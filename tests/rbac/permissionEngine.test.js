// tests/rbac/permissionEngine.test.js
//
// Every feature needs tests like these.
// Pattern: one allowed role succeeds, one denied role gets 403.
//
// D-008: permissions and visibility are evaluated against user.activeRole /
// user.activeRoleId only — user.roles[] is no longer consulted here.

const { hasPermission, getVisibilityScope } = require('../../src/modules/roles/permissionEngine')

// Mock the db module
jest.mock('../../src/db', () => ({
  query: jest.fn()
}))

const db = require('../../src/db')

describe('hasPermission', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns true for super_admin regardless of permission', async () => {
    const user = { id: 'user-1', tenantId: 'tenant-1', activeRoleId: 'role-super-admin', activeRole: 'super_admin' }
    const result = await hasPermission(user, 'view', 'learning', 'catalog')
    expect(result).toBe(true)
    // Super admin bypasses DB check — no query should be made
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns true when the active role has the required permission', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    const user = { id: 'user-2', tenantId: 'tenant-1', activeRoleId: 'role-ld-admin', activeRole: 'ld_admin' }
    const result = await hasPermission(user, 'create', 'learning', 'catalog')
    expect(result).toBe(true)
    expect(db.query).toHaveBeenCalledWith(
      expect.any(String),
      ['user-2', 'role-ld-admin', 'learning', 'catalog', 'create']
    )
  })

  it('returns false when the active role does not have the required permission', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })
    const user = { id: 'user-3', tenantId: 'tenant-1', activeRoleId: 'role-associate', activeRole: 'associate' }
    const result = await hasPermission(user, 'configure', 'learning', 'catalog')
    expect(result).toBe(false)
  })

  it('returns false for null user', async () => {
    const result = await hasPermission(null, 'view', 'learning', 'catalog')
    expect(result).toBe(false)
  })

  it('returns false without querying the db when the user has no active role', async () => {
    const user = { id: 'user-4', tenantId: 'tenant-1', activeRoleId: null, activeRole: null }
    const result = await hasPermission(user, 'view', 'learning', 'catalog')
    expect(result).toBe(false)
    expect(db.query).not.toHaveBeenCalled()
  })
})

describe('getVisibilityScope', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns all scope for super_admin', async () => {
    const user = { id: 'user-1', tenantId: 'tenant-1', activeRole: 'super_admin' }
    const scope = await getVisibilityScope(user)
    expect(scope.type).toBe('all')
    expect(scope.orgUnitIds).toBeNull()
  })

  it('returns all scope for ld_admin', async () => {
    const user = { id: 'user-2', tenantId: 'tenant-1', activeRole: 'ld_admin' }
    const scope = await getVisibilityScope(user)
    expect(scope.type).toBe('all')
  })

  it('returns own scope for associate', async () => {
    const user = { id: 'user-3', tenantId: 'tenant-1', activeRole: 'associate', orgUnitId: 'ou-1' }
    const scope = await getVisibilityScope(user)
    expect(scope.type).toBe('own')
    expect(scope.orgUnitIds).toContain('ou-1')
  })

  it('returns assigned_only scope for external user', async () => {
    const user = { id: 'user-4', tenantId: 'tenant-1', activeRole: 'external' }
    const scope = await getVisibilityScope(user)
    expect(scope.type).toBe('assigned_only')
    expect(scope.orgUnitIds).toHaveLength(0)
  })

  it('returns team scope for reporting_manager including direct reports', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ org_unit_id: 'ou-2' }, { org_unit_id: 'ou-3' }] }) // direct reports
      .mockResolvedValueOnce({ rows: [{ org_unit_id: 'ou-1' }] }) // own profile
    const user = { id: 'user-5', tenantId: 'tenant-1', activeRole: 'reporting_manager', orgUnitId: 'ou-1' }
    const scope = await getVisibilityScope(user)
    expect(scope.type).toBe('team')
    expect(scope.orgUnitIds).toEqual(expect.arrayContaining(['ou-1', 'ou-2', 'ou-3']))
  })

  it('returns none scope for null user', async () => {
    const scope = await getVisibilityScope(null)
    expect(scope.type).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// D-008: active role switching
// ---------------------------------------------------------------------------

describe('D-008: active role switching', () => {
  beforeEach(() => jest.clearAllMocks())

  it('evaluates permissions against the active role only — switching active role changes the result for the same user', async () => {
    const user = {
      id: 'user-6',
      tenantId: 'tenant-1',
      roles: ['associate', 'ld_admin'],
      activeRoleId: 'role-associate',
      activeRole: 'associate'
    }

    // As 'associate', cannot publish content
    db.query.mockResolvedValueOnce({ rows: [] })
    expect(await hasPermission(user, 'configure', 'content', 'catalog')).toBe(false)
    expect(db.query).toHaveBeenLastCalledWith(
      expect.any(String),
      ['user-6', 'role-associate', 'content', 'catalog', 'configure']
    )

    // Same user switches active role to 'ld_admin' — can now publish content
    user.activeRoleId = 'role-ld-admin'
    user.activeRole = 'ld_admin'
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
    expect(await hasPermission(user, 'configure', 'content', 'catalog')).toBe(true)
    expect(db.query).toHaveBeenLastCalledWith(
      expect.any(String),
      ['user-6', 'role-ld-admin', 'content', 'catalog', 'configure']
    )
  })
})
