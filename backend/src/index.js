// src/index.js
//
// Main Express application entry point. Wires up global middleware (Rule 2/3
// still apply per-route via authenticate + requirePermission inside each
// router), mounts every module's routes, and exposes an unauthenticated
// health check for load balancers / orchestration probes.

require('dotenv').config()

const express = require('express')
const helmet = require('helmet')
const cors = require('cors')
const rateLimit = require('express-rate-limit')

const db = require('./db')

const authRoutes = require('./modules/auth/authRoutes')
const userRoutes = require('./modules/users/userRoutes')
const inviteRoutes = require('./modules/users/inviteRoutes')
const roleRoutes = require('./modules/roles/roleRoutes')
const roleSwitchRoutes = require('./modules/roles/roleSwitchRoutes')
const workflowRoutes = require('./modules/workflow/workflowRoutes')
const notificationRoutes = require('./modules/notifications/notificationRoutes')
const configRoutes = require('./modules/config/configRoutes')
const contentRoutes = require('./modules/content/contentRoutes')
const catalogRoutes = require('./modules/content/catalogRoutes')
const scormRoutes = require('./modules/content/scormRoutes')
const pathRoutes = require('./modules/learning/pathRoutes')
const assignmentRoutes = require('./modules/learning/assignmentRoutes')
const progressRoutes = require('./modules/learning/progressRoutes')
const dashboardRoutes = require('./modules/dashboard/dashboardRoutes')
const skillRoutes = require('./modules/skills/skillRoutes')

const app = express()

app.use(helmet())
app.use(cors())
app.use(express.json())

app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100,               // 100 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false
}))

// GET /health — liveness check, no auth required
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// authRoutes/userRoutes/contentRoutes declare paths relative to their mount point.
app.use('/auth', authRoutes)
app.use('/admin/users', userRoutes)
app.use('/content/assets', contentRoutes)

// inviteRoutes.publicRouter declares full paths (/users/invite/verify,
// /users/invite/accept) and must be mounted before the authenticated /users
// router below — these two endpoints are reached from the invitation email
// before the recipient has a session.
app.use(inviteRoutes.publicRouter)
app.use('/users', inviteRoutes.router)

// roleRoutes/roleSwitchRoutes/workflowRoutes/notificationRoutes/configRoutes/
// catalogRoutes/scormRoutes/pathRoutes/assignmentRoutes/progressRoutes/
// dashboardRoutes/skillRoutes already declare their full paths (e.g.
// /admin/roles, /auth/switch-role, /workflows/tasks/me, /notifications/me,
// /admin/config, /catalog/search, /scorm/initialize, /learning-paths,
// /assignments, /progress/events, /dashboard/me, /skills/inventory) and are
// mounted at the application root.
app.use(roleRoutes)
app.use(roleSwitchRoutes)
app.use(workflowRoutes)
app.use(notificationRoutes)
app.use(configRoutes)
app.use(catalogRoutes)
app.use(scormRoutes)
app.use(pathRoutes)
app.use(assignmentRoutes)
app.use(progressRoutes)
app.use(dashboardRoutes)
app.use(skillRoutes)

// 404 for anything that didn't match a route
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// Global error handler — never expose stack traces in production
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
  res.status(500).json({ error: message })
})

const PORT = process.env.PORT || 3001

async function start() {
  try {
    await db.query('SELECT 1')
    console.log('Database connection OK')
  } catch (err) {
    console.error('Failed to connect to database:', err.message)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log(`LXP backend listening on port ${PORT}`)
  })
}

if (require.main === module) {
  start()
}

module.exports = app
