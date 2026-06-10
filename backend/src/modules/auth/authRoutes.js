// src/modules/auth/authRoutes.js
//
// POST /auth/login  — public; verifies credentials and issues a JWT
// POST /auth/logout — requires a valid session; records the logout
//
// Login and logout are deliberately not wired through requirePermission():
// before login there is no authenticated user for the permission engine to
// evaluate, and "end my own session" isn't a resource-scoped permission —
// every authenticated user may always log themselves out. Tenant scoping
// (Rule 3) and audit logging (Rule 4) are still enforced in authService.

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const authService = require('./authService')

const router = express.Router()

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {}

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const result = await authService.login({
      email,
      password,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    res.json({
      token: result.token,
      user: result.user,
      availableRoles: result.availableRoles,
      activeRole: result.activeRole
    })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await authService.logout({
      user: req.user,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })

    res.json({ message: 'Logged out' })
  } catch (err) {
    next(err)
  }
})

module.exports = router
