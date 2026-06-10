// src/modules/content/catalogRoutes.js
//
// /catalog — learner-facing search, browse, and saved-items on top of
// learning_assets (specs/002-learning-catalog-discovery). Declares full
// paths and is mounted at the application root (same convention as
// roleRoutes/workflowRoutes/notificationRoutes), since it sits alongside
// — not underneath — the /content/assets authoring API in contentRoutes.js.
//
// Every route requires content.assets.view (migration 015 grants this to
// every role except 'external'); searchService additionally enforces Rule 7
// (only 'published' assets, nothing for visibilityScope.type === 'assigned_only').

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const searchService = require('./searchService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// GET /catalog/search — full text + filtered search across published assets
router.get('/catalog/search', requirePermission('view', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await searchService.searchAssets({ actor: actorFrom(req), query: req.query })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /catalog/browse — recently added, top skills, and recommended assets
router.get('/catalog/browse', requirePermission('view', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await searchService.browseAssets({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// GET /catalog/assets/:id/save — toggle the caller's bookmark on an asset
router.get('/catalog/assets/:id/save', requirePermission('view', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await searchService.toggleSavedAsset({
      actor: actorFrom(req),
      assetId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ assetId: result.assetId, saved: result.saved })
  } catch (err) {
    next(err)
  }
})

// GET /catalog/saved — the caller's saved/bookmarked assets
router.get('/catalog/saved', requirePermission('view', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await searchService.getSavedAssets({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

module.exports = router
