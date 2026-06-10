// src/modules/learning/pathRoutes.js
//
// /learning-paths — curated, ordered sequences of learning_assets.
// Every route: authenticate -> requirePermission -> handler.
// requirePermission() handles the 403 + ACCESS_VIOLATION audit write for
// permission denials (Rule 2); pathService additionally enforces Rule 7
// (visibility) for GET and Rule 6 (asset_id FK validation) for POST.
//
// Declares full paths and is mounted at the application root (same
// convention as catalogRoutes/workflowRoutes).

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const pathService = require('./pathService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// POST /learning-paths — create a path with ordered items
router.post('/learning-paths', requirePermission('create', 'learning', 'paths'), async (req, res, next) => {
  try {
    const result = await pathService.createPath({
      actor: actorFrom(req),
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.path)
  } catch (err) {
    next(err)
  }
})

// GET /learning-paths/:id — path with all items and their assets
router.get('/learning-paths/:id', requirePermission('view', 'learning', 'paths'), async (req, res, next) => {
  try {
    const result = await pathService.getPathById({
      actor: actorFrom(req),
      pathId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.path)
  } catch (err) {
    next(err)
  }
})

module.exports = router
