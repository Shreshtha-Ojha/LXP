// src/modules/learning/progressRoutes.js
//
// /progress — recording and reading a learner's own progress through
// learning_assets. Always "my own records" (Rule 7) — there is no
// manager/admin view of another user's progress here.
// Every route: authenticate -> requirePermission -> handler.
// requirePermission() handles the 403 + ACCESS_VIOLATION audit write for
// permission denials (Rule 2); progressService enforces Rule 1 (config-driven
// completion rules), Rule 3 (tenant_id + user_id scoping), Rule 4 (audit
// trail), and Rule 6 (asset_id FK validation).
//
// Declares full paths and is mounted at the application root (same
// convention as pathRoutes/assignmentRoutes).

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const progressService = require('./progressService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// POST /progress/events — record a started/progress_updated/completed/resumed event
router.post('/progress/events', requirePermission('create', 'learning', 'progress'), async (req, res, next) => {
  try {
    const result = await progressService.recordProgressEvent({
      actor: actorFrom(req),
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json({ event: result.event, completion: result.completion })
  } catch (err) {
    next(err)
  }
})

// GET /progress/me — the caller's progress across every asset they've started
router.get('/progress/me', requirePermission('view', 'learning', 'progress'), async (req, res, next) => {
  try {
    const result = await progressService.getMyProgress({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /progress/resume/:assetId — last known position_seconds for video resume
router.get('/progress/resume/:assetId', requirePermission('view', 'learning', 'progress'), async (req, res, next) => {
  try {
    const result = await progressService.getResumePosition({ actor: actorFrom(req), assetId: req.params.assetId })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ assetId: result.assetId, positionSeconds: result.positionSeconds, lastUpdatedAt: result.lastUpdatedAt })
  } catch (err) {
    next(err)
  }
})

module.exports = router
