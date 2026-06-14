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

// GET /learning-paths — list of paths visible to the actor (Rule 7)
router.get('/learning-paths', requirePermission('view', 'learning', 'paths'), async (req, res, next) => {
  try {
    const paths = await pathService.getAllPaths({ actor: actorFrom(req) })
    res.json(paths)
  } catch (err) {
    next(err)
  }
})

// POST /learning-paths — create a path. `nodes` payload (path builder) vs
// `items` payload (legacy curated list, migration 017) are both supported.
router.post('/learning-paths', requirePermission('create', 'learning', 'paths'), async (req, res, next) => {
  try {
    const input = req.body || {}
    const result = Array.isArray(input.nodes)
      ? await pathService.createPathWithNodes({
          actor: actorFrom(req),
          input,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        })
      : await pathService.createPath({
          actor: actorFrom(req),
          input,
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

// PUT /learning-paths/:id — replace a path builder path's details, nodes, and skills
router.put('/learning-paths/:id', requirePermission('edit', 'learning', 'paths'), async (req, res, next) => {
  try {
    const result = await pathService.updatePath({
      actor: actorFrom(req),
      pathId: req.params.id,
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

// POST /learning-paths/:id/submit-review — send a path into the Learning Path Review workflow
router.post('/learning-paths/:id/submit-review', requirePermission('edit', 'learning', 'paths'), async (req, res, next) => {
  try {
    const result = await pathService.submitForReview({
      actor: actorFrom(req),
      pathId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.path)
  } catch (err) {
    next(err)
  }
})

// POST /learning-paths/:id/publish — publish directly (draft, if role is in publish_bypass_roles) or after review (in_review)
router.post('/learning-paths/:id/publish', requirePermission('approve', 'learning', 'paths'), async (req, res, next) => {
  try {
    const result = await pathService.publishPath({
      actor: actorFrom(req),
      pathId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.path)
  } catch (err) {
    next(err)
  }
})

// POST /learning-paths/:id/duplicate — copy a path (and its nodes/skills) into a new draft
router.post('/learning-paths/:id/duplicate', requirePermission('edit', 'learning', 'paths'), async (req, res, next) => {
  try {
    const result = await pathService.duplicatePath({
      actor: actorFrom(req),
      pathId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.path)
  } catch (err) {
    next(err)
  }
})

module.exports = router
