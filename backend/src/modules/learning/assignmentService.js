// src/modules/learning/assignmentService.js
//
// Business logic behind /assignments. Every function takes an `actor`
// ({ id, tenantId, roles, activeRole, activeRoleId, visibilityScope }) and enforces:
//  - Rule 3: every query is scoped by tenant_id
//  - Rule 4: every assignment created writes an ASSIGNMENT_CREATED audit
//    event in the same transaction
//  - Rule 5: this is a notification fan-out, not an approval — no workflow
//    engine involved. POST /assignments calls notificationService.notify
//    directly, same as workflowService does for its own task assignments
//  - Rule 6: exactly one of asset_id/path_id is required and must reference
//    an existing learning_assets/learning_paths row for the tenant
//  - Rule 7: POST /assignments resolves "team"/"org_unit"/"users" targets
//    through actor.visibilityScope (set by permissionEngine.getVisibilityScope)
//    so a manager can only assign within their permitted scope; GET
//    /assignments/team is restricted to the caller's direct reports
//    (user_profiles.manager_id), never all tenant users

const { randomUUID } = require('crypto')
const db = require('../../db')
const auditLog = require('../audit/auditLog')
const notificationService = require('../notifications/notificationService')

const { AuditActions } = auditLog

const TARGET_TYPES = ['users', 'team', 'org_unit']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function serializeAssignment(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    assetId: row.asset_id,
    pathId: row.path_id,
    title: row.asset_title ?? row.path_title ?? null,
    assignedTo: row.assigned_to,
    assignedBy: row.assigned_by,
    dueDate: row.due_date,
    isMandatory: row.is_mandatory,
    status: row.status,
    isOverdue: row.is_overdue ?? false,
    note: row.note,
    createdAt: row.created_at
  }
}

/**
 * Resolve target.{type, user_ids, org_unit_id} into a list of assigned_to
 * user ids, scoped to actor.visibilityScope (Rule 7).
 *  - 'team'     -> the actor's direct reports (user_profiles.manager_id = actor.id)
 *  - 'org_unit' -> active users in target.org_unit_id, which must be within
 *                  actor.visibilityScope.orgUnitIds (null = unrestricted)
 *  - 'users'    -> target.user_ids, each validated active and within scope
 * Returns { userIds } or { error, status }.
 */
async function resolveTargetUserIds(actor, target) {
  if (!target || !TARGET_TYPES.includes(target.type)) {
    return { error: `target.type must be one of: ${TARGET_TYPES.join(', ')}`, status: 400 }
  }

  const orgUnitIds = actor.visibilityScope?.orgUnitIds

  if (target.type === 'team') {
    const result = await db.query(
      `SELECT u.id FROM users u
       JOIN user_profiles up ON up.user_id = u.id
       WHERE up.manager_id = $1 AND u.tenant_id = $2 AND u.status = 'active'`,
      [actor.id, actor.tenantId]
    )
    if (result.rows.length === 0) return { error: 'You have no direct reports to assign to', status: 400 }
    return { userIds: result.rows.map((r) => r.id) }
  }

  if (target.type === 'org_unit') {
    if (!target.org_unit_id) return { error: 'target.org_unit_id is required for target.type "org_unit"', status: 400 }
    if (orgUnitIds && !orgUnitIds.includes(target.org_unit_id)) {
      return { error: 'target.org_unit_id is outside your visibility scope', status: 403 }
    }

    const result = await db.query(
      `SELECT u.id FROM users u
       JOIN user_profiles up ON up.user_id = u.id
       WHERE u.tenant_id = $1 AND u.status = 'active' AND up.org_unit_id = $2`,
      [actor.tenantId, target.org_unit_id]
    )
    if (result.rows.length === 0) return { error: 'No active users found in target.org_unit_id', status: 400 }
    return { userIds: result.rows.map((r) => r.id) }
  }

  // target.type === 'users'
  if (!Array.isArray(target.user_ids) || target.user_ids.length === 0) {
    return { error: 'target.user_ids must be a non-empty array for target.type "users"', status: 400 }
  }

  const params = [actor.tenantId, target.user_ids]
  let scopeClause = ''
  if (orgUnitIds) {
    scopeClause = ' AND up.org_unit_id = ANY($3)'
    params.push(orgUnitIds)
  }

  const result = await db.query(
    `SELECT u.id FROM users u
     JOIN user_profiles up ON up.user_id = u.id
     WHERE u.tenant_id = $1 AND u.id = ANY($2) AND u.status = 'active'${scopeClause}`,
    params
  )
  const found = new Set(result.rows.map((r) => r.id))
  const missing = target.user_ids.filter((id) => !found.has(id))
  if (missing.length > 0) {
    return { error: `These users are not active or are outside your visibility scope: ${missing.join(', ')}`, status: 403 }
  }
  return { userIds: [...new Set(target.user_ids)] }
}

// ---------------------------------------------------------------------------
// POST /assignments
// ---------------------------------------------------------------------------

function validateCreateInput(input) {
  const errors = []

  const hasAsset = !!input.asset_id
  const hasPath = !!input.path_id
  if (hasAsset === hasPath) errors.push('Exactly one of asset_id or path_id is required')

  if (input.due_date !== undefined && input.due_date !== null && !DATE_RE.test(input.due_date)) {
    errors.push('due_date must be a date in YYYY-MM-DD format')
  }
  if (input.is_mandatory !== undefined && typeof input.is_mandatory !== 'boolean') {
    errors.push('is_mandatory must be a boolean')
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') {
    errors.push('note must be a string')
  }

  return errors
}

async function createAssignment({ actor, input, ipAddress, userAgent }) {
  const errors = validateCreateInput(input)
  if (errors.length > 0) {
    return { ok: false, status: 400, error: errors.join('; ') }
  }

  let title
  if (input.asset_id) {
    const result = await db.query(`SELECT title FROM learning_assets WHERE id = $1 AND tenant_id = $2`, [input.asset_id, actor.tenantId])
    if (result.rows.length === 0) return { ok: false, status: 400, error: 'asset_id does not exist for this tenant' }
    title = result.rows[0].title
  } else {
    const result = await db.query(`SELECT title FROM learning_paths WHERE id = $1 AND tenant_id = $2`, [input.path_id, actor.tenantId])
    if (result.rows.length === 0) return { ok: false, status: 400, error: 'path_id does not exist for this tenant' }
    title = result.rows[0].title
  }

  const resolved = await resolveTargetUserIds(actor, input.target)
  if (resolved.error) return { ok: false, status: resolved.status, error: resolved.error }

  const isMandatory = input.is_mandatory !== false
  const dueDate = input.due_date || null

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const created = []
    for (const userId of resolved.userIds) {
      const assignmentId = randomUUID()
      const insertResult = await client.query(
        `INSERT INTO assignments (id, tenant_id, asset_id, path_id, assigned_to, assigned_by, due_date, is_mandatory, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [assignmentId, actor.tenantId, input.asset_id || null, input.path_id || null, userId, actor.id, dueDate, isMandatory, input.note || null]
      )
      const assignment = insertResult.rows[0]
      created.push(assignment)

      await auditLog.write({
        tenantId: actor.tenantId,
        actorUserId: actor.id,
        actorRoleAtTime: actor.roles?.join(','),
        actionType: AuditActions.ASSIGNMENT_CREATED,
        entityType: 'Assignment',
        entityId: assignmentId,
        newValue: serializeAssignment(assignment),
        ipAddress,
        userAgent,
        result: 'success'
      }, client)

      await notificationService.notify({
        tenantId: actor.tenantId,
        userId,
        eventType: 'assignment.created',
        data: { title, due_date: dueDate || '' },
        metadata: { assignmentId, assetId: input.asset_id || null, pathId: input.path_id || null },
        client
      })
    }

    await client.query('COMMIT')
    return { ok: true, status: 201, assignments: created.map((row) => serializeAssignment({ ...row, asset_title: input.asset_id ? title : null, path_title: input.path_id ? title : null })) }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced asset, path, or user does not exist' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid field value' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /assignments/me
// ---------------------------------------------------------------------------

const ASSIGNMENT_SELECT = `
  SELECT a.*,
         (a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE AND a.status != 'completed') AS is_overdue,
         la.title AS asset_title,
         lp.title AS path_title
  FROM assignments a
  LEFT JOIN learning_assets la ON la.id = a.asset_id
  LEFT JOIN learning_paths lp ON lp.id = a.path_id
`

async function getMyAssignments({ actor }) {
  const result = await db.query(
    `${ASSIGNMENT_SELECT}
     WHERE a.tenant_id = $1 AND a.assigned_to = $2
     ORDER BY a.due_date ASC NULLS LAST, a.created_at DESC`,
    [actor.tenantId, actor.id]
  )
  return { assignments: result.rows.map(serializeAssignment) }
}

// ---------------------------------------------------------------------------
// GET /assignments/team
// ---------------------------------------------------------------------------

async function getTeamAssignments({ actor }) {
  const reportsResult = await db.query(
    `SELECT u.id, up.first_name, up.last_name FROM users u
     JOIN user_profiles up ON up.user_id = u.id
     WHERE up.manager_id = $1 AND u.tenant_id = $2`,
    [actor.id, actor.tenantId]
  )
  if (reportsResult.rows.length === 0) return { assignments: [] }

  const reportIds = reportsResult.rows.map((r) => r.id)
  const result = await db.query(
    `${ASSIGNMENT_SELECT}
     JOIN user_profiles aup ON aup.user_id = a.assigned_to
     WHERE a.tenant_id = $1 AND a.assigned_to = ANY($2)
     ORDER BY a.due_date ASC NULLS LAST, a.created_at DESC`,
    [actor.tenantId, reportIds]
  )

  const namesById = new Map(reportsResult.rows.map((r) => [r.id, `${r.first_name} ${r.last_name}`]))
  return {
    assignments: result.rows.map((row) => ({
      ...serializeAssignment(row),
      assignedToName: namesById.get(row.assigned_to) || null
    }))
  }
}

module.exports = {
  createAssignment,
  getMyAssignments,
  getTeamAssignments,
  // exported for tests / reuse
  serializeAssignment,
  resolveTargetUserIds
}
