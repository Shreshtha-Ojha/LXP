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
const permissionEngine = require('../roles/permissionEngine')

const { AuditActions } = auditLog

const PATH_TYPES = ['competency', 'career', 'certification', 'development', 'strategic']

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

module.exports = {
  createPath,
  getPathById,
  // exported for tests / reuse
  serializePath
}
