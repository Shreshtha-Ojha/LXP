// src/modules/skills/skillService.js
//
// Business logic behind /skills/*. Every function takes an `actor`
// ({ id, tenantId, roles, activeRole, activeRoleId, visibilityScope }) and
// enforces:
//  - Rule 3: every query is scoped by tenant_id
//  - Rule 4: every state change writes its audit event in the same
//    transaction as the change
//  - Rule 6: skill_id/current_level_id/validated_level_id are validated
//    against skills/proficiency_levels for the tenant before any write
//  - Rule 7: GET /skills/inventory, /skills/gap-analysis and
//    /skills/recommendations default to "own records only". A reporting
//    manager may additionally view a direct report's inventory via ?userId=
//    (user_profiles.manager_id) — anyone else requesting another user's
//    records gets 403 + an ACCESS_VIOLATION audit event. PUT
//    /skills/:skillId/validate restricts a reporting_manager to their direct
//    reports the same way; competency_leader "practice members" resolution is
//    deferred to Release 3 (migration 019), so for now a competency_leader
//    may validate any record in their tenant.
//  - Rule 1: gaps and "met" requirements come from role_skill_requirements
//    (admin-configurable per designation), never hardcoded skill/level
//    expectations in this file.
//
// PUT /skills/:skillId/validate is a single-step, single-authorized-validator
// status transition — see migration 021 for why this does not go through
// WorkflowDefinition/WorkflowInstance (Rule 5).

const { randomUUID } = require('crypto')
const db = require('../../db')
const auditLog = require('../audit/auditLog')
const notificationService = require('../notifications/notificationService')

const { AuditActions } = auditLog

const VALIDATION_DECISIONS = ['approved', 'rejected']
const RECOMMENDED_CONTENT_LIMIT = 3
const RECOMMENDATIONS_LIMIT = 10

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function serializeSkillRecord(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    skillId: row.skill_id,
    currentLevelId: row.current_level_id,
    targetLevelId: row.target_level_id,
    status: row.status,
    source: row.source,
    evidenceUrl: row.evidence_url,
    validationNote: row.validation_note,
    declaredAt: row.declared_at,
    validatedAt: row.validated_at,
    validatedBy: row.validated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function formatName(row) {
  if (!row) return null
  if (row.preferred_name) return row.preferred_name
  if (!row.first_name && !row.last_name) return null
  return `${row.first_name || ''} ${row.last_name || ''}`.trim()
}

/**
 * Resolve which user's records this request applies to.
 *  - no ?userId= (or ?userId= === actor.id) -> the caller's own records
 *  - ?userId= for someone else -> only a reporting manager may view a direct
 *    report (user_profiles.manager_id = actor.id), or ld_admin/super_admin/
 *    hr_admin/executive (visibilityScope type 'all'/'org') may view anyone in
 *    the tenant. Anything else is a 403 + ACCESS_VIOLATION (Rule 2/7).
 */
async function resolveTargetUser({ actor, userId, ipAddress, userAgent }) {
  const targetId = userId || actor.id

  const result = await db.query(
    `SELECT u.id, up.designation, up.manager_id
     FROM users u
     JOIN user_profiles up ON up.user_id = u.id
     WHERE u.id = $1 AND u.tenant_id = $2`,
    [targetId, actor.tenantId]
  )
  if (result.rows.length === 0) return { ok: false, status: 404, error: 'User not found' }

  const target = result.rows[0]

  if (targetId !== actor.id) {
    const scopeType = actor.visibilityScope?.type
    const isDirectReport = target.manager_id === actor.id
    if (scopeType !== 'all' && scopeType !== 'org' && !isDirectReport) {
      await auditLog.write({
        tenantId: actor.tenantId,
        actorUserId: actor.id,
        actorRoleAtTime: actor.roles?.join(','),
        actionType: AuditActions.ACCESS_VIOLATION,
        entityType: 'UserSkillRecord',
        entityId: targetId,
        ipAddress,
        userAgent,
        result: 'failure',
        metadata: { action: 'skills.inventory.view', targetUserId: targetId }
      })
      return { ok: false, status: 403, error: 'Forbidden' }
    }
  }

  return { ok: true, targetId, designation: target.designation }
}

// ---------------------------------------------------------------------------
// GET /skills/inventory
// ---------------------------------------------------------------------------

const INVENTORY_SELECT = `
  SELECT usr.id, usr.status, usr.source, usr.declared_at, usr.validated_at,
         s.name AS skill_name, cc.name AS category,
         cur.id AS current_level_id, cur.name AS current_level_name, cur.level_order AS current_level_order,
         req.id AS required_level_id, req.name AS required_level_name, req.level_order AS required_level_order
  FROM user_skill_records usr
  JOIN skills s ON s.id = usr.skill_id
  LEFT JOIN competency_categories cc ON cc.id = s.category_id
  LEFT JOIN proficiency_levels cur ON cur.id = usr.current_level_id
  LEFT JOIN role_skill_requirements rsr
    ON rsr.tenant_id = usr.tenant_id AND rsr.skill_id = usr.skill_id AND rsr.role_name = $3
  LEFT JOIN proficiency_levels req ON req.id = rsr.required_level_id
  WHERE usr.tenant_id = $1 AND usr.user_id = $2
  ORDER BY s.name ASC
`

async function getInventory({ actor, userId, ipAddress, userAgent }) {
  const resolved = await resolveTargetUser({ actor, userId, ipAddress, userAgent })
  if (!resolved.ok) return resolved

  const result = await db.query(INVENTORY_SELECT, [actor.tenantId, resolved.targetId, resolved.designation])

  const skills = result.rows.map((row) => {
    const currentLevel = row.current_level_id
      ? { id: row.current_level_id, name: row.current_level_name, level_order: row.current_level_order }
      : null
    const requiredLevel = row.required_level_id
      ? { id: row.required_level_id, name: row.required_level_name, level_order: row.required_level_order }
      : null
    const hasGap = !!requiredLevel && (!currentLevel || currentLevel.level_order < requiredLevel.level_order)
    const gapLevels = hasGap ? requiredLevel.level_order - (currentLevel?.level_order || 0) : 0

    return {
      id: row.id,
      skill_name: row.skill_name,
      category: row.category,
      current_level: currentLevel,
      required_level: requiredLevel,
      status: row.status,
      source: row.source,
      has_gap: hasGap,
      gap_levels: gapLevels,
      declared_at: row.declared_at,
      validated_at: row.validated_at
    }
  })

  const summary = {
    total_skills: skills.length,
    validated: skills.filter((s) => s.status === 'validated').length,
    pending: skills.filter((s) => s.status === 'pending_validation').length,
    self_declared: skills.filter((s) => s.status === 'self_declared').length,
    skills_with_gaps: skills.filter((s) => s.has_gap).length,
    skills_meeting_requirements: skills.filter((s) => s.required_level && !s.has_gap).length
  }

  return { ok: true, status: 200, skills, summary }
}

// ---------------------------------------------------------------------------
// POST /skills/declare
// ---------------------------------------------------------------------------

function validateDeclareInput(input) {
  const errors = []
  if (!input.skill_id) errors.push('skill_id is required')
  if (!input.current_level_id) errors.push('current_level_id is required')
  if (input.evidence_url !== undefined && input.evidence_url !== null && typeof input.evidence_url !== 'string') {
    errors.push('evidence_url must be a string')
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') {
    errors.push('note must be a string')
  }
  return errors
}

async function declareSkill({ actor, input, ipAddress, userAgent }) {
  const errors = validateDeclareInput(input)
  if (errors.length > 0) return { ok: false, status: 400, error: errors.join('; ') }

  const skillResult = await db.query(`SELECT id, name FROM skills WHERE id = $1 AND tenant_id = $2`, [input.skill_id, actor.tenantId])
  if (skillResult.rows.length === 0) return { ok: false, status: 400, error: 'skill_id does not exist for this tenant' }

  const levelResult = await db.query(`SELECT id, name FROM proficiency_levels WHERE id = $1 AND tenant_id = $2`, [input.current_level_id, actor.tenantId])
  if (levelResult.rows.length === 0) return { ok: false, status: 400, error: 'current_level_id does not exist for this tenant' }

  const id = randomUUID()
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const insertResult = await client.query(
      `INSERT INTO user_skill_records (id, tenant_id, user_id, skill_id, current_level_id, status, source, evidence_url, validation_note)
       VALUES ($1,$2,$3,$4,$5,'self_declared','self_declared',$6,$7)
       RETURNING *`,
      [id, actor.tenantId, actor.id, input.skill_id, input.current_level_id, input.evidence_url || null, input.note || null]
    )
    const record = insertResult.rows[0]

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.SKILL_DECLARED,
      entityType: 'UserSkillRecord',
      entityId: record.id,
      newValue: serializeSkillRecord(record),
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    const profileResult = await client.query(
      `SELECT manager_id, first_name, last_name, preferred_name FROM user_profiles WHERE user_id = $1`,
      [actor.id]
    )
    const managerId = profileResult.rows[0]?.manager_id
    if (managerId) {
      await notificationService.notify({
        tenantId: actor.tenantId,
        userId: managerId,
        eventType: 'skill.declared',
        data: {
          user_name: formatName(profileResult.rows[0]) || '',
          skill_name: skillResult.rows[0].name,
          level_name: levelResult.rows[0].name
        },
        metadata: { userSkillRecordId: record.id, skillId: input.skill_id, declaredBy: actor.id },
        client
      })
    }

    await client.query('COMMIT')
    return { ok: true, status: 201, record: serializeSkillRecord(record) }
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return { ok: false, status: 409, error: 'This skill has already been declared' }
    if (err.code === '23503') return { ok: false, status: 400, error: 'Referenced skill, level, or user does not exist' }
    if (err.code === '23514') return { ok: false, status: 400, error: 'Invalid field value' }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// PUT /skills/:skillId/validate
// ---------------------------------------------------------------------------

async function validateSkill({ actor, recordId, input, ipAddress, userAgent }) {
  if (!VALIDATION_DECISIONS.includes(input.decision)) {
    return { ok: false, status: 400, error: `decision must be one of: ${VALIDATION_DECISIONS.join(', ')}` }
  }
  if (input.decision === 'approved' && !input.validated_level_id) {
    return { ok: false, status: 400, error: 'validated_level_id is required when decision is "approved"' }
  }

  const recordResult = await db.query(
    `SELECT usr.*, up.manager_id, s.name AS skill_name
     FROM user_skill_records usr
     JOIN user_profiles up ON up.user_id = usr.user_id
     JOIN skills s ON s.id = usr.skill_id
     WHERE usr.id = $1 AND usr.tenant_id = $2`,
    [recordId, actor.tenantId]
  )
  if (recordResult.rows.length === 0) return { ok: false, status: 404, error: 'Skill record not found' }
  const record = recordResult.rows[0]

  // Rule 7 — reporting_manager may only validate their direct reports.
  // competency_leader "practice members" resolution is deferred to Release 3
  // (migration 019), so for now a competency_leader may validate any record
  // in their tenant.
  if (actor.activeRole === 'reporting_manager' && record.manager_id !== actor.id) {
    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.ACCESS_VIOLATION,
      entityType: 'UserSkillRecord',
      entityId: recordId,
      ipAddress,
      userAgent,
      result: 'failure',
      metadata: { action: 'skills.validation.approve' }
    })
    return { ok: false, status: 403, error: 'Forbidden' }
  }

  let validatedLevel = null
  if (input.decision === 'approved') {
    const levelResult = await db.query(`SELECT id, name FROM proficiency_levels WHERE id = $1 AND tenant_id = $2`, [input.validated_level_id, actor.tenantId])
    if (levelResult.rows.length === 0) return { ok: false, status: 400, error: 'validated_level_id does not exist for this tenant' }
    validatedLevel = levelResult.rows[0]
  }

  const newStatus = input.decision === 'approved' ? 'validated' : 'rejected'

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const updateResult = await client.query(
      `UPDATE user_skill_records
       SET status = $1,
           current_level_id = COALESCE($2, current_level_id),
           validation_note = $3,
           validated_at = NOW(),
           validated_by = $4,
           updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6
       RETURNING *`,
      [newStatus, input.decision === 'approved' ? input.validated_level_id : null, input.note || null, actor.id, recordId, actor.tenantId]
    )
    const updated = updateResult.rows[0]

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: input.decision === 'approved' ? AuditActions.SKILL_VALIDATED : AuditActions.SKILL_REJECTED,
      entityType: 'UserSkillRecord',
      entityId: recordId,
      oldValue: serializeSkillRecord(record),
      newValue: serializeSkillRecord(updated),
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await notificationService.notify({
      tenantId: actor.tenantId,
      userId: record.user_id,
      eventType: input.decision === 'approved' ? 'skill.validated' : 'skill.rejected',
      data: {
        skill_name: record.skill_name,
        level_name: validatedLevel?.name || '',
        note: input.note || ''
      },
      metadata: { userSkillRecordId: recordId, validatedBy: actor.id },
      client
    })

    await client.query('COMMIT')
    return { ok: true, status: 200, record: serializeSkillRecord(updated) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /skills/gap-analysis & GET /skills/recommendations
// ---------------------------------------------------------------------------

const GAP_ANALYSIS_SELECT = `
  SELECT rsr.skill_id, s.name AS skill_name,
         req.id AS required_level_id, req.name AS required_level_name, req.level_order AS required_level_order,
         cur.name AS current_level_name,
         (req.level_order - COALESCE(cur.level_order, 0)) AS gap_levels
  FROM role_skill_requirements rsr
  JOIN skills s ON s.id = rsr.skill_id
  JOIN proficiency_levels req ON req.id = rsr.required_level_id
  LEFT JOIN user_skill_records usr ON usr.tenant_id = rsr.tenant_id AND usr.user_id = $2 AND usr.skill_id = rsr.skill_id
  LEFT JOIN proficiency_levels cur ON cur.id = usr.current_level_id
  WHERE rsr.tenant_id = $1 AND rsr.role_name = $3
  ORDER BY gap_levels DESC, s.name ASC
`

/** Shared by getGapAnalysis and getRecommendations — gaps are pre-sorted biggest-first (Rule 1: thresholds come from role_skill_requirements, not hardcoded). */
async function computeGapAnalysis({ actor }) {
  const profileResult = await db.query(`SELECT designation FROM user_profiles WHERE user_id = $1`, [actor.id])
  const targetRole = profileResult.rows[0]?.designation || null
  if (!targetRole) return { targetRole: null, requirements: [] }

  const result = await db.query(GAP_ANALYSIS_SELECT, [actor.tenantId, actor.id, targetRole])

  const requirements = result.rows.map((row) => ({
    skillId: row.skill_id,
    skillName: row.skill_name,
    currentLevelName: row.current_level_name,
    requiredLevelId: row.required_level_id,
    requiredLevelName: row.required_level_name,
    gapLevels: Number(row.gap_levels)
  }))

  return { targetRole, requirements }
}

const RECOMMENDED_ASSETS_SELECT = `
  SELECT la.id, la.title, la.content_type, la.duration_minutes,
         CASE WHEN la.proficiency_level_id = $3 THEN 0 ELSE 1 END AS proficiency_match
  FROM learning_assets la
  JOIN learning_asset_skills las ON las.asset_id = la.id
  WHERE la.tenant_id = $1 AND la.status = 'published' AND las.skill_id = $2
  ORDER BY proficiency_match ASC, la.created_at DESC
`

async function getGapAnalysis({ actor }) {
  const { targetRole, requirements } = await computeGapAnalysis({ actor })
  if (!targetRole) return { target_role: null, readiness_pct: 100, gaps: [], met: [] }

  const gaps = []
  const met = []

  for (const req of requirements) {
    if (req.gapLevels > 0) {
      const contentResult = await db.query(
        `${RECOMMENDED_ASSETS_SELECT} LIMIT $4`,
        [actor.tenantId, req.skillId, req.requiredLevelId, RECOMMENDED_CONTENT_LIMIT]
      )
      gaps.push({
        skill_name: req.skillName,
        current_level: req.currentLevelName || null,
        required_level: req.requiredLevelName,
        gap_levels: req.gapLevels,
        recommended_content: contentResult.rows.map((r) => ({
          id: r.id, title: r.title, content_type: r.content_type, duration_minutes: r.duration_minutes
        }))
      })
    } else {
      met.push({
        skill_name: req.skillName,
        current_level: req.currentLevelName || null,
        required_level: req.requiredLevelName
      })
    }
  }

  const total = requirements.length
  const readinessPct = total === 0 ? 100 : Math.round((met.length / total) * 100)

  return { target_role: targetRole, readiness_pct: readinessPct, gaps, met }
}

const ASSET_SKILLS_SELECT = `
  SELECT s.name
  FROM learning_asset_skills las
  JOIN skills s ON s.id = las.skill_id
  WHERE las.asset_id = $1
  ORDER BY s.name
`

async function getRecommendations({ actor }) {
  const { targetRole, requirements } = await computeGapAnalysis({ actor })
  if (!targetRole) return []

  const gaps = requirements.filter((r) => r.gapLevels > 0)
  if (gaps.length === 0) return []

  const recommendations = []
  const seenAssetIds = new Set()

  for (const gap of gaps) {
    if (recommendations.length >= RECOMMENDATIONS_LIMIT) break

    const assetsResult = await db.query(RECOMMENDED_ASSETS_SELECT, [actor.tenantId, gap.skillId, gap.requiredLevelId])

    for (const asset of assetsResult.rows) {
      if (recommendations.length >= RECOMMENDATIONS_LIMIT) break
      if (seenAssetIds.has(asset.id)) continue
      seenAssetIds.add(asset.id)

      const skillsResult = await db.query(ASSET_SKILLS_SELECT, [asset.id])

      recommendations.push({
        asset_id: asset.id,
        title: asset.title,
        content_type: asset.content_type,
        duration_minutes: asset.duration_minutes,
        skills: skillsResult.rows.map((r) => r.name),
        reason: `Closes gap in ${gap.skillName}`
      })
    }
  }

  return recommendations
}

// ---------------------------------------------------------------------------
// GET /skills/all
// ---------------------------------------------------------------------------

const ALL_SKILLS_SELECT = `
  SELECT cc.name AS category_name, s.id, s.name
  FROM skills s
  LEFT JOIN competency_categories cc ON cc.id = s.category_id
  WHERE s.tenant_id = $1 AND s.status = 'active'
  ORDER BY cc.name ASC NULLS LAST, s.name ASC
`

async function getAllSkillsGrouped({ actor }) {
  const result = await db.query(ALL_SKILLS_SELECT, [actor.tenantId])

  const groups = []
  const groupByCategory = new Map()

  for (const row of result.rows) {
    const categoryName = row.category_name || 'Uncategorized'
    let group = groupByCategory.get(categoryName)
    if (!group) {
      group = { category_name: categoryName, skills: [] }
      groupByCategory.set(categoryName, group)
      groups.push(group)
    }
    group.skills.push({ id: row.id, name: row.name })
  }

  return groups
}

module.exports = {
  getInventory,
  declareSkill,
  validateSkill,
  getGapAnalysis,
  getRecommendations,
  getAllSkillsGrouped,
  // exported for tests / reuse
  serializeSkillRecord,
  computeGapAnalysis
}
