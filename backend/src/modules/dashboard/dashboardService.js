// src/modules/dashboard/dashboardService.js
//
// Business logic behind /dashboard/me, /dashboard/team, /dashboard/admin.
// Every function takes an `actor` ({ id, tenantId, roles, activeRole,
// activeRoleId }) and enforces:
//  - Rule 3: every query is scoped by tenant_id
//  - Rule 7: /dashboard/me is additionally scoped to user_id = actor.id
//    ("own records only" — every role's personal dashboard); /dashboard/team
//    is restricted to the caller's direct reports (user_profiles.manager_id),
//    the same convention as learning.assignmentService.getTeamAssignments;
//    /dashboard/admin aggregates tenant-wide (L&D admin/super_admin only,
//    enforced by dashboardRoutes' requirePermission)
//  - Rule 1: the "due soon" window and overdue urgency bands come from
//    configurations.dashboard.thresholds (migration 019), never hardcoded
//    thresholds in this file
//
// Response keys are snake_case to match the dashboard API contract — unlike
// the camelCase serializers elsewhere in this codebase.
//
// promotion_readiness, kpis.skills_validated/skills_total/certifications_active,
// competency_progress, promotion_pipeline, and skill_heatmap depend on
// entities that don't exist yet (SkillRecord/ValidationStatus — Release 2;
// CareerAspiration/RoleRequirement/ReadinessScore/Certification — Release 3).
// They are returned as empty/zero placeholders until that schema lands —
// do not build ahead of the current release.

const db = require('../../db')
const configService = require('../config/configService')

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const DEFAULT_THRESHOLDS = {
  due_soon_days: 3,
  overdue_urgency_days: { medium: 3, high: 7 }
}

const NEXT_ACTIONS_LIMIT = 5
const RECENT_COMPLETIONS_LIMIT = 5
const POPULAR_CONTENT_LIMIT = 5
const RECENT_ACTIVITY_LIMIT = 10

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Rule 1 — "due soon" window and overdue urgency bands from configurations.dashboard.thresholds. */
async function getThresholds(tenantId) {
  const configured = await configService.get(tenantId, 'dashboard', 'thresholds')
  return {
    due_soon_days: configured?.due_soon_days ?? DEFAULT_THRESHOLDS.due_soon_days,
    overdue_urgency_days: {
      ...DEFAULT_THRESHOLDS.overdue_urgency_days,
      ...(configured?.overdue_urgency_days || {})
    }
  }
}

function classifyUrgency(daysOverdue, thresholds) {
  if (daysOverdue >= thresholds.overdue_urgency_days.high) return 'high'
  if (daysOverdue >= thresholds.overdue_urgency_days.medium) return 'medium'
  return 'low'
}

function formatName(row) {
  if (!row) return null
  if (row.preferred_name) return row.preferred_name
  if (!row.first_name && !row.last_name) return null
  return `${row.first_name || ''} ${row.last_name || ''}`.trim()
}

function toUtcMidnight(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`).getTime()
}

/**
 * Current consecutive-day learning-activity streak ending today or
 * yesterday. Returns 0 once the most recent activity is more than a day old
 * (the streak is broken).
 */
function computeStreakDays(activityDates, referenceDate = new Date()) {
  if (!activityDates || activityDates.length === 0) return 0

  const todayMs = toUtcMidnight(referenceDate.toISOString().slice(0, 10))
  const dates = [...new Set(activityDates)].map(toUtcMidnight).sort((a, b) => b - a)

  if (Math.round((todayMs - dates[0]) / ONE_DAY_MS) > 1) return 0

  let streak = 1
  for (let i = 1; i < dates.length; i++) {
    const gapDays = Math.round((dates[i - 1] - dates[i]) / ONE_DAY_MS)
    if (gapDays !== 1) break
    streak++
  }
  return streak
}

// ---------------------------------------------------------------------------
// GET /dashboard/me
// ---------------------------------------------------------------------------

const ASSIGNMENTS_SELECT = `
  SELECT a.due_date, a.is_mandatory,
         (a.due_date IS NOT NULL AND a.due_date < CURRENT_DATE) AS is_overdue,
         (a.due_date - CURRENT_DATE) AS days_until_due,
         (CURRENT_DATE - a.due_date) AS days_overdue,
         COALESCE(la.title, lp.title) AS title,
         la.id AS asset_id, la.content_type,
         COALESCE(la.duration_minutes, path_duration.total_minutes) AS duration_minutes
  FROM assignments a
  LEFT JOIN learning_assets la ON la.id = a.asset_id
  LEFT JOIN learning_paths lp ON lp.id = a.path_id
  LEFT JOIN LATERAL (
    SELECT SUM(la2.duration_minutes)::int AS total_minutes
    FROM learning_path_items lpi
    JOIN learning_assets la2 ON la2.id = lpi.asset_id
    WHERE lpi.path_id = a.path_id AND lpi.is_mandatory = TRUE
  ) path_duration ON a.path_id IS NOT NULL
`

async function getAssociateDashboard({ actor }) {
  const thresholds = await getThresholds(actor.tenantId)

  const [profileResult, activityResult, assignmentsResult, completionsResult] = await Promise.all([
    db.query(`SELECT first_name, last_name, preferred_name FROM user_profiles WHERE user_id = $1`, [actor.id]),
    db.query(
      `SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date::text AS activity_date
       FROM progress_events WHERE tenant_id = $1 AND user_id = $2`,
      [actor.tenantId, actor.id]
    ),
    db.query(
      `${ASSIGNMENTS_SELECT}
       WHERE a.tenant_id = $1 AND a.assigned_to = $2 AND a.status != 'completed'
       ORDER BY a.due_date ASC NULLS LAST, a.created_at DESC`,
      [actor.tenantId, actor.id]
    ),
    db.query(
      `SELECT cr.asset_id, cr.completed_at, la.title
       FROM completion_records cr
       JOIN learning_assets la ON la.id = cr.asset_id
       WHERE cr.tenant_id = $1 AND cr.user_id = $2
       ORDER BY cr.completed_at DESC
       LIMIT $3`,
      [actor.tenantId, actor.id, RECENT_COMPLETIONS_LIMIT]
    )
  ])

  const assignments = assignmentsResult.rows

  const blockers = assignments
    .filter((a) => a.is_overdue && a.is_mandatory)
    .map((a) => ({
      type: 'overdue_assignment',
      description: `"${a.title}" is overdue`,
      urgency: classifyUrgency(Number(a.days_overdue), thresholds)
    }))

  const assignmentsDueSoon = assignments.filter((a) =>
    a.due_date != null && Number(a.days_until_due) >= 0 && Number(a.days_until_due) <= thresholds.due_soon_days
  ).length

  const nextActions = assignments.slice(0, NEXT_ACTIONS_LIMIT).map((a) => ({
    title: a.title,
    type: a.content_type || 'path',
    duration_minutes: a.duration_minutes,
    closes_blocker: a.is_overdue && a.is_mandatory,
    asset_id: a.asset_id
  }))

  return {
    greeting: {
      name: formatName(profileResult.rows[0]),
      streak_days: computeStreakDays(activityResult.rows.map((r) => r.activity_date))
    },
    promotion_readiness: {
      target_role: null,
      readiness_pct: null,
      blocking_items: []
    },
    kpis: {
      skills_validated: 0,
      skills_total: 0,
      blocking_count: blockers.length,
      assignments_due_soon: assignmentsDueSoon,
      certifications_active: 0
    },
    blockers,
    next_actions: nextActions,
    competency_progress: [],
    recent_completions: completionsResult.rows.map((r) => ({
      title: r.title,
      completed_at: r.completed_at,
      asset_id: r.asset_id
    }))
  }
}

// ---------------------------------------------------------------------------
// GET /dashboard/team
// ---------------------------------------------------------------------------

async function getTeamDashboard({ actor }) {
  const thresholds = await getThresholds(actor.tenantId)

  const reportsResult = await db.query(
    `SELECT u.id, up.first_name, up.last_name, up.preferred_name
     FROM users u
     JOIN user_profiles up ON up.user_id = u.id
     WHERE up.manager_id = $1 AND u.tenant_id = $2 AND u.status = 'active'`,
    [actor.id, actor.tenantId]
  )

  const empty = {
    summary: { team_readiness_pct: null, at_risk_count: 0, promotion_ready_count: 0, overdue_count: 0, pending_validations_count: 0 },
    interventions: [],
    promotion_pipeline: [],
    skill_heatmap: []
  }

  if (reportsResult.rows.length === 0) return empty

  const reportIds = reportsResult.rows.map((r) => r.id)
  const namesById = new Map(reportsResult.rows.map((r) => [r.id, formatName(r)]))

  const overdueResult = await db.query(
    `SELECT assigned_to, is_mandatory, (CURRENT_DATE - due_date) AS days_overdue
     FROM assignments
     WHERE tenant_id = $1 AND assigned_to = ANY($2)
       AND status != 'completed' AND due_date IS NOT NULL AND due_date < CURRENT_DATE`,
    [actor.tenantId, reportIds]
  )

  const mandatoryByUser = new Map()
  for (const row of overdueResult.rows) {
    if (!row.is_mandatory) continue
    const entry = mandatoryByUser.get(row.assigned_to) || { count: 0, maxDaysOverdue: 0 }
    entry.count += 1
    entry.maxDaysOverdue = Math.max(entry.maxDaysOverdue, Number(row.days_overdue))
    mandatoryByUser.set(row.assigned_to, entry)
  }

  const interventions = [...mandatoryByUser.entries()].map(([userId, { count, maxDaysOverdue }]) => ({
    user_id: userId,
    name: namesById.get(userId) || null,
    type: 'overdue_assignments',
    description: `${count} overdue mandatory assignment${count === 1 ? '' : 's'}`,
    action: 'send_reminder',
    urgency: classifyUrgency(maxDaysOverdue, thresholds)
  }))

  return {
    summary: {
      team_readiness_pct: null,
      at_risk_count: mandatoryByUser.size,
      promotion_ready_count: 0,
      overdue_count: overdueResult.rows.length,
      pending_validations_count: 0
    },
    interventions,
    promotion_pipeline: [],
    skill_heatmap: []
  }
}

// ---------------------------------------------------------------------------
// GET /dashboard/admin
// ---------------------------------------------------------------------------

async function getAdminDashboard({ actor }) {
  const [usersResult, contentResult, assignmentStatsResult, popularResult, activityResult] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'active')::int AS active
       FROM users WHERE tenant_id = $1`,
      [actor.tenantId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'published')::int AS published
       FROM learning_assets WHERE tenant_id = $1`,
      [actor.tenantId]
    ),
    db.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE AND status != 'completed')::int AS overdue
       FROM assignments WHERE tenant_id = $1`,
      [actor.tenantId]
    ),
    db.query(
      `SELECT cr.asset_id, la.title, COUNT(*)::int AS completions
       FROM completion_records cr
       JOIN learning_assets la ON la.id = cr.asset_id
       WHERE cr.tenant_id = $1
       GROUP BY cr.asset_id, la.title
       ORDER BY completions DESC, la.title ASC
       LIMIT $2`,
      [actor.tenantId, POPULAR_CONTENT_LIMIT]
    ),
    db.query(
      `SELECT ae.action_type, ae.created_at, up.first_name, up.last_name, up.preferred_name
       FROM audit_events ae
       LEFT JOIN user_profiles up ON up.user_id = ae.actor_user_id
       WHERE ae.tenant_id = $1
       ORDER BY ae.created_at DESC
       LIMIT $2`,
      [actor.tenantId, RECENT_ACTIVITY_LIMIT]
    )
  ])

  const assignmentStats = assignmentStatsResult.rows[0]
  const completionRate = assignmentStats.total > 0
    ? Math.round((assignmentStats.completed / assignmentStats.total) * 100)
    : 0

  return {
    platform_stats: {
      total_users: usersResult.rows[0].total,
      active_users: usersResult.rows[0].active,
      total_content: contentResult.rows[0].total,
      published_content: contentResult.rows[0].published
    },
    completion_rate: completionRate,
    overdue_assignments: assignmentStats.overdue,
    popular_content: popularResult.rows.map((r) => ({ title: r.title, completions: r.completions, asset_id: r.asset_id })),
    recent_activity: activityResult.rows.map((r) => ({
      event: r.action_type,
      user: formatName(r) || 'System',
      timestamp: r.created_at
    }))
  }
}

module.exports = {
  getAssociateDashboard,
  getTeamDashboard,
  getAdminDashboard,
  // exported for tests / reuse
  computeStreakDays,
  classifyUrgency,
  getThresholds
}
