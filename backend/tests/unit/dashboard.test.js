// tests/unit/dashboard.test.js
//
// Unit tests for src/modules/dashboard/dashboardService.js and the RBAC
// wiring in src/modules/dashboard/dashboardRoutes.js.
//
// Pattern (matches tests/unit/progress.test.js / assignments.test.js): mock
// db and configService so we can assert exactly what each dashboard returns
// and how config-driven thresholds (Rule 1) shape blockers/interventions.
// permissionEngine is NOT mocked — its real hasPermission/getVisibilityScope
// run against the mocked db.query.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('../../src/modules/config/configService', () => ({
  get: jest.fn()
}))
jest.mock('../../src/middleware/authenticate', () => ({
  authenticate: (req, res, next) => {
    req.user = {
      id: 'user-1',
      tenantId: 'tenant-1',
      email: 'test@example.com',
      userType: 'internal',
      roles: [req.headers['x-test-role']],
      orgUnitId: 'ou-1',
      activeRoleId: `role-${req.headers['x-test-role']}`,
      activeRole: req.headers['x-test-role']
    }
    next()
  }
}))

const db = require('../../src/db')
const configService = require('../../src/modules/config/configService')
const dashboardService = require('../../src/modules/dashboard/dashboardService')

const associate = { id: 'user-1', tenantId: 'tenant-1', roles: ['associate'], activeRole: 'associate', activeRoleId: 'role-associate' }
const reportingManager = { id: 'mgr-1', tenantId: 'tenant-1', roles: ['reporting_manager'], activeRole: 'reporting_manager', activeRoleId: 'role-rm' }
const ldAdmin = { id: 'admin-1', tenantId: 'tenant-1', roles: ['ld_admin'], activeRole: 'ld_admin', activeRoleId: 'role-ld' }

const THRESHOLDS = { due_soon_days: 3, overdue_urgency_days: { medium: 3, high: 7 } }

/** YYYY-MM-DD string `daysAgo` days before today (UTC) — keeps streak tests independent of the run date. */
function isoDate(daysAgo) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// computeStreakDays (pure)
// ---------------------------------------------------------------------------

describe('computeStreakDays', () => {
  const today = new Date('2026-06-11T15:00:00Z')

  it('returns 0 for no activity', () => {
    expect(dashboardService.computeStreakDays([], today)).toBe(0)
  })

  it('returns 1 when the only activity was today', () => {
    expect(dashboardService.computeStreakDays(['2026-06-11'], today)).toBe(1)
  })

  it('still counts the streak when the most recent activity was yesterday', () => {
    expect(dashboardService.computeStreakDays(['2026-06-10'], today)).toBe(1)
  })

  it('counts consecutive days ending today', () => {
    expect(dashboardService.computeStreakDays(['2026-06-11', '2026-06-10', '2026-06-09'], today)).toBe(3)
  })

  it('stops at the first gap', () => {
    expect(dashboardService.computeStreakDays(['2026-06-11', '2026-06-09'], today)).toBe(1)
  })

  it('returns 0 when the most recent activity is more than a day old (streak broken)', () => {
    expect(dashboardService.computeStreakDays(['2026-06-08'], today)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// classifyUrgency / getThresholds (Rule 1 — config-driven thresholds)
// ---------------------------------------------------------------------------

describe('classifyUrgency', () => {
  it('classifies low/medium/high based on configured day bands', () => {
    expect(dashboardService.classifyUrgency(1, THRESHOLDS)).toBe('low')
    expect(dashboardService.classifyUrgency(3, THRESHOLDS)).toBe('medium')
    expect(dashboardService.classifyUrgency(7, THRESHOLDS)).toBe('high')
    expect(dashboardService.classifyUrgency(10, THRESHOLDS)).toBe('high')
  })
})

describe('getThresholds', () => {
  it('falls back to defaults when configurations.dashboard.thresholds is not set', async () => {
    configService.get.mockResolvedValueOnce(null)

    const thresholds = await dashboardService.getThresholds('tenant-1')

    expect(thresholds).toEqual(THRESHOLDS)
  })

  it('merges configured values over the defaults', async () => {
    configService.get.mockResolvedValueOnce({ due_soon_days: 5 })

    const thresholds = await dashboardService.getThresholds('tenant-1')

    expect(thresholds).toEqual({ due_soon_days: 5, overdue_urgency_days: { medium: 3, high: 7 } })
  })
})

// ---------------------------------------------------------------------------
// getAssociateDashboard
// ---------------------------------------------------------------------------

describe('getAssociateDashboard', () => {
  it('builds greeting, blockers, next actions, kpis and stubs unimplemented sections', async () => {
    configService.get.mockResolvedValueOnce(null) // thresholds -> defaults

    db.query
      .mockResolvedValueOnce({ rows: [{ first_name: 'Asha', last_name: 'Rao', preferred_name: null }] }) // profile
      .mockResolvedValueOnce({ rows: [{ activity_date: isoDate(0) }] }) // progress activity -> streak of 1
      .mockResolvedValueOnce({
        rows: [
          // overdue mandatory video -> blocker, urgency 'medium' (5 days overdue)
          { due_date: '2026-06-01', is_mandatory: true, is_overdue: true, days_until_due: -5, days_overdue: 5, title: 'Security Basics', asset_id: 'asset-1', content_type: 'video', duration_minutes: 30 },
          // due in 2 days -> counts toward assignments_due_soon
          { due_date: '2026-06-13', is_mandatory: true, is_overdue: false, days_until_due: 2, days_overdue: null, title: 'Read the Handbook', asset_id: 'asset-2', content_type: 'pdf', duration_minutes: 15 },
          // optional path assignment, far in the future
          { due_date: '2026-07-01', is_mandatory: false, is_overdue: false, days_until_due: 20, days_overdue: null, title: 'Cloud Fundamentals Path', asset_id: null, content_type: null, duration_minutes: 120 }
        ]
      }) // assignments
      .mockResolvedValueOnce({ rows: [{ asset_id: 'asset-9', completed_at: '2026-06-09T10:00:00Z', title: 'Intro to Kubernetes' }] }) // completions

    const result = await dashboardService.getAssociateDashboard({ actor: associate })

    expect(result.greeting).toEqual({ name: 'Asha Rao', streak_days: 1 })

    // Release 2/3 sections — stubbed until SkillRecord/CareerAspiration/Certification exist
    expect(result.promotion_readiness).toEqual({ target_role: null, readiness_pct: null, blocking_items: [] })
    expect(result.competency_progress).toEqual([])
    expect(result.kpis.skills_validated).toBe(0)
    expect(result.kpis.skills_total).toBe(0)
    expect(result.kpis.certifications_active).toBe(0)

    expect(result.kpis.blocking_count).toBe(1)
    expect(result.kpis.assignments_due_soon).toBe(1)

    expect(result.blockers).toEqual([
      { type: 'overdue_assignment', description: '"Security Basics" is overdue', urgency: 'medium' }
    ])

    expect(result.next_actions).toEqual([
      { title: 'Security Basics', type: 'video', duration_minutes: 30, closes_blocker: true, asset_id: 'asset-1' },
      { title: 'Read the Handbook', type: 'pdf', duration_minutes: 15, closes_blocker: false, asset_id: 'asset-2' },
      { title: 'Cloud Fundamentals Path', type: 'path', duration_minutes: 120, closes_blocker: false, asset_id: null }
    ])

    expect(result.recent_completions).toEqual([
      { title: 'Intro to Kubernetes', completed_at: '2026-06-09T10:00:00Z', asset_id: 'asset-9' }
    ])

    // Rule 3/7 — scoped to this user only
    expect(db.query).toHaveBeenNthCalledWith(3,
      expect.stringContaining('WHERE a.tenant_id = $1 AND a.assigned_to = $2'),
      ['tenant-1', 'user-1']
    )
  })

  it('returns zeroed-out kpis and empty lists when there is no activity, no assignments, and no completions', async () => {
    configService.get.mockResolvedValueOnce(null)

    db.query
      .mockResolvedValueOnce({ rows: [{ first_name: 'Ben', last_name: 'Lee', preferred_name: null }] }) // profile
      .mockResolvedValueOnce({ rows: [] }) // activity
      .mockResolvedValueOnce({ rows: [] }) // assignments
      .mockResolvedValueOnce({ rows: [] }) // completions

    const result = await dashboardService.getAssociateDashboard({ actor: associate })

    expect(result.greeting).toEqual({ name: 'Ben Lee', streak_days: 0 })
    expect(result.kpis).toEqual({ skills_validated: 0, skills_total: 0, blocking_count: 0, assignments_due_soon: 0, certifications_active: 0 })
    expect(result.blockers).toEqual([])
    expect(result.next_actions).toEqual([])
    expect(result.recent_completions).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getTeamDashboard
// ---------------------------------------------------------------------------

describe('getTeamDashboard', () => {
  it('returns an empty dashboard when the manager has no direct reports', async () => {
    configService.get.mockResolvedValueOnce(null)
    db.query.mockResolvedValueOnce({ rows: [] }) // direct reports

    const result = await dashboardService.getTeamDashboard({ actor: reportingManager })

    expect(result).toEqual({
      summary: { team_readiness_pct: null, at_risk_count: 0, promotion_ready_count: 0, overdue_count: 0, pending_validations_count: 0 },
      interventions: [],
      promotion_pipeline: [],
      skill_heatmap: []
    })
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('flags direct reports with overdue mandatory assignments as interventions', async () => {
    configService.get.mockResolvedValueOnce(null)

    db.query
      .mockResolvedValueOnce({
        rows: [
          { id: 'user-2', first_name: 'Asha', last_name: 'Rao', preferred_name: null },
          { id: 'user-3', first_name: 'Ben', last_name: 'Lee', preferred_name: null }
        ]
      }) // direct reports
      .mockResolvedValueOnce({
        rows: [
          { assigned_to: 'user-2', is_mandatory: true, days_overdue: 8 },
          { assigned_to: 'user-2', is_mandatory: true, days_overdue: 2 },
          { assigned_to: 'user-3', is_mandatory: false, days_overdue: 1 }
        ]
      }) // overdue assignments across the team

    const result = await dashboardService.getTeamDashboard({ actor: reportingManager })

    expect(result.summary).toEqual({
      team_readiness_pct: null,
      at_risk_count: 1,        // only user-2 has a mandatory overdue assignment
      promotion_ready_count: 0,
      overdue_count: 3,        // all overdue assignments, mandatory or not
      pending_validations_count: 0
    })

    expect(result.interventions).toEqual([
      { user_id: 'user-2', name: 'Asha Rao', type: 'overdue_assignments', description: '2 overdue mandatory assignments', action: 'send_reminder', urgency: 'high' }
    ])

    expect(result.promotion_pipeline).toEqual([])
    expect(result.skill_heatmap).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getAdminDashboard
// ---------------------------------------------------------------------------

describe('getAdminDashboard', () => {
  it('aggregates platform stats, completion rate, popular content and recent activity', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 50, active: 45 }] }) // users
      .mockResolvedValueOnce({ rows: [{ total: 20, published: 15 }] }) // content
      .mockResolvedValueOnce({ rows: [{ total: 100, completed: 60, overdue: 10 }] }) // assignment stats
      .mockResolvedValueOnce({
        rows: [
          { asset_id: 'asset-1', title: 'Intro to Kubernetes', completions: 30 },
          { asset_id: 'asset-2', title: 'Networking Basics', completions: 20 }
        ]
      }) // popular content
      .mockResolvedValueOnce({
        rows: [
          { action_type: 'ASSIGNMENT_CREATED', created_at: '2026-06-11T09:00:00Z', first_name: 'Cara', last_name: 'Singh', preferred_name: null },
          { action_type: 'USER_CREATED', created_at: '2026-06-11T08:00:00Z', first_name: null, last_name: null, preferred_name: null }
        ]
      }) // recent activity

    const result = await dashboardService.getAdminDashboard({ actor: ldAdmin })

    expect(result.platform_stats).toEqual({ total_users: 50, active_users: 45, total_content: 20, published_content: 15 })
    expect(result.completion_rate).toBe(60)
    expect(result.overdue_assignments).toBe(10)
    expect(result.popular_content).toEqual([
      { title: 'Intro to Kubernetes', completions: 30, asset_id: 'asset-1' },
      { title: 'Networking Basics', completions: 20, asset_id: 'asset-2' }
    ])
    expect(result.recent_activity).toEqual([
      { event: 'ASSIGNMENT_CREATED', user: 'Cara Singh', timestamp: '2026-06-11T09:00:00Z' },
      { event: 'USER_CREATED', user: 'System', timestamp: '2026-06-11T08:00:00Z' }
    ])
  })

  it('reports a 0% completion rate when the tenant has no assignments yet', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 5, active: 5 }] })
      .mockResolvedValueOnce({ rows: [{ total: 0, published: 0 }] })
      .mockResolvedValueOnce({ rows: [{ total: 0, completed: 0, overdue: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await dashboardService.getAdminDashboard({ actor: ldAdmin })

    expect(result.completion_rate).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — Rule 10: at least one allowed role succeeds, one denied
// role gets a 403 + ACCESS_VIOLATION
// ---------------------------------------------------------------------------

describe('dashboard routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const dashboardRoutes = require('../../src/modules/dashboard/dashboardRoutes')

  const app = express()
  app.use(express.json())
  app.use(dashboardRoutes)

  describe('GET /dashboard/me', () => {
    it('allows associate to view their own dashboard (200)', async () => {
      configService.get.mockResolvedValueOnce(null)

      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, dashboard, me)
        .mockResolvedValueOnce({ rows: [{ first_name: 'Asha', last_name: 'Rao', preferred_name: null }] }) // profile
        .mockResolvedValueOnce({ rows: [] }) // activity
        .mockResolvedValueOnce({ rows: [] }) // assignments
        .mockResolvedValueOnce({ rows: [] }) // completions

      const res = await request(app)
        .get('/dashboard/me')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body.greeting).toEqual({ name: 'Asha Rao', streak_days: 0 })
      expect(res.body.promotion_readiness).toEqual({ target_role: null, readiness_pct: null, blocking_items: [] })
    })

    it('denies a role without dashboard.me.view (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .get('/dashboard/me')
        .set('x-test-role', 'external')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('GET /dashboard/team', () => {
    it('allows reporting_manager to view their team dashboard (200)', async () => {
      configService.get.mockResolvedValueOnce(null)

      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, dashboard, team)
        .mockResolvedValueOnce({ rows: [{ org_unit_id: 'ou-1' }] }) // getVisibilityScope: direct reports' org units
        .mockResolvedValueOnce({ rows: [{ org_unit_id: 'ou-1' }] }) // getVisibilityScope: own profile
        .mockResolvedValueOnce({ rows: [] }) // direct reports -> none

      const res = await request(app)
        .get('/dashboard/team')
        .set('x-test-role', 'reporting_manager')

      expect(res.status).toBe(200)
      expect(res.body.summary).toEqual({ team_readiness_pct: null, at_risk_count: 0, promotion_ready_count: 0, overdue_count: 0, pending_validations_count: 0 })
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .get('/dashboard/team')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('GET /dashboard/admin', () => {
    it('allows ld_admin to view the platform dashboard (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, dashboard, admin)
        .mockResolvedValueOnce({ rows: [{ total: 1, active: 1 }] }) // users
        .mockResolvedValueOnce({ rows: [{ total: 0, published: 0 }] }) // content
        .mockResolvedValueOnce({ rows: [{ total: 0, completed: 0, overdue: 0 }] }) // assignment stats
        .mockResolvedValueOnce({ rows: [] }) // popular content
        .mockResolvedValueOnce({ rows: [] }) // recent activity

      const res = await request(app)
        .get('/dashboard/admin')
        .set('x-test-role', 'ld_admin')

      expect(res.status).toBe(200)
      expect(res.body.platform_stats).toEqual({ total_users: 1, active_users: 1, total_content: 0, published_content: 0 })
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .get('/dashboard/admin')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })
})
