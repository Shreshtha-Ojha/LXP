// tests/unit/users.test.js
//
// Unit tests for src/modules/users/userService.js and the RBAC wiring in
// src/modules/users/userRoutes.js.
//
// Pattern (matches tests/unit/auth.test.js): mock db, bcrypt, and auditLog so
// we can assert exactly what gets written to the audit log for each outcome,
// and that visibility scope (Rule 7) is enforced before any write.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('bcrypt')
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})
// Bypass JWT/db lookups in authenticate so route tests can set req.user
// directly via a header — permissionEngine and userService still run for real
// against the mocked db above.
jest.mock('../../src/middleware/authenticate', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'test@example.com',
      userType: 'internal',
      roles: [req.headers['x-test-role']],
      orgUnitId: 'ou-1'
    }
    next()
  }
}))

const bcrypt = require('bcrypt')
const db = require('../../src/db')
const auditLog = require('../../src/modules/audit/auditLog')
const userService = require('../../src/modules/users/userService')

const ALL_SCOPE = { type: 'all', orgUnitIds: null }

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// isOrgUnitInScope (Rule 7)
// ---------------------------------------------------------------------------

describe('isOrgUnitInScope', () => {
  it('allows any org unit when the scope is unrestricted (orgUnitIds: null)', () => {
    expect(userService.isOrgUnitInScope(ALL_SCOPE, 'ou-9')).toBe(true)
  })

  it('allows records that have no org unit, regardless of scope', () => {
    expect(userService.isOrgUnitInScope({ orgUnitIds: ['ou-1'] }, null)).toBe(true)
  })

  it('allows org units that are within scope', () => {
    expect(userService.isOrgUnitInScope({ orgUnitIds: ['ou-1'] }, 'ou-1')).toBe(true)
  })

  it('denies org units that are outside scope', () => {
    expect(userService.isOrgUnitInScope({ orgUnitIds: ['ou-1'] }, 'ou-2')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// listUsers
// ---------------------------------------------------------------------------

describe('listUsers', () => {
  it('scopes the query by tenant_id and the visibility scope org units', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '1' }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 'user-2', tenant_id: 'tenant-1', email: 'bob@example.com', status: 'active',
          user_type: 'internal', first_name: 'Bob', last_name: 'Lee', org_unit_id: 'ou-1', roles: ['associate']
        }]
      })

    const result = await userService.listUsers({
      tenantId: 'tenant-1',
      visibilityScope: { type: 'team', orgUnitIds: ['ou-1'] },
      filters: {},
      page: 1,
      pageSize: 20
    })

    expect(result.data).toHaveLength(1)
    expect(result.data[0].email).toBe('bob@example.com')
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 })

    const [countSql, countParams] = db.query.mock.calls[0]
    expect(countSql).toContain('u.tenant_id = $1')
    expect(countSql).toContain('up.org_unit_id = ANY($2)')
    expect(countParams).toEqual(['tenant-1', ['ou-1']])
  })

  it('does not add an org-unit filter when the scope is unrestricted, and applies status/role filters', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })

    await userService.listUsers({
      tenantId: 'tenant-1',
      visibilityScope: ALL_SCOPE,
      filters: { status: 'active', role: 'associate' },
      page: 1,
      pageSize: 20
    })

    const [countSql, countParams] = db.query.mock.calls[0]
    expect(countSql).not.toContain('org_unit_id = ANY')
    expect(countSql).toContain('u.status = $2')
    expect(countSql).toContain('r2.name = $3')
    expect(countParams).toEqual(['tenant-1', 'active', 'associate'])
  })

  it('clamps an out-of-range page size to the configured maximum', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await userService.listUsers({
      tenantId: 'tenant-1',
      visibilityScope: ALL_SCOPE,
      filters: {},
      page: 1,
      pageSize: 9999
    })

    expect(result.pagination.pageSize).toBe(100)
  })
})

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

describe('createUser', () => {
  const ldAdmin = { id: 'admin-1', tenantId: 'tenant-1', roles: ['ld_admin'], visibilityScope: ALL_SCOPE }

  it('hashes the password, creates the user + profile, and writes USER_CREATED in the same transaction', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { key: 'password_min_length', value: { value: 8 } },
        { key: 'password_require_upper', value: { value: true } },
        { key: 'password_require_number', value: { value: true } }
      ]
    })
    bcrypt.hash.mockResolvedValueOnce('hashed-pw')

    const client = txClient([
      {}, // BEGIN
      { rows: [{ id: 'user-9', tenant_id: 'tenant-1', email: 'new@example.com', status: 'active', user_type: 'internal', password_hash: 'hashed-pw', created_at: '2026-01-01' }] }, // INSERT users
      { rows: [{ user_id: 'user-9', first_name: 'New', last_name: 'Hire', org_unit_id: 'ou-1' }] }, // INSERT user_profiles
      {}, // audit insert
      {}  // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await userService.createUser({
      actor: ldAdmin,
      input: {
        email: 'new@example.com',
        password: 'Password1',
        profile: { firstName: 'New', lastName: 'Hire', orgUnitId: 'ou-1' }
      },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.user.email).toBe('new@example.com')
    expect(result.user).not.toHaveProperty('password_hash')
    expect(result.user.profile.firstName).toBe('New')

    expect(bcrypt.hash).toHaveBeenCalledWith('Password1', 12)
    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'admin-1',
        actionType: auditLog.AuditActions.USER_CREATED,
        entityType: 'User',
        entityId: 'user-9',
        result: 'success'
      }),
      client
    )
  })

  it('rejects a password that fails the configured password policy without touching the database', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ key: 'password_min_length', value: { value: 8 } }] })

    const result = await userService.createUser({
      actor: ldAdmin,
      input: { email: 'new2@example.com', password: 'short', profile: { firstName: 'A', lastName: 'B' } },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('at least 8 characters') })
    expect(db.getClient).not.toHaveBeenCalled()
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('returns 403 and logs ACCESS_VIOLATION when the target org unit is outside the actor visibility scope', async () => {
    const reportingManager = { id: 'mgr-1', tenantId: 'tenant-1', roles: ['reporting_manager'], visibilityScope: { type: 'team', orgUnitIds: ['ou-1'] } }

    db.query.mockResolvedValueOnce({ rows: [{ key: 'password_min_length', value: { value: 8 } }] })

    const result = await userService.createUser({
      actor: reportingManager,
      input: { email: 'new3@example.com', password: 'Password1', profile: { firstName: 'A', lastName: 'B', orgUnitId: 'ou-99' } },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(db.getClient).not.toHaveBeenCalled()
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.ACCESS_VIOLATION, result: 'failure' })
    )
  })

  it('returns 409 when the email already exists for the tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ key: 'password_min_length', value: { value: 8 } }] })
    bcrypt.hash.mockResolvedValueOnce('hashed-pw')

    const client = txClient([
      {}, // BEGIN
      Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await userService.createUser({
      actor: ldAdmin,
      input: { email: 'dup@example.com', password: 'Password1', profile: { firstName: 'A', lastName: 'B' } },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 409, error: 'A user with this email already exists' })
    expect(client.release).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// updateUser
// ---------------------------------------------------------------------------

describe('updateUser', () => {
  const CURRENT_ROW = {
    id: 'user-2', tenant_id: 'tenant-1', employee_id: 'E2', email: 'bob@example.com',
    status: 'active', user_type: 'internal', last_login_at: null, created_at: '2025-01-01',
    first_name: 'Bob', last_name: 'Lee', preferred_name: null, phone: null, location: null,
    time_zone: 'UTC', language: 'en', avatar_url: null, designation: 'Engineer', grade: null,
    employment_type: null, org_unit_id: 'ou-1', manager_id: null, joining_date: null,
    roles: ['associate']
  }

  const ldAdmin = { id: 'admin-1', tenantId: 'tenant-1', roles: ['ld_admin'], visibilityScope: ALL_SCOPE }

  it('updates fields and writes USER_UPDATED with old and new snapshots in one transaction', async () => {
    const updatedRow = { ...CURRENT_ROW, designation: 'Senior Engineer' }
    const client = txClient([
      {},                       // BEGIN
      { rows: [CURRENT_ROW] },  // fetch current
      {},                       // UPDATE user_profiles
      { rows: [updatedRow] },   // fetch updated
      {},                       // audit insert
      {}                        // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await userService.updateUser({
      actor: ldAdmin,
      userId: 'user-2',
      updates: { profile: { designation: 'Senior Engineer' } },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.user.profile.designation).toBe('Senior Engineer')
    expect(client.query).toHaveBeenCalledWith('COMMIT')

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.USER_UPDATED,
        entityId: 'user-2',
        oldValue: expect.objectContaining({ profile: expect.objectContaining({ designation: 'Engineer' }) }),
        newValue: expect.objectContaining({ profile: expect.objectContaining({ designation: 'Senior Engineer' }) }),
        result: 'success'
      }),
      client
    )
  })

  it('returns 404 when the user does not exist in this tenant', async () => {
    const client = txClient([
      {},          // BEGIN
      { rows: [] }, // fetch current -> none
      {}           // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await userService.updateUser({
      actor: ldAdmin,
      userId: 'missing',
      updates: { profile: { designation: 'X' } },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'User not found' })
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('returns 403 and logs ACCESS_VIOLATION when the record is outside the actor visibility scope', async () => {
    const client = txClient([
      {},                      // BEGIN
      { rows: [CURRENT_ROW] }, // fetch current (org_unit_id: 'ou-1')
      {}                       // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const reportingManager = { id: 'mgr-1', tenantId: 'tenant-1', roles: ['reporting_manager'], visibilityScope: { type: 'team', orgUnitIds: ['ou-2'] } }

    const result = await userService.updateUser({
      actor: reportingManager,
      userId: 'user-2',
      updates: { profile: { designation: 'Hacked' } },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.ACCESS_VIOLATION, entityId: 'user-2', result: 'failure' })
    )
  })

  it('returns 400 when the update body has no recognised fields, without opening a transaction', async () => {
    const result = await userService.updateUser({
      actor: ldAdmin,
      userId: 'user-2',
      updates: { nonsense: 'value' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'No valid fields to update' })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// deactivateUser
// ---------------------------------------------------------------------------

describe('deactivateUser', () => {
  const ACTIVE_ROW = {
    id: 'user-3', tenant_id: 'tenant-1', employee_id: 'E3', email: 'carl@example.com',
    status: 'active', user_type: 'internal', last_login_at: null, created_at: '2025-01-01',
    first_name: 'Carl', last_name: 'Diaz', org_unit_id: 'ou-1', roles: ['associate']
  }

  const ldAdmin = { id: 'admin-1', tenantId: 'tenant-1', roles: ['ld_admin'], visibilityScope: ALL_SCOPE }

  it('sets status to inactive and writes USER_DEACTIVATED with old/new values', async () => {
    const inactiveRow = { ...ACTIVE_ROW, status: 'inactive' }
    const client = txClient([
      {},                     // BEGIN
      { rows: [ACTIVE_ROW] }, // fetch current
      {},                     // UPDATE users SET status
      { rows: [inactiveRow] }, // fetch updated
      {},                     // audit insert
      {}                      // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await userService.deactivateUser({ actor: ldAdmin, userId: 'user-3', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.user.status).toBe('inactive')
    expect(client.query).toHaveBeenCalledWith('UPDATE users SET status = $2, updated_at = NOW() WHERE id = $1', ['user-3', 'inactive'])

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.USER_DEACTIVATED,
        entityId: 'user-3',
        oldValue: expect.objectContaining({ status: 'active' }),
        newValue: expect.objectContaining({ status: 'inactive' }),
        result: 'success'
      }),
      client
    )
  })

  it('is idempotent for an already-inactive user and writes no audit event', async () => {
    const client = txClient([
      {},                                              // BEGIN
      { rows: [{ ...ACTIVE_ROW, status: 'inactive' }] }, // fetch current
      {}                                                // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await userService.deactivateUser({ actor: ldAdmin, userId: 'user-3', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.user.status).toBe('inactive')
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('returns 403 and logs ACCESS_VIOLATION when the record is outside the actor visibility scope', async () => {
    const client = txClient([
      {},                     // BEGIN
      { rows: [ACTIVE_ROW] }, // fetch current (org_unit_id: 'ou-1')
      {}                      // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const reportingManager = { id: 'mgr-1', tenantId: 'tenant-1', roles: ['reporting_manager'], visibilityScope: { type: 'team', orgUnitIds: ['ou-2'] } }

    const result = await userService.deactivateUser({ actor: reportingManager, userId: 'user-3', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.ACCESS_VIOLATION, entityId: 'user-3', result: 'failure' })
    )
  })
})

// ---------------------------------------------------------------------------
// bulkUploadUsers
// ---------------------------------------------------------------------------

describe('bulkUploadUsers', () => {
  const ldAdmin = { id: 'admin-1', tenantId: 'tenant-1', roles: ['ld_admin'], visibilityScope: ALL_SCOPE }

  function csv(rows) {
    return Buffer.from(rows.map((r) => r.join(',')).join('\n') + '\n', 'utf-8')
  }

  it('returns a preview with per-row errors and inserts nothing when confirm is not set', async () => {
    const fileBuffer = csv([
      ['email', 'first_name', 'last_name', 'org_unit_code', 'manager_email', 'role'],
      ['alice@example.com', 'Alice', 'Anders', 'ENG', 'manager@example.com', 'associate'],
      ['bademail', 'Bad', 'Row', 'BADCODE', 'missing@example.com', 'no_such_role']
    ])

    db.query
      .mockResolvedValueOnce({ rows: [] }) // existing users with these emails
      .mockResolvedValueOnce({ rows: [{ id: 'ou-eng', code: 'ENG' }] }) // org units
      .mockResolvedValueOnce({ rows: [{ id: 'mgr-1', email: 'manager@example.com' }] }) // managers
      .mockResolvedValueOnce({ rows: [{ id: 'role-assoc', name: 'associate' }] }) // roles

    const result = await userService.bulkUploadUsers({ actor: ldAdmin, fileBuffer, confirm: false })

    expect(result.ok).toBe(true)
    expect(result.committed).toBe(false)
    expect(result.summary).toEqual({ totalRows: 2, validCount: 1, errorCount: 1 })

    expect(result.rows[0].errors).toEqual([])
    expect(result.rows[1].errors).toEqual(expect.arrayContaining([
      'email is not a valid email address',
      'org_unit_code "BADCODE" not found',
      'manager_email "missing@example.com" not found',
      'role "no_such_role" not found'
    ]))

    expect(db.getClient).not.toHaveBeenCalled()
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('refuses to import when confirm is set but validation errors remain', async () => {
    const fileBuffer = csv([
      ['email', 'first_name', 'last_name'],
      ['bademail', 'Bad', 'Row']
    ])

    db.query.mockResolvedValueOnce({ rows: [] }) // existing users lookup

    const result = await userService.bulkUploadUsers({ actor: ldAdmin, fileBuffer, confirm: true })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.committed).toBe(false)
    expect(result.summary.errorCount).toBe(1)
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('imports all rows and writes a single USER_BULK_UPLOADED audit event when confirmed and valid', async () => {
    const fileBuffer = csv([
      ['email', 'first_name', 'last_name', 'org_unit_code', 'manager_email', 'role'],
      ['alice@example.com', 'Alice', 'Anders', 'ENG', 'manager@example.com', 'associate']
    ])

    db.query
      .mockResolvedValueOnce({ rows: [] }) // existing users
      .mockResolvedValueOnce({ rows: [{ id: 'ou-eng', code: 'ENG' }] }) // org units
      .mockResolvedValueOnce({ rows: [{ id: 'mgr-1', email: 'manager@example.com' }] }) // managers
      .mockResolvedValueOnce({ rows: [{ id: 'role-assoc', name: 'associate' }] }) // roles

    const client = txClient([
      {},                                                          // BEGIN
      { rows: [{ id: 'user-new', email: 'alice@example.com' }] },  // INSERT users
      {},                                                          // INSERT user_profiles
      {},                                                          // INSERT user_roles
      {},                                                          // audit insert
      {}                                                           // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await userService.bulkUploadUsers({ actor: ldAdmin, fileBuffer, confirm: true })

    expect(result.ok).toBe(true)
    expect(result.committed).toBe(true)
    expect(result.summary).toEqual({ totalRows: 1, validCount: 1, errorCount: 0, insertedCount: 1 })
    expect(result.created).toEqual([{ id: 'user-new', email: 'alice@example.com' }])

    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.USER_BULK_UPLOADED,
        entityType: 'User',
        result: 'success',
        newValue: expect.objectContaining({ insertedCount: 1 })
      }),
      client
    )
  })

  it('rejects legacy .xls files based on the file header, not the extension', async () => {
    const oleBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x00, 0x00, 0x00])

    await expect(userService.bulkUploadUsers({ actor: ldAdmin, fileBuffer: oleBuffer, confirm: false }))
      .rejects.toMatchObject({ status: 400 })

    expect(db.query).not.toHaveBeenCalled()
  })

  it('rejects a file with only a header row', async () => {
    const fileBuffer = csv([['email', 'first_name', 'last_name']])

    await expect(userService.bulkUploadUsers({ actor: ldAdmin, fileBuffer, confirm: false }))
      .rejects.toMatchObject({ status: 400 })
  })
})

// ---------------------------------------------------------------------------
// Route-level RBAC: GET /admin/users
// (Rule 10 — at least one allowed role succeeds, one denied role gets a 403)
// ---------------------------------------------------------------------------

describe('GET /admin/users (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const userRoutes = require('../../src/modules/users/userRoutes')

  const app = express()
  app.use(express.json())
  app.use('/admin/users', userRoutes)

  it('allows ld_admin (200) and lists users within their unrestricted scope', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission: ld_admin -> super_admin shortcut not taken, but role check passes
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })    // listUsers count
      .mockResolvedValueOnce({ rows: [] })                  // listUsers data

    const res = await request(app)
      .get('/admin/users')
      .set('x-test-role', 'ld_admin')

    expect(res.status).toBe(200)
    expect(res.body.data).toEqual([])
    expect(res.body.pagination.total).toBe(0)
  })

  it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // hasPermission: associate -> no matching role_permissions row
      .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert written by requirePermission

    const res = await request(app)
      .get('/admin/users')
      .set('x-test-role', 'associate')

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })

    const [violationSql, violationParams] = db.query.mock.calls[1]
    expect(violationSql).toContain('ACCESS_VIOLATION')
    expect(violationParams).toEqual(
      expect.arrayContaining(['tenant-1', 'user-1', 'associate', 'users.directory'])
    )
  })
})
