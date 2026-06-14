// src/modules/users/inviteService.js
//
// Business logic behind the user invitation flow:
//   POST   /users/invite           - create or re-issue an invitation
//   GET    /users/invite/verify    - public: check a magic-link token
//   POST   /users/invite/accept    - public: set password, activate account
//   GET    /users/invited          - list pending invitations
//   DELETE /users/invite/:id       - revoke an invitation
//   POST   /users/invite/:id/resend - re-issue an invitation's token/email
//
// Every state change is written in the same transaction as its audit event
// (Rule 4). Allowed email domains come from allowed_email_domains, never a
// hardcoded array (Rule 1) — see migration 023.

const crypto = require('crypto')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../../db')
const auditLog = require('../audit/auditLog')
const notificationService = require('../notifications/notificationService')
const { validatePasswordPolicy } = require('./userService')
const { getSessionExpiry } = require('../auth/authService')

const { AuditActions } = auditLog

const BCRYPT_COST = 12
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_EVENT_TYPE = 'user.invited'

/** First + last name from user_profiles, e.g. for {{invited_by_name}}. */
async function getDisplayName(runner, userId) {
  const result = await runner.query(
    `SELECT first_name, last_name FROM user_profiles WHERE user_id = $1`,
    [userId]
  )
  const row = result.rows[0]
  return row ? `${row.first_name} ${row.last_name}`.trim() : ''
}

function buildMagicLink(token) {
  return `${process.env.FRONTEND_URL}/set-password?token=${token}`
}

// ---------------------------------------------------------------------------
// POST /users/invite
// ---------------------------------------------------------------------------

async function inviteUser({ actor, input, ipAddress, userAgent }) {
  const email = input?.email?.trim().toLowerCase()
  const firstName = input?.first_name?.trim()
  const lastName = input?.last_name?.trim()
  const roleName = input?.role_name
  const designation = input?.designation?.trim() || null
  const grade = input?.grade?.trim() || null
  const personalNote = input?.personal_note?.trim() || ''

  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, status: 400, error: 'A valid email is required' }
  }
  if (!firstName || !lastName) {
    return { ok: false, status: 400, error: 'first_name and last_name are required' }
  }
  if (!roleName) {
    return { ok: false, status: 400, error: 'role_name is required' }
  }

  // Rule 1: allowed domains are configuration, not a hardcoded array.
  const domain = email.split('@')[1]
  const domainResult = await db.query(
    `SELECT 1 FROM allowed_email_domains WHERE tenant_id = $1 AND domain = $2`,
    [actor.tenantId, domain]
  )
  if (domainResult.rows.length === 0) {
    return { ok: false, status: 400, error: 'Email domain not allowed. Contact your administrator.' }
  }

  const roleResult = await db.query(
    `SELECT id FROM roles WHERE tenant_id = $1 AND name = $2 AND status = 'active'`,
    [actor.tenantId, roleName]
  )
  const role = roleResult.rows[0]
  if (!role) {
    return { ok: false, status: 400, error: 'Invalid role_name' }
  }

  const existingResult = await db.query(
    `SELECT id, status FROM users WHERE tenant_id = $1 AND email = $2`,
    [actor.tenantId, email]
  )
  const existingUser = existingResult.rows[0]
  if (existingUser && existingUser.status !== 'invited') {
    return { ok: false, status: 409, error: 'A user with this email already exists.' }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    let userId
    if (existingUser) {
      // Re-inviting a not-yet-activated user: refresh their profile/role and
      // expire any still-pending tokens before issuing a new one.
      userId = existingUser.id

      await client.query(
        `UPDATE user_profiles SET first_name = $2, last_name = $3, designation = $4, grade = $5, updated_at = NOW()
         WHERE user_id = $1`,
        [userId, firstName, lastName, designation, grade]
      )
      await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [userId])
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)`,
        [userId, role.id, actor.id]
      )
      await client.query(
        `UPDATE invite_tokens SET status = 'expired' WHERE user_id = $1 AND status = 'pending'`,
        [userId]
      )
    } else {
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, status, user_type)
         VALUES ($1, $2, 'invited', 'internal')
         RETURNING id`,
        [actor.tenantId, email]
      )
      userId = userResult.rows[0].id

      await client.query(
        `INSERT INTO user_profiles (user_id, first_name, last_name, designation, grade)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, firstName, lastName, designation, grade]
      )
      await client.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)`,
        [userId, role.id, actor.id]
      )
    }

    const token = crypto.randomBytes(32).toString('hex')
    const tokenResult = await client.query(
      `INSERT INTO invite_tokens (tenant_id, user_id, token, invited_by, invited_email, role_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING expires_at`,
      [actor.tenantId, userId, token, actor.id, email, roleName]
    )
    const expiresAt = tokenResult.rows[0].expires_at
    const magicLink = buildMagicLink(token)
    const invitedByName = await getDisplayName(client, actor.id)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.USER_INVITED,
      entityType: 'User',
      entityId: userId,
      newValue: { email, role_name: roleName },
      ipAddress,
      userAgent,
      result: 'success',
      metadata: { role: roleName, invited_email: email }
    }, client)

    // notify() never throws on email-send failure (it logs and continues —
    // see notificationService.dispatch), so the magic link below is always
    // returned even when SMTP is unavailable.
    await notificationService.notify({
      tenantId: actor.tenantId,
      userId,
      eventType: INVITE_EVENT_TYPE,
      data: {
        first_name: firstName,
        invited_by_name: invitedByName,
        magic_link: magicLink,
        personal_note: personalNote
      },
      metadata: { invited_email: email, role_name: roleName },
      client
    })

    await client.query('COMMIT')

    return {
      ok: true,
      status: 201,
      message: 'Invitation sent',
      user_id: userId,
      magic_link: magicLink,
      expires_at: expiresAt
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /users/invite/verify  (public)
// ---------------------------------------------------------------------------

async function verifyInviteToken({ token }) {
  if (!token) return { valid: false, reason: 'not_found' }

  const result = await db.query(
    `SELECT it.status, it.role_name, it.expires_at,
            u.email,
            up.first_name, up.last_name,
            ib.first_name AS inviter_first_name, ib.last_name AS inviter_last_name
     FROM invite_tokens it
     JOIN users u ON u.id = it.user_id
     LEFT JOIN user_profiles up ON up.user_id = it.user_id
     LEFT JOIN user_profiles ib ON ib.user_id = it.invited_by
     WHERE it.token = $1`,
    [token]
  )
  const row = result.rows[0]

  if (!row) return { valid: false, reason: 'not_found' }
  if (row.status === 'accepted') return { valid: false, reason: 'already_used' }
  if (row.status === 'revoked' || row.status === 'expired') return { valid: false, reason: 'expired' }
  if (new Date(row.expires_at) < new Date()) return { valid: false, reason: 'expired' }

  return {
    valid: true,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    role_name: row.role_name,
    invited_by_name: `${row.inviter_first_name || ''} ${row.inviter_last_name || ''}`.trim(),
    expires_at: row.expires_at
  }
}

// ---------------------------------------------------------------------------
// POST /users/invite/accept  (public)
// ---------------------------------------------------------------------------

async function acceptInvite({ input, ipAddress, userAgent }) {
  const token = input?.token
  const password = input?.password
  const confirmPassword = input?.confirm_password

  if (!token) {
    return { ok: false, status: 400, error: 'token is required' }
  }
  if (!password || !confirmPassword) {
    return { ok: false, status: 400, error: 'password and confirm_password are required' }
  }
  if (password !== confirmPassword) {
    return { ok: false, status: 400, error: "Passwords don't match" }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const tokenResult = await client.query(
      `SELECT it.id, it.user_id, it.role_name, it.status, it.expires_at,
              u.tenant_id, u.email, u.status AS user_status
       FROM invite_tokens it
       JOIN users u ON u.id = it.user_id
       WHERE it.token = $1
       FOR UPDATE OF it`,
      [token]
    )
    const inviteToken = tokenResult.rows[0]

    if (!inviteToken) {
      await client.query('ROLLBACK')
      return { ok: false, status: 400, error: 'This invitation link is invalid' }
    }
    if (inviteToken.status === 'accepted') {
      await client.query('ROLLBACK')
      return { ok: false, status: 400, error: 'This invitation link has already been used' }
    }
    if (inviteToken.status !== 'pending' || new Date(inviteToken.expires_at) < new Date()) {
      await client.query('ROLLBACK')
      return { ok: false, status: 400, error: 'This invitation link has expired' }
    }

    const policyErrors = await validatePasswordPolicy(inviteToken.tenant_id, password)
    if (policyErrors.length > 0) {
      await client.query('ROLLBACK')
      return { ok: false, status: 400, error: policyErrors.join('; ') }
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
    const wasInvited = inviteToken.user_status === 'invited'

    await client.query(
      `UPDATE users SET password_hash = $2, status = 'active', password_changed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [inviteToken.user_id, passwordHash]
    )

    await client.query(
      `UPDATE invite_tokens SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
      [inviteToken.id]
    )

    const rolesResult = await client.query(
      `SELECT r.id, r.name
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
       WHERE ur.user_id = $1
         AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
         AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)`,
      [inviteToken.user_id]
    )
    const availableRoles = rolesResult.rows.map((r) => r.name)
    const activeRole = rolesResult.rows.find((r) => r.name === inviteToken.role_name) || rolesResult.rows[0]

    if (activeRole) {
      await client.query(
        `INSERT INTO user_active_roles (user_id, role_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET role_id = EXCLUDED.role_id, switched_at = NOW()`,
        [inviteToken.user_id, activeRole.id]
      )
    }

    const profileResult = await client.query(
      `SELECT first_name, last_name FROM user_profiles WHERE user_id = $1`,
      [inviteToken.user_id]
    )
    const profile = profileResult.rows[0]

    await auditLog.write({
      tenantId: inviteToken.tenant_id,
      actorUserId: inviteToken.user_id,
      actorRoleAtTime: activeRole?.name,
      actionType: wasInvited ? AuditActions.USER_ACTIVATED : AuditActions.PASSWORD_CHANGED,
      entityType: 'User',
      entityId: inviteToken.user_id,
      oldValue: { status: inviteToken.user_status },
      newValue: { status: 'active' },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')

    const expiresIn = await getSessionExpiry(inviteToken.tenant_id)
    const jwtToken = jwt.sign(
      { userId: inviteToken.user_id, tenantId: inviteToken.tenant_id, activeRoleId: activeRole?.id || null },
      process.env.JWT_SECRET,
      { expiresIn }
    )

    return {
      ok: true,
      token: jwtToken,
      user: {
        id: inviteToken.user_id,
        tenantId: inviteToken.tenant_id,
        email: inviteToken.email,
        first_name: profile?.first_name,
        last_name: profile?.last_name
      },
      activeRole: activeRole?.name || null,
      availableRoles
    }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /users/invited
// ---------------------------------------------------------------------------

async function listInvitedUsers({ actor }) {
  const result = await db.query(
    `SELECT it.id, it.user_id, it.invited_email, it.role_name, it.status, it.expires_at, it.created_at,
            up.first_name, up.last_name,
            ib.first_name AS inviter_first_name, ib.last_name AS inviter_last_name
     FROM invite_tokens it
     LEFT JOIN user_profiles up ON up.user_id = it.user_id
     LEFT JOIN user_profiles ib ON ib.user_id = it.invited_by
     WHERE it.tenant_id = $1 AND it.status = 'pending'
     ORDER BY it.created_at DESC`,
    [actor.tenantId]
  )

  return result.rows.map((row) => ({
    id: row.id,
    user_id: row.user_id,
    email: row.invited_email,
    first_name: row.first_name,
    last_name: row.last_name,
    role_name: row.role_name,
    invited_by_name: `${row.inviter_first_name || ''} ${row.inviter_last_name || ''}`.trim(),
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at
  }))
}

// ---------------------------------------------------------------------------
// DELETE /users/invite/:id  (id = users.id)
// ---------------------------------------------------------------------------

async function revokeInvite({ actor, userId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const userResult = await client.query(
      `SELECT id, status, email FROM users WHERE id = $1 AND tenant_id = $2`,
      [userId, actor.tenantId]
    )
    const user = userResult.rows[0]
    if (!user) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'User not found' }
    }

    await client.query(
      `UPDATE invite_tokens SET status = 'revoked' WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    )
    await client.query(
      `UPDATE users SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [userId]
    )

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.INVITE_REVOKED,
      entityType: 'User',
      entityId: userId,
      oldValue: { status: user.status },
      newValue: { status: 'inactive' },
      ipAddress,
      userAgent,
      result: 'success',
      metadata: { invited_email: user.email }
    }, client)

    await client.query('COMMIT')
    return { ok: true, message: 'Invitation revoked' }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /users/invite/:id/resend  (id = users.id)
// ---------------------------------------------------------------------------

async function resendInvite({ actor, userId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const userResult = await client.query(
      `SELECT u.id, u.email, up.first_name
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       WHERE u.id = $1 AND u.tenant_id = $2`,
      [userId, actor.tenantId]
    )
    const user = userResult.rows[0]
    if (!user) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'User not found' }
    }

    const latestTokenResult = await client.query(
      `SELECT role_name FROM invite_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId]
    )
    const roleName = latestTokenResult.rows[0]?.role_name
    if (!roleName) {
      await client.query('ROLLBACK')
      return { ok: false, status: 400, error: 'No invitation found for this user' }
    }

    await client.query(
      `UPDATE invite_tokens SET status = 'expired' WHERE user_id = $1 AND status = 'pending'`,
      [userId]
    )

    const token = crypto.randomBytes(32).toString('hex')
    const tokenResult = await client.query(
      `INSERT INTO invite_tokens (tenant_id, user_id, token, invited_by, invited_email, role_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING expires_at`,
      [actor.tenantId, userId, token, actor.id, user.email, roleName]
    )
    const expiresAt = tokenResult.rows[0].expires_at
    const magicLink = buildMagicLink(token)
    const invitedByName = await getDisplayName(client, actor.id)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.INVITE_RESENT,
      entityType: 'User',
      entityId: userId,
      newValue: { invited_email: user.email, role_name: roleName },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await notificationService.notify({
      tenantId: actor.tenantId,
      userId,
      eventType: INVITE_EVENT_TYPE,
      data: {
        first_name: user.first_name,
        invited_by_name: invitedByName,
        magic_link: magicLink,
        personal_note: ''
      },
      metadata: { invited_email: user.email, role_name: roleName },
      client
    })

    await client.query('COMMIT')

    return { ok: true, message: 'Invitation resent', magic_link: magicLink, expires_at: expiresAt }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  inviteUser,
  verifyInviteToken,
  acceptInvite,
  listInvitedUsers,
  revokeInvite,
  resendInvite
}
