// src/modules/roles/roleService.js
//
// Business logic behind /admin/roles, /admin/users/:id/roles, and
// /access/effective-permissions. Every function takes an `actor`
// ({ id, tenantId, roles, visibilityScope }) and enforces:
//  - Rule 3: every query is scoped by tenant_id
//  - Rule 4: every state change writes an audit event in the same transaction
//  - Rule 7: visibility scope is enforced here for user-role assignments

const db = require('../../db')
const auditLog = require('../audit/auditLog')
const { isOrgUnitInScope } = require('../users/userService')

const { AuditActions } = auditLog

const ACTIVE_ROLE_STATUS = 'active' // fixed enum value from the roles.status CHECK constraint

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function serializeRole(row, permissions = []) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description,
    isSystemRole: row.is_system_role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    permissions
  }
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

async function fetchRolePermissions(runner, roleId) {
  const result = await runner.query(
    `SELECT p.module, p.feature, p.action
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1
     ORDER BY p.module, p.feature, p.action`,
    [roleId]
  )
  return result.rows
}

async function fetchPermissionsByRoleIds(roleIds) {
  if (roleIds.length === 0) return new Map()

  const result = await db.query(
    `SELECT rp.role_id, p.module, p.feature, p.action
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ANY($1)
     ORDER BY p.module, p.feature, p.action`,
    [roleIds]
  )

  const byRole = new Map()
  for (const row of result.rows) {
    if (!byRole.has(row.role_id)) byRole.set(row.role_id, [])
    byRole.get(row.role_id).push({ module: row.module, feature: row.feature, action: row.action })
  }
  return byRole
}

async function fetchUserOrgUnit(runner, tenantId, userId) {
  const result = await runner.query(
    `SELECT u.id, up.org_unit_id
     FROM users u
     LEFT JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1 AND u.tenant_id = $2`,
    [userId, tenantId]
  )
  return result.rows[0] || null
}

/**
 * Resource-level visibility failure: the actor passed requirePermission()
 * for roles.assignments.edit, but this user is outside their scope.
 * Mirrors the ACCESS_VIOLATION pattern in userService.recordAccessViolation.
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
// GET /admin/roles
// ---------------------------------------------------------------------------

async function listRoles({ tenantId }) {
  const rolesResult = await db.query(
    `SELECT * FROM roles WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  )

  const permsByRole = await fetchPermissionsByRoleIds(rolesResult.rows.map((r) => r.id))

  return rolesResult.rows.map((r) => serializeRole(r, permsByRole.get(r.id) || []))
}

// ---------------------------------------------------------------------------
// POST /admin/roles
// ---------------------------------------------------------------------------

async function createRole({ actor, input, ipAddress, userAgent }) {
  const name = input?.name?.trim()
  if (!name) return { ok: false, status: 400, error: 'name is required' }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const result = await client.query(
      `INSERT INTO roles (tenant_id, name, description, is_system_role)
       VALUES ($1, $2, $3, FALSE)
       RETURNING *`,
      [actor.tenantId, name, input.description || null]
    )
    const role = serializeRole(result.rows[0], [])

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.ROLE_CREATED,
      entityType: 'Role',
      entityId: role.id,
      newValue: role,
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, status: 201, role }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return { ok: false, status: 409, error: 'A role with this name already exists' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// PUT /admin/roles/:id
// ---------------------------------------------------------------------------

const ROLE_FIELD_MAP = {
  name: 'name',
  description: 'description'
}

async function updateRole({ actor, roleId, updates = {}, ipAddress, userAgent }) {
  const columns = pickColumns(updates, ROLE_FIELD_MAP)
  if (Object.keys(columns).length === 0) {
    return { ok: false, status: 400, error: 'No valid fields to update' }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(
      `SELECT * FROM roles WHERE id = $1 AND tenant_id = $2`,
      [roleId, actor.tenantId]
    )
    const current = currentResult.rows[0]
    if (!current) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Role not found' }
    }

    if (current.is_system_role && 'name' in columns && columns.name !== current.name) {
      await client.query('ROLLBACK')
      return { ok: false, status: 400, error: 'System role names cannot be changed' }
    }

    const { clause, values } = buildSetClause(columns, 2)
    const updatedResult = await client.query(
      `UPDATE roles SET ${clause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [roleId, ...values]
    )
    const updated = updatedResult.rows[0]
    const permissions = await fetchRolePermissions(client, roleId)

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.ROLE_UPDATED,
      entityType: 'Role',
      entityId: roleId,
      oldValue: serializeRole(current),
      newValue: serializeRole(updated),
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, role: serializeRole(updated, permissions) }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return { ok: false, status: 409, error: 'A role with this name already exists' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /admin/roles/:id/permissions  (replace semantics)
// ---------------------------------------------------------------------------

async function setRolePermissions({ actor, roleId, permissions, ipAddress, userAgent }) {
  if (!Array.isArray(permissions)) {
    return { ok: false, status: 400, error: 'permissions must be an array of { module, feature, action }' }
  }
  for (const p of permissions) {
    if (!p?.module || !p?.feature || !p?.action) {
      return { ok: false, status: 400, error: 'Each permission requires module, feature, and action' }
    }
  }

  // De-duplicate requested tuples so a repeated tuple isn't mistaken for an
  // unresolvable one when matched against the (unique) permissions catalog.
  const seen = new Set()
  const requested = []
  for (const p of permissions) {
    const key = `${p.module}.${p.feature}.${p.action}`
    if (!seen.has(key)) {
      seen.add(key)
      requested.push(p)
    }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const roleResult = await client.query(
      `SELECT * FROM roles WHERE id = $1 AND tenant_id = $2`,
      [roleId, actor.tenantId]
    )
    const role = roleResult.rows[0]
    if (!role) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Role not found' }
    }

    let resolved = []
    if (requested.length > 0) {
      const placeholders = requested.map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`).join(', ')
      const lookupResult = await client.query(
        `SELECT id, module, feature, action FROM permissions
         WHERE (module, feature, action) IN (${placeholders})
         ORDER BY module, feature, action`,
        requested.flatMap((p) => [p.module, p.feature, p.action])
      )
      resolved = lookupResult.rows
    }

    if (resolved.length !== requested.length) {
      await client.query('ROLLBACK')
      const found = new Set(resolved.map((r) => `${r.module}.${r.feature}.${r.action}`))
      const unknown = requested
        .map((p) => `${p.module}.${p.feature}.${p.action}`)
        .filter((key) => !found.has(key))
      return { ok: false, status: 400, error: `Unknown permission(s): ${unknown.join(', ')}` }
    }

    const currentResult = await client.query(
      `SELECT p.id, p.module, p.feature, p.action
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1`,
      [roleId]
    )
    const current = currentResult.rows

    const newIds = new Set(resolved.map((r) => r.id))
    const oldIds = new Set(current.map((r) => r.id))

    const toRemove = current.filter((r) => !newIds.has(r.id)).map((r) => r.id)
    const toAdd = resolved.filter((r) => !oldIds.has(r.id)).map((r) => r.id)

    if (toRemove.length > 0) {
      await client.query(
        `DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = ANY($2)`,
        [roleId, toRemove]
      )
    }
    for (const permissionId of toAdd) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
        [roleId, permissionId]
      )
    }

    const oldPermissions = current.map(({ module, feature, action }) => ({ module, feature, action }))
    const newPermissions = resolved.map(({ module, feature, action }) => ({ module, feature, action }))

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.PERMISSION_CHANGED,
      entityType: 'Role',
      entityId: roleId,
      oldValue: { permissions: oldPermissions },
      newValue: { permissions: newPermissions },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, role: serializeRole(role, newPermissions) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// POST /admin/users/:id/roles
// ---------------------------------------------------------------------------

async function assignRoleToUser({ actor, userId, roleId, effectiveFrom, effectiveTo, ipAddress, userAgent }) {
  if (!roleId) return { ok: false, status: 400, error: 'roleId is required' }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const user = await fetchUserOrgUnit(client, actor.tenantId, userId)
    if (!user) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'User not found' }
    }

    if (!isOrgUnitInScope(actor.visibilityScope, user.org_unit_id)) {
      await client.query('ROLLBACK')
      await recordAccessViolation({ actor, action: 'roles.assignments.edit', entityId: userId, ipAddress, userAgent })
      return { ok: false, status: 403, error: 'Forbidden' }
    }

    const roleResult = await client.query(
      `SELECT * FROM roles WHERE id = $1 AND tenant_id = $2`,
      [roleId, actor.tenantId]
    )
    const role = roleResult.rows[0]
    if (!role) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Role not found' }
    }
    if (role.status !== ACTIVE_ROLE_STATUS) {
      await client.query('ROLLBACK')
      return { ok: false, status: 400, error: 'Cannot assign a retired role' }
    }

    const insertResult = await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by, effective_from, effective_to)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, roleId, actor.id, effectiveFrom || null, effectiveTo || null]
    )
    const assignment = insertResult.rows[0]

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.ROLE_ASSIGNED,
      entityType: 'User',
      entityId: userId,
      newValue: {
        roleId: role.id,
        roleName: role.name,
        effectiveFrom: assignment.effective_from,
        effectiveTo: assignment.effective_to
      },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return {
      ok: true,
      status: 201,
      assignment: {
        userId,
        roleId: role.id,
        roleName: role.name,
        assignedBy: actor.id,
        effectiveFrom: assignment.effective_from,
        effectiveTo: assignment.effective_to
      }
    }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return { ok: false, status: 409, error: 'This role is already assigned to the user' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// DELETE /admin/users/:id/roles/:roleId
// ---------------------------------------------------------------------------

async function removeRoleFromUser({ actor, userId, roleId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const user = await fetchUserOrgUnit(client, actor.tenantId, userId)
    if (!user) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'User not found' }
    }

    if (!isOrgUnitInScope(actor.visibilityScope, user.org_unit_id)) {
      await client.query('ROLLBACK')
      await recordAccessViolation({ actor, action: 'roles.assignments.edit', entityId: userId, ipAddress, userAgent })
      return { ok: false, status: 403, error: 'Forbidden' }
    }

    const roleResult = await client.query(
      `SELECT * FROM roles WHERE id = $1 AND tenant_id = $2`,
      [roleId, actor.tenantId]
    )
    const role = roleResult.rows[0]
    if (!role) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Role not found' }
    }

    const deleteResult = await client.query(
      `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, roleId]
    )
    if (deleteResult.rowCount === 0) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'This role is not assigned to the user' }
    }

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.ROLE_REMOVED,
      entityType: 'User',
      entityId: userId,
      oldValue: { roleId: role.id, roleName: role.name },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, message: 'Role removed' }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /access/effective-permissions
// ---------------------------------------------------------------------------

async function getEffectivePermissions({ user }) {
  // super_admin bypasses permissionEngine.hasPermission entirely (see
  // permissionEngine.js), so its "effective" set is the whole catalog rather
  // than whatever happens to be in role_permissions for that role.
  if (user.roles?.includes('super_admin')) {
    const result = await db.query(
      `SELECT module, feature, action FROM permissions ORDER BY module, feature, action`
    )
    return { roles: user.roles, permissions: result.rows }
  }

  const result = await db.query(
    `SELECT DISTINCT p.module, p.feature, p.action
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = $1
       AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
       AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)
     ORDER BY p.module, p.feature, p.action`,
    [user.id]
  )

  return { roles: user.roles, permissions: result.rows }
}

module.exports = {
  listRoles,
  createRole,
  updateRole,
  setRolePermissions,
  assignRoleToUser,
  removeRoleFromUser,
  getEffectivePermissions,
  serializeRole
}
