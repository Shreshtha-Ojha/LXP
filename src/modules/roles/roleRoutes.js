// src/modules/roles/roleRoutes.js
//
// Role and permission administration. Mount at the application root
// (app.use(roleRoutes)) — routes declare their own full paths since they
// span /admin/roles, /admin/users/:id/roles, and /access.
//
// Every route except GET /access/effective-permissions: authenticate ->
// requirePermission -> handler. requirePermission() handles the 403 +
// ACCESS_VIOLATION audit write for permission denials (Rule 2); roleService
// additionally enforces Rule 7 (visibility scope) for user-role assignments.
//
// GET /access/effective-permissions is deliberately not wired through
// requirePermission(): it isn't a resource-scoped permission, it's "tell me
// my own access" — every authenticated user may always introspect their own
// effective permissions (same rationale as POST /auth/logout in
// authRoutes.js). Tenant scoping (Rule 3) and audit logging (Rule 4 — N/A,
// this is a read) are unaffected since the query is keyed off req.user.id.

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('./permissionEngine')
const roleService = require('./roleService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// GET /admin/roles — list all roles for the tenant, with their permissions
router.get('/admin/roles', requirePermission('view', 'roles', 'definitions'), async (req, res, next) => {
  try {
    const roles = await roleService.listRoles({ tenantId: req.user.tenantId })
    res.json({ data: roles })
  } catch (err) {
    next(err)
  }
})

// POST /admin/roles — create a custom role
router.post('/admin/roles', requirePermission('create', 'roles', 'definitions'), async (req, res, next) => {
  try {
    const result = await roleService.createRole({
      actor: actorFrom(req),
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.role)
  } catch (err) {
    next(err)
  }
})

// PUT /admin/roles/:id — update name/description (system roles cannot be renamed)
router.put('/admin/roles/:id', requirePermission('edit', 'roles', 'definitions'), async (req, res, next) => {
  try {
    const result = await roleService.updateRole({
      actor: actorFrom(req),
      roleId: req.params.id,
      updates: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.role)
  } catch (err) {
    next(err)
  }
})

// POST /admin/roles/:id/permissions — replace the role's permission set
router.post('/admin/roles/:id/permissions', requirePermission('configure', 'roles', 'permissions'), async (req, res, next) => {
  try {
    const result = await roleService.setRolePermissions({
      actor: actorFrom(req),
      roleId: req.params.id,
      permissions: req.body?.permissions,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.role)
  } catch (err) {
    next(err)
  }
})

// POST /admin/users/:id/roles — assign a role to a user
router.post('/admin/users/:id/roles', requirePermission('edit', 'roles', 'assignments'), async (req, res, next) => {
  try {
    const result = await roleService.assignRoleToUser({
      actor: actorFrom(req),
      userId: req.params.id,
      roleId: req.body?.roleId,
      effectiveFrom: req.body?.effectiveFrom,
      effectiveTo: req.body?.effectiveTo,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.assignment)
  } catch (err) {
    next(err)
  }
})

// DELETE /admin/users/:id/roles/:roleId — remove a role from a user
router.delete('/admin/users/:id/roles/:roleId', requirePermission('edit', 'roles', 'assignments'), async (req, res, next) => {
  try {
    const result = await roleService.removeRoleFromUser({
      actor: actorFrom(req),
      userId: req.params.id,
      roleId: req.params.roleId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message })
  } catch (err) {
    next(err)
  }
})

// GET /access/effective-permissions — the calling user's full permission set
router.get('/access/effective-permissions', async (req, res, next) => {
  try {
    const result = await roleService.getEffectivePermissions({ user: req.user })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

module.exports = router
