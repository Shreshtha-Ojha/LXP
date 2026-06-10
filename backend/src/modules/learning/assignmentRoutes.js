// src/modules/learning/assignmentRoutes.js
//
// /assignments — assigning learning_assets/learning_paths to users, a
// manager's direct reports, or an org unit.
// Every route: authenticate -> requirePermission -> handler.
// requirePermission() handles the 403 + ACCESS_VIOLATION audit write for
// permission denials (Rule 2); assignmentService additionally enforces
// Rule 7 (visibility scope) when resolving "team"/"org_unit"/"users" targets
// and restricts GET /assignments/team to the caller's direct reports.
//
// Declares full paths and is mounted at the application root (same
// convention as pathRoutes/catalogRoutes/workflowRoutes).

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const assignmentService = require('./assignmentService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// POST /assignments — assign an asset or path to user(s), a team, or an org unit
router.post('/assignments', requirePermission('create', 'learning', 'assignments'), async (req, res, next) => {
  try {
    const result = await assignmentService.createAssignment({
      actor: actorFrom(req),
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json({ assignments: result.assignments })
  } catch (err) {
    next(err)
  }
})

// GET /assignments/me — the caller's own assignments, with overdue items flagged
router.get('/assignments/me', requirePermission('view', 'learning', 'assignments'), async (req, res, next) => {
  try {
    const result = await assignmentService.getMyAssignments({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /assignments/team — manager only: assignments for direct reports
router.get('/assignments/team', requirePermission('view', 'learning', 'team_assignments'), async (req, res, next) => {
  try {
    const result = await assignmentService.getTeamAssignments({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

module.exports = router
