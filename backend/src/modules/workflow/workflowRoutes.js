// src/modules/workflow/workflowRoutes.js
//
// Routes for the central workflow engine (Rule 5). Both routes require
// workflow.tasks.{view,approve} (migration 011); workflowService additionally
// checks that the calling user is actually party to the instance being acted
// on (assigned_to/delegated_to/initiated_by) before making any change.

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const workflowService = require('./workflowService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// GET /workflows/tasks/me — pending workflow tasks assigned to the caller
router.get('/workflows/tasks/me', requirePermission('view', 'workflow', 'tasks'), async (req, res, next) => {
  try {
    const tasks = await workflowService.getMyTasks({ actor: actorFrom(req) })
    res.json({ data: tasks })
  } catch (err) {
    next(err)
  }
})

// POST /workflows/:instanceId/actions — approve/reject/send_back/request_info/escalate/delegate/withdraw
router.post('/workflows/:instanceId/actions', requirePermission('approve', 'workflow', 'tasks'), async (req, res, next) => {
  try {
    const result = await workflowService.takeAction({
      actor: actorFrom(req),
      instanceId: req.params.instanceId,
      action: req.body?.action,
      comment: req.body?.comment,
      attachment: req.body?.attachment,
      delegateTo: req.body?.delegateTo,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.instance)
  } catch (err) {
    next(err)
  }
})

module.exports = router
