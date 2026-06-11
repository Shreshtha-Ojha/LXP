// src/modules/dashboard/dashboardRoutes.js
//
// /dashboard — role-specific landing dashboards.
// Every route: authenticate -> requirePermission -> handler.
// requirePermission() handles the 403 + ACCESS_VIOLATION audit write for
// permission denials (Rule 2); dashboardService enforces Rule 3 (tenant_id
// scoping) and Rule 7 (visibility — /me is always the caller's own records,
// /team is the caller's direct reports, /admin is tenant-wide for L&D admin
// /super_admin only, per migration 019's permission grants).
//
// Declares full paths and is mounted at the application root (same
// convention as pathRoutes/assignmentRoutes/progressRoutes).

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const dashboardService = require('./dashboardService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// GET /dashboard/me — the caller's own associate dashboard
router.get('/dashboard/me', requirePermission('view', 'dashboard', 'me'), async (req, res, next) => {
  try {
    const result = await dashboardService.getAssociateDashboard({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /dashboard/team — direct reports' dashboard (reporting_manager, ld_admin, super_admin)
router.get('/dashboard/team', requirePermission('view', 'dashboard', 'team'), async (req, res, next) => {
  try {
    const result = await dashboardService.getTeamDashboard({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /dashboard/admin — platform-wide stats (ld_admin, super_admin)
router.get('/dashboard/admin', requirePermission('view', 'dashboard', 'admin'), async (req, res, next) => {
  try {
    const result = await dashboardService.getAdminDashboard({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

module.exports = router
