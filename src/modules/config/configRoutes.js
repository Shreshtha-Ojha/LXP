// src/modules/config/configRoutes.js
//
// /admin/config and /admin/features — tenant configuration and feature flag
// administration. Gated by config.settings.{view,configure} and
// config.feature_flags.{view,configure} (migration 013), granted to
// super_admin only. requirePermission() handles the 403 + ACCESS_VIOLATION
// audit write for permission denials (Rule 2); configService writes
// CONFIG_CHANGED / FEATURE_FLAG_CHANGED in the same transaction as the
// update (Rule 4).

const express = require('express')
const { authenticate } = require('../../middleware/authenticate')
const { requirePermission } = require('../roles/permissionEngine')
const configService = require('./configService')

const router = express.Router()

router.use(authenticate)

function actorFrom(req) {
  return { id: req.user.id, roles: req.user.roles }
}

function contextFrom(req) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] }
}

// GET /admin/config — list all configuration for the tenant
router.get('/admin/config', requirePermission('view', 'config', 'settings'), async (req, res, next) => {
  try {
    const data = await configService.listConfig(req.user.tenantId)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// PUT /admin/config/:module/:key — update (or create) a configuration value
router.put('/admin/config/:module/:key', requirePermission('configure', 'config', 'settings'), async (req, res, next) => {
  try {
    if (!req.body || !('value' in req.body)) {
      return res.status(400).json({ error: 'value is required' })
    }

    const config = await configService.set(
      req.user.tenantId,
      req.params.module,
      req.params.key,
      req.body.value,
      actorFrom(req),
      contextFrom(req)
    )
    res.json(config)
  } catch (err) {
    next(err)
  }
})

// GET /admin/features — list all feature flags for the tenant
router.get('/admin/features', requirePermission('view', 'config', 'feature_flags'), async (req, res, next) => {
  try {
    const data = await configService.listFeatureFlags(req.user.tenantId)
    res.json({ data })
  } catch (err) {
    next(err)
  }
})

// PUT /admin/features/:feature — toggle a feature flag
router.put('/admin/features/:feature', requirePermission('configure', 'config', 'feature_flags'), async (req, res, next) => {
  try {
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' })
    }

    const flag = await configService.setFeatureFlag(
      req.user.tenantId,
      req.params.feature,
      req.body.enabled,
      actorFrom(req),
      contextFrom(req)
    )
    res.json(flag)
  } catch (err) {
    next(err)
  }
})

module.exports = router
