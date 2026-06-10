// src/modules/roles/permissionEngine.js
//
// Central permission engine. Every API endpoint goes through this.
// Never write inline permission checks in route handlers.

const db = require('../../db')

/**
 * Check if a user has a specific permission.
 *
 * D-008: active role switching — permissions are evaluated against the
 * user's active role only, not every role they hold.
 *
 * @param {object} user          - Authenticated user object { id, tenantId, roles[], activeRoleId, activeRole }
 * @param {string} action        - view | create | edit | approve | configure | administer
 * @param {string} module        - e.g. 'learning', 'users', 'assessments'
 * @param {string} feature       - e.g. 'catalog', 'assignments', 'bulk_upload'
 * @returns {boolean}
 */
async function hasPermission(user, action, module, feature) {
  if (!user || !user.id) return false

  // Super admins have all permissions — but their actions are always audit logged
  // (audit logging happens in the middleware, not here)
  if (user.activeRole === 'super_admin') return true

  if (!user.activeRoleId) return false

  const result = await db.query(
    `SELECT 1
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p       ON p.id = rp.permission_id
     WHERE ur.user_id  = $1
       AND ur.role_id  = $2
       AND p.module    = $3
       AND p.feature   = $4
       AND p.action    = $5
       AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
       AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)
     LIMIT 1`,
    [user.id, user.activeRoleId, module, feature, action]
  )

  return result.rows.length > 0
}

/**
 * Get the visibility scope for a user — which org unit IDs they are
 * permitted to see data for.
 *
 * This is the VisibilityScopeResolver. All data queries go through this
 * instead of hardcoding org filtering in SQL.
 *
 * Returns an object:
 * {
 *   type: 'own' | 'team' | 'practice' | 'org' | 'assigned_only' | 'all',
 *   orgUnitIds: UUID[] | null   // null means "all" (for L&D admin, super admin)
 * }
 */
async function getVisibilityScope(user) {
  if (!user || !user.id) {
    return { type: 'none', orgUnitIds: [] }
  }

  const activeRole = user.activeRole

  // Super admin and L&D admin see everything
  if (activeRole === 'super_admin' || activeRole === 'ld_admin') {
    return { type: 'all', orgUnitIds: null }
  }

  // HR admin sees org-wide talent/workforce data (scoped by HR config in future)
  if (activeRole === 'hr_admin') {
    return { type: 'org', orgUnitIds: null }
  }

  // Executive sees org-wide aggregated data
  if (activeRole === 'executive') {
    return { type: 'org', orgUnitIds: null }
  }

  // Reporting manager sees own record + direct reports' org units
  if (activeRole === 'reporting_manager') {
    const directReports = await db.query(
      `SELECT up.org_unit_id
       FROM user_profiles up
       WHERE up.manager_id = $1
         AND up.org_unit_id IS NOT NULL`,
      [user.id]
    )
    const ownProfile = await db.query(
      `SELECT org_unit_id FROM user_profiles WHERE user_id = $1`,
      [user.id]
    )
    const orgUnitIds = [
      ...(ownProfile.rows[0]?.org_unit_id ? [ownProfile.rows[0].org_unit_id] : []),
      ...directReports.rows.map(r => r.org_unit_id)
    ]
    return { type: 'team', orgUnitIds: [...new Set(orgUnitIds)] }
  }

  // Program manager sees their assigned projects (placeholder — full impl in Release 3)
  if (activeRole === 'program_manager') {
    return { type: 'team', orgUnitIds: [user.orgUnitId].filter(Boolean) }
  }

  // External users see nothing unless explicitly assigned
  if (activeRole === 'external') {
    return { type: 'assigned_only', orgUnitIds: [] }
  }

  // Default: associate sees only their own record
  return { type: 'own', orgUnitIds: [user.orgUnitId].filter(Boolean) }
}

/**
 * Express middleware factory.
 * Usage: router.get('/path', requirePermission('view', 'learning', 'catalog'), handler)
 *
 * Automatically:
 * 1. Checks the permission
 * 2. Returns 403 if denied
 * 3. Writes an ACCESS_VIOLATION audit event if denied
 * 4. Attaches visibilityScope to req for the handler to use in queries
 */
function requirePermission(action, module, feature) {
  return async (req, res, next) => {
    const user = req.user  // set by auth middleware

    if (!user) {
      return res.status(401).json({ error: 'Unauthenticated' })
    }

    const permitted = await hasPermission(user, action, module, feature)

    if (!permitted) {
      // Write access violation to audit log
      await db.query(
        `INSERT INTO audit_events
           (tenant_id, actor_user_id, actor_role_at_time, action_type, entity_type, ip_address, result, metadata)
         VALUES ($1, $2, $3, 'ACCESS_VIOLATION', $4, $5, 'failure', $6)`,
        [
          user.tenantId,
          user.id,
          user.activeRole,
          `${module}.${feature}`,
          req.ip,
          JSON.stringify({ method: req.method, path: req.path, action })
        ]
      )
      return res.status(403).json({ error: 'Forbidden' })
    }

    // Attach visibility scope for use in query handlers
    req.visibilityScope = await getVisibilityScope(user)

    next()
  }
}

module.exports = { hasPermission, getVisibilityScope, requirePermission }
