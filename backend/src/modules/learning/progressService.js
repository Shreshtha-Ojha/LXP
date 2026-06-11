// src/modules/learning/progressService.js
//
// Business logic behind /progress. Every function takes an `actor`
// ({ id, tenantId, roles, activeRole, activeRoleId }) and enforces:
//  - Rule 1: per-content-type completion rules (e.g. "video completes at
//    90%") come from configurations.learning.completion_rules, never
//    hardcoded thresholds in this file
//  - Rule 3: every query is scoped by tenant_id, and additionally by
//    user_id = actor.id — progress is always "my own records" (Rule 7)
//  - Rule 4: the progress event, any resulting completion_record, and any
//    resulting assignment status change are written in a single transaction,
//    each with its own audit event
//  - Rule 5: marking an assignment 'completed' here is a system-observed
//    status transition driven by the learner's own activity, not a human
//    approval — it does not go through the workflow engine
//  - Rule 6: asset_id is validated against learning_assets for the tenant
//    before any write

const { randomUUID } = require('crypto')
const db = require('../../db')
const auditLog = require('../audit/auditLog')
const configService = require('../config/configService')

const { AuditActions } = auditLog

const EVENT_TYPES = ['started', 'progress_updated', 'completed', 'resumed']

// Used only when configurations.learning.completion_rules has no entry for a
// content_type — the most conservative behaviour (only an explicit
// event_type='completed' event completes it).
const DEFAULT_COMPLETION_RULE = { completion_type: 'manual' }

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function serializeProgressEvent(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    assetId: row.asset_id,
    eventType: row.event_type,
    progressPct: row.progress_pct,
    positionSeconds: row.position_seconds,
    metadata: row.metadata,
    createdAt: row.created_at
  }
}

function serializeCompletionRecord(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    assetId: row.asset_id,
    pathId: row.path_id,
    assignmentId: row.assignment_id,
    completedAt: row.completed_at,
    score: row.score,
    timeSpentMinutes: row.time_spent_minutes
  }
}

/** Rule 1 — per content_type completion rule from configurations.learning.completion_rules. */
async function getCompletionRule(tenantId, contentType) {
  const rules = await configService.get(tenantId, 'learning', 'completion_rules')
  return rules?.[contentType] || DEFAULT_COMPLETION_RULE
}

/** Does this event satisfy the asset's configured completion rule? */
function isCompletionTriggered(input, rule) {
  if (input.event_type === 'completed') return true
  if (rule.completion_type === 'threshold' && input.progress_pct != null) {
    return input.progress_pct >= rule.threshold_pct
  }
  return false
}

// ---------------------------------------------------------------------------
// POST /progress/events
// ---------------------------------------------------------------------------

function validateEventInput(input) {
  const errors = []

  if (!input.asset_id) errors.push('asset_id is required')

  if (!input.event_type) {
    errors.push('event_type is required')
  } else if (!EVENT_TYPES.includes(input.event_type)) {
    errors.push(`event_type must be one of: ${EVENT_TYPES.join(', ')}`)
  }

  if (input.progress_pct !== undefined && input.progress_pct !== null) {
    if (!Number.isInteger(input.progress_pct) || input.progress_pct < 0 || input.progress_pct > 100) {
      errors.push('progress_pct must be an integer between 0 and 100')
    }
  }

  if (input.position_seconds !== undefined && input.position_seconds !== null) {
    if (!Number.isInteger(input.position_seconds) || input.position_seconds < 0) {
      errors.push('position_seconds must be a non-negative integer')
    }
  }

  if (input.metadata !== undefined && input.metadata !== null && typeof input.metadata !== 'object') {
    errors.push('metadata must be an object')
  }

  return errors
}

/**
 * Find the assignment(s) this completion satisfies:
 *  - the direct asset assignment (assigned_to = user, asset_id = this asset), if any
 *  - any path assignment where this asset is a mandatory item, if any
 * Runs inside the completion transaction so the freshly-inserted
 * completion_records row is visible to maybeCompletePathAssignment below.
 */
async function findAffectedAssignments(client, tenantId, userId, assetId) {
  const directResult = await client.query(
    `SELECT * FROM assignments
     WHERE tenant_id = $1 AND assigned_to = $2 AND asset_id = $3 AND status != 'completed'`,
    [tenantId, userId, assetId]
  )

  const pathResult = await client.query(
    `SELECT a.*
     FROM assignments a
     JOIN learning_path_items lpi
       ON lpi.path_id = a.path_id AND lpi.asset_id = $3 AND lpi.is_mandatory = TRUE
     WHERE a.tenant_id = $1 AND a.assigned_to = $2 AND a.path_id IS NOT NULL AND a.status != 'completed'`,
    [tenantId, userId, assetId]
  )

  return { direct: directResult.rows[0] || null, paths: pathResult.rows }
}

/** If every mandatory item in this path assignment's path is now complete for the user, mark the assignment 'completed'. */
async function maybeCompletePathAssignment(client, { actor, pathAssignment, ipAddress, userAgent }) {
  const itemsResult = await client.query(
    `SELECT asset_id FROM learning_path_items WHERE path_id = $1 AND is_mandatory = TRUE`,
    [pathAssignment.path_id]
  )
  const mandatoryAssetIds = itemsResult.rows.map((r) => r.asset_id)
  if (mandatoryAssetIds.length === 0) return

  const completedResult = await client.query(
    `SELECT asset_id FROM completion_records WHERE tenant_id = $1 AND user_id = $2 AND asset_id = ANY($3)`,
    [actor.tenantId, actor.id, mandatoryAssetIds]
  )
  if (completedResult.rows.length < mandatoryAssetIds.length) return

  await client.query(`UPDATE assignments SET status = 'completed' WHERE id = $1`, [pathAssignment.id])

  await auditLog.write({
    tenantId: actor.tenantId,
    actorUserId: actor.id,
    actorRoleAtTime: actor.roles?.join(','),
    actionType: AuditActions.ASSIGNMENT_COMPLETED,
    entityType: 'Assignment',
    entityId: pathAssignment.id,
    oldValue: { status: pathAssignment.status },
    newValue: { status: 'completed' },
    ipAddress,
    userAgent,
    result: 'success',
    metadata: { pathId: pathAssignment.path_id, reason: 'all_mandatory_items_completed' }
  }, client)
}

async function recordProgressEvent({ actor, input, ipAddress, userAgent }) {
  const errors = validateEventInput(input)
  if (errors.length > 0) {
    return { ok: false, status: 400, error: errors.join('; ') }
  }

  const assetResult = await db.query(
    `SELECT id, content_type FROM learning_assets WHERE id = $1 AND tenant_id = $2`,
    [input.asset_id, actor.tenantId]
  )
  const asset = assetResult.rows[0]
  if (!asset) return { ok: false, status: 400, error: 'asset_id does not exist for this tenant' }

  const rule = await getCompletionRule(actor.tenantId, asset.content_type)
  const triggersCompletion = isCompletionTriggered(input, rule)

  const eventId = randomUUID()

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const eventResult = await client.query(
      `INSERT INTO progress_events (id, tenant_id, user_id, asset_id, event_type, progress_pct, position_seconds, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        eventId, actor.tenantId, actor.id, input.asset_id, input.event_type,
        input.progress_pct ?? null, input.position_seconds ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null
      ]
    )
    const event = eventResult.rows[0]

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.PROGRESS_EVENT_RECORDED,
      entityType: 'ProgressEvent',
      entityId: eventId,
      newValue: serializeProgressEvent(event),
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    let completion = null

    if (triggersCompletion) {
      const existingResult = await client.query(
        `SELECT * FROM completion_records WHERE tenant_id = $1 AND user_id = $2 AND asset_id = $3`,
        [actor.tenantId, actor.id, input.asset_id]
      )

      if (existingResult.rows.length === 0) {
        const { direct, paths } = await findAffectedAssignments(client, actor.tenantId, actor.id, input.asset_id)
        const assignmentId = direct?.id || paths[0]?.id || null
        const pathId = paths[0]?.path_id || null

        const score = Number.isInteger(input.metadata?.score) ? input.metadata.score : null
        const timeSpentMinutes = Number.isInteger(input.metadata?.time_spent_minutes) ? input.metadata.time_spent_minutes : null

        const completionId = randomUUID()
        const completionResult = await client.query(
          `INSERT INTO completion_records (id, tenant_id, user_id, asset_id, path_id, assignment_id, score, time_spent_minutes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING *`,
          [completionId, actor.tenantId, actor.id, input.asset_id, pathId, assignmentId, score, timeSpentMinutes]
        )
        completion = completionResult.rows[0]

        await auditLog.write({
          tenantId: actor.tenantId,
          actorUserId: actor.id,
          actorRoleAtTime: actor.roles?.join(','),
          actionType: AuditActions.ASSET_COMPLETED,
          entityType: 'CompletionRecord',
          entityId: completionId,
          newValue: serializeCompletionRecord(completion),
          ipAddress,
          userAgent,
          result: 'success'
        }, client)

        if (direct) {
          await client.query(`UPDATE assignments SET status = 'completed' WHERE id = $1`, [direct.id])
          await auditLog.write({
            tenantId: actor.tenantId,
            actorUserId: actor.id,
            actorRoleAtTime: actor.roles?.join(','),
            actionType: AuditActions.ASSIGNMENT_COMPLETED,
            entityType: 'Assignment',
            entityId: direct.id,
            oldValue: { status: direct.status },
            newValue: { status: 'completed' },
            ipAddress,
            userAgent,
            result: 'success'
          }, client)
        }

        for (const pathAssignment of paths) {
          await maybeCompletePathAssignment(client, { actor, pathAssignment, ipAddress, userAgent })
        }
      } else {
        completion = existingResult.rows[0]
      }
    }

    await client.query('COMMIT')
    return {
      ok: true,
      status: 201,
      event: serializeProgressEvent(event),
      completion: serializeCompletionRecord(completion)
    }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced asset or user does not exist' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid field value' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /progress/me
// ---------------------------------------------------------------------------

async function getMyProgress({ actor }) {
  const result = await db.query(
    `SELECT DISTINCT ON (pe.asset_id)
            pe.asset_id, pe.progress_pct, pe.position_seconds, pe.created_at AS last_event_at,
            la.title AS asset_title, la.content_type,
            cr.completed_at, cr.score, cr.time_spent_minutes
     FROM progress_events pe
     JOIN learning_assets la ON la.id = pe.asset_id
     LEFT JOIN completion_records cr
       ON cr.tenant_id = pe.tenant_id AND cr.user_id = pe.user_id AND cr.asset_id = pe.asset_id
     WHERE pe.tenant_id = $1 AND pe.user_id = $2
     ORDER BY pe.asset_id, pe.created_at DESC`,
    [actor.tenantId, actor.id]
  )

  return {
    progress: result.rows.map((row) => ({
      assetId: row.asset_id,
      assetTitle: row.asset_title,
      contentType: row.content_type,
      status: row.completed_at ? 'completed' : (row.progress_pct ? 'in_progress' : 'started'),
      progressPct: row.progress_pct,
      positionSeconds: row.position_seconds,
      lastEventAt: row.last_event_at,
      completedAt: row.completed_at,
      score: row.score,
      timeSpentMinutes: row.time_spent_minutes
    }))
  }
}

// ---------------------------------------------------------------------------
// GET /progress/resume/:assetId
// ---------------------------------------------------------------------------

async function getResumePosition({ actor, assetId }) {
  const assetResult = await db.query(
    `SELECT id FROM learning_assets WHERE id = $1 AND tenant_id = $2`,
    [assetId, actor.tenantId]
  )
  if (assetResult.rows.length === 0) {
    return { ok: false, status: 404, error: 'Learning asset not found' }
  }

  const result = await db.query(
    `SELECT position_seconds, created_at FROM progress_events
     WHERE tenant_id = $1 AND user_id = $2 AND asset_id = $3 AND position_seconds IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [actor.tenantId, actor.id, assetId]
  )

  return {
    ok: true,
    assetId,
    positionSeconds: result.rows[0]?.position_seconds ?? 0,
    lastUpdatedAt: result.rows[0]?.created_at ?? null
  }
}

module.exports = {
  recordProgressEvent,
  getMyProgress,
  getResumePosition,
  // exported for tests / reuse
  serializeProgressEvent,
  serializeCompletionRecord,
  isCompletionTriggered,
  getCompletionRule
}
