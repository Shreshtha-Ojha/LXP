// src/modules/config/configService.js
//
// Central configuration and feature-flag service (Rule 1: business rules
// live in configurations/feature_flags, never hardcoded). Reads are cached
// in memory for CACHE_TTL_MS to keep hot paths (e.g. authService's password
// policy / session timeout lookups) off the database; writes go through a
// transaction that records CONFIG_CHANGED / FEATURE_FLAG_CHANGED in the
// audit log (Rule 4) and immediately refresh the cache so the change is
// visible on the very next read.
//
// `value` is stored as JSONB shaped { "value": <actual value> } — the same
// convention authService.getSessionExpiry and userService.validatePasswordPolicy
// already read from migration 008's seed data.

const db = require('../../db')
const auditLog = require('../audit/auditLog')

const { AuditActions } = auditLog

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

const configCache = new Map()      // `${tenantId}:${module}:${key}` -> { value, expiresAt }
const featureFlagCache = new Map() // `${tenantId}:${feature}`       -> { value, expiresAt }

function getCached(cache, key) {
  const entry = cache.get(key)
  if (entry && entry.expiresAt > Date.now()) return entry
  return null
}

function setCached(cache, key, value) {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
}

function serializeConfig(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    module: row.module,
    key: row.key,
    value: row.value?.value ?? null,
    description: row.description,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at
  }
}

function serializeFeatureFlag(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    feature: row.feature,
    isEnabled: row.is_enabled,
    description: row.description,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at
  }
}

// ---------------------------------------------------------------------------
// configService.get(tenantId, module, key)
// ---------------------------------------------------------------------------

async function get(tenantId, module, key) {
  const cacheKey = `${tenantId}:${module}:${key}`
  const cached = getCached(configCache, cacheKey)
  if (cached) return cached.value

  const result = await db.query(
    `SELECT value FROM configurations WHERE tenant_id = $1 AND module = $2 AND key = $3`,
    [tenantId, module, key]
  )
  const value = result.rows[0]?.value?.value ?? null

  setCached(configCache, cacheKey, value)
  return value
}

// ---------------------------------------------------------------------------
// configService.set(tenantId, module, key, value, updatedBy)
// ---------------------------------------------------------------------------

/**
 * @param {object} updatedBy - { id, roles } of the actor making the change,
 *                              used for the updated_by column and the audit
 *                              event's actor_role_at_time snapshot.
 * @param {object} [context] - { ipAddress, userAgent } for the audit event.
 */
async function set(tenantId, module, key, value, updatedBy, context = {}) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(
      `SELECT * FROM configurations WHERE tenant_id = $1 AND module = $2 AND key = $3`,
      [tenantId, module, key]
    )
    const current = currentResult.rows[0] || null
    const oldValue = current?.value?.value ?? null

    const upsertResult = await client.query(
      `INSERT INTO configurations (tenant_id, module, key, value, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, module, key)
       DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [tenantId, module, key, JSON.stringify({ value }), updatedBy?.id || null]
    )
    const updated = upsertResult.rows[0]

    await auditLog.write({
      tenantId,
      actorUserId: updatedBy?.id,
      actorRoleAtTime: updatedBy?.roles?.join(','),
      actionType: AuditActions.CONFIG_CHANGED,
      entityType: 'Configuration',
      entityId: updated.id,
      oldValue: { module, key, value: oldValue },
      newValue: { module, key, value },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')

    setCached(configCache, `${tenantId}:${module}:${key}`, value)
    return serializeConfig(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// configService.isFeatureEnabled(tenantId, feature)
// ---------------------------------------------------------------------------

async function isFeatureEnabled(tenantId, feature) {
  const cacheKey = `${tenantId}:${feature}`
  const cached = getCached(featureFlagCache, cacheKey)
  if (cached) return cached.value

  const result = await db.query(
    `SELECT is_enabled FROM feature_flags WHERE tenant_id = $1 AND feature = $2`,
    [tenantId, feature]
  )
  const value = result.rows[0]?.is_enabled ?? false

  setCached(featureFlagCache, cacheKey, value)
  return value
}

// ---------------------------------------------------------------------------
// configService.setFeatureFlag(tenantId, feature, enabled, updatedBy)
// ---------------------------------------------------------------------------

/**
 * @param {object} updatedBy - { id, roles } of the actor making the change.
 * @param {object} [context] - { ipAddress, userAgent } for the audit event.
 */
async function setFeatureFlag(tenantId, feature, enabled, updatedBy, context = {}) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const currentResult = await client.query(
      `SELECT * FROM feature_flags WHERE tenant_id = $1 AND feature = $2`,
      [tenantId, feature]
    )
    const current = currentResult.rows[0] || null
    const oldEnabled = current?.is_enabled ?? false

    const upsertResult = await client.query(
      `INSERT INTO feature_flags (tenant_id, feature, is_enabled, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, feature)
       DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [tenantId, feature, enabled, updatedBy?.id || null]
    )
    const updated = upsertResult.rows[0]

    await auditLog.write({
      tenantId,
      actorUserId: updatedBy?.id,
      actorRoleAtTime: updatedBy?.roles?.join(','),
      actionType: AuditActions.FEATURE_FLAG_CHANGED,
      entityType: 'FeatureFlag',
      entityId: updated.id,
      oldValue: { feature, isEnabled: oldEnabled },
      newValue: { feature, isEnabled: enabled },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')

    setCached(featureFlagCache, `${tenantId}:${feature}`, enabled)
    return serializeFeatureFlag(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /admin/config and GET /admin/features — uncached, always-fresh listings
// ---------------------------------------------------------------------------

async function listConfig(tenantId) {
  const result = await db.query(
    `SELECT * FROM configurations WHERE tenant_id = $1 ORDER BY module, key`,
    [tenantId]
  )
  return result.rows.map(serializeConfig)
}

async function listFeatureFlags(tenantId) {
  const result = await db.query(
    `SELECT * FROM feature_flags WHERE tenant_id = $1 ORDER BY feature`,
    [tenantId]
  )
  return result.rows.map(serializeFeatureFlag)
}

/** Test-only: clear both in-memory caches between test cases. */
function clearCache() {
  configCache.clear()
  featureFlagCache.clear()
}

module.exports = {
  get,
  set,
  isFeatureEnabled,
  setFeatureFlag,
  listConfig,
  listFeatureFlags,
  clearCache,
  CACHE_TTL_MS
}
