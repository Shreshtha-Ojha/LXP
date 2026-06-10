// src/modules/content/searchService.js
//
// Business logic behind /catalog/* (catalogue search, browse, and saved
// items — specs/002-learning-catalog-discovery). Every function takes an
// `actor` ({ id, tenantId, roles, activeRole, visibilityScope }) and enforces:
//  - Rule 3: every query is scoped by tenant_id
//  - Rule 6: skills are matched via learning_asset_skills (FK), never free text
//  - Rule 7: only 'published' assets are returned (draft/in_review/retired
//    stay out of the catalogue — admins manage those via /content/assets);
//    actor.visibilityScope.type === 'assigned_only' (external users — see
//    migration 015) gets nothing back, since explicit content assignment
//    isn't modelled yet
//  - Rule 4: saving/unsaving a bookmark writes CONTENT_SAVED/CONTENT_UNSAVED
//    in the same transaction as the saved_items change
//
// Reuses contentService.serializeAsset so catalogue results have the same
// shape as GET /content/assets/:id.

const db = require('../../db')
const auditLog = require('../audit/auditLog')
const { serializeAsset } = require('./contentService')

const { AuditActions } = auditLog

const SORT_OPTIONS = ['newest', 'popular', 'relevant']
const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const RECENTLY_ADDED_LIMIT = 10
const TOP_SKILLS_LIMIT = 5
const SKILL_ASSET_LIMIT = 5
const RECOMMENDED_LIMIT = 10

// Selects a published learning asset together with its proficiency level and
// linked skills (Rule 6) — same shape contentService.fetchAssetWithRelations
// produces, so serializeAsset works on either.
const ASSET_SELECT = `
  SELECT la.*, pl.name AS proficiency_level_name, pl.level_order AS proficiency_level_order,
         COALESCE(
           array_agg(DISTINCT jsonb_build_object('id', s.id, 'name', s.name)) FILTER (WHERE s.id IS NOT NULL),
           ARRAY[]::jsonb[]
         ) AS skills
  FROM learning_assets la
  LEFT JOIN proficiency_levels pl ON pl.id = la.proficiency_level_id
  LEFT JOIN learning_asset_skills las ON las.asset_id = la.id
  LEFT JOIN skills s ON s.id = las.skill_id
`

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function clampInt(value, fallback, { min, max } = {}) {
  const parsed = parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  if (min !== undefined && parsed < min) return min
  if (max !== undefined && parsed > max) return max
  return parsed
}

/** Accepts skills=id1,id2 or repeated skills[]=id1&skills[]=id2 query params. */
function parseSkillIds(skills) {
  if (!skills) return []
  if (Array.isArray(skills)) return skills.map(String).filter(Boolean)
  return String(skills).split(',').map((s) => s.trim()).filter(Boolean)
}

/** Fetch published assets matching an optional extra WHERE clause, ordered and limited. `runner` is db or a tx client. */
async function fetchPublishedAssets(runner, tenantId, { whereExtra = '', extraParams = [], orderBy = 'la.created_at DESC', limit }) {
  const params = [tenantId, ...extraParams]
  let limitClause = ''
  if (limit) {
    params.push(limit)
    limitClause = `LIMIT $${params.length}`
  }

  const result = await runner.query(
    `${ASSET_SELECT}
     WHERE la.tenant_id = $1 AND la.status = 'published' ${whereExtra}
     GROUP BY la.id, pl.name, pl.level_order
     ORDER BY ${orderBy}
     ${limitClause}`,
    params
  )
  return result.rows.map(serializeAsset)
}

/** Rule 7 — external users (visibilityScope.type === 'assigned_only') see nothing in the open catalogue. */
function isAssignedOnly(actor) {
  return actor.visibilityScope?.type === 'assigned_only'
}

// ---------------------------------------------------------------------------
// GET /catalog/search
// ---------------------------------------------------------------------------

async function searchAssets({ actor, query = {} }) {
  const page = clampInt(query.page, DEFAULT_PAGE, { min: 1 })
  const limit = clampInt(query.limit, DEFAULT_LIMIT, { min: 1, max: MAX_LIMIT })

  if (isAssignedOnly(actor)) {
    return { ok: true, results: [], total: 0, page, limit }
  }

  const q = typeof query.q === 'string' && query.q.trim() !== '' ? query.q.trim() : null
  const skillIds = parseSkillIds(query.skills)
  const contentType = query.content_type || null
  const proficiencyLevelId = query.proficiency_level_id || null
  const language = query.language || null
  const durationMin = query.duration_min !== undefined ? clampInt(query.duration_min, null, { min: 0 }) : null
  const durationMax = query.duration_max !== undefined ? clampInt(query.duration_max, null, { min: 0 }) : null

  // 'relevant' only makes sense with a query string — fall back to 'newest' otherwise.
  let sort = SORT_OPTIONS.includes(query.sort) ? query.sort : (q ? 'relevant' : 'newest')
  if (sort === 'relevant' && !q) sort = 'newest'

  const conditions = [`la.tenant_id = $1`, `la.status = 'published'`]
  const params = [actor.tenantId]
  let qParamIndex = null

  if (q) {
    params.push(q)
    qParamIndex = params.length
    conditions.push(`(
      la.search_vector @@ websearch_to_tsquery('english', $${qParamIndex})
      OR EXISTS (
        SELECT 1 FROM learning_asset_skills mlas
        JOIN skills ms ON ms.id = mlas.skill_id
        WHERE mlas.asset_id = la.id AND ms.name ILIKE '%' || $${qParamIndex} || '%'
      )
    )`)
  }

  if (skillIds.length > 0) {
    params.push(skillIds)
    conditions.push(`EXISTS (
      SELECT 1 FROM learning_asset_skills flas
      WHERE flas.asset_id = la.id AND flas.skill_id = ANY($${params.length}::uuid[])
    )`)
  }

  if (contentType) {
    params.push(contentType)
    conditions.push(`la.content_type = $${params.length}`)
  }

  if (proficiencyLevelId) {
    params.push(proficiencyLevelId)
    conditions.push(`la.proficiency_level_id = $${params.length}`)
  }

  if (language) {
    params.push(language)
    conditions.push(`la.language = $${params.length}`)
  }

  if (durationMin !== null) {
    params.push(durationMin)
    conditions.push(`la.duration_minutes >= $${params.length}`)
  }

  if (durationMax !== null) {
    params.push(durationMax)
    conditions.push(`la.duration_minutes <= $${params.length}`)
  }

  let orderBy = 'la.created_at DESC'
  if (sort === 'popular') {
    // No completion-tracking entity exists yet (Release 1 data model) — save
    // count is the most meaningful "popularity" signal currently available.
    orderBy = 'save_count DESC, la.created_at DESC'
  } else if (sort === 'relevant') {
    orderBy = `ts_rank(la.search_vector, websearch_to_tsquery('english', $${qParamIndex})) DESC, la.created_at DESC`
  }

  params.push(limit)
  const limitIdx = params.length
  params.push((page - 1) * limit)
  const offsetIdx = params.length

  const result = await db.query(
    `SELECT la.*, pl.name AS proficiency_level_name, pl.level_order AS proficiency_level_order,
            COALESCE(
              array_agg(DISTINCT jsonb_build_object('id', s.id, 'name', s.name)) FILTER (WHERE s.id IS NOT NULL),
              ARRAY[]::jsonb[]
            ) AS skills,
            COALESCE(si.save_count, 0) AS save_count,
            COUNT(*) OVER() AS total_count
     FROM learning_assets la
     LEFT JOIN proficiency_levels pl ON pl.id = la.proficiency_level_id
     LEFT JOIN learning_asset_skills las ON las.asset_id = la.id
     LEFT JOIN skills s ON s.id = las.skill_id
     LEFT JOIN (
       SELECT asset_id, COUNT(*) AS save_count FROM saved_items GROUP BY asset_id
     ) si ON si.asset_id = la.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY la.id, pl.name, pl.level_order, si.save_count
     ORDER BY ${orderBy}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  )

  const total = result.rows[0] ? parseInt(result.rows[0].total_count, 10) : 0

  return { ok: true, results: result.rows.map(serializeAsset), total, page, limit }
}

// ---------------------------------------------------------------------------
// GET /catalog/browse
// ---------------------------------------------------------------------------

async function browseAssets({ actor }) {
  if (isAssignedOnly(actor)) {
    return { ok: true, recently_added: [], by_skill: [], recommended: [] }
  }

  const recentlyAdded = await fetchPublishedAssets(db, actor.tenantId, {
    orderBy: 'la.created_at DESC',
    limit: RECENTLY_ADDED_LIMIT
  })

  const topSkillsResult = await db.query(
    `SELECT s.id, s.name, COUNT(DISTINCT la.id) AS asset_count
     FROM skills s
     JOIN learning_asset_skills las ON las.skill_id = s.id
     JOIN learning_assets la ON la.id = las.asset_id AND la.tenant_id = $1 AND la.status = 'published'
     WHERE s.tenant_id = $1
     GROUP BY s.id, s.name
     HAVING COUNT(DISTINCT la.id) > 0
     ORDER BY asset_count DESC, s.name ASC
     LIMIT $2`,
    [actor.tenantId, TOP_SKILLS_LIMIT]
  )

  const bySkill = []
  for (const skill of topSkillsResult.rows) {
    const assets = await fetchPublishedAssets(db, actor.tenantId, {
      whereExtra: `AND EXISTS (SELECT 1 FROM learning_asset_skills bslas WHERE bslas.asset_id = la.id AND bslas.skill_id = $2)`,
      extraParams: [skill.id],
      orderBy: 'la.created_at DESC',
      limit: SKILL_ASSET_LIMIT
    })
    bySkill.push({ skill: { id: skill.id, name: skill.name }, assets })
  }

  // Basic recommendation (non-goal: AI matching — Release 4): match the
  // user's job title to content tags via a simple substring check.
  const profileResult = await db.query(`SELECT designation FROM user_profiles WHERE user_id = $1`, [actor.id])
  const designation = profileResult.rows[0]?.designation

  let recommended = []
  if (designation) {
    recommended = await fetchPublishedAssets(db, actor.tenantId, {
      whereExtra: `AND EXISTS (SELECT 1 FROM unnest(la.tags) AS tag WHERE $2 ILIKE '%' || tag || '%')`,
      extraParams: [designation],
      orderBy: 'la.created_at DESC',
      limit: RECOMMENDED_LIMIT
    })
  }

  return { ok: true, recently_added: recentlyAdded, by_skill: bySkill, recommended }
}

// ---------------------------------------------------------------------------
// GET /catalog/assets/:id/save — toggle bookmark
// ---------------------------------------------------------------------------

async function toggleSavedAsset({ actor, assetId, ipAddress, userAgent }) {
  if (isAssignedOnly(actor)) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const assetResult = await client.query(
      `SELECT id FROM learning_assets WHERE id = $1 AND tenant_id = $2 AND status = 'published'`,
      [assetId, actor.tenantId]
    )
    if (assetResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Learning asset not found' }
    }

    const existingResult = await client.query(
      `SELECT 1 FROM saved_items WHERE user_id = $1 AND asset_id = $2`,
      [actor.id, assetId]
    )

    let saved
    let actionType
    if (existingResult.rows.length > 0) {
      await client.query(`DELETE FROM saved_items WHERE user_id = $1 AND asset_id = $2`, [actor.id, assetId])
      saved = false
      actionType = AuditActions.CONTENT_UNSAVED
    } else {
      await client.query(
        `INSERT INTO saved_items (tenant_id, user_id, asset_id) VALUES ($1, $2, $3)`,
        [actor.tenantId, actor.id, assetId]
      )
      saved = true
      actionType = AuditActions.CONTENT_SAVED
    }

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType,
      entityType: 'SavedItem',
      entityId: assetId,
      newValue: { saved },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, assetId, saved }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /catalog/saved
// ---------------------------------------------------------------------------

async function getSavedAssets({ actor }) {
  if (isAssignedOnly(actor)) {
    return { ok: true, results: [] }
  }

  const result = await db.query(
    `SELECT la.*, pl.name AS proficiency_level_name, pl.level_order AS proficiency_level_order,
            COALESCE(
              array_agg(DISTINCT jsonb_build_object('id', s.id, 'name', s.name)) FILTER (WHERE s.id IS NOT NULL),
              ARRAY[]::jsonb[]
            ) AS skills,
            si.saved_at
     FROM saved_items si
     JOIN learning_assets la ON la.id = si.asset_id
     LEFT JOIN proficiency_levels pl ON pl.id = la.proficiency_level_id
     LEFT JOIN learning_asset_skills las ON las.asset_id = la.id
     LEFT JOIN skills s ON s.id = las.skill_id
     WHERE si.user_id = $1 AND si.tenant_id = $2 AND la.status = 'published'
     GROUP BY la.id, pl.name, pl.level_order, si.saved_at
     ORDER BY si.saved_at DESC`,
    [actor.id, actor.tenantId]
  )

  return { ok: true, results: result.rows.map((row) => ({ ...serializeAsset(row), savedAt: row.saved_at })) }
}

module.exports = {
  searchAssets,
  browseAssets,
  toggleSavedAsset,
  getSavedAssets
}
