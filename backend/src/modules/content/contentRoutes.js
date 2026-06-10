// src/modules/content/contentRoutes.js
//
// /content/assets — learning asset authoring and publication.
// Every route: authenticate -> requirePermission -> handler.
// requirePermission() handles the 403 + ACCESS_VIOLATION audit write for
// permission denials (Rule 2); contentService additionally enforces Rule 7
// (visibility) for GET, and Rule 1 (config-driven status transitions /
// publish bypass) for submit-review / publish / retire.

const express = require('express')
const multer = require('multer')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const contentService = require('./contentService')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

/** Multipart fields arrive as strings — parse JSON-encoded arrays/numbers for skill_ids, tags, duration_minutes. */
function parseAssetInput(body = {}) {
  const input = { ...body }

  for (const field of ['skill_ids', 'tags']) {
    if (typeof input[field] === 'string') {
      try {
        input[field] = JSON.parse(input[field])
      } catch {
        // leave as-is — validation will reject the non-array value
      }
    }
  }

  if (typeof input.duration_minutes === 'string' && input.duration_minutes !== '') {
    const parsed = Number(input.duration_minutes)
    if (!Number.isNaN(parsed)) input.duration_minutes = parsed
  }

  return input
}

// POST /content/assets — create a learning asset (status: draft)
router.post('/', requirePermission('create', 'content', 'assets'), upload.single('file'), async (req, res, next) => {
  try {
    const result = await contentService.createAsset({
      actor: actorFrom(req),
      input: parseAssetInput(req.body),
      file: req.file,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.asset)
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    next(err)
  }
})

// GET /content/assets/:id — full asset detail (Rule 7: hidden from associates unless published)
router.get('/:id', requirePermission('view', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await contentService.getAssetById({
      actor: actorFrom(req),
      assetId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.asset)
  } catch (err) {
    next(err)
  }
})

// PUT /content/assets/:id — update asset metadata
router.put('/:id', requirePermission('edit', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await contentService.updateAsset({
      actor: actorFrom(req),
      assetId: req.params.id,
      updates: parseAssetInput(req.body || {}),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.asset)
  } catch (err) {
    next(err)
  }
})

// POST /content/assets/:id/submit-review — start the content publication workflow (status -> in_review)
router.post('/:id/submit-review', requirePermission('edit', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await contentService.submitForReview({
      actor: actorFrom(req),
      assetId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ asset: result.asset, workflow: result.workflow })
  } catch (err) {
    next(err)
  }
})

// POST /content/assets/:id/publish — direct publish (status -> published); requires content.assets.approve
router.post('/:id/publish', requirePermission('approve', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await contentService.publishAsset({
      actor: actorFrom(req),
      assetId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.asset)
  } catch (err) {
    next(err)
  }
})

// POST /content/assets/:id/retire — status -> retired
router.post('/:id/retire', requirePermission('edit', 'content', 'assets'), async (req, res, next) => {
  try {
    const result = await contentService.retireAsset({
      actor: actorFrom(req),
      assetId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.asset)
  } catch (err) {
    next(err)
  }
})

module.exports = router
