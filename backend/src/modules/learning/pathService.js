// src/modules/learning/pathService.js
//
// Business logic behind /learning-paths. Every function takes an `actor`
// ({ id, tenantId, roles, activeRole, activeRoleId }) and enforces:
//  - Rule 3: every query is scoped by tenant_id
//  - Rule 4: every state change writes an audit event in the same transaction
//  - Rule 6: path items reference learning_assets via asset_id (FK), never
//    free text — asset_id and proficiency_level_id are validated against the
//    tenant's catalogue before insert
//  - Rule 7: GET hides draft/retired paths from anyone who isn't the creator,
//    doesn't hold learning.paths.create, and has no assignment against the path

const { randomUUID } = require('crypto')
const db = require('../../db')
const auditLog = require('../audit/auditLog')
const configService = require('../config/configService')
const workflowService = require('../workflow/workflowService')
const permissionEngine = require('../roles/permissionEngine')

const { AuditActions } = auditLog

const PATH_TYPES = ['competency', 'career', 'certification', 'development', 'strategic']
const NODE_TYPES = ['content', 'quiz']
const CONTENT_ITEM_TYPES = ['video', 'article', 'pdf', 'scorm', 'external_link']

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function serializePathItem(row) {
  return {
    id: row.id,
    itemOrder: row.item_order,
    isMandatory: row.is_mandatory,
    prerequisiteItemId: row.prerequisite_item_id,
    asset: {
      id: row.asset_id,
      title: row.asset_title,
      contentType: row.asset_content_type,
      durationMinutes: row.asset_duration_minutes,
      status: row.asset_status,
      proficiencyLevel: row.asset_proficiency_level_id ? {
        id: row.asset_proficiency_level_id,
        name: row.asset_proficiency_level_name,
        levelOrder: row.asset_proficiency_level_order
      } : null
    }
  }
}

function serializePath(row, items = []) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    pathType: row.path_type,
    proficiencyLevel: row.proficiency_level_id ? {
      id: row.proficiency_level_id,
      name: row.proficiency_level_name,
      levelOrder: row.proficiency_level_order
    } : null,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map(serializePathItem)
  }
}

/** Fetch a learning path with its proficiency level and ordered items+assets (Rule 6). `runner` is db or a tx client. */
async function fetchPathWithItems(runner, tenantId, pathId) {
  const pathResult = await runner.query(
    `SELECT lp.*, pl.name AS proficiency_level_name, pl.level_order AS proficiency_level_order
     FROM learning_paths lp
     LEFT JOIN proficiency_levels pl ON pl.id = lp.proficiency_level_id
     WHERE lp.id = $1 AND lp.tenant_id = $2`,
    [pathId, tenantId]
  )
  const path = pathResult.rows[0]
  if (!path) return null

  const itemsResult = await runner.query(
    `SELECT lpi.*, la.title AS asset_title, la.content_type AS asset_content_type,
            la.duration_minutes AS asset_duration_minutes, la.status AS asset_status,
            la.proficiency_level_id AS asset_proficiency_level_id,
            apl.name AS asset_proficiency_level_name, apl.level_order AS asset_proficiency_level_order
     FROM learning_path_items lpi
     JOIN learning_assets la ON la.id = lpi.asset_id
     LEFT JOIN proficiency_levels apl ON apl.id = la.proficiency_level_id
     WHERE lpi.path_id = $1
     ORDER BY lpi.item_order ASC`,
    [pathId]
  )

  return serializePath(path, itemsResult.rows)
}

/** Resource-level visibility failure (Rule 7) — actor passed requirePermission(learning.paths.view) but this path isn't visible to them. */
async function recordAccessViolation({ actor, action, entityId, ipAddress, userAgent }) {
  await auditLog.write({
    tenantId: actor.tenantId,
    actorUserId: actor.id,
    actorRoleAtTime: actor.roles?.join(','),
    actionType: AuditActions.ACCESS_VIOLATION,
    entityType: 'LearningPath',
    entityId,
    ipAddress,
    userAgent,
    result: 'failure',
    metadata: { action, reason: 'path_not_visible' }
  })
}

/** Returns the subset of `assetIds` that do not exist for this tenant (Rule 6 — FK, never free text). */
async function findMissingAssetIds(tenantId, assetIds) {
  if (assetIds.length === 0) return []
  const result = await db.query(`SELECT id FROM learning_assets WHERE tenant_id = $1 AND id = ANY($2)`, [tenantId, assetIds])
  const found = new Set(result.rows.map((r) => r.id))
  return [...new Set(assetIds)].filter((id) => !found.has(id))
}

/** Returns the subset of `skillIds` that do not exist for this tenant (Rule 6 — FK, never free text). */
async function findMissingSkillIds(tenantId, skillIds) {
  if (skillIds.length === 0) return []
  const result = await db.query(`SELECT id FROM skills WHERE tenant_id = $1 AND id = ANY($2)`, [tenantId, skillIds])
  const found = new Set(result.rows.map((r) => r.id))
  return [...new Set(skillIds)].filter((id) => !found.has(id))
}

/** Rule 1 — validate a status change against configurations.learning.status_transitions. Returns an error string, or null if allowed. */
async function checkTransition(tenantId, currentStatus, targetStatus) {
  const transitions = await configService.get(tenantId, 'learning', 'status_transitions')
  if (!transitions) return 'Learning path status transitions are not configured'
  const allowed = transitions[currentStatus] || []
  if (!allowed.includes(targetStatus)) {
    return `Cannot transition learning path from '${currentStatus}' to '${targetStatus}'`
  }
  return null
}

// ---------------------------------------------------------------------------
// Node-based paths (path builder) — shared helpers
// ---------------------------------------------------------------------------

function serializePathNodeItem(row) {
  return {
    id: row.id,
    itemOrder: row.item_order,
    assetId: row.asset_id,
    title: row.asset_id ? row.asset_title : row.title,
    contentType: row.asset_id ? row.asset_content_type : row.content_type,
    durationMinutes: row.asset_id ? row.asset_duration_minutes : row.duration_minutes,
    externalUrl: row.external_url,
    body: row.body
  }
}

function serializePathNodeQuestion(row, options) {
  return {
    id: row.id,
    questionText: row.question_text,
    questionOrder: row.question_order,
    options: options.map((opt) => ({
      id: opt.id,
      text: opt.option_text,
      isCorrect: opt.is_correct,
      optionOrder: opt.option_order
    }))
  }
}

/** Serialize a node-based learning path (path builder) — separate from serializePath (items-based, migration 017). */
function serializePathWithNodes(row, nodeRows = [], itemRows = [], questionRows = [], optionRows = [], skillRows = []) {
  if (!row) return null

  const optionsByQuestion = new Map()
  for (const opt of optionRows) {
    if (!optionsByQuestion.has(opt.question_id)) optionsByQuestion.set(opt.question_id, [])
    optionsByQuestion.get(opt.question_id).push(opt)
  }

  const questionsByNode = new Map()
  for (const q of questionRows) {
    if (!questionsByNode.has(q.node_id)) questionsByNode.set(q.node_id, [])
    questionsByNode.get(q.node_id).push(serializePathNodeQuestion(q, optionsByQuestion.get(q.id) || []))
  }

  const itemsByNode = new Map()
  for (const item of itemRows) {
    if (!itemsByNode.has(item.node_id)) itemsByNode.set(item.node_id, [])
    itemsByNode.get(item.node_id).push(serializePathNodeItem(item))
  }

  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    pathType: row.path_type,
    proficiencyLevel: row.proficiency_level_id ? {
      id: row.proficiency_level_id,
      name: row.proficiency_level_name,
      levelOrder: row.proficiency_level_order
    } : null,
    estimatedDurationMinutes: row.estimated_duration_minutes,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    skills: skillRows.map((s) => ({ id: s.id, name: s.name })),
    nodes: nodeRows.map((node) => ({
      id: node.id,
      type: node.type,
      title: node.title,
      coins: node.coins,
      nodeOrder: node.node_order,
      items: itemsByNode.get(node.id) || [],
      questions: questionsByNode.get(node.id) || []
    }))
  }
}

/** Fetch a node-based learning path: nodes, items (with asset relations), quiz questions+options, and linked skills (Rule 6). `runner` is db or a tx client. */
async function fetchPathWithNodes(runner, tenantId, pathId) {
  const pathResult = await runner.query(
    `SELECT lp.*, pl.name AS proficiency_level_name, pl.level_order AS proficiency_level_order
     FROM learning_paths lp
     LEFT JOIN proficiency_levels pl ON pl.id = lp.proficiency_level_id
     WHERE lp.id = $1 AND lp.tenant_id = $2`,
    [pathId, tenantId]
  )
  const path = pathResult.rows[0]
  if (!path) return null

  const nodesResult = await runner.query(
    `SELECT * FROM path_nodes WHERE path_id = $1 ORDER BY node_order ASC`,
    [pathId]
  )

  const itemsResult = await runner.query(
    `SELECT pni.*, la.title AS asset_title, la.content_type AS asset_content_type, la.duration_minutes AS asset_duration_minutes
     FROM path_node_items pni
     JOIN path_nodes pn ON pn.id = pni.node_id
     LEFT JOIN learning_assets la ON la.id = pni.asset_id
     WHERE pn.path_id = $1
     ORDER BY pn.node_order ASC, pni.item_order ASC`,
    [pathId]
  )

  const questionsResult = await runner.query(
    `SELECT pnq.*
     FROM path_node_questions pnq
     JOIN path_nodes pn ON pn.id = pnq.node_id
     WHERE pn.path_id = $1
     ORDER BY pn.node_order ASC, pnq.question_order ASC`,
    [pathId]
  )

  const optionsResult = await runner.query(
    `SELECT pnqo.*
     FROM path_node_question_options pnqo
     JOIN path_node_questions pnq ON pnq.id = pnqo.question_id
     JOIN path_nodes pn ON pn.id = pnq.node_id
     WHERE pn.path_id = $1
     ORDER BY pn.node_order ASC, pnq.question_order ASC, pnqo.option_order ASC`,
    [pathId]
  )

  const skillsResult = await runner.query(
    `SELECT s.id, s.name FROM learning_path_skills lps JOIN skills s ON s.id = lps.skill_id WHERE lps.path_id = $1`,
    [pathId]
  )

  return serializePathWithNodes(path, nodesResult.rows, itemsResult.rows, questionsResult.rows, optionsResult.rows, skillsResult.rows)
}

/** Collect every asset_id referenced by a node's items, for the Rule 6 FK check. */
function collectAssetIds(nodes) {
  const ids = []
  for (const node of nodes || []) {
    for (const item of node.items || []) {
      if (item.asset_id) ids.push(item.asset_id)
    }
  }
  return ids
}

function validateNodesInput(input) {
  const errors = []

  if (!input.title || !String(input.title).trim()) errors.push('title is required')

  if (!input.path_type) {
    errors.push('path_type is required')
  } else if (!PATH_TYPES.includes(input.path_type)) {
    errors.push(`path_type must be one of: ${PATH_TYPES.join(', ')}`)
  }

  if (input.proficiency_level_name !== undefined && input.proficiency_level_name !== null
      && typeof input.proficiency_level_name !== 'string') {
    errors.push('proficiency_level_name must be a string')
  }

  if (input.skill_ids !== undefined && !Array.isArray(input.skill_ids)) {
    errors.push('skill_ids must be an array')
  }

  if (input.estimated_duration_minutes !== undefined && input.estimated_duration_minutes !== null) {
    if (!Number.isInteger(input.estimated_duration_minutes) || input.estimated_duration_minutes < 0) {
      errors.push('estimated_duration_minutes must be a non-negative integer')
    }
  }

  if (!Array.isArray(input.nodes)) {
    errors.push('nodes must be an array')
    return errors
  }

  const nodeOrders = new Set()
  for (const [i, node] of input.nodes.entries()) {
    if (!NODE_TYPES.includes(node.type)) {
      errors.push(`nodes[${i}].type must be one of: ${NODE_TYPES.join(', ')}`)
    }

    if (!Number.isInteger(node.node_order) || node.node_order <= 0) {
      errors.push(`nodes[${i}].node_order must be a positive integer`)
    } else if (nodeOrders.has(node.node_order)) {
      errors.push(`nodes[${i}].node_order ${node.node_order} is duplicated`)
    } else {
      nodeOrders.add(node.node_order)
    }

    if (node.coins !== undefined && (!Number.isInteger(node.coins) || node.coins < 0)) {
      errors.push(`nodes[${i}].coins must be a non-negative integer`)
    }

    const itemOrders = new Set()
    for (const [j, item] of (node.items || []).entries()) {
      if (!Number.isInteger(item.item_order) || item.item_order <= 0) {
        errors.push(`nodes[${i}].items[${j}].item_order must be a positive integer`)
      } else if (itemOrders.has(item.item_order)) {
        errors.push(`nodes[${i}].items[${j}].item_order ${item.item_order} is duplicated`)
      } else {
        itemOrders.add(item.item_order)
      }

      if (!item.asset_id && item.content_type && !CONTENT_ITEM_TYPES.includes(item.content_type)) {
        errors.push(`nodes[${i}].items[${j}].content_type must be one of: ${CONTENT_ITEM_TYPES.join(', ')}`)
      }
    }

    const questionOrders = new Set()
    for (const [j, question] of (node.questions || []).entries()) {
      if (!Number.isInteger(question.question_order) || question.question_order <= 0) {
        errors.push(`nodes[${i}].questions[${j}].question_order must be a positive integer`)
      } else if (questionOrders.has(question.question_order)) {
        errors.push(`nodes[${i}].questions[${j}].question_order ${question.question_order} is duplicated`)
      } else {
        questionOrders.add(question.question_order)
      }

      const optionOrders = new Set()
      for (const [k, option] of (question.options || []).entries()) {
        if (!Number.isInteger(option.option_order) || option.option_order <= 0) {
          errors.push(`nodes[${i}].questions[${j}].options[${k}].option_order must be a positive integer`)
        } else if (optionOrders.has(option.option_order)) {
          errors.push(`nodes[${i}].questions[${j}].options[${k}].option_order ${option.option_order} is duplicated`)
        } else {
          optionOrders.add(option.option_order)
        }
      }
    }
  }

  return errors
}

/** Insert `nodes` (and their items/questions/options) under `pathId`. Used by create, update (after a delete-and-reinsert), and duplicate. */
async function insertNodes(client, pathId, nodes) {
  for (const node of nodes || []) {
    const nodeId = randomUUID()
    await client.query(
      `INSERT INTO path_nodes (id, path_id, type, title, coins, node_order) VALUES ($1,$2,$3,$4,$5,$6)`,
      [nodeId, pathId, node.type, node.title || '', node.coins || 0, node.node_order]
    )

    for (const item of node.items || []) {
      await client.query(
        `INSERT INTO path_node_items (id, node_id, asset_id, title, content_type, duration_minutes, external_url, body, item_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          randomUUID(),
          nodeId,
          item.asset_id || null,
          item.asset_id ? null : (item.title || null),
          item.asset_id ? null : (item.content_type || null),
          item.duration_minutes ?? null,
          item.external_url || null,
          item.body || null,
          item.item_order
        ]
      )
    }

    for (const question of node.questions || []) {
      const questionId = randomUUID()
      await client.query(
        `INSERT INTO path_node_questions (id, node_id, question_text, question_order) VALUES ($1,$2,$3,$4)`,
        [questionId, nodeId, question.question_text || '', question.question_order]
      )

      for (const option of question.options || []) {
        await client.query(
          `INSERT INTO path_node_question_options (id, question_id, option_text, is_correct, option_order) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), questionId, option.text || '', !!option.is_correct, option.option_order]
        )
      }
    }
  }
}

// ---------------------------------------------------------------------------
// POST /learning-paths
// ---------------------------------------------------------------------------

function validateCreateInput(input) {
  const errors = []

  if (!input.title) errors.push('title is required')

  if (!input.path_type) {
    errors.push('path_type is required')
  } else if (!PATH_TYPES.includes(input.path_type)) {
    errors.push(`path_type must be one of: ${PATH_TYPES.join(', ')}`)
  }

  if (input.estimated_duration_minutes !== undefined && input.estimated_duration_minutes !== null) {
    if (!Number.isInteger(input.estimated_duration_minutes) || input.estimated_duration_minutes <= 0) {
      errors.push('estimated_duration_minutes must be a positive integer')
    }
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    errors.push('items must be a non-empty array')
    return errors
  }

  const orders = new Set()
  for (const [i, item] of input.items.entries()) {
    if (!item.asset_id) errors.push(`items[${i}].asset_id is required`)

    if (!Number.isInteger(item.item_order) || item.item_order <= 0) {
      errors.push(`items[${i}].item_order must be a positive integer`)
    } else if (orders.has(item.item_order)) {
      errors.push(`items[${i}].item_order ${item.item_order} is duplicated`)
    } else {
      orders.add(item.item_order)
    }
  }

  for (const [i, item] of input.items.entries()) {
    if (item.prerequisite_item_order === undefined || item.prerequisite_item_order === null) continue
    if (item.prerequisite_item_order === item.item_order) {
      errors.push(`items[${i}].prerequisite_item_order cannot reference itself`)
    } else if (!orders.has(item.prerequisite_item_order)) {
      errors.push(`items[${i}].prerequisite_item_order ${item.prerequisite_item_order} does not match any item_order in items`)
    }
  }

  return errors
}

async function createPath({ actor, input, ipAddress, userAgent }) {
  const errors = validateCreateInput(input)
  if (errors.length > 0) {
    return { ok: false, status: 400, error: errors.join('; ') }
  }

  if (input.proficiency_level_id) {
    const proficiencyResult = await db.query(
      `SELECT id FROM proficiency_levels WHERE id = $1 AND tenant_id = $2`,
      [input.proficiency_level_id, actor.tenantId]
    )
    if (proficiencyResult.rows.length === 0) {
      return { ok: false, status: 400, error: 'proficiency_level_id does not exist for this tenant' }
    }
  }

  const missingAssets = await findMissingAssetIds(actor.tenantId, input.items.map((item) => item.asset_id))
  if (missingAssets.length > 0) {
    return { ok: false, status: 400, error: `Unknown asset_ids: ${missingAssets.join(', ')}` }
  }

  const pathId = randomUUID()
  const itemIds = input.items.map(() => randomUUID())
  const orderToItemId = new Map(input.items.map((item, i) => [item.item_order, itemIds[i]]))

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO learning_paths
         (id, tenant_id, title, description, path_type, proficiency_level_id, estimated_duration_minutes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        pathId, actor.tenantId, input.title, input.description || null, input.path_type,
        input.proficiency_level_id || null, input.estimated_duration_minutes || null, actor.id
      ]
    )

    for (const [i, item] of input.items.entries()) {
      const prerequisiteItemId = item.prerequisite_item_order != null
        ? orderToItemId.get(item.prerequisite_item_order)
        : null

      await client.query(
        `INSERT INTO learning_path_items (id, path_id, asset_id, item_order, is_mandatory, prerequisite_item_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [itemIds[i], pathId, item.asset_id, item.item_order, item.is_mandatory !== false, prerequisiteItemId]
      )
    }

    const created = await fetchPathWithItems(client, actor.tenantId, pathId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.LEARNING_PATH_CREATED,
      entityType: 'LearningPath',
      entityId: pathId,
      newValue: created,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 201, path: created }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced asset or proficiency level does not exist' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid path_type or other constrained value' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /learning-paths/:id
// ---------------------------------------------------------------------------

async function getPathById({ actor, pathId, ipAddress, userAgent }) {
  const path = await fetchPathWithItems(db, actor.tenantId, pathId)
  if (!path) {
    return { ok: false, status: 404, error: 'Learning path not found' }
  }

  if (path.status !== 'published' && path.createdBy !== actor.id) {
    const canManage = await permissionEngine.hasPermission(actor, 'create', 'learning', 'paths')
    if (!canManage) {
      const assignedResult = await db.query(
        `SELECT 1 FROM assignments WHERE tenant_id = $1 AND path_id = $2 AND assigned_to = $3 LIMIT 1`,
        [actor.tenantId, pathId, actor.id]
      )
      if (assignedResult.rows.length === 0) {
        await recordAccessViolation({ actor, action: 'learning.paths.view', entityId: pathId, ipAddress, userAgent })
        return { ok: false, status: 403, error: 'Forbidden' }
      }
    }
  }

  return { ok: true, path }
}

// ---------------------------------------------------------------------------
// POST /learning-paths (node-based payload — path builder)
// ---------------------------------------------------------------------------

async function resolveProficiencyLevelId(tenantId, name) {
  if (!name) return { ok: true, id: null }
  const levelResult = await db.query(
    `SELECT id FROM proficiency_levels WHERE tenant_id = $1 AND name = $2`,
    [tenantId, name]
  )
  if (levelResult.rows.length === 0) {
    return { ok: false, status: 400, error: `Unknown proficiency_level_name: ${name}` }
  }
  return { ok: true, id: levelResult.rows[0].id }
}

async function createPathWithNodes({ actor, input, ipAddress, userAgent }) {
  const errors = validateNodesInput(input)
  if (errors.length > 0) {
    return { ok: false, status: 400, error: errors.join('; ') }
  }

  const level = await resolveProficiencyLevelId(actor.tenantId, input.proficiency_level_name)
  if (!level.ok) return level

  const skillIds = [...new Set(input.skill_ids || [])]
  const missingSkills = await findMissingSkillIds(actor.tenantId, skillIds)
  if (missingSkills.length > 0) {
    return { ok: false, status: 400, error: `Unknown skill_ids: ${missingSkills.join(', ')}` }
  }

  const missingAssets = await findMissingAssetIds(actor.tenantId, collectAssetIds(input.nodes))
  if (missingAssets.length > 0) {
    return { ok: false, status: 400, error: `Unknown asset_ids: ${missingAssets.join(', ')}` }
  }

  const pathId = randomUUID()

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO learning_paths
         (id, tenant_id, title, description, path_type, proficiency_level_id, estimated_duration_minutes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)`,
      [
        pathId, actor.tenantId, input.title, input.description || null, input.path_type,
        level.id, input.estimated_duration_minutes || null, actor.id
      ]
    )

    await insertNodes(client, pathId, input.nodes)

    for (const skillId of skillIds) {
      await client.query(`INSERT INTO learning_path_skills (path_id, skill_id) VALUES ($1, $2)`, [pathId, skillId])
    }

    const created = await fetchPathWithNodes(client, actor.tenantId, pathId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.LEARNING_PATH_CREATED,
      entityType: 'LearningPath',
      entityId: pathId,
      newValue: created,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 201, path: created }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced asset, skill, or proficiency level does not exist' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid path_type, node type, or other constrained value' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// PUT /learning-paths/:id
// ---------------------------------------------------------------------------

async function updatePath({ actor, pathId, input, ipAddress, userAgent }) {
  const errors = validateNodesInput(input)
  if (errors.length > 0) {
    return { ok: false, status: 400, error: errors.join('; ') }
  }

  const level = await resolveProficiencyLevelId(actor.tenantId, input.proficiency_level_name)
  if (!level.ok) return level

  const skillIds = [...new Set(input.skill_ids || [])]
  const missingSkills = await findMissingSkillIds(actor.tenantId, skillIds)
  if (missingSkills.length > 0) {
    return { ok: false, status: 400, error: `Unknown skill_ids: ${missingSkills.join(', ')}` }
  }

  const missingAssets = await findMissingAssetIds(actor.tenantId, collectAssetIds(input.nodes))
  if (missingAssets.length > 0) {
    return { ok: false, status: 400, error: `Unknown asset_ids: ${missingAssets.join(', ')}` }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(`SELECT * FROM learning_paths WHERE id = $1 AND tenant_id = $2`, [pathId, actor.tenantId])
    const current = currentResult.rows[0]
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning path not found' }
    }

    if (current.created_by !== actor.id) {
      const canManageAny = await permissionEngine.hasPermission(actor, 'approve', 'learning', 'paths')
      if (!canManageAny) {
        await client.query('ROLLBACK')
        await recordAccessViolation({ actor, action: 'learning.paths.edit', entityId: pathId, ipAddress, userAgent })
        return { ok: false, status: 403, error: 'Forbidden' }
      }
    }

    const before = await fetchPathWithNodes(client, actor.tenantId, pathId)

    await client.query(
      `UPDATE learning_paths
       SET title = $1, description = $2, path_type = $3, proficiency_level_id = $4, estimated_duration_minutes = $5, updated_at = NOW()
       WHERE id = $6`,
      [input.title, input.description || null, input.path_type, level.id, input.estimated_duration_minutes || null, pathId]
    )

    await client.query(`DELETE FROM path_nodes WHERE path_id = $1`, [pathId])
    await client.query(`DELETE FROM learning_path_skills WHERE path_id = $1`, [pathId])

    await insertNodes(client, pathId, input.nodes)
    for (const skillId of skillIds) {
      await client.query(`INSERT INTO learning_path_skills (path_id, skill_id) VALUES ($1, $2)`, [pathId, skillId])
    }

    const after = await fetchPathWithNodes(client, actor.tenantId, pathId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.LEARNING_PATH_UPDATED,
      entityType: 'LearningPath',
      entityId: pathId,
      oldValue: before,
      newValue: after,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 200, path: after }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced asset, skill, or proficiency level does not exist' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid path_type, node type, or other constrained value' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /learning-paths/:id/submit-review
// ---------------------------------------------------------------------------

async function submitForReview({ actor, pathId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(`SELECT * FROM learning_paths WHERE id = $1 AND tenant_id = $2`, [pathId, actor.tenantId])
    const current = currentResult.rows[0]
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning path not found' }
    }

    if (current.created_by !== actor.id) {
      const canManageAny = await permissionEngine.hasPermission(actor, 'approve', 'learning', 'paths')
      if (!canManageAny) {
        await client.query('ROLLBACK')
        await recordAccessViolation({ actor, action: 'learning.paths.edit', entityId: pathId, ipAddress, userAgent })
        return { ok: false, status: 403, error: 'Forbidden' }
      }
    }

    const transitionError = await checkTransition(actor.tenantId, current.status, 'in_review')
    if (transitionError) {
      await client.query('ROLLBACK')
      return { ok: false, status: 409, error: transitionError }
    }

    await client.query(`UPDATE learning_paths SET status = 'in_review', updated_at = NOW() WHERE id = $1`, [pathId])

    const definitionResult = await client.query(
      `SELECT id FROM workflow_definitions
       WHERE tenant_id = $1 AND module = 'learning' AND trigger_event = 'learning_path.submitted' AND is_active = TRUE
       ORDER BY version DESC LIMIT 1`,
      [actor.tenantId]
    )
    const definition = definitionResult.rows[0]
    if (!definition) {
      await client.query('ROLLBACK')
      return { ok: false, status: 500, error: 'No active learning path review workflow is configured' }
    }

    const { instance, tasks } = await workflowService.startWorkflow(definition.id, 'LearningPath', pathId, actor.id, client)

    const updated = await fetchPathWithNodes(client, actor.tenantId, pathId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.LEARNING_PATH_SUBMITTED,
      entityType: 'LearningPath',
      entityId: pathId,
      oldValue: { status: current.status },
      newValue: { status: 'in_review' },
      ipAddress,
      userAgent,
      result: 'success',
      metadata: { workflowInstanceId: instance.id }
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 200, path: updated, workflow: { instance, tasks } }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /learning-paths/:id/publish
// ---------------------------------------------------------------------------

async function publishPath({ actor, pathId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(`SELECT * FROM learning_paths WHERE id = $1 AND tenant_id = $2`, [pathId, actor.tenantId])
    const current = currentResult.rows[0]
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning path not found' }
    }

    const transitionError = await checkTransition(actor.tenantId, current.status, 'published')
    if (transitionError) {
      await client.query('ROLLBACK')
      return { ok: false, status: 409, error: transitionError }
    }

    if (current.status === 'draft') {
      const bypassRoles = (await configService.get(actor.tenantId, 'learning', 'publish_bypass_roles')) || []
      if (!bypassRoles.includes(actor.activeRole)) {
        await client.query('ROLLBACK')
        return { ok: false, status: 409, error: 'Learning path must go through review (in_review) before publishing' }
      }
    }

    await client.query(`UPDATE learning_paths SET status = 'published', updated_at = NOW() WHERE id = $1`, [pathId])
    const updated = await fetchPathWithNodes(client, actor.tenantId, pathId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.LEARNING_PATH_PUBLISHED,
      entityType: 'LearningPath',
      entityId: pathId,
      oldValue: { status: current.status },
      newValue: { status: 'published' },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 200, path: updated }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /learning-paths/:id/duplicate
// ---------------------------------------------------------------------------

async function duplicatePath({ actor, pathId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const original = await fetchPathWithNodes(client, actor.tenantId, pathId)
    if (!original) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning path not found' }
    }

    if (original.createdBy !== actor.id && original.status !== 'published') {
      const canManageAny = await permissionEngine.hasPermission(actor, 'approve', 'learning', 'paths')
      if (!canManageAny) {
        await client.query('ROLLBACK')
        await recordAccessViolation({ actor, action: 'learning.paths.edit', entityId: pathId, ipAddress, userAgent })
        return { ok: false, status: 403, error: 'Forbidden' }
      }
    }

    const newPathId = randomUUID()
    await client.query(
      `INSERT INTO learning_paths
         (id, tenant_id, title, description, path_type, proficiency_level_id, estimated_duration_minutes, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)`,
      [
        newPathId, actor.tenantId, `${original.title} (Copy)`, original.description, original.pathType,
        original.proficiencyLevel?.id || null, original.estimatedDurationMinutes, actor.id
      ]
    )

    await insertNodes(client, newPathId, original.nodes.map((node) => ({
      type: node.type,
      title: node.title,
      coins: node.coins,
      node_order: node.nodeOrder,
      items: node.items.map((item) => ({
        asset_id: item.assetId,
        title: item.assetId ? undefined : item.title,
        content_type: item.assetId ? undefined : item.contentType,
        duration_minutes: item.assetId ? undefined : item.durationMinutes,
        external_url: item.externalUrl,
        body: item.body,
        item_order: item.itemOrder
      })),
      questions: node.questions.map((question) => ({
        question_text: question.questionText,
        question_order: question.questionOrder,
        options: question.options.map((option) => ({
          text: option.text,
          is_correct: option.isCorrect,
          option_order: option.optionOrder
        }))
      }))
    })))

    for (const skill of original.skills) {
      await client.query(`INSERT INTO learning_path_skills (path_id, skill_id) VALUES ($1, $2)`, [newPathId, skill.id])
    }

    const created = await fetchPathWithNodes(client, actor.tenantId, newPathId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.LEARNING_PATH_DUPLICATED,
      entityType: 'LearningPath',
      entityId: newPathId,
      oldValue: { sourcePathId: pathId },
      newValue: created,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 201, path: created }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /learning-paths
// ---------------------------------------------------------------------------

/** Rule 7 — ld_admin/super_admin see every path in the tenant; everyone else sees their own paths (any status) plus published paths. */
async function getAllPaths({ actor }) {
  const conditions = ['lp.tenant_id = $1']
  const params = [actor.tenantId]

  if (actor.visibilityScope?.type !== 'all') {
    params.push(actor.id)
    conditions.push(`(lp.created_by = $${params.length} OR lp.status = 'published')`)
  }

  const result = await db.query(
    `SELECT lp.id, lp.title, lp.description, lp.status, lp.estimated_duration_minutes, lp.created_by, lp.created_at,
            COALESCE(node_counts.node_count, 0) AS node_count,
            COALESCE(node_counts.total_coins, 0) AS total_coins,
            COALESCE(skill_names.skills, ARRAY[]::text[]) AS skills,
            COALESCE(up.preferred_name, up.first_name || ' ' || up.last_name, u.email) AS created_by_name
     FROM learning_paths lp
     LEFT JOIN users u ON u.id = lp.created_by
     LEFT JOIN user_profiles up ON up.user_id = lp.created_by
     LEFT JOIN (
       SELECT path_id, COUNT(*) AS node_count, COALESCE(SUM(coins), 0) AS total_coins
       FROM path_nodes GROUP BY path_id
     ) node_counts ON node_counts.path_id = lp.id
     LEFT JOIN (
       SELECT lps.path_id, array_agg(s.name) AS skills
       FROM learning_path_skills lps
       JOIN skills s ON s.id = lps.skill_id
       GROUP BY lps.path_id
     ) skill_names ON skill_names.path_id = lp.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY lp.created_at DESC`,
    params
  )

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    node_count: Number(row.node_count),
    duration_minutes: row.estimated_duration_minutes || 0,
    total_coins: Number(row.total_coins),
    skills: row.skills || [],
    created_by: row.created_by_name,
    created_at: row.created_at
  }))
}

module.exports = {
  createPath,
  getPathById,
  createPathWithNodes,
  updatePath,
  submitForReview,
  publishPath,
  duplicatePath,
  getAllPaths,
  // exported for tests / reuse
  serializePath,
  serializePathWithNodes
}
