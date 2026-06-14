// src/modules/users/inviteRoutes.js
//
// User invitation flow. Two routers are exported because two of the five
// endpoints (verify/accept) are reached from the magic-link email before the
// recipient has any session — they must stay outside `authenticate`.
//
//   publicRouter — declares full paths, mounted at the app root, NO auth:
//     GET  /users/invite/verify
//     POST /users/invite/accept
//
//   router — mounted at /users, authenticate + requirePermission('users','invitations',...):
//     POST   /invite           (create, also covers resend-on-reinvite)
//     GET    /invited          (view)
//     DELETE /invite/:id       (edit — revoke)
//     POST   /invite/:id/resend (create)

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const inviteService = require('./inviteService')

const publicRouter = express.Router()
const router = express.Router()

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// ---------------------------------------------------------------------------
// Public routes — reached from the invitation email, no session yet
// ---------------------------------------------------------------------------

// GET /users/invite/verify?token=... — check a magic-link token before
// rendering the set-password form.
publicRouter.get('/users/invite/verify', async (req, res, next) => {
  try {
    const result = await inviteService.verifyInviteToken({ token: req.query.token })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /users/invite/accept — set password and activate the invited account.
publicRouter.post('/users/invite/accept', async (req, res, next) => {
  try {
    const result = await inviteService.acceptInvite({
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({
      token: result.token,
      user: result.user,
      activeRole: result.activeRole,
      availableRoles: result.availableRoles
    })
  } catch (err) {
    next(err)
  }
})

// ---------------------------------------------------------------------------
// Authenticated routes — mounted at /users
// ---------------------------------------------------------------------------

router.use(authenticate)

// POST /users/invite — invite a new user (or re-issue if still 'invited')
router.post('/invite', requirePermission('create', 'users', 'invitations'), async (req, res, next) => {
  try {
    const result = await inviteService.inviteUser({
      actor: actorFrom(req),
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json({
      message: result.message,
      user_id: result.user_id,
      magic_link: result.magic_link,
      expires_at: result.expires_at
    })
  } catch (err) {
    next(err)
  }
})

// GET /users/invited — pending invitations
router.get('/invited', requirePermission('view', 'users', 'invitations'), async (req, res, next) => {
  try {
    const result = await inviteService.listInvitedUsers({ actor: actorFrom(req) })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// DELETE /users/invite/:id — revoke a pending invitation (id = users.id)
router.delete('/invite/:id', requirePermission('edit', 'users', 'invitations'), async (req, res, next) => {
  try {
    const result = await inviteService.revokeInvite({
      actor: actorFrom(req),
      userId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message })
  } catch (err) {
    next(err)
  }
})

// POST /users/invite/:id/resend — re-issue an invitation's token + email (id = users.id)
router.post('/invite/:id/resend', requirePermission('create', 'users', 'invitations'), async (req, res, next) => {
  try {
    const result = await inviteService.resendInvite({
      actor: actorFrom(req),
      userId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json({ message: result.message, magic_link: result.magic_link, expires_at: result.expires_at })
  } catch (err) {
    next(err)
  }
})

module.exports = { router, publicRouter }
