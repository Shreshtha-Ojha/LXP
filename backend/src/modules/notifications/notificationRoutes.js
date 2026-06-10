// src/modules/notifications/notificationRoutes.js
//
// /notifications — the caller's own notification inbox. Every route requires
// notifications.inbox.{view,edit} (migration 012); notificationService
// additionally checks that the notification being actioned belongs to the
// caller (Rule 7 — every persona's floor is "own records only" for their
// own inbox) before making any change.

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const notificationService = require('./notificationService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// GET /notifications/me — unread notifications for the caller, newest first
router.get('/notifications/me', requirePermission('view', 'notifications', 'inbox'), async (req, res, next) => {
  try {
    const notifications = await notificationService.getUnreadForUser({ actor: actorFrom(req) })
    res.json({ data: notifications })
  } catch (err) {
    next(err)
  }
})

// POST /notifications/:id/read — mark one notification as read
router.post('/notifications/:id/read', requirePermission('edit', 'notifications', 'inbox'), async (req, res, next) => {
  try {
    const result = await notificationService.markAsRead({
      actor: actorFrom(req),
      notificationId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.notification)
  } catch (err) {
    next(err)
  }
})

// POST /notifications/read-all — mark every unread notification for the caller as read
router.post('/notifications/read-all', requirePermission('edit', 'notifications', 'inbox'), async (req, res, next) => {
  try {
    const result = await notificationService.markAllAsRead({
      actor: actorFrom(req),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

module.exports = router
