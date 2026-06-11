// src/modules/content/scormRoutes.js
//
// /scorm — SCORM 1.2 / SCORM 2004 runtime endpoints called by the SCORM
// player embedded in a content_type='scorm' learning_asset. Every route:
// authenticate -> requirePermission -> handler. requirePermission() handles
// the 403 + ACCESS_VIOLATION audit write for permission denials (Rule 2);
// scormService enforces Rule 3/7 (tenant_id + user_id scoping) and Rule 6
// (asset_id FK validation).
//
// Reuses 'learning.progress.create' (migration 018, granted to every role)
// — a SCORM runtime call is just another way the learner records progress
// on their own asset, same permission as POST /progress/events.
//
// Declares full paths and is mounted at the application root (same
// convention as progressRoutes/pathRoutes/dashboardRoutes) — NOT nested
// under contentRoutes' /content/assets prefix, which would produce
// /content/assets/scorm/* instead of the required /scorm/* paths.

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const scormService = require('./scormService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

const requireScormPermission = requirePermission('create', 'learning', 'progress')

// POST /scorm/initialize — launch: create or resume the session for asset_id,
// returning a session token and the learner's last-saved cmi data
router.post('/scorm/initialize', requireScormPermission, async (req, res, next) => {
  try {
    const result = await scormService.initializeSession({
      actor: actorFrom(req),
      assetId: req.body?.asset_id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json({
      session_token: result.session.sessionToken,
      lesson_status: result.session.lessonStatus,
      score: result.session.score,
      suspend_data: result.session.suspendData
    })
  } catch (err) {
    next(err)
  }
})

// POST /scorm/set-value — LMSSetValue/SetValue: persist one or more cmi.* key/value pairs
router.post('/scorm/set-value', requireScormPermission, async (req, res, next) => {
  try {
    const { session_token, key, value, values } = req.body || {}
    const result = await scormService.setValue({ actor: actorFrom(req), sessionToken: session_token, key, value, values })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// POST /scorm/commit — LMSCommit/Commit: persist the session and audit a checkpoint
router.post('/scorm/commit', requireScormPermission, async (req, res, next) => {
  try {
    const result = await scormService.commit({
      actor: actorFrom(req),
      sessionToken: req.body?.session_token,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// POST /scorm/terminate — LMSFinish/Terminate: end the session; if lesson_status
// is 'completed' or 'passed', forward to learning.progressService as
// event_type='completed' (the existing scorm/external_status completion path)
router.post('/scorm/terminate', requireScormPermission, async (req, res, next) => {
  try {
    const result = await scormService.terminate({
      actor: actorFrom(req),
      sessionToken: req.body?.session_token,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ ok: true, completed: result.completed, completion: result.completion })
  } catch (err) {
    next(err)
  }
})

module.exports = router
