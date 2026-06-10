// src/modules/users/userService.js
//
// Business logic behind /admin/users. Every function takes an `actor`
// ({ id, tenantId, roles, visibilityScope }) and enforces:
//  - Rule 3: every query is scoped by tenant_id
//  - Rule 4: every state change writes an audit event in the same transaction
//  - Rule 7: visibility scope is enforced here, not just in the route layer

const bcrypt = require('bcrypt')
const ExcelJS = require('exceljs')
const { Readable } = require('stream')
const db = require('../../db')
const auditLog = require('../audit/auditLog')

const { AuditActions } = auditLog

const BCRYPT_COST = 12
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const DEACTIVATED_STATUS = 'inactive' // fixed enum value from the users.status CHECK constraint

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/**
 * Rule 7 — true if `orgUnitId` falls within the actor's visibility scope.
 * `orgUnitIds === null` means unrestricted (L&D admin, HR admin, super admin).
 * A null/undefined orgUnitId (record has no org unit) is treated as visible
 * to everyone — there's nothing to scope against.
 */
function isOrgUnitInScope(visibilityScope, orgUnitId) {
  if (!visibilityScope || visibilityScope.orgUnitIds === null) return true
  if (!orgUnitId) return true
  return visibilityScope.orgUnitIds.includes(orgUnitId)
}

/**
 * Resource-level visibility failure: the actor passed requirePermission()
 * for the module/feature, but this specific record is outside their scope.
 * Mirrors the ACCESS_VIOLATION pattern in permissionEngine.requirePermission.
 */
async function recordAccessViolation({ actor, action, entityId, ipAddress, userAgent }) {
  await auditLog.write({
    tenantId: actor.tenantId,
    actorUserId: actor.id,
    actorRoleAtTime: actor.roles?.join(','),
    actionType: AuditActions.ACCESS_VIOLATION,
    entityType: 'User',
    entityId,
    ipAddress,
    userAgent,
    result: 'failure',
    metadata: { action, reason: 'out_of_visibility_scope' }
  })
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function toPositiveInt(value, fallback) {
  const n = parseInt(value, 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** Shape a users+user_profiles row for API responses and audit snapshots. Never includes password_hash/mfa_secret. */
function serializeUser(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    employeeId: row.employee_id,
    email: row.email,
    status: row.status,
    userType: row.user_type,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    roles: row.roles || [],
    profile: {
      firstName: row.first_name,
      lastName: row.last_name,
      preferredName: row.preferred_name,
      phone: row.phone,
      location: row.location,
      timeZone: row.time_zone,
      language: row.language,
      avatarUrl: row.avatar_url,
      designation: row.designation,
      grade: row.grade,
      employmentType: row.employment_type,
      orgUnitId: row.org_unit_id,
      managerId: row.manager_id,
      joiningDate: row.joining_date
    }
  }
}

async function fetchUserWithProfile(runner, tenantId, userId) {
  const result = await runner.query(
    `SELECT u.*, up.first_name, up.last_name, up.preferred_name, up.phone, up.location,
            up.time_zone, up.language, up.avatar_url, up.designation, up.grade,
            up.employment_type, up.org_unit_id, up.manager_id, up.joining_date,
            COALESCE(
              array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL),
              ARRAY[]::text[]
            ) AS roles
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
       AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
       AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)
     LEFT JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
     WHERE u.id = $1 AND u.tenant_id = $2
     GROUP BY u.id, up.user_id`,
    [userId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * Read FR12's password policy from configurations (auth.password_min_length,
 * password_require_upper, password_require_number) instead of hardcoding
 * thresholds — Rule 1.
 */
async function validatePasswordPolicy(tenantId, password) {
  const result = await db.query(
    `SELECT key, value FROM configurations
     WHERE tenant_id = $1 AND module = 'auth'
       AND key IN ('password_min_length', 'password_require_upper', 'password_require_number')`,
    [tenantId]
  )

  const policy = {}
  for (const row of result.rows) {
    policy[row.key] = row.value?.value
  }

  const errors = []
  if (policy.password_min_length && password.length < policy.password_min_length) {
    errors.push(`Password must be at least ${policy.password_min_length} characters`)
  }
  if (policy.password_require_upper && !/[A-Z]/.test(password)) {
    errors.push('Password must contain an uppercase letter')
  }
  if (policy.password_require_number && !/[0-9]/.test(password)) {
    errors.push('Password must contain a number')
  }
  return errors
}

// ---------------------------------------------------------------------------
// GET /admin/users
// ---------------------------------------------------------------------------

async function listUsers({ tenantId, visibilityScope, filters = {}, page, pageSize }) {
  const safePage = toPositiveInt(page, 1)
  const safePageSize = Math.min(toPositiveInt(pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  const offset = (safePage - 1) * safePageSize

  const conditions = ['u.tenant_id = $1']
  const params = [tenantId]

  // Rule 7: restrict to the actor's visibility scope at the data layer
  if (visibilityScope?.orgUnitIds !== null) {
    params.push(visibilityScope?.orgUnitIds || [])
    conditions.push(`up.org_unit_id = ANY($${params.length})`)
  }

  if (filters.status) {
    params.push(filters.status)
    conditions.push(`u.status = $${params.length}`)
  }

  if (filters.orgUnitId) {
    params.push(filters.orgUnitId)
    conditions.push(`up.org_unit_id = $${params.length}`)
  }

  if (filters.role) {
    params.push(filters.role)
    conditions.push(`EXISTS (
      SELECT 1 FROM user_roles ur2
      JOIN roles r2 ON r2.id = ur2.role_id
      WHERE ur2.user_id = u.id AND r2.name = $${params.length} AND r2.status = 'active'
    )`)
  }

  const where = conditions.join(' AND ')

  const countResult = await db.query(
    `SELECT COUNT(*) FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id WHERE ${where}`,
    params
  )

  const dataResult = await db.query(
    `SELECT u.id, u.tenant_id, u.employee_id, u.email, u.status, u.user_type,
            u.last_login_at, u.created_at,
            up.first_name, up.last_name, up.org_unit_id, up.designation, up.manager_id,
            COALESCE(
              array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL),
              ARRAY[]::text[]
            ) AS roles
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
       AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
       AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)
     LEFT JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
     WHERE ${where}
     GROUP BY u.id, up.user_id
     ORDER BY u.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, safePageSize, offset]
  )

  const total = parseInt(countResult.rows[0].count, 10)

  return {
    data: dataResult.rows.map(serializeUser),
    pagination: {
      page: safePage,
      pageSize: safePageSize,
      total,
      totalPages: Math.ceil(total / safePageSize) || 0
    }
  }
}

// ---------------------------------------------------------------------------
// POST /admin/users
// ---------------------------------------------------------------------------

async function createUser({ actor, input, ipAddress, userAgent }) {
  const email = input?.email?.trim()
  const password = input?.password
  const profile = input?.profile || {}

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: 'A valid email is required' }
  }
  if (!password) {
    return { ok: false, status: 400, error: 'Password is required' }
  }
  if (!profile.firstName || !profile.lastName) {
    return { ok: false, status: 400, error: 'profile.firstName and profile.lastName are required' }
  }

  const policyErrors = await validatePasswordPolicy(actor.tenantId, password)
  if (policyErrors.length > 0) {
    return { ok: false, status: 400, error: policyErrors.join('; ') }
  }

  if (profile.orgUnitId && !isOrgUnitInScope(actor.visibilityScope, profile.orgUnitId)) {
    await recordAccessViolation({ actor, action: 'users.profile.create', entityId: null, ipAddress, userAgent })
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const userResult = await client.query(
      `INSERT INTO users (tenant_id, employee_id, email, password_hash, status, user_type)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'active'), COALESCE($6, 'internal'))
       RETURNING *`,
      [actor.tenantId, input.employeeId || null, email, passwordHash, input.status || null, input.userType || null]
    )
    const user = userResult.rows[0]

    const profileResult = await client.query(
      `INSERT INTO user_profiles
         (user_id, first_name, last_name, preferred_name, phone, location, time_zone, language,
          avatar_url, designation, grade, employment_type, org_unit_id, manager_id, joining_date)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'UTC'), COALESCE($8, 'en'), $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        user.id, profile.firstName, profile.lastName, profile.preferredName || null,
        profile.phone || null, profile.location || null, profile.timeZone || null,
        profile.language || null, profile.avatarUrl || null, profile.designation || null,
        profile.grade || null, profile.employmentType || null, profile.orgUnitId || null,
        profile.managerId || null, profile.joiningDate || null
      ]
    )

    const created = serializeUser({ ...user, ...profileResult.rows[0], roles: [] })

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.USER_CREATED,
      entityType: 'User',
      entityId: user.id,
      newValue: created,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 201, user: created }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return { ok: false, status: 409, error: 'A user with this email already exists' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid status or user_type value' }
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced org unit or manager does not exist' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// PUT /admin/users/:id
// ---------------------------------------------------------------------------

const USER_FIELD_MAP = {
  email: 'email',
  employeeId: 'employee_id',
  status: 'status',
  userType: 'user_type'
}

const PROFILE_FIELD_MAP = {
  firstName: 'first_name',
  lastName: 'last_name',
  preferredName: 'preferred_name',
  phone: 'phone',
  location: 'location',
  timeZone: 'time_zone',
  language: 'language',
  avatarUrl: 'avatar_url',
  designation: 'designation',
  grade: 'grade',
  employmentType: 'employment_type',
  orgUnitId: 'org_unit_id',
  managerId: 'manager_id',
  joiningDate: 'joining_date'
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

async function updateUser({ actor, userId, updates = {}, ipAddress, userAgent }) {
  const userColumns = pickColumns(updates, USER_FIELD_MAP)
  const profileColumns = pickColumns(updates.profile || {}, PROFILE_FIELD_MAP)

  if (Object.keys(userColumns).length === 0 && Object.keys(profileColumns).length === 0) {
    return { ok: false, status: 400, error: 'No valid fields to update' }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const current = await fetchUserWithProfile(client, actor.tenantId, userId)
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'User not found' }
    }

    // Rule 7: the record being edited, and any new org unit it's moving to,
    // must both be within the actor's visibility scope.
    const targetOrgUnitId = 'org_unit_id' in profileColumns ? profileColumns.org_unit_id : current.org_unit_id
    if (!isOrgUnitInScope(actor.visibilityScope, current.org_unit_id) ||
        !isOrgUnitInScope(actor.visibilityScope, targetOrgUnitId)) {
      await client.query('ROLLBACK')
      await recordAccessViolation({ actor, action: 'users.profile.edit', entityId: userId, ipAddress, userAgent })
      return { ok: false, status: 403, error: 'Forbidden' }
    }

    if (Object.keys(userColumns).length > 0) {
      const { clause, values } = buildSetClause(userColumns, 2)
      await client.query(`UPDATE users SET ${clause}, updated_at = NOW() WHERE id = $1`, [userId, ...values])
    }

    if (Object.keys(profileColumns).length > 0) {
      const { clause, values } = buildSetClause(profileColumns, 2)
      await client.query(`UPDATE user_profiles SET ${clause}, updated_at = NOW() WHERE user_id = $1`, [userId, ...values])
    }

    const updated = await fetchUserWithProfile(client, actor.tenantId, userId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.USER_UPDATED,
      entityType: 'User',
      entityId: userId,
      oldValue: serializeUser(current),
      newValue: serializeUser(updated),
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, user: serializeUser(updated) }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return { ok: false, status: 409, error: 'A user with this email already exists' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid status or user_type value' }
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced org unit or manager does not exist' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id  (soft delete)
// ---------------------------------------------------------------------------

async function deactivateUser({ actor, userId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const current = await fetchUserWithProfile(client, actor.tenantId, userId)
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'User not found' }
    }

    if (!isOrgUnitInScope(actor.visibilityScope, current.org_unit_id)) {
      await client.query('ROLLBACK')
      await recordAccessViolation({ actor, action: 'users.profile.deactivate', entityId: userId, ipAddress, userAgent })
      return { ok: false, status: 403, error: 'Forbidden' }
    }

    if (current.status === DEACTIVATED_STATUS) {
      await client.query('ROLLBACK')
      return { ok: true, user: serializeUser(current) }
    }

    await client.query('UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1', [userId, DEACTIVATED_STATUS])
    const updated = await fetchUserWithProfile(client, actor.tenantId, userId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.USER_DEACTIVATED,
      entityType: 'User',
      entityId: userId,
      oldValue: serializeUser(current),
      newValue: serializeUser(updated),
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, user: serializeUser(updated) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /admin/users/bulk-upload
// ---------------------------------------------------------------------------
//
// Stateless preview/confirm: every call parses and validates the uploaded
// file. confirm=false (or absent) returns the preview without writing
// anything. confirm=true inserts all rows IF AND ONLY IF there are zero
// validation errors — otherwise nothing is imported (per the spec's
// acceptance criteria) and the same error preview is returned.
//
// Expected columns (header row, case-insensitive, spaces become underscores):
//   email, first_name, last_name, employee_id, designation,
//   org_unit_code, manager_email, role

const XLSX_MAGIC = Buffer.from([0x50, 0x4b]) // 'PK' — .xlsx is a zip archive
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) // legacy .xls (unsupported)
const REQUIRED_COLUMNS = ['email', 'first_name', 'last_name']

/** Parse an uploaded buffer as CSV or XLSX, detected from file content (not extension). */
async function parseUserFile(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(OLE_MAGIC)) {
    const err = new Error('Legacy .xls files are not supported — please save as .xlsx or .csv')
    err.status = 400
    throw err
  }

  const workbook = new ExcelJS.Workbook()
  try {
    if (buffer.length >= 2 && buffer.subarray(0, 2).equals(XLSX_MAGIC)) {
      await workbook.xlsx.load(buffer)
    } else {
      await workbook.csv.read(Readable.from(buffer))
    }
  } catch {
    const err = new Error('Could not parse the uploaded file as CSV or Excel')
    err.status = 400
    throw err
  }

  const worksheet = workbook.worksheets[0]
  if (!worksheet || worksheet.rowCount < 2) {
    const err = new Error('File must contain a header row and at least one data row')
    err.status = 400
    throw err
  }

  const headers = []
  worksheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  })

  const rows = []
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const data = {}
    let hasValue = false
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber]
      if (!key) return
      const raw = cell.value
      const value = raw === null || raw === undefined ? '' : String(raw).trim()
      if (value) hasValue = true
      data[key] = value
    })
    if (hasValue) rows.push({ row: rowNumber, data })
  })

  return rows
}

/** Validate parsed rows: required fields, format, in-file/DB duplicates, and FK lookups. */
async function validateBulkRows(rows, actor) {
  const seenEmails = new Set()
  const emails = []
  const orgUnitCodes = new Set()
  const managerEmails = new Set()
  const roleNames = new Set()

  for (const { data } of rows) {
    if (data.email) emails.push(data.email.toLowerCase())
    if (data.org_unit_code) orgUnitCodes.add(data.org_unit_code)
    if (data.manager_email) managerEmails.add(data.manager_email.toLowerCase())
    if (data.role) roleNames.add(data.role)
  }

  const [existingUsers, orgUnits, managers, roles] = await Promise.all([
    emails.length
      ? db.query('SELECT email FROM users WHERE tenant_id = $1 AND LOWER(email) = ANY($2)', [actor.tenantId, emails])
      : { rows: [] },
    orgUnitCodes.size
      ? db.query('SELECT id, code FROM organisation_units WHERE tenant_id = $1 AND code = ANY($2)', [actor.tenantId, [...orgUnitCodes]])
      : { rows: [] },
    managerEmails.size
      ? db.query('SELECT id, LOWER(email) AS email FROM users WHERE tenant_id = $1 AND LOWER(email) = ANY($2)', [actor.tenantId, [...managerEmails]])
      : { rows: [] },
    roleNames.size
      ? db.query("SELECT id, name FROM roles WHERE tenant_id = $1 AND name = ANY($2) AND status = 'active'", [actor.tenantId, [...roleNames]])
      : { rows: [] }
  ])

  const existingEmailSet = new Set(existingUsers.rows.map((r) => r.email.toLowerCase()))
  const orgUnitMap = new Map(orgUnits.rows.map((r) => [r.code, r.id]))
  const managerMap = new Map(managers.rows.map((r) => [r.email, r.id]))
  const roleMap = new Map(roles.rows.map((r) => [r.name, r.id]))

  const results = rows.map(({ row, data }) => {
    const errors = []
    const email = data.email?.toLowerCase()

    for (const col of REQUIRED_COLUMNS) {
      if (!data[col]) errors.push(`${col} is required`)
    }
    if (data.email && !EMAIL_RE.test(data.email)) {
      errors.push('email is not a valid email address')
    }
    if (email) {
      if (existingEmailSet.has(email)) errors.push('email already exists')
      if (seenEmails.has(email)) errors.push('duplicate email in file')
      seenEmails.add(email)
    }

    let orgUnitId = null
    if (data.org_unit_code) {
      orgUnitId = orgUnitMap.get(data.org_unit_code) || null
      if (!orgUnitId) errors.push(`org_unit_code "${data.org_unit_code}" not found`)
      else if (!isOrgUnitInScope(actor.visibilityScope, orgUnitId)) errors.push(`org_unit_code "${data.org_unit_code}" is outside your visibility scope`)
    }

    let managerId = null
    if (data.manager_email) {
      managerId = managerMap.get(data.manager_email.toLowerCase()) || null
      if (!managerId) errors.push(`manager_email "${data.manager_email}" not found`)
    }

    let roleId = null
    if (data.role) {
      roleId = roleMap.get(data.role) || null
      if (!roleId) errors.push(`role "${data.role}" not found`)
    }

    return { row, data, errors, resolved: { orgUnitId, managerId, roleId } }
  })

  const errorCount = results.filter((r) => r.errors.length > 0).length

  return {
    results,
    summary: { totalRows: rows.length, validCount: rows.length - errorCount, errorCount }
  }
}

async function bulkUploadUsers({ actor, fileBuffer, confirm, ipAddress, userAgent }) {
  const rows = await parseUserFile(fileBuffer)
  const { results, summary } = await validateBulkRows(rows, actor)
  const preview = results.map((r) => ({ row: r.row, data: r.data, errors: r.errors }))

  if (!confirm) {
    return { ok: true, status: 200, committed: false, summary, rows: preview }
  }

  if (summary.errorCount > 0) {
    return { ok: false, status: 400, committed: false, summary, rows: preview, error: 'Resolve validation errors before confirming' }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const created = []
    for (const r of results) {
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, employee_id, email)
         VALUES ($1, $2, $3)
         RETURNING id, email`,
        [actor.tenantId, r.data.employee_id || null, r.data.email]
      )
      const newUser = userResult.rows[0]

      await client.query(
        `INSERT INTO user_profiles (user_id, first_name, last_name, designation, org_unit_id, manager_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newUser.id, r.data.first_name, r.data.last_name, r.data.designation || null, r.resolved.orgUnitId, r.resolved.managerId]
      )

      if (r.resolved.roleId) {
        await client.query(
          'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)',
          [newUser.id, r.resolved.roleId, actor.id]
        )
      }

      created.push(newUser)
    }

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.USER_BULK_UPLOADED,
      entityType: 'User',
      newValue: { insertedCount: created.length, users: created },
      ipAddress,
      userAgent,
      result: 'success',
      metadata: { totalRows: summary.totalRows }
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 201, committed: true, summary: { ...summary, insertedCount: created.length }, created }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return { ok: false, status: 409, committed: false, error: 'A duplicate email was found during insert' }
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  listUsers,
  createUser,
  updateUser,
  deactivateUser,
  bulkUploadUsers,
  // exported for tests / reuse
  isOrgUnitInScope,
  serializeUser
}
