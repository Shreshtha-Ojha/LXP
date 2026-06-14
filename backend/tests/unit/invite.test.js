// tests/unit/invite.test.js
//
// Unit tests for src/modules/users/inviteService.js and the route wiring in
// src/modules/users/inviteRoutes.js — the user invitation flow (migration
// 023): invite -> verify -> accept (magic link, no session yet) -> revoke /
// resend / list pending invitations.
//
// Pattern (matches tests/unit/users.test.js / assignments.test.js): mock db,
// crypto.randomBytes, bcrypt, jsonwebtoken, auditLog.write and
// notificationService.notify so we can assert exactly what gets written for
// each outcome. permissionEngine is NOT mocked — its real hasPermission/
// getVisibilityScope run against the mocked db.query.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomBytes: jest.fn()
}))
jest.mock('bcrypt')
jest.mock('jsonwebtoken')
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})
jest.mock('../../src/modules/notifications/notificationService', () => ({
  notify: jest.fn()
}))
jest.mock('../../src/middleware/authenticate', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: 'admin-1',
      tenantId: 'tenant-1',
      email: 'admin@sg.com',
      userType: 'internal',
      roles: [req.headers['x-test-role']],
      orgUnitId: 'ou-1',
      activeRoleId: `role-${req.headers['x-test-role']}`,
      activeRole: req.headers['x-test-role']
    }
    next()
  }
}))

const crypto = require('crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../../src/db')
const auditLog = require('../../src/modules/audit/auditLog')
const notificationService = require('../../src/modules/notifications/notificationService')
const inviteService = require('../../src/modules/users/inviteService')

const ALL_SCOPE = { type: 'all', orgUnitIds: null }
const LD_ADMIN = { id: 'admin-1', tenantId: 'tenant-1', roles: ['ld_admin'], visibilityScope: ALL_SCOPE }
const TOKEN_BYTES = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd', 'hex')
const TOKEN_HEX = TOKEN_BYTES.toString('hex')
const FUTURE = new Date(Date.now() + 1000 * 60 * 60).toISOString()

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

beforeEach(() => {
  jest.clearAllMocks()
  crypto.randomBytes.mockReturnValue(TOKEN_BYTES)
  process.env.FRONTEND_URL = 'http://localhost:3000'
})

// ---------------------------------------------------------------------------
// inviteUser
// ---------------------------------------------------------------------------

describe('inviteUser', () => {
  it('creates the user, profile, role and invite token, and sends the invitation email', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ domain: 'sg.com' }] })  // allowed_email_domains
      .mockResolvedValueOnce({ rows: [{ id: 'role-assoc' }] })  // roles lookup
      .mockResolvedValueOnce({ rows: [] })                       // existing user check

    const client = txClient([
      {},                                                      // BEGIN
      { rows: [{ id: 'user-9' }] },                            // INSERT users
      {},                                                       // INSERT user_profiles
      {},                                                       // INSERT user_roles
      { rows: [{ expires_at: '2026-06-17T00:00:00.000Z' }] },  // INSERT invite_tokens
      { rows: [{ first_name: 'Lena', last_name: 'Admin' }] },  // getDisplayName (inviter)
      {}                                                        // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await inviteService.inviteUser({
      actor: LD_ADMIN,
      input: { email: 'NewHire@sg.com', first_name: 'New', last_name: 'Hire', role_name: 'associate' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.message).toBe('Invitation sent')
    expect(result.user_id).toBe('user-9')
    expect(result.magic_link).toBe(`http://localhost:3000/set-password?token=${TOKEN_HEX}`)
    expect(result.expires_at).toBe('2026-06-17T00:00:00.000Z')

    expect(client.query).toHaveBeenCalledWith('COMMIT')

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'admin-1',
        actionType: auditLog.AuditActions.USER_INVITED,
        entityType: 'User',
        entityId: 'user-9',
        result: 'success',
        metadata: { role: 'associate', invited_email: 'newhire@sg.com' }
      }),
      client
    )

    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-9',
        eventType: 'user.invited',
        data: expect.objectContaining({
          first_name: 'New',
          invited_by_name: 'Lena Admin',
          magic_link: `http://localhost:3000/set-password?token=${TOKEN_HEX}`
        })
      })
    )
  })

  it('rejects an email whose domain is not in allowed_email_domains', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // allowed_email_domains: no match

    const result = await inviteService.inviteUser({
      actor: LD_ADMIN,
      input: { email: 'someone@gmail.com', first_name: 'A', last_name: 'B', role_name: 'associate' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'Email domain not allowed. Contact your administrator.' })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('rejects an email that already belongs to an active user', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ domain: 'sg.com' }] })            // allowed_email_domains
      .mockResolvedValueOnce({ rows: [{ id: 'role-assoc' }] })            // roles lookup
      .mockResolvedValueOnce({ rows: [{ id: 'user-5', status: 'active' }] }) // existing user check

    const result = await inviteService.inviteUser({
      actor: LD_ADMIN,
      input: { email: 'existing@sg.com', first_name: 'A', last_name: 'B', role_name: 'associate' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 409, error: 'A user with this email already exists.' })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// verifyInviteToken
// ---------------------------------------------------------------------------

describe('verifyInviteToken', () => {
  it('returns invite details for a valid pending token', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        status: 'pending',
        role_name: 'associate',
        expires_at: FUTURE,
        email: 'newhire@sg.com',
        first_name: 'New',
        last_name: 'Hire',
        inviter_first_name: 'Lena',
        inviter_last_name: 'Admin'
      }]
    })

    const result = await inviteService.verifyInviteToken({ token: TOKEN_HEX })

    expect(result).toEqual({
      valid: true,
      email: 'newhire@sg.com',
      first_name: 'New',
      last_name: 'Hire',
      role_name: 'associate',
      invited_by_name: 'Lena Admin',
      expires_at: FUTURE
    })
  })

  it('returns valid: false with reason "expired" once expires_at is in the past', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        status: 'pending',
        role_name: 'associate',
        expires_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        email: 'newhire@sg.com',
        first_name: 'New',
        last_name: 'Hire',
        inviter_first_name: 'Lena',
        inviter_last_name: 'Admin'
      }]
    })

    const result = await inviteService.verifyInviteToken({ token: TOKEN_HEX })

    expect(result).toEqual({ valid: false, reason: 'expired' })
  })
})

// ---------------------------------------------------------------------------
// acceptInvite
// ---------------------------------------------------------------------------

describe('acceptInvite', () => {
  const PENDING_TOKEN_ROW = {
    id: 'token-1', user_id: 'user-9', role_name: 'associate', status: 'pending',
    expires_at: FUTURE, tenant_id: 'tenant-1', email: 'newhire@sg.com', user_status: 'invited'
  }

  const PASSWORD_POLICY_ROWS = {
    rows: [
      { key: 'password_min_length', value: { value: 8 } },
      { key: 'password_require_upper', value: { value: true } },
      { key: 'password_require_number', value: { value: true } }
    ]
  }

  it('activates an invited user, sets their password, and returns a session like login', async () => {
    bcrypt.hash.mockResolvedValueOnce('hashed-pw')
    jwt.sign.mockReturnValueOnce('mock-jwt-token')

    const client = txClient([
      {},                                                       // BEGIN
      { rows: [PENDING_TOKEN_ROW] },                            // SELECT invite_tokens ... FOR UPDATE
      {},                                                        // UPDATE users SET password_hash...
      {},                                                        // UPDATE invite_tokens SET status='accepted'
      { rows: [{ id: 'role-assoc', name: 'associate' }] },      // SELECT roles via user_roles
      {},                                                        // INSERT user_active_roles
      { rows: [{ first_name: 'New', last_name: 'Hire' }] },     // SELECT user_profiles
      {}                                                         // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    db.query
      .mockResolvedValueOnce(PASSWORD_POLICY_ROWS)              // validatePasswordPolicy
      .mockResolvedValueOnce({ rows: [{ value: { value: 60 } }] }) // getSessionExpiry

    const result = await inviteService.acceptInvite({
      input: { token: TOKEN_HEX, password: 'Password1', confirm_password: 'Password1' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.token).toBe('mock-jwt-token')
    expect(result.user).toEqual({
      id: 'user-9', tenantId: 'tenant-1', email: 'newhire@sg.com', first_name: 'New', last_name: 'Hire'
    })
    expect(result.activeRole).toBe('associate')
    expect(result.availableRoles).toEqual(['associate'])

    expect(bcrypt.hash).toHaveBeenCalledWith('Password1', 12)
    expect(client.query).toHaveBeenCalledWith('COMMIT')

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-9',
        actionType: auditLog.AuditActions.USER_ACTIVATED,
        entityType: 'User',
        entityId: 'user-9',
        oldValue: { status: 'invited' },
        newValue: { status: 'active' },
        result: 'success'
      }),
      client
    )
  })

  it('rejects a password that fails the configured password policy and rolls back', async () => {
    const client = txClient([
      {},                            // BEGIN
      { rows: [PENDING_TOKEN_ROW] }, // SELECT FOR UPDATE
      {}                             // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    db.query.mockResolvedValueOnce(PASSWORD_POLICY_ROWS)

    const result = await inviteService.acceptInvite({
      input: { token: TOKEN_HEX, password: 'weakpassword', confirm_password: 'weakpassword' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('uppercase')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('rejects a token that has already been accepted', async () => {
    const client = txClient([
      {},                                                            // BEGIN
      { rows: [{ ...PENDING_TOKEN_ROW, status: 'accepted', user_status: 'active' }] }, // SELECT FOR UPDATE
      {}                                                             // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await inviteService.acceptInvite({
      input: { token: TOKEN_HEX, password: 'Password1', confirm_password: 'Password1' },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'This invitation link has already been used' })
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(auditLog.write).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// revokeInvite
// ---------------------------------------------------------------------------

describe('revokeInvite', () => {
  it('marks the pending invite revoked and the user inactive, with an INVITE_REVOKED audit event', async () => {
    const client = txClient([
      {},                                                                    // BEGIN
      { rows: [{ id: 'user-9', status: 'invited', email: 'newhire@sg.com' }] }, // SELECT users
      {},                                                                    // UPDATE invite_tokens
      {},                                                                    // UPDATE users
      {}                                                                     // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await inviteService.revokeInvite({
      actor: LD_ADMIN,
      userId: 'user-9',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: true, message: 'Invitation revoked' })
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'revoked'"), ['user-9'])
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("status = 'inactive'"), ['user-9'])

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'admin-1',
        actionType: auditLog.AuditActions.INVITE_REVOKED,
        entityType: 'User',
        entityId: 'user-9',
        oldValue: { status: 'invited' },
        newValue: { status: 'inactive' },
        result: 'success',
        metadata: { invited_email: 'newhire@sg.com' }
      }),
      client
    )
  })

  it('returns 404 when the user does not exist in this tenant', async () => {
    const client = txClient([
      {},          // BEGIN
      { rows: [] }, // SELECT users -> none
      {}           // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await inviteService.revokeInvite({
      actor: LD_ADMIN,
      userId: 'missing',
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'User not found' })
    expect(auditLog.write).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// listInvitedUsers
// ---------------------------------------------------------------------------

describe('listInvitedUsers', () => {
  it('returns pending invitations scoped to the tenant', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'invite-1', user_id: 'user-9', invited_email: 'newhire@sg.com',
        role_name: 'associate', status: 'pending',
        expires_at: '2026-06-17T00:00:00.000Z', created_at: '2026-06-14T00:00:00.000Z',
        first_name: 'New', last_name: 'Hire',
        inviter_first_name: 'Lena', inviter_last_name: 'Admin'
      }]
    })

    const result = await inviteService.listInvitedUsers({ actor: LD_ADMIN })

    expect(result).toEqual([{
      id: 'invite-1',
      user_id: 'user-9',
      email: 'newhire@sg.com',
      first_name: 'New',
      last_name: 'Hire',
      role_name: 'associate',
      invited_by_name: 'Lena Admin',
      status: 'pending',
      expires_at: '2026-06-17T00:00:00.000Z',
      created_at: '2026-06-14T00:00:00.000Z'
    }])

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('it.tenant_id = $1')
    expect(sql).toContain("it.status = 'pending'")
    expect(params).toEqual(['tenant-1'])
  })
})

// ---------------------------------------------------------------------------
// Route wiring: RBAC on /users/invite + /users/invited, and public access to
// /users/invite/verify (Rule 2/10 — at least one allowed role succeeds, one
// denied role gets a 403, and the magic-link endpoints need no session)
// ---------------------------------------------------------------------------

describe('route wiring (RBAC + public access)', () => {
  const request = require('supertest')
  const express = require('express')
  const inviteRoutes = require('../../src/modules/users/inviteRoutes')

  const app = express()
  app.use(express.json())
  app.use(inviteRoutes.publicRouter)
  app.use('/users', inviteRoutes.router)

  it('allows ld_admin (201) on POST /users/invite', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission -> granted
      .mockResolvedValueOnce({ rows: [{ domain: 'sg.com' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'role-assoc' }] })
      .mockResolvedValueOnce({ rows: [] })

    const client = txClient([
      {},
      { rows: [{ id: 'user-9' }] },
      {},
      {},
      { rows: [{ expires_at: '2026-06-17T00:00:00.000Z' }] },
      { rows: [{ first_name: 'Lena', last_name: 'Admin' }] },
      {}
    ])
    db.getClient.mockResolvedValueOnce(client)

    const res = await request(app)
      .post('/users/invite')
      .set('x-test-role', 'ld_admin')
      .send({ email: 'newhire@sg.com', first_name: 'New', last_name: 'Hire', role_name: 'associate' })

    expect(res.status).toBe(201)
    expect(res.body.message).toBe('Invitation sent')
    expect(res.body.magic_link).toContain('/set-password?token=')
  })

  it('denies associate (403) on POST /users/invite and logs ACCESS_VIOLATION', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // hasPermission -> denied
      .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

    const res = await request(app)
      .post('/users/invite')
      .set('x-test-role', 'associate')
      .send({ email: 'newhire@sg.com', first_name: 'New', last_name: 'Hire', role_name: 'associate' })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })

    const [violationSql, violationParams] = db.query.mock.calls[1]
    expect(violationSql).toContain('ACCESS_VIOLATION')
    expect(violationParams).toEqual(
      expect.arrayContaining(['tenant-1', 'admin-1', 'associate', 'users.invitations'])
    )
  })

  it('serves GET /users/invite/verify without authentication', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // no matching token

    const res = await request(app).get('/users/invite/verify').query({ token: 'does-not-exist' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ valid: false, reason: 'not_found' })
  })
})
