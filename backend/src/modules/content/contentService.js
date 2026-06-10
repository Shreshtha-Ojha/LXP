// src/modules/content/contentService.js
//
// Business logic behind /content/assets. Every function takes an `actor`
// ({ id, tenantId, roles, activeRole, activeRoleId }) and enforces:
//  - Rule 1: status transitions and the publish-review bypass come from
//    the `configurations` table (content.status_transitions /
//    content.publish_bypass_roles), never hardcoded status/role checks
//  - Rule 3: every query is scoped by tenant_id
//  - Rule 4: every state change writes an audit event in the same transaction
//  - Rule 5: submit-review goes through workflowService.startWorkflow —
//    no inline approval logic here
//  - Rule 6: skills are linked via learning_asset_skills (FK), never free text
//  - Rule 7: GET hides draft/in_review/retired assets from anyone who isn't
//    the author or doesn't hold content.assets edit permission

const { randomUUID } = require('crypto')
const db = require('../../db')
const auditLog = require('../audit/auditLog')
const configService = require('../config/configService')
const workflowService = require('../workflow/workflowService')
const permissionEngine = require('../roles/permissionEngine')
const contentStorage = require('./contentStorage')

const { AuditActions } = auditLog

const CONTENT_TYPES = ['video', 'pdf', 'article', 'scorm', 'external_link']
const FILE_CONTENT_TYPES = ['pdf', 'scorm']

const REQUIRED_FIELDS = ['title', 'description', 'content_type', 'proficiency_level_id', 'duration_minutes', 'language', 'skill_ids', 'tags']

const VIDEO_URL_RE = /^https?:\/\/([^/]*\.)?(youtube\.com|youtu\.be|vimeo\.com)\//i
const HTTP_URL_RE = /^https?:\/\//i

const PDF_MAGIC = Buffer.from('%PDF')
const ZIP_MAGIC = Buffer.from([0x50, 0x4b]) // 'PK' — SCORM packages are zip archives

const ASSET_FIELD_MAP = {
  title: 'title',
  description: 'description',
  proficiency_level_id: 'proficiency_level_id',
  duration_minutes: 'duration_minutes',
  language: 'language',
  version: 'version',
  effective_from: 'effective_from',
  effective_to: 'effective_to',
  external_url: 'external_url'
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function serializeAsset(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    title: row.title,
    description: row.description,
    contentType: row.content_type,
    proficiencyLevel: row.proficiency_level_id ? {
      id: row.proficiency_level_id,
      name: row.proficiency_level_name,
      levelOrder: row.proficiency_level_order
    } : null,
    durationMinutes: row.duration_minutes,
    language: row.language,
    version: row.version,
    status: row.status,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    authorUserId: row.author_user_id,
    storageUrl: row.storage_url,
    externalUrl: row.external_url,
    tags: row.tags || [],
    skills: row.skills || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Fetch a learning asset with its proficiency level and linked skills (Rule 6). `runner` is db or a tx client. */
async function fetchAssetWithRelations(runner, tenantId, assetId) {
  const result = await runner.query(
    `SELECT la.*, pl.name AS proficiency_level_name, pl.level_order AS proficiency_level_order,
            COALESCE(
              array_agg(DISTINCT jsonb_build_object('id', s.id, 'name', s.name)) FILTER (WHERE s.id IS NOT NULL),
              ARRAY[]::jsonb[]
            ) AS skills
     FROM learning_assets la
     LEFT JOIN proficiency_levels pl ON pl.id = la.proficiency_level_id
     LEFT JOIN learning_asset_skills las ON las.asset_id = la.id
     LEFT JOIN skills s ON s.id = las.skill_id
     WHERE la.id = $1 AND la.tenant_id = $2
     GROUP BY la.id, pl.name, pl.level_order`,
    [assetId, tenantId]
  )
  return serializeAsset(result.rows[0])
}

/** Resource-level visibility failure (Rule 7) — actor passed requirePermission(content.assets.view) but this asset isn't visible to them. */
async function recordAccessViolation({ actor, action, entityId, ipAddress, userAgent }) {
  await auditLog.write({
    tenantId: actor.tenantId,
    actorUserId: actor.id,
    actorRoleAtTime: actor.roles?.join(','),
    actionType: AuditActions.ACCESS_VIOLATION,
    entityType: 'LearningAsset',
    entityId,
    ipAddress,
    userAgent,
    result: 'failure',
    metadata: { action, reason: 'content_not_visible' }
  })
}

/** Returns the subset of `skillIds` that do not exist for this tenant (Rule 6 — FK, never free text). */
async function findMissingSkillIds(tenantId, skillIds) {
  if (skillIds.length === 0) return []
  const result = await db.query(`SELECT id FROM skills WHERE tenant_id = $1 AND id = ANY($2)`, [tenantId, skillIds])
  const found = new Set(result.rows.map((r) => r.id))
  return skillIds.filter((id) => !found.has(id))
}

/** Rule 1 — validate a status change against configurations.content.status_transitions. Returns an error string, or null if allowed. */
async function checkTransition(tenantId, currentStatus, targetStatus) {
  const transitions = await configService.get(tenantId, 'content', 'status_transitions')
  if (!transitions) return 'Content status transitions are not configured'
  const allowed = transitions[currentStatus] || []
  if (!allowed.includes(targetStatus)) {
    return `Cannot transition content from '${currentStatus}' to '${targetStatus}'`
  }
  return null
}

/** Map an input object's recognised keys onto DB column names via a fixed allow-list. */
function pickColumns(input, fieldMap) {
  const result = {}
  for (const [inputKey, column] of Object.entries(fieldMap)) {
    if (Object.prototype.hasOwnProperty.call(input, inputKey)) {
      result[column] = input[inputKey]
    }
  }
  return result
}

function buildSetClause(columnValues, startIndex) {
  const columns = Object.keys(columnValues)
  const clause = columns.map((col, i) => `${col} = $${startIndex + i}`).join(', ')
  const values = columns.map((col) => columnValues[col])
  return { clause, values }
}

// ---------------------------------------------------------------------------
// POST /content/assets
// ---------------------------------------------------------------------------

function validateFileHeader(contentType, file) {
  const buffer = file?.buffer
  if (contentType === 'pdf') {
    if (!buffer || buffer.length < 4 || !buffer.subarray(0, 4).equals(PDF_MAGIC)) {
      return 'Uploaded file does not have a valid PDF header'
    }
  }
  if (contentType === 'scorm') {
    if (!buffer || buffer.length < 2 || !buffer.subarray(0, 2).equals(ZIP_MAGIC)) {
      return 'Uploaded file does not have a valid SCORM (zip) header'
    }
  }
  return null
}

function validateCreateInput(input, file) {
  const errors = []

  for (const field of REQUIRED_FIELDS) {
    if (input[field] === undefined || input[field] === null || input[field] === '') {
      errors.push(`${field} is required`)
    }
  }
  if (errors.length > 0) return errors

  if (!CONTENT_TYPES.includes(input.content_type)) {
    errors.push(`content_type must be one of: ${CONTENT_TYPES.join(', ')}`)
  }
  if (!Array.isArray(input.skill_ids) || input.skill_ids.length === 0) {
    errors.push('skill_ids must be a non-empty array')
  }
  if (!Array.isArray(input.tags)) {
    errors.push('tags must be an array')
  }
  if (!Number.isInteger(input.duration_minutes) || input.duration_minutes <= 0) {
    errors.push('duration_minutes must be a positive integer')
  }

  if (input.content_type === 'video') {
    if (!input.external_url || !VIDEO_URL_RE.test(input.external_url)) {
      errors.push('video content requires a YouTube or Vimeo external_url')
    }
  } else if (input.content_type === 'external_link') {
    if (!input.external_url || !HTTP_URL_RE.test(input.external_url)) {
      errors.push('external_link content requires a valid http(s) external_url')
    }
  } else if (FILE_CONTENT_TYPES.includes(input.content_type)) {
    if (!file) {
      errors.push(`${input.content_type} content requires a file upload`)
    } else {
      const headerError = validateFileHeader(input.content_type, file)
      if (headerError) errors.push(headerError)
    }
  }

  return errors
}

async function createAsset({ actor, input, file, ipAddress, userAgent }) {
  const errors = validateCreateInput(input, file)
  if (errors.length > 0) {
    return { ok: false, status: 400, error: errors.join('; ') }
  }

  const missingSkills = await findMissingSkillIds(actor.tenantId, input.skill_ids)
  if (missingSkills.length > 0) {
    return { ok: false, status: 400, error: `Unknown skill_ids: ${missingSkills.join(', ')}` }
  }

  const proficiencyResult = await db.query(
    `SELECT id FROM proficiency_levels WHERE id = $1 AND tenant_id = $2`,
    [input.proficiency_level_id, actor.tenantId]
  )
  if (proficiencyResult.rows.length === 0) {
    return { ok: false, status: 400, error: 'proficiency_level_id does not exist for this tenant' }
  }

  const assetId = randomUUID()
  let storageUrl = null
  let externalUrl = null

  if (FILE_CONTENT_TYPES.includes(input.content_type)) {
    storageUrl = await contentStorage.uploadAssetFile({ tenantId: actor.tenantId, assetId, file })
  } else {
    externalUrl = input.external_url || null
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    await client.query(
      `INSERT INTO learning_assets
         (id, tenant_id, title, description, content_type, proficiency_level_id, duration_minutes,
          language, tags, status, author_user_id, storage_url, external_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11,$12)`,
      [
        assetId, actor.tenantId, input.title, input.description, input.content_type,
        input.proficiency_level_id, input.duration_minutes, input.language, input.tags,
        actor.id, storageUrl, externalUrl
      ]
    )

    for (const skillId of input.skill_ids) {
      await client.query(`INSERT INTO learning_asset_skills (asset_id, skill_id) VALUES ($1, $2)`, [assetId, skillId])
    }

    const created = await fetchAssetWithRelations(client, actor.tenantId, assetId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.CONTENT_CREATED,
      entityType: 'LearningAsset',
      entityId: assetId,
      newValue: created,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 201, asset: created }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced proficiency level or skill does not exist' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid content_type or other constrained value' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// PUT /content/assets/:id
// ---------------------------------------------------------------------------

async function updateAsset({ actor, assetId, updates = {}, ipAddress, userAgent }) {
  const columns = pickColumns(updates, ASSET_FIELD_MAP)
  const hasTags = Array.isArray(updates.tags)
  const hasSkillIds = Array.isArray(updates.skill_ids)

  if (hasTags) columns.tags = updates.tags

  if (Object.keys(columns).length === 0 && !hasSkillIds) {
    return { ok: false, status: 400, error: 'No valid fields to update' }
  }

  if (hasSkillIds) {
    if (updates.skill_ids.length === 0) {
      return { ok: false, status: 400, error: 'skill_ids must be a non-empty array' }
    }
    const missingSkills = await findMissingSkillIds(actor.tenantId, updates.skill_ids)
    if (missingSkills.length > 0) {
      return { ok: false, status: 400, error: `Unknown skill_ids: ${missingSkills.join(', ')}` }
    }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const before = await fetchAssetWithRelations(client, actor.tenantId, assetId)
    if (!before) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning asset not found' }
    }

    if (Object.keys(columns).length > 0) {
      const { clause, values } = buildSetClause(columns, 2)
      await client.query(`UPDATE learning_assets SET ${clause}, updated_at = NOW() WHERE id = $1`, [assetId, ...values])
    }

    if (hasSkillIds) {
      await client.query(`DELETE FROM learning_asset_skills WHERE asset_id = $1`, [assetId])
      for (const skillId of updates.skill_ids) {
        await client.query(`INSERT INTO learning_asset_skills (asset_id, skill_id) VALUES ($1, $2)`, [assetId, skillId])
      }
    }

    const after = await fetchAssetWithRelations(client, actor.tenantId, assetId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.CONTENT_UPDATED,
      entityType: 'LearningAsset',
      entityId: assetId,
      oldValue: before,
      newValue: after,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, asset: after }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced proficiency level does not exist' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid field value' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /content/assets/:id/submit-review
// ---------------------------------------------------------------------------

async function submitForReview({ actor, assetId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(`SELECT * FROM learning_assets WHERE id = $1 AND tenant_id = $2`, [assetId, actor.tenantId])
    const current = currentResult.rows[0]
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning asset not found' }
    }

    const transitionError = await checkTransition(actor.tenantId, current.status, 'in_review')
    if (transitionError) {
      await client.query('ROLLBACK')
      return { ok: false, status: 409, error: transitionError }
    }

    await client.query(`UPDATE learning_assets SET status = 'in_review', updated_at = NOW() WHERE id = $1`, [assetId])

    const definitionResult = await client.query(
      `SELECT id FROM workflow_definitions
       WHERE tenant_id = $1 AND module = 'content' AND trigger_event = 'content.submitted' AND is_active = TRUE
       ORDER BY version DESC LIMIT 1`,
      [actor.tenantId]
    )
    const definition = definitionResult.rows[0]
    if (!definition) {
      await client.query('ROLLBACK')
      return { ok: false, status: 500, error: 'No active content publication workflow is configured' }
    }

    const { instance, tasks } = await workflowService.startWorkflow(definition.id, 'LearningAsset', assetId, actor.id, client)

    const updated = await fetchAssetWithRelations(client, actor.tenantId, assetId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.CONTENT_SUBMITTED_FOR_REVIEW,
      entityType: 'LearningAsset',
      entityId: assetId,
      oldValue: { status: current.status },
      newValue: { status: 'in_review' },
      ipAddress,
      userAgent,
      result: 'success',
      metadata: { workflowInstanceId: instance.id }
    }, client)

    await client.query('COMMIT')
    return { ok: true, asset: updated, workflow: { instance, tasks } }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /content/assets/:id/publish
// ---------------------------------------------------------------------------

async function publishAsset({ actor, assetId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(`SELECT * FROM learning_assets WHERE id = $1 AND tenant_id = $2`, [assetId, actor.tenantId])
    const current = currentResult.rows[0]
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning asset not found' }
    }

    const transitionError = await checkTransition(actor.tenantId, current.status, 'published')
    if (transitionError) {
      await client.query('ROLLBACK')
      return { ok: false, status: 409, error: transitionError }
    }

    if (current.status === 'draft') {
      const bypassRoles = (await configService.get(actor.tenantId, 'content', 'publish_bypass_roles')) || []
      if (!bypassRoles.includes(actor.activeRole)) {
        await client.query('ROLLBACK')
        return { ok: false, status: 409, error: 'Content must go through review (in_review) before publishing' }
      }
    }

    await client.query(`UPDATE learning_assets SET status = 'published', updated_at = NOW() WHERE id = $1`, [assetId])
    const updated = await fetchAssetWithRelations(client, actor.tenantId, assetId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.CONTENT_PUBLISHED,
      entityType: 'LearningAsset',
      entityId: assetId,
      oldValue: { status: current.status },
      newValue: { status: 'published' },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, asset: updated }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /content/assets/:id/retire
// ---------------------------------------------------------------------------

async function retireAsset({ actor, assetId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(`SELECT * FROM learning_assets WHERE id = $1 AND tenant_id = $2`, [assetId, actor.tenantId])
    const current = currentResult.rows[0]
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning asset not found' }
    }

    const transitionError = await checkTransition(actor.tenantId, current.status, 'retired')
    if (transitionError) {
      await client.query('ROLLBACK')
      return { ok: false, status: 409, error: transitionError }
    }

    await client.query(`UPDATE learning_assets SET status = 'retired', updated_at = NOW() WHERE id = $1`, [assetId])
    const updated = await fetchAssetWithRelations(client, actor.tenantId, assetId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.CONTENT_RETIRED,
      entityType: 'LearningAsset',
      entityId: assetId,
      oldValue: { status: current.status },
      newValue: { status: 'retired' },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, asset: updated }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /content/assets/:id
// ---------------------------------------------------------------------------

async function getAssetById({ actor, assetId, ipAddress, userAgent }) {
  const asset = await fetchAssetWithRelations(db, actor.tenantId, assetId)
  if (!asset) {
    return { ok: false, status: 404, error: 'Learning asset not found' }
  }

  if (asset.status !== 'published' && asset.authorUserId !== actor.id) {
    const canManage = await permissionEngine.hasPermission(actor, 'edit', 'content', 'assets')
    if (!canManage) {
      await recordAccessViolation({ actor, action: 'content.assets.view', entityId: assetId, ipAddress, userAgent })
      return { ok: false, status: 403, error: 'Forbidden' }
    }
  }

  return { ok: true, asset }
}

module.exports = {
  createAsset,
  updateAsset,
  submitForReview,
  publishAsset,
  retireAsset,
  getAssetById,
  // exported for tests / reuse
  serializeAsset
}
