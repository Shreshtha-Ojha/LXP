// src/modules/content/scormService.js
//
// Business logic behind /scorm — minimal SCORM 1.2 / SCORM 2004 runtime
// support (initialize / set-value / commit / terminate). Every function
// takes an `actor` ({ id, tenantId, roles, activeRole, activeRoleId }) and
// enforces:
//  - Rule 3/7: every query is scoped by tenant_id AND user_id = actor.id —
//    a SCORM session is always "my own record", same as
//    learning.progressService
//  - Rule 6: asset_id is validated against learning_assets for the tenant
//    (and must be content_type='scorm') before a session is created
//  - Rule 4: initialize/commit/terminate write an audit event. set-value
//    merges the submitted CMI key/value pairs into the session's working
//    data directly (the equivalent of an LMS API wrapper's in-memory cache)
//    and is not separately audited — commit is the persisted checkpoint
//    that is audited, matching how a SCORM player calls LMSCommit()/
//    Commit() periodically rather than on every LMSSetValue()/SetValue()
//  - terminate forwards a 'completed'/'passed' lesson_status to
//    learning.progressService as event_type='completed', the existing
//    integration point for content_type='scorm' assets (completion_type
//    'external_status', migration 018)

const { randomUUID } = require('crypto')
const db = require('../../db')
const auditLog = require('../audit/auditLog')
const progressService = require('../learning/progressService')

const { AuditActions } = auditLog

// CMI keys this minimal runtime understands, mapped onto the scorm_sessions
// convenience columns. Within a single set-value/values payload, last key
// wins — for SCORM 2004 a package typically sets cmi.completion_status
// ('completed') and cmi.success_status ('passed'/'failed') together, and
// 'passed' overwriting 'completed' is the desired outcome since terminate
// treats both as "this attempt is done".
const LESSON_STATUS_KEYS = ['cmi.core.lesson_status', 'cmi.completion_status', 'cmi.success_status']
const SCORE_KEYS = ['cmi.core.score.raw', 'cmi.score.raw']
const SUSPEND_DATA_KEYS = ['cmi.suspend_data']

// terminate() treats either of these final lesson_status values as completion.
const COMPLETING_STATUSES = ['completed', 'passed']

function serializeSession(row) {
  if (!row) return null
  return {
    sessionToken: row.id,
    assetId: row.asset_id,
    lessonStatus: row.lesson_status,
    score: row.score,
    suspendData: row.suspend_data,
    sessionData: row.session_data
  }
}

/** Pull recognised CMI keys out of a key/value map into the denormalized columns. */
function extractColumnUpdates(values) {
  const updates = {}
  for (const key of LESSON_STATUS_KEYS) {
    if (key in values) updates.lesson_status = String(values[key])
  }
  for (const key of SCORE_KEYS) {
    if (key in values) {
      const parsed = parseInt(values[key], 10)
      if (!Number.isNaN(parsed)) updates.score = parsed
    }
  }
  for (const key of SUSPEND_DATA_KEYS) {
    if (key in values) updates.suspend_data = String(values[key])
  }
  return updates
}

// ---------------------------------------------------------------------------
// POST /scorm/initialize
// ---------------------------------------------------------------------------

async function initializeSession({ actor, assetId, ipAddress, userAgent }) {
  if (!assetId) return { ok: false, status: 400, error: 'asset_id is required' }

  const assetResult = await db.query(
    `SELECT id, content_type FROM learning_assets WHERE id = $1 AND tenant_id = $2`,
    [assetId, actor.tenantId]
  )
  const asset = assetResult.rows[0]
  if (!asset) return { ok: false, status: 400, error: 'asset_id does not exist for this tenant' }
  if (asset.content_type !== 'scorm') return { ok: false, status: 400, error: 'asset_id is not a SCORM asset' }

  const sessionId = randomUUID()
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const insertResult = await client.query(
      `INSERT INTO scorm_sessions (id, tenant_id, user_id, asset_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, asset_id) DO NOTHING
       RETURNING *`,
      [sessionId, actor.tenantId, actor.id, assetId]
    )

    let session = insertResult.rows[0]

    if (session) {
      await auditLog.write({
        tenantId: actor.tenantId,
        actorUserId: actor.id,
        actorRoleAtTime: actor.roles?.join(','),
        actionType: AuditActions.SCORM_SESSION_STARTED,
        entityType: 'ScormSession',
        entityId: session.id,
        newValue: serializeSession(session),
        ipAddress,
        userAgent,
        result: 'success'
      }, client)
    } else {
      const existing = await client.query(
        `SELECT * FROM scorm_sessions WHERE tenant_id = $1 AND user_id = $2 AND asset_id = $3`,
        [actor.tenantId, actor.id, assetId]
      )
      session = existing.rows[0]
    }

    await client.query('COMMIT')
    return { ok: true, status: 200, session: serializeSession(session) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /scorm/set-value
// ---------------------------------------------------------------------------

async function setValue({ actor, sessionToken, key, value, values }) {
  if (!sessionToken) return { ok: false, status: 400, error: 'session_token is required' }

  const merged = values && typeof values === 'object' ? { ...values } : {}
  if (key !== undefined) {
    if (typeof key !== 'string' || key === '') return { ok: false, status: 400, error: 'key must be a non-empty string' }
    if (value === undefined) return { ok: false, status: 400, error: 'value is required when key is provided' }
    merged[key] = value
  }
  if (Object.keys(merged).length === 0) {
    return { ok: false, status: 400, error: 'key/value or values is required' }
  }

  const columnUpdates = extractColumnUpdates(merged)

  const result = await db.query(
    `UPDATE scorm_sessions
     SET session_data  = session_data || $4::jsonb,
         lesson_status = COALESCE($5, lesson_status),
         score         = COALESCE($6, score),
         suspend_data  = COALESCE($7, suspend_data),
         updated_at    = NOW()
     WHERE tenant_id = $1 AND user_id = $2 AND id = $3
     RETURNING *`,
    [
      actor.tenantId, actor.id, sessionToken,
      JSON.stringify(merged),
      columnUpdates.lesson_status ?? null,
      columnUpdates.score ?? null,
      columnUpdates.suspend_data ?? null
    ]
  )

  if (result.rows.length === 0) return { ok: false, status: 404, error: 'SCORM session not found' }

  return { ok: true, status: 200, session: serializeSession(result.rows[0]) }
}

// ---------------------------------------------------------------------------
// POST /scorm/commit
// ---------------------------------------------------------------------------

async function commit({ actor, sessionToken, ipAddress, userAgent }) {
  if (!sessionToken) return { ok: false, status: 400, error: 'session_token is required' }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const result = await client.query(
      `UPDATE scorm_sessions SET updated_at = NOW()
       WHERE tenant_id = $1 AND user_id = $2 AND id = $3
       RETURNING *`,
      [actor.tenantId, actor.id, sessionToken]
    )
    const session = result.rows[0]
    if (!session) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'SCORM session not found' }
    }

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.SCORM_SESSION_COMMITTED,
      entityType: 'ScormSession',
      entityId: session.id,
      newValue: serializeSession(session),
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 200 }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /scorm/terminate
// ---------------------------------------------------------------------------

async function terminate({ actor, sessionToken, ipAddress, userAgent }) {
  if (!sessionToken) return { ok: false, status: 400, error: 'session_token is required' }

  const sessionResult = await db.query(
    `SELECT * FROM scorm_sessions WHERE tenant_id = $1 AND user_id = $2 AND id = $3`,
    [actor.tenantId, actor.id, sessionToken]
  )
  const session = sessionResult.rows[0]
  if (!session) return { ok: false, status: 404, error: 'SCORM session not found' }

  await auditLog.write({
    tenantId: actor.tenantId,
    actorUserId: actor.id,
    actorRoleAtTime: actor.roles?.join(','),
    actionType: AuditActions.SCORM_SESSION_TERMINATED,
    entityType: 'ScormSession',
    entityId: session.id,
    newValue: serializeSession(session),
    ipAddress,
    userAgent,
    result: 'success'
  })

  let completion = null

  if (COMPLETING_STATUSES.includes(session.lesson_status)) {
    const timeSpentMinutes = Math.max(0, Math.round((Date.now() - new Date(session.created_at).getTime()) / 60000))

    const progressResult = await progressService.recordProgressEvent({
      actor,
      input: {
        asset_id: session.asset_id,
        event_type: 'completed',
        metadata: {
          scorm_completion_status: session.lesson_status,
          score: session.score,
          time_spent_minutes: timeSpentMinutes
        }
      },
      ipAddress,
      userAgent
    })

    if (!progressResult.ok) return { ok: false, status: progressResult.status, error: progressResult.error }
    completion = progressResult.completion
  }

  return { ok: true, status: 200, completed: completion !== null, completion }
}

module.exports = {
  initializeSession,
  setValue,
  commit,
  terminate,
  // exported for tests / reuse
  serializeSession,
  extractColumnUpdates
}
