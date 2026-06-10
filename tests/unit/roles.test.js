// tests/unit/roles.test.js
//
// Unit tests for src/modules/roles/roleService.js and the RBAC wiring in
// src/modules/roles/roleRoutes.js.
//
// Pattern (matches tests/unit/users.test.js): mock db and auditLog so we can
// assert exactly what gets written to the audit log for each outcome, and
// that visibility scope (Rule 7) is enforced before any write. authenticate
// is mocked at the top level (not via jest.doMock) so every required module
// shares the same mocked db singleton.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})
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

const db = require('../../src/db')
const auditLog = require('../../src/modules/audit/auditLog')
const roleService = require('../../src/modules/roles/roleService')

const ALL_SCOPE = { type: 'all', orgUnitIds: null }
const ldAdmin = { id: 'admin-1', tenantId: 'tenant-1', roles: ['ld_admin'], visibilityScope: ALL_SCOPE }

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// listRoles
// ---------------------------------------------------------------------------

describe('listRoles', () => {
  it('scopes by tenant_id and attaches each role permissions via the join table', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [
          { id: 'role-1', tenant_id: 'tenant-1', name: 'associate', description: 'Associate', is_system_role: true, status: 'active' },
          { id: 'role-2', tenant_id: 'tenant-1', name: 'ld_admin', description: 'L&D Admin', is_system_role: true, status: 'active' }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          { role_id: 'role-2', module: 'roles', feature: 'definitions', action: 'view' },
          { role_id: 'role-2', module: 'roles', feature: 'definitions', action: 'create' }
        ]
      })

    const result = await roleService.listRoles({ tenantId: 'tenant-1' })

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(expect.objectContaining({ id: 'role-1', name: 'associate', isSystemRole: true, permissions: [] }))
    expect(result[1].permissions).toEqual([
      { module: 'roles', feature: 'definitions', action: 'view' },
      { module: 'roles', feature: 'definitions', action: 'create' }
    ])

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('WHERE tenant_id = $1')
    expect(params).toEqual(['tenant-1'])
  })

  it('does not query role_permissions when the tenant has no roles', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await roleService.listRoles({ tenantId: 'tenant-1' })

    expect(result).toEqual([])
    expect(db.query).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// createRole
// ---------------------------------------------------------------------------

describe('createRole', () => {
  it('creates a non-system role and writes ROLE_CREATED in the same transaction', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [{ id: 'role-9', tenant_id: 'tenant-1', name: 'Custom Trainer', description: 'A custom role', is_system_role: false, status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01' }] },
      {}, // audit insert
      {}  // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.createRole({
      actor: ldAdmin,
      input: { name: 'Custom Trainer', description: 'A custom role' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.role).toEqual(expect.objectContaining({ id: 'role-9', name: 'Custom Trainer', isSystemRole: false, permissions: [] }))

    const [insertSql, insertParams] = client.query.mock.calls[1]
    expect(insertSql).toContain('FALSE')
    expect(insertParams).toEqual(['tenant-1', 'Custom Trainer', 'A custom role'])

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'admin-1',
        actionType: auditLog.AuditActions.ROLE_CREATED,
        entityType: 'Role',
        entityId: 'role-9',
        result: 'success'
      }),
      client
    )
  })

  it('returns 400 when name is missing, without touching the database', async () => {
    const result = await roleService.createRole({ actor: ldAdmin, input: {}, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result).toEqual({ ok: false, status: 400, error: 'name is required' })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 409 when a role with this name already exists for the tenant', async () => {
    const client = txClient([
      {}, // BEGIN
      Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.createRole({
      actor: ldAdmin,
      input: { name: 'ld_admin' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 409, error: 'A role with this name already exists' })
    expect(client.release).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// updateRole
// ---------------------------------------------------------------------------

describe('updateRole', () => {
  const CUSTOM_ROLE = {
    id: 'role-2', tenant_id: 'tenant-1', name: 'Old Name', description: 'Old desc',
    is_system_role: false, status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01'
  }

  const SYSTEM_ROLE = {
    id: 'role-1', tenant_id: 'tenant-1', name: 'ld_admin', description: 'L&D Admin',
    is_system_role: true, status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01'
  }

  it('updates name/description of a custom role and writes ROLE_UPDATED with old/new snapshots', async () => {
    const updated = { ...CUSTOM_ROLE, name: 'New Name', description: 'New desc' }
    const client = txClient([
      {},                     // BEGIN
      { rows: [CUSTOM_ROLE] }, // SELECT current
      { rows: [updated] },     // UPDATE ... RETURNING
      { rows: [] },            // fetchRolePermissions
      {},                      // audit insert
      {}                       // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.updateRole({
      actor: ldAdmin,
      roleId: 'role-2',
      updates: { name: 'New Name', description: 'New desc' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.role).toEqual(expect.objectContaining({ name: 'New Name', description: 'New desc', permissions: [] }))

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.ROLE_UPDATED,
        entityId: 'role-2',
        oldValue: expect.objectContaining({ name: 'Old Name', description: 'Old desc' }),
        newValue: expect.objectContaining({ name: 'New Name', description: 'New desc' }),
        result: 'success'
      }),
      client
    )
  })

  it('allows editing the description of a system role as long as the name is unchanged', async () => {
    const updated = { ...SYSTEM_ROLE, description: 'Updated description' }
    const client = txClient([
      {},                      // BEGIN
      { rows: [SYSTEM_ROLE] }, // SELECT current
      { rows: [updated] },     // UPDATE ... RETURNING
      { rows: [] },            // fetchRolePermissions
      {},                      // audit insert
      {}                       // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.updateRole({
      actor: ldAdmin,
      roleId: 'role-1',
      updates: { description: 'Updated description' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.role.description).toBe('Updated description')
  })

  it('returns 400 when attempting to rename a system role', async () => {
    const client = txClient([
      {},                      // BEGIN
      { rows: [SYSTEM_ROLE] }, // SELECT current
      {}                       // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.updateRole({
      actor: ldAdmin,
      roleId: 'role-1',
      updates: { name: 'renamed_admin' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'System role names cannot be changed' })
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('returns 404 when the role does not exist in this tenant', async () => {
    const client = txClient([
      {},          // BEGIN
      { rows: [] }, // SELECT current -> none
      {}           // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.updateRole({
      actor: ldAdmin,
      roleId: 'missing',
      updates: { name: 'X' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Role not found' })
  })

  it('returns 400 when no recognised fields are provided, without touching the database', async () => {
    const result = await roleService.updateRole({ actor: ldAdmin, roleId: 'role-2', updates: { foo: 'bar' } })

    expect(result).toEqual({ ok: false, status: 400, error: 'No valid fields to update' })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// setRolePermissions (replace semantics)
// ---------------------------------------------------------------------------

describe('setRolePermissions', () => {
  const ROLE = {
    id: 'role-2', tenant_id: 'tenant-1', name: 'Custom Role', description: null,
    is_system_role: false, status: 'active', created_at: '2026-01-01', updated_at: '2026-01-01'
  }

  it('replaces the permission set: removes what is no longer requested, adds what is new, writes PERMISSION_CHANGED', async () => {
    const client = txClient([
      {},                                                                            // BEGIN
      { rows: [ROLE] },                                                              // SELECT role
      { rows: [{ id: 'perm-2', module: 'roles', feature: 'assignments', action: 'edit' }] }, // lookup requested permissions
      { rows: [{ id: 'perm-1', module: 'roles', feature: 'definitions', action: 'view' }] },  // current role_permissions
      {},                                                                            // DELETE role_permissions (perm-1)
      {},                                                                            // INSERT role_permissions (perm-2)
      {},                                                                            // audit insert
      {}                                                                             // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.setRolePermissions({
      actor: ldAdmin,
      roleId: 'role-2',
      permissions: [{ module: 'roles', feature: 'assignments', action: 'edit' }],
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.role.permissions).toEqual([{ module: 'roles', feature: 'assignments', action: 'edit' }])

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM role_permissions'),
      ['role-2', ['perm-1']]
    )
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO role_permissions'),
      ['role-2', 'perm-2']
    )

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.PERMISSION_CHANGED,
        entityType: 'Role',
        entityId: 'role-2',
        oldValue: { permissions: [{ module: 'roles', feature: 'definitions', action: 'view' }] },
        newValue: { permissions: [{ module: 'roles', feature: 'assignments', action: 'edit' }] },
        result: 'success'
      }),
      client
    )
  })

  it('clears all permissions when given an empty array', async () => {
    const client = txClient([
      {},                                                                           // BEGIN
      { rows: [ROLE] },                                                             // SELECT role
      { rows: [{ id: 'perm-1', module: 'roles', feature: 'definitions', action: 'view' }] }, // current role_permissions
      {},                                                                           // DELETE role_permissions (perm-1)
      {},                                                                           // audit insert
      {}                                                                            // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.setRolePermissions({ actor: ldAdmin, roleId: 'role-2', permissions: [] })

    expect(result.ok).toBe(true)
    expect(result.role.permissions).toEqual([])
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM role_permissions'), ['role-2', ['perm-1']])
  })

  it('returns 400 listing unresolvable permission tuples without writing anything', async () => {
    const client = txClient([
      {},               // BEGIN
      { rows: [ROLE] }, // SELECT role
      { rows: [] },     // lookup -> nothing matches
      {}                // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.setRolePermissions({
      actor: ldAdmin,
      roleId: 'role-2',
      permissions: [{ module: 'bogus', feature: 'thing', action: 'view' }]
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'Unknown permission(s): bogus.thing.view' })
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('returns 404 when the role does not exist in this tenant', async () => {
    const client = txClient([
      {},          // BEGIN
      { rows: [] }, // SELECT role -> none
      {}           // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.setRolePermissions({ actor: ldAdmin, roleId: 'missing', permissions: [] })

    expect(result).toEqual({ ok: false, status: 404, error: 'Role not found' })
  })

  it('returns 400 when permissions is not an array, without touching the database', async () => {
    const result = await roleService.setRolePermissions({ actor: ldAdmin, roleId: 'role-2', permissions: 'oops' })

    expect(result).toEqual({ ok: false, status: 400, error: 'permissions must be an array of { module, feature, action }' })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// assignRoleToUser
// ---------------------------------------------------------------------------

describe('assignRoleToUser', () => {
  const TARGET_USER = { id: 'user-2', org_unit_id: 'ou-1' }
  const TRAINER_ROLE = { id: 'role-2', tenant_id: 'tenant-1', name: 'trainer', status: 'active' }

  it('assigns the role and writes ROLE_ASSIGNED in the same transaction', async () => {
    const client = txClient([
      {},                      // BEGIN
      { rows: [TARGET_USER] }, // fetchUserOrgUnit
      { rows: [TRAINER_ROLE] }, // SELECT role
      { rows: [{ user_id: 'user-2', role_id: 'role-2', effective_from: null, effective_to: null }] }, // INSERT user_roles
      {},                      // audit insert
      {}                       // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.assignRoleToUser({
      actor: ldAdmin,
      userId: 'user-2',
      roleId: 'role-2',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.assignment).toEqual(expect.objectContaining({ userId: 'user-2', roleId: 'role-2', roleName: 'trainer' }))

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.ROLE_ASSIGNED,
        entityType: 'User',
        entityId: 'user-2',
        newValue: expect.objectContaining({ roleId: 'role-2', roleName: 'trainer' }),
        result: 'success'
      }),
      client
    )
  })

  it('returns 403 and logs ACCESS_VIOLATION when the user is outside the actor visibility scope', async () => {
    const client = txClient([
      {},                                            // BEGIN
      { rows: [{ id: 'user-9', org_unit_id: 'ou-99' }] }, // fetchUserOrgUnit
      {}                                             // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const reportingManager = { id: 'mgr-1', tenantId: 'tenant-1', roles: ['reporting_manager'], visibilityScope: { type: 'team', orgUnitIds: ['ou-1'] } }

    const result = await roleService.assignRoleToUser({
      actor: reportingManager,
      userId: 'user-9',
      roleId: 'role-2',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.ACCESS_VIOLATION, result: 'failure' })
    )
  })

  it('returns 404 when the user does not exist in this tenant', async () => {
    const client = txClient([
      {},          // BEGIN
      { rows: [] }, // fetchUserOrgUnit -> none
      {}           // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.assignRoleToUser({ actor: ldAdmin, userId: 'missing', roleId: 'role-2' })

    expect(result).toEqual({ ok: false, status: 404, error: 'User not found' })
  })

  it('returns 404 when the role does not exist in this tenant', async () => {
    const client = txClient([
      {},                      // BEGIN
      { rows: [TARGET_USER] }, // fetchUserOrgUnit
      { rows: [] },            // SELECT role -> none
      {}                       // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.assignRoleToUser({ actor: ldAdmin, userId: 'user-2', roleId: 'missing' })

    expect(result).toEqual({ ok: false, status: 404, error: 'Role not found' })
  })

  it('returns 400 when the role is retired', async () => {
    const client = txClient([
      {},                      // BEGIN
      { rows: [TARGET_USER] }, // fetchUserOrgUnit
      { rows: [{ ...TRAINER_ROLE, status: 'retired' }] }, // SELECT role
      {}                       // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.assignRoleToUser({ actor: ldAdmin, userId: 'user-2', roleId: 'role-2' })

    expect(result).toEqual({ ok: false, status: 400, error: 'Cannot assign a retired role' })
  })

  it('returns 409 when the user already has this role', async () => {
    const client = txClient([
      {},                      // BEGIN
      { rows: [TARGET_USER] }, // fetchUserOrgUnit
      { rows: [TRAINER_ROLE] }, // SELECT role
      Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.assignRoleToUser({ actor: ldAdmin, userId: 'user-2', roleId: 'role-2' })

    expect(result).toEqual({ ok: false, status: 409, error: 'This role is already assigned to the user' })
  })

  it('returns 400 when roleId is missing, without touching the database', async () => {
    const result = await roleService.assignRoleToUser({ actor: ldAdmin, userId: 'user-2', roleId: undefined })

    expect(result).toEqual({ ok: false, status: 400, error: 'roleId is required' })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// removeRoleFromUser
// ---------------------------------------------------------------------------

describe('removeRoleFromUser', () => {
  const TARGET_USER = { id: 'user-2', org_unit_id: 'ou-1' }
  const TRAINER_ROLE = { id: 'role-2', tenant_id: 'tenant-1', name: 'trainer', status: 'active' }

  it('removes the assignment and writes ROLE_REMOVED in the same transaction', async () => {
    const client = txClient([
      {},                      // BEGIN
      { rows: [TARGET_USER] }, // fetchUserOrgUnit
      { rows: [TRAINER_ROLE] }, // SELECT role
      { rowCount: 1 },         // DELETE user_roles
      {},                      // audit insert
      {}                       // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.removeRoleFromUser({
      actor: ldAdmin,
      userId: 'user-2',
      roleId: 'role-2',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: true, message: 'Role removed' })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.ROLE_REMOVED,
        entityType: 'User',
        entityId: 'user-2',
        oldValue: { roleId: 'role-2', roleName: 'trainer' },
        result: 'success'
      }),
      client
    )
  })

  it('returns 404 when the user does not have this role assigned', async () => {
    const client = txClient([
      {},                      // BEGIN
      { rows: [TARGET_USER] }, // fetchUserOrgUnit
      { rows: [TRAINER_ROLE] }, // SELECT role
      { rowCount: 0 },         // DELETE user_roles -> nothing deleted
      {}                       // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await roleService.removeRoleFromUser({ actor: ldAdmin, userId: 'user-2', roleId: 'role-2' })

    expect(result).toEqual({ ok: false, status: 404, error: 'This role is not assigned to the user' })
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('returns 403 and logs ACCESS_VIOLATION when the user is outside the actor visibility scope', async () => {
    const client = txClient([
      {},                                                  // BEGIN
      { rows: [{ id: 'user-9', org_unit_id: 'ou-99' }] }, // fetchUserOrgUnit
      {}                                                   // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const reportingManager = { id: 'mgr-1', tenantId: 'tenant-1', roles: ['reporting_manager'], visibilityScope: { type: 'team', orgUnitIds: ['ou-1'] } }

    const result = await roleService.removeRoleFromUser({ actor: reportingManager, userId: 'user-9', roleId: 'role-2' })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.ACCESS_VIOLATION, result: 'failure' })
    )
  })
})

// ---------------------------------------------------------------------------
// getEffectivePermissions
// ---------------------------------------------------------------------------

describe('getEffectivePermissions', () => {
  it('returns the full permission catalog for super_admin (which bypasses role_permissions entirely)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { module: 'roles', feature: 'definitions', action: 'view' },
        { module: 'users', feature: 'profile', action: 'edit' }
      ]
    })

    const result = await roleService.getEffectivePermissions({ user: { id: 'admin-0', roles: ['super_admin'] } })

    expect(result.roles).toEqual(['super_admin'])
    expect(result.permissions).toEqual([
      { module: 'roles', feature: 'definitions', action: 'view' },
      { module: 'users', feature: 'profile', action: 'edit' }
    ])

    const [sql] = db.query.mock.calls[0]
    expect(sql).toContain('FROM permissions')
    expect(sql).not.toContain('user_roles')
  })

  it("derives a non-super_admin user's effective permissions from their current role assignments", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ module: 'roles', feature: 'definitions', action: 'view' }]
    })

    const result = await roleService.getEffectivePermissions({ user: { id: 'user-2', roles: ['ld_admin'] } })

    expect(result).toEqual({ roles: ['ld_admin'], permissions: [{ module: 'roles', feature: 'definitions', action: 'view' }] })

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('user_roles')
    expect(params).toEqual(['user-2'])
  })
})

// ---------------------------------------------------------------------------
// Route-level RBAC
// (Rule 10 — at least one allowed role succeeds, one denied role gets a 403)
// ---------------------------------------------------------------------------

describe('role management routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const roleRoutes = require('../../src/modules/roles/roleRoutes')

  const app = express()
  app.use(express.json())
  app.use(roleRoutes)

  describe('GET /admin/roles', () => {
    it('allows ld_admin (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission
        .mockResolvedValueOnce({ rows: [] })                  // listRoles

      const res = await request(app).get('/admin/roles').set('x-test-role', 'ld_admin')

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app).get('/admin/roles').set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })

      const [violationSql, violationParams] = db.query.mock.calls[1]
      expect(violationSql).toContain('ACCESS_VIOLATION')
      expect(violationParams).toEqual(
        expect.arrayContaining(['tenant-1', 'user-1', 'associate', 'roles.definitions'])
      )
    })
  })

  describe('POST /admin/users/:id/roles', () => {
    it('allows ld_admin (201) and assigns the role', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission

      const client = txClient([
        {},                                              // BEGIN
        { rows: [{ id: 'user-2', org_unit_id: 'ou-1' }] }, // fetchUserOrgUnit
        { rows: [{ id: 'role-2', tenant_id: 'tenant-1', name: 'trainer', status: 'active' }] }, // SELECT role
        { rows: [{ user_id: 'user-2', role_id: 'role-2', effective_from: null, effective_to: null }] }, // INSERT user_roles
        {},                                              // audit insert
        {}                                               // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/admin/users/user-2/roles')
        .set('x-test-role', 'ld_admin')
        .send({ roleId: 'role-2' })

      expect(res.status).toBe(201)
      expect(res.body).toEqual(expect.objectContaining({ userId: 'user-2', roleId: 'role-2', roleName: 'trainer' }))
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/admin/users/user-2/roles')
        .set('x-test-role', 'associate')
        .send({ roleId: 'role-2' })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('GET /access/effective-permissions', () => {
    it('returns the calling user own effective permissions without a permission gate', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ module: 'roles', feature: 'definitions', action: 'view' }] })

      const res = await request(app).get('/access/effective-permissions').set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ roles: ['associate'], permissions: [{ module: 'roles', feature: 'definitions', action: 'view' }] })

      // Only the effective-permissions lookup ran — no hasPermission/ACCESS_VIOLATION query
      expect(db.query).toHaveBeenCalledTimes(1)
    })
  })
})
