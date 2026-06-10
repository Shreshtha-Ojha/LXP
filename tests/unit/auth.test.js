// tests/unit/auth.test.js
//
// Unit tests for authService.login / authService.logout.
// Pattern: mock db, bcrypt, jwt, and auditLog so we can assert exactly
// what gets written to the audit log for each outcome.
//
// D-008: login resolves and returns the user's active role (activeRole /
// activeRoleId) alongside availableRoles (every role the user holds).

process.env.JWT_SECRET = 'test-secret'
process.env.JWT_EXPIRES_IN = '8h'
process.env.INTERNAL_TENANT_ID = 'tenant-internal'

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('bcrypt')
jest.mock('jsonwebtoken')
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../../src/db')
const auditLog = require('../../src/modules/audit/auditLog')
const { login, logout } = require('../../src/modules/auth/authService')

const ACTIVE_USER = {
  id: 'user-1',
  tenant_id: 'tenant-1',
  email: 'alice@example.com',
  password_hash: 'hashed-password',
  status: 'active',
  roles: ['associate'],
  role_ids: ['role-assoc-1']
}

const MULTI_ROLE_USER = {
  id: 'user-2',
  tenant_id: 'tenant-1',
  email: 'bob@example.com',
  password_hash: 'hashed-password',
  status: 'active',
  roles: ['associate', 'ld_admin'],
  role_ids: ['role-assoc-1', 'role-ld-admin-1']
}

const ACTIVE_ROLE_PRIORITY = {
  value: { value: ['associate', 'reporting_manager', 'competency_leader', 'ld_admin', 'super_admin'] }
}

describe('authService.login', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns a token and writes LOGIN_SUCCESS on successful login', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [ACTIVE_USER] })              // findUserByEmail
      .mockResolvedValueOnce({ rows: [{ value: { value: 60 } }] }) // session config

    bcrypt.compare.mockResolvedValueOnce(true)
    jwt.sign.mockReturnValueOnce('signed-jwt')

    const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() }
    db.getClient.mockResolvedValueOnce(client)

    const result = await login({
      email: 'alice@example.com',
      password: 'correct-password',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.token).toBe('signed-jwt')
    expect(result.user).toEqual({ id: 'user-1', tenantId: 'tenant-1', email: 'alice@example.com' })
    expect(result.availableRoles).toEqual(['associate'])
    expect(result.activeRole).toBe('associate')

    // D-008: JWT payload includes activeRoleId — a single-role user's only
    // role is automatically active, expiry from config
    expect(jwt.sign).toHaveBeenCalledWith(
      { userId: 'user-1', tenantId: 'tenant-1', activeRoleId: 'role-assoc-1' },
      'test-secret',
      { expiresIn: '60m' }
    )

    // last_login_at update and audit write happen in the same transaction
    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('UPDATE users SET last_login_at = NOW() WHERE id = $1', ['user-1'])
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        actorRoleAtTime: 'associate',
        actionType: auditLog.AuditActions.LOGIN_SUCCESS,
        result: 'success'
      }),
      client
    )
  })

  it('returns 401 and writes LOGIN_FAILED for the wrong password', async () => {
    db.query.mockResolvedValueOnce({ rows: [ACTIVE_USER] })
    bcrypt.compare.mockResolvedValueOnce(false)

    const result = await login({
      email: 'alice@example.com',
      password: 'wrong-password',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid email or password' })
    expect(db.getClient).not.toHaveBeenCalled()

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        actionType: auditLog.AuditActions.LOGIN_FAILED,
        result: 'failure',
        metadata: expect.objectContaining({ reason: 'invalid_password' })
      })
    )
  })

  it('returns 401 and writes LOGIN_FAILED for a non-existent user', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await login({
      email: 'nobody@example.com',
      password: 'whatever',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid email or password' })
    expect(bcrypt.compare).not.toHaveBeenCalled()
    expect(db.getClient).not.toHaveBeenCalled()

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-internal', // falls back to INTERNAL_TENANT_ID — tenant unknown for an unmatched email
        actionType: auditLog.AuditActions.LOGIN_FAILED,
        result: 'failure',
        metadata: expect.objectContaining({ reason: 'user_not_found', email: 'nobody@example.com' })
      })
    )
  })

  it('returns 401 and writes LOGIN_FAILED for an inactive user without checking the password', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...ACTIVE_USER, status: 'inactive' }] })

    const result = await login({
      email: 'alice@example.com',
      password: 'correct-password',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 401, error: 'Account is not active' })
    expect(bcrypt.compare).not.toHaveBeenCalled()

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        actionType: auditLog.AuditActions.LOGIN_FAILED,
        result: 'failure',
        metadata: expect.objectContaining({ reason: 'account_not_active' })
      })
    )
  })

  // -------------------------------------------------------------------------
  // D-008: active role switching — login-time resolution
  // -------------------------------------------------------------------------

  it('defaults a multi-role user\'s first login to the configured active_role_priority and records it', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [MULTI_ROLE_USER] })          // findUserByEmail
      .mockResolvedValueOnce({ rows: [] })                         // user_active_roles — no existing record
      .mockResolvedValueOnce({ rows: [ACTIVE_ROLE_PRIORITY] })     // configurations — active_role_priority
      .mockResolvedValueOnce({ rows: [{ value: { value: 60 } }] }) // session config

    bcrypt.compare.mockResolvedValueOnce(true)
    jwt.sign.mockReturnValueOnce('signed-jwt')

    const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() }
    db.getClient.mockResolvedValueOnce(client)

    const result = await login({
      email: 'bob@example.com',
      password: 'correct-password',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.availableRoles).toEqual(['associate', 'ld_admin'])
    // 'associate' is the lowest-privilege role per active_role_priority
    expect(result.activeRole).toBe('associate')

    expect(jwt.sign).toHaveBeenCalledWith(
      { userId: 'user-2', tenantId: 'tenant-1', activeRoleId: 'role-assoc-1' },
      'test-secret',
      { expiresIn: '60m' }
    )

    // First-time resolution is persisted as part of the login transaction
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_active_roles'),
      ['user-2', 'role-assoc-1']
    )
  })

  it('honors a multi-role user\'s previously chosen active role over the priority default', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [MULTI_ROLE_USER] })             // findUserByEmail
      .mockResolvedValueOnce({ rows: [{ role_id: 'role-ld-admin-1' }] }) // user_active_roles — existing choice
      .mockResolvedValueOnce({ rows: [{ value: { value: 60 } }] })    // session config

    bcrypt.compare.mockResolvedValueOnce(true)
    jwt.sign.mockReturnValueOnce('signed-jwt')

    const client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() }
    db.getClient.mockResolvedValueOnce(client)

    const result = await login({
      email: 'bob@example.com',
      password: 'correct-password',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.activeRole).toBe('ld_admin')
    expect(jwt.sign).toHaveBeenCalledWith(
      { userId: 'user-2', tenantId: 'tenant-1', activeRoleId: 'role-ld-admin-1' },
      'test-secret',
      { expiresIn: '60m' }
    )

    // Existing choice — no INSERT into user_active_roles
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO user_active_roles'),
      expect.anything()
    )
  })
})

describe('authService.logout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('writes a LOGOUT audit event for the authenticated user', async () => {
    const user = { id: 'user-1', tenantId: 'tenant-1', roles: ['associate'] }

    await logout({ user, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        actorRoleAtTime: 'associate',
        actionType: auditLog.AuditActions.LOGOUT,
        result: 'success'
      })
    )
  })
})
