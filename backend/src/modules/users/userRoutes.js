// src/modules/users/userRoutes.js
//
// /admin/users — user directory and provisioning.
// Every route: authenticate -> requirePermission -> handler.
// requirePermission() handles the 403 + ACCESS_VIOLATION audit write for
// permission denials (Rule 2); userService additionally enforces Rule 7
// (visibility scope) for the specific record being read/written.

const express = require('express')
const multer = require('multer')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const userService = require('./userService')

const router = express.Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } })

router.use(authenticate)

function actorFrom(req) {
  return { ...req.user, visibilityScope: req.visibilityScope }
}

// GET /admin/users — paginated directory, filterable by status/org_unit/role
router.get('/', requirePermission('view', 'users', 'directory'), async (req, res, next) => {
  try {
    const { status, org_unit: orgUnitId, role, page, pageSize } = req.query
    const result = await userService.listUsers({
      tenantId: req.user.tenantId,
      visibilityScope: req.visibilityScope,
      filters: { status, orgUnitId, role },
      page,
      pageSize
    })
    res.json(result)
  } catch (err) {
    next(err)
  }
})

// POST /admin/users — create a user + profile
router.post('/', requirePermission('create', 'users', 'profile'), async (req, res, next) => {
  try {
    const result = await userService.createUser({
      actor: actorFrom(req),
      input: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.status(result.status).json(result.user)
  } catch (err) {
    next(err)
  }
})

// PUT /admin/users/:id — update user and/or profile fields
router.put('/:id', requirePermission('edit', 'users', 'profile'), async (req, res, next) => {
  try {
    const result = await userService.updateUser({
      actor: actorFrom(req),
      userId: req.params.id,
      updates: req.body || {},
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.user)
  } catch (err) {
    next(err)
  }
})

// DELETE /admin/users/:id — soft delete (status -> inactive)
router.delete('/:id', requirePermission('edit', 'users', 'profile'), async (req, res, next) => {
  try {
    const result = await userService.deactivateUser({
      actor: actorFrom(req),
      userId: req.params.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    })
    if (!result.ok) return res.status(result.status).json({ error: result.error })
    res.json(result.user)
  } catch (err) {
    next(err)
  }
})

// POST /admin/users/bulk-upload — preview (confirm=false) or import (confirm=true)
router.post(
  '/bulk-upload',
  requirePermission('create', 'users', 'bulk_upload'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'A CSV or Excel file is required (field name "file")' })
      }

      const confirm = req.body?.confirm === 'true' || req.body?.confirm === true

      const result = await userService.bulkUploadUsers({
        actor: actorFrom(req),
        fileBuffer: req.file.buffer,
        confirm,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      })

      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, summary: result.summary, rows: result.rows })
      }

      res.status(result.status).json({
        committed: result.committed,
        summary: result.summary,
        rows: result.rows,
        created: result.created
      })
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message })
      next(err)
    }
  }
)

module.exports = router
