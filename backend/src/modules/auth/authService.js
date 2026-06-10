// src/modules/auth/authService.js
//
// Login / logout business logic for POST /auth/login and POST /auth/logout.
//
// JWT payload is { userId, tenantId } only — roles are loaded fresh from the
// DB on every request by the authenticate middleware (see
// src/middleware/authenticate.js) and must never be trusted from the token.

const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const db = require('../../db')
const auditLog = require('../audit/auditLog')

const { AuditActions } = auditLog

// A failed login against an email that matches no user happens before any
// tenant is known, but audit_events.tenant_id is NOT NULL. Attribute these
// to the seeded internal tenant — Release 0 is single-tenant (migration 001).
const FALLBACK_TENANT_ID = process.env.INTERNAL_TENANT_ID

/**
 * Look up a user by email along with their currently-active role names and
 * IDs (parallel arrays — both ordered by role name so indexes correspond).
 * Login cannot be scoped by tenant_id (Rule 3) because the tenant isn't
 * known until the user is identified — this lookup is the one place that
 * establishes it.
 */
async function findUserByEmail(email) {
  const result = await db.query(
    `SELECT u.id, u.tenant_id, u.email, u.password_hash, u.status,
            COALESCE(
              array_agg(r.name ORDER BY r.name) FILTER (WHERE r.name IS NOT NULL),
              ARRAY[]::text[]
            ) AS roles,
            COALESCE(
              array_agg(r.id ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL),
              ARRAY[]::uuid[]
            ) AS role_ids
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
       AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
       AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)
     LEFT JOIN roles r ON r.id = ur.role_id AND r.status = 'active'
     WHERE u.email = $1
     GROUP BY u.id`,
    [email]
  )
  return result.rows[0] || null
}

/**
 * Resolve the JWT lifetime from the tenant's `auth.session_timeout_minutes`
 * configuration (FR10 — session expiry is configurable). Falls back to
 * JWT_EXPIRES_IN only if the tenant has no configuration row.
 */
async function getSessionExpiry(tenantId) {
  const result = await db.query(
    `SELECT value FROM configurations
     WHERE tenant_id = $1 AND module = 'auth' AND key = 'session_timeout_minutes'`,
    [tenantId]
  )
  const minutes = result.rows[0]?.value?.value
  return minutes ? `${minutes}m` : process.env.JWT_EXPIRES_IN
}

/**
 * D-008: a user with multiple roles explicitly switches their active role.
 * On login, default to their existing choice (user_active_roles), or — for
 * a first-time multi-role login — the lowest-privilege role per the
 * configurable auth.active_role_priority order.
 *
 * @returns {{ roleId: string|null, roleName: string|null, isNew: boolean }}
 *          isNew is true when user_active_roles has no row yet and one
 *          should be inserted as part of the login transaction.
 */
async function resolveActiveRole(user) {
  if (user.roles.length <= 1) {
    return { roleId: user.role_ids[0] || null, roleName: user.roles[0] || null, isNew: false }
  }

  const existing = await db.query(
    `SELECT role_id FROM user_active_roles WHERE user_id = $1`,
    [user.id]
  )
  const existingIndex = user.role_ids.indexOf(existing.rows[0]?.role_id)
  if (existingIndex !== -1) {
    return { roleId: existing.rows[0].role_id, roleName: user.roles[existingIndex], isNew: false }
  }

  const priorityResult = await db.query(
    `SELECT value FROM configurations
     WHERE tenant_id = $1 AND module = 'auth' AND key = 'active_role_priority'`,
    [user.tenant_id]
  )
  const priorityOrder = priorityResult.rows[0]?.value?.value || []

  const defaultRoleName = priorityOrder.find((name) => user.roles.includes(name)) || [...user.roles].sort()[0]
  const defaultIndex = user.roles.indexOf(defaultRoleName)
  return { roleId: user.role_ids[defaultIndex], roleName: defaultRoleName, isNew: true }
}

async function recordLoginFailure({ tenantId, user, email, ipAddress, userAgent, reason }) {
  await auditLog.write({
    tenantId,
    actorUserId: user?.id,
    actorRoleAtTime: user?.roles?.join(','),
    actionType: AuditActions.LOGIN_FAILED,
    entityType: 'User',
    entityId: user?.id,
    ipAddress,
    userAgent,
    result: 'failure',
    metadata: { email, reason }
  })
}

/**
 * Verify credentials and issue a JWT.
 * Returns { ok: true, token, user } on success or
 * { ok: false, status, error } on failure.
 */
async function login({ email, password, ipAddress, userAgent }) {
  const user = await findUserByEmail(email)

  if (!user) {
    await recordLoginFailure({
      tenantId: FALLBACK_TENANT_ID, email, ipAddress, userAgent, reason: 'user_not_found'
    })
    return { ok: false, status: 401, error: 'Invalid email or password' }
  }

  if (user.status !== 'active') {
    await recordLoginFailure({
      tenantId: user.tenant_id, user, email, ipAddress, userAgent, reason: 'account_not_active'
    })
    return { ok: false, status: 401, error: 'Account is not active' }
  }

  const passwordValid = user.password_hash
    ? await bcrypt.compare(password, user.password_hash)
    : false

  if (!passwordValid) {
    await recordLoginFailure({
      tenantId: user.tenant_id, user, email, ipAddress, userAgent, reason: 'invalid_password'
    })
    return { ok: false, status: 401, error: 'Invalid email or password' }
  }

  const activeRole = await resolveActiveRole(user)

  const expiresIn = await getSessionExpiry(user.tenant_id)
  const token = jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, activeRoleId: activeRole.roleId },
    process.env.JWT_SECRET,
    { expiresIn }
  )

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    await client.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id])

    if (activeRole.isNew) {
      await client.query(
        `INSERT INTO user_active_roles (user_id, role_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id, activeRole.roleId]
      )
    }

    await auditLog.write({
      tenantId: user.tenant_id,
      actorUserId: user.id,
      actorRoleAtTime: user.roles.join(','),
      actionType: AuditActions.LOGIN_SUCCESS,
      entityType: 'User',
      entityId: user.id,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return {
    ok: true,
    token,
    user: { id: user.id, tenantId: user.tenant_id, email: user.email },
    availableRoles: user.roles,
    activeRole: activeRole.roleName
  }
}

/**
 * Record a logout. JWTs are stateless and Release 0 has no session/token
 * table, so the token itself remains valid until it expires (bounded by
 * auth.session_timeout_minutes) — this records that the user ended their
 * session for the audit trail.
 */
async function logout({ user, ipAddress, userAgent }) {
  await auditLog.write({
    tenantId: user.tenantId,
    actorUserId: user.id,
    actorRoleAtTime: user.roles?.join(','),
    actionType: AuditActions.LOGOUT,
    entityType: 'User',
    entityId: user.id,
    ipAddress,
    userAgent,
    result: 'success'
  })
}

module.exports = { login, logout, getSessionExpiry }
