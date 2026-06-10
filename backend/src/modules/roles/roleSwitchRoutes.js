// src/modules/roles/roleSwitchRoutes.js
//
// POST /auth/switch-role — D-008: users with multiple roles explicitly
// switch their active role. From this point on, permissionEngine.hasPermission
// and permissionEngine.getVisibilityScope evaluate against the active role only.
//
// Not wired through requirePermission(): switching which of YOUR OWN roles is
// active isn't a resource-scoped permission — every authenticated user may
// switch to any role they actually hold (validated in roleService against
// user_roles). Same rationale as POST /auth/logout in authRoutes.js.

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const roleService = require('./roleService')

const router = express.Router()

router.post('/auth/switch-role', authenticate, async (req, res, next) => {
  try {
    const result = await roleService.switchActiveRole({
      actor: req.user,
      roleId: req.body?.roleId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({
      token: result.token,
      activeRole: result.activeRole,
      availableRoles: result.availableRoles
    })
  } catch (err) {
    next(err)
  }
})

module.exports = router
