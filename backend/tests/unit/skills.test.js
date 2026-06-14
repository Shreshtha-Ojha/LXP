// tests/unit/skills.test.js
//
// Unit tests for src/modules/skills/skillService.js and the RBAC wiring in
// src/modules/skills/skillRoutes.js.
//
// Pattern (matches tests/unit/assignments.test.js / dashboard.test.js): mock
// db, crypto.randomUUID, auditLog.write and notificationService.notify so we
// can assert exactly what state changes, audit events, and notifications
// each action produces. permissionEngine is NOT mocked for the routes block
// — its real hasPermission/getVisibilityScope run against mocked db.query.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: jest.fn()
}))
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})
jest.mock('../../src/modules/notifications/notificationService', () => ({
  notify: jest.fn()
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

const crypto = require('crypto')
const db = require('../../src/db')
const auditLog = require('../../src/modules/audit/auditLog')
const notificationService = require('../../src/modules/notifications/notificationService')
const skillService = require('../../src/modules/skills/skillService')
const { AuditActions } = auditLog

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

const associate = {
  id: 'user-2', tenantId: 'tenant-1', roles: ['associate'],
  activeRole: 'associate', activeRoleId: 'role-associate',
  visibilityScope: { type: 'own', orgUnitIds: ['ou-1'] }
}
const reportingManager = {
  id: 'mgr-1', tenantId: 'tenant-1', roles: ['reporting_manager'],
  activeRole: 'reporting_manager', activeRoleId: 'role-reporting_manager',
  visibilityScope: { type: 'team', orgUnitIds: ['ou-1', 'ou-2'] }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /skills/inventory
// ---------------------------------------------------------------------------

describe('getInventory', () => {
  it('returns the caller\'s own skills with computed gaps and summary', async () => {
    db.query
      // resolveTargetUser — targetId === actor.id, no cross-user check
      .mockResolvedValueOnce({ rows: [{ id: 'user-2', designation: 'Software Engineer', manager_id: 'mgr-1' }] })
      // INVENTORY_SELECT
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'usr-1', status: 'validated', source: 'self_declared',
            declared_at: '2026-05-01T00:00:00Z', validated_at: '2026-05-05T00:00:00Z',
            skill_name: 'Kubernetes', category: 'Cloud',
            current_level_id: 'lvl-2', current_level_name: 'Intermediate', current_level_order: 2,
            required_level_id: 'lvl-3', required_level_name: 'Advanced', required_level_order: 3
          },
          {
            id: 'usr-2', status: 'self_declared', source: 'self_declared',
            declared_at: '2026-06-01T00:00:00Z', validated_at: null,
            skill_name: 'Docker', category: 'Cloud',
            current_level_id: 'lvl-3', current_level_name: 'Advanced', current_level_order: 3,
            required_level_id: null, required_level_name: null, required_level_order: null
          }
        ]
      })

    const result = await skillService.getInventory({ actor: associate })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.skills).toEqual([
      {
        id: 'usr-1', skill_name: 'Kubernetes', category: 'Cloud',
        current_level: { id: 'lvl-2', name: 'Intermediate', level_order: 2 },
        required_level: { id: 'lvl-3', name: 'Advanced', level_order: 3 },
        status: 'validated', source: 'self_declared',
        has_gap: true, gap_levels: 1,
        declared_at: '2026-05-01T00:00:00Z', validated_at: '2026-05-05T00:00:00Z'
      },
      {
        id: 'usr-2', skill_name: 'Docker', category: 'Cloud',
        current_level: { id: 'lvl-3', name: 'Advanced', level_order: 3 },
        required_level: null,
        status: 'self_declared', source: 'self_declared',
        has_gap: false, gap_levels: 0,
        declared_at: '2026-06-01T00:00:00Z', validated_at: null
      }
    ])
    expect(result.summary).toEqual({
      total_skills: 2,
      validated: 1,
      pending: 0,
      self_declared: 1,
      skills_with_gaps: 1,
      skills_meeting_requirements: 0
    })

    // resolveTargetUser is scoped to the caller's own tenant + id
    expect(db.query).toHaveBeenNthCalledWith(1, expect.any(String), ['user-2', 'tenant-1'])
    // INVENTORY_SELECT is scoped to the caller's tenant, resolved user, and designation
    expect(db.query).toHaveBeenNthCalledWith(2, expect.any(String), ['tenant-1', 'user-2', 'Software Engineer'])
  })

  it('lets a reporting manager view a direct report\'s inventory via ?userId=', async () => {
    db.query
      // resolveTargetUser — target's manager_id matches the reporting manager
      .mockResolvedValueOnce({ rows: [{ id: 'user-2', designation: 'Software Engineer', manager_id: 'mgr-1' }] })
      // INVENTORY_SELECT
      .mockResolvedValueOnce({ rows: [] })

    const result = await skillService.getInventory({ actor: reportingManager, userId: 'user-2' })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.skills).toEqual([])
    expect(result.summary.total_skills).toBe(0)
    expect(auditLog.write).not.toHaveBeenCalled()

    expect(db.query).toHaveBeenNthCalledWith(1, expect.any(String), ['user-2', 'tenant-1'])
    expect(db.query).toHaveBeenNthCalledWith(2, expect.any(String), ['tenant-1', 'user-2', 'Software Engineer'])
  })

  it('returns 403 + ACCESS_VIOLATION when an associate requests another user\'s inventory', async () => {
    db.query
      // resolveTargetUser — target's manager is not the caller, and the
      // caller's visibilityScope is 'own'
      .mockResolvedValueOnce({ rows: [{ id: 'user-3', designation: 'Software Engineer', manager_id: 'mgr-1' }] })

    const result = await skillService.getInventory({
      actor: associate,
      userId: 'user-3',
      ipAddress: '10.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })

    // INVENTORY_SELECT must never run for a forbidden request
    expect(db.query).toHaveBeenCalledTimes(1)

    expect(auditLog.write).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      actorUserId: 'user-2',
      actionType: AuditActions.ACCESS_VIOLATION,
      entityType: 'UserSkillRecord',
      entityId: 'user-3',
      ipAddress: '10.0.0.1',
      userAgent: 'jest',
      result: 'failure',
      metadata: { action: 'skills.inventory.view', targetUserId: 'user-3' }
    }))
  })
})

// ---------------------------------------------------------------------------
// POST /skills/declare
// ---------------------------------------------------------------------------

describe('declareSkill', () => {
  it('creates a self_declared record, audits SKILL_DECLARED, and notifies the manager', async () => {
    crypto.randomUUID.mockReturnValue('usr-new-1')

    db.query
      // skill_id lookup
      .mockResolvedValueOnce({ rows: [{ id: 'skill-1', name: 'Kubernetes' }] })
      // current_level_id lookup
      .mockResolvedValueOnce({ rows: [{ id: 'lvl-2', name: 'Intermediate' }] })

    const insertedRow = {
      id: 'usr-new-1', tenant_id: 'tenant-1', user_id: 'user-2', skill_id: 'skill-1',
      current_level_id: 'lvl-2', target_level_id: null,
      status: 'self_declared', source: 'self_declared',
      evidence_url: 'https://example.com/cert.pdf', validation_note: 'Completed certification',
      declared_at: '2026-06-13T00:00:00Z', validated_at: null, validated_by: null,
      created_at: '2026-06-13T00:00:00Z', updated_at: '2026-06-13T00:00:00Z'
    }
    const client = txClient([
      {}, // BEGIN
      { rows: [insertedRow] }, // INSERT ... RETURNING *
      { rows: [{ manager_id: 'mgr-1', first_name: 'Asha', last_name: 'Rao', preferred_name: null }] }, // profileResult
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await skillService.declareSkill({
      actor: associate,
      input: { skill_id: 'skill-1', current_level_id: 'lvl-2', evidence_url: 'https://example.com/cert.pdf', note: 'Completed certification' }
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.record).toMatchObject({
      id: 'usr-new-1', userId: 'user-2', skillId: 'skill-1', currentLevelId: 'lvl-2',
      status: 'self_declared', source: 'self_declared'
    })

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-2',
        actionType: AuditActions.SKILL_DECLARED,
        entityType: 'UserSkillRecord',
        entityId: 'usr-new-1',
        newValue: skillService.serializeSkillRecord(insertedRow),
        result: 'success'
      }),
      client
    )

    expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'mgr-1',
      eventType: 'skill.declared',
      data: { user_name: 'Asha Rao', skill_name: 'Kubernetes', level_name: 'Intermediate' },
      client
    }))

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(client.query).toHaveBeenNthCalledWith(4, 'COMMIT')
  })
})

// ---------------------------------------------------------------------------
// PUT /skills/:skillId/validate
// ---------------------------------------------------------------------------

describe('validateSkill', () => {
  it('lets a reporting manager approve a direct report\'s record, audits SKILL_VALIDATED, and notifies the associate', async () => {
    const recordRow = {
      id: 'usr-1', tenant_id: 'tenant-1', user_id: 'user-2', skill_id: 'skill-1',
      current_level_id: 'lvl-2', target_level_id: null,
      status: 'self_declared', source: 'self_declared', evidence_url: null, validation_note: null,
      declared_at: '2026-06-01T00:00:00Z', validated_at: null, validated_by: null,
      created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
      manager_id: 'mgr-1', skill_name: 'Kubernetes'
    }
    const updatedRow = {
      ...recordRow,
      current_level_id: 'lvl-3', status: 'validated', validation_note: 'Confirmed via project review',
      validated_at: '2026-06-13T00:00:00Z', validated_by: 'mgr-1', updated_at: '2026-06-13T00:00:00Z'
    }
    delete updatedRow.manager_id
    delete updatedRow.skill_name

    db.query
      .mockResolvedValueOnce({ rows: [recordRow] }) // recordResult
      .mockResolvedValueOnce({ rows: [{ id: 'lvl-3', name: 'Advanced' }] }) // validated_level_id lookup

    const client = txClient([
      {}, // BEGIN
      { rows: [updatedRow] }, // UPDATE ... RETURNING *
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await skillService.validateSkill({
      actor: reportingManager,
      recordId: 'usr-1',
      input: { decision: 'approved', note: 'Confirmed via project review', validated_level_id: 'lvl-3' }
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.record).toMatchObject({ id: 'usr-1', status: 'validated', currentLevelId: 'lvl-3', validatedBy: 'mgr-1' })

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: AuditActions.SKILL_VALIDATED,
        entityType: 'UserSkillRecord',
        entityId: 'usr-1',
        oldValue: skillService.serializeSkillRecord(recordRow),
        newValue: skillService.serializeSkillRecord(updatedRow)
      }),
      client
    )

    expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      userId: 'user-2',
      eventType: 'skill.validated',
      data: { skill_name: 'Kubernetes', level_name: 'Advanced', note: 'Confirmed via project review' }
    }))
  })

  it('returns 403 + ACCESS_VIOLATION when a reporting manager targets a non-direct-report', async () => {
    const recordRow = {
      id: 'usr-9', tenant_id: 'tenant-1', user_id: 'user-9', skill_id: 'skill-1',
      current_level_id: 'lvl-2', status: 'self_declared', source: 'self_declared',
      manager_id: 'someone-else', skill_name: 'Kubernetes'
    }
    db.query.mockResolvedValueOnce({ rows: [recordRow] }) // recordResult

    const result = await skillService.validateSkill({
      actor: reportingManager,
      recordId: 'usr-9',
      input: { decision: 'approved', validated_level_id: 'lvl-3' },
      ipAddress: '10.0.0.1',
      userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(db.getClient).not.toHaveBeenCalled()
    expect(auditLog.write).toHaveBeenCalledWith(expect.objectContaining({
      actionType: AuditActions.ACCESS_VIOLATION,
      entityType: 'UserSkillRecord',
      entityId: 'usr-9',
      result: 'failure',
      metadata: { action: 'skills.validation.approve' }
    }))
  })
})

// ---------------------------------------------------------------------------
// GET /skills/gap-analysis
// ---------------------------------------------------------------------------

describe('getGapAnalysis', () => {
  it('returns gaps with recommended content and "met" requirements, with a computed readiness_pct', async () => {
    db.query
      // computeGapAnalysis: designation lookup
      .mockResolvedValueOnce({ rows: [{ designation: 'Senior Software Engineer' }] })
      // GAP_ANALYSIS_SELECT
      .mockResolvedValueOnce({
        rows: [
          {
            skill_id: 'skill-1', skill_name: 'Kubernetes',
            required_level_id: 'lvl-3', required_level_name: 'Advanced', required_level_order: 3,
            current_level_name: 'Intermediate', current_level_order: 2, gap_levels: '1'
          },
          {
            skill_id: 'skill-2', skill_name: 'Communication',
            required_level_id: 'lvl-2', required_level_name: 'Intermediate', required_level_order: 2,
            current_level_name: 'Intermediate', current_level_order: 2, gap_levels: '0'
          }
        ]
      })
      // RECOMMENDED_ASSETS_SELECT for the Kubernetes gap
      .mockResolvedValueOnce({
        rows: [{ id: 'asset-1', title: 'Advanced Kubernetes', content_type: 'video', duration_minutes: 45, proficiency_match: 0 }]
      })

    const result = await skillService.getGapAnalysis({ actor: associate })

    expect(result).toEqual({
      target_role: 'Senior Software Engineer',
      readiness_pct: 50,
      gaps: [
        {
          skill_name: 'Kubernetes', current_level: 'Intermediate', current_level_order: 2,
          required_level: 'Advanced', required_level_order: 3, gap_levels: 1,
          recommended_content: [{ id: 'asset-1', title: 'Advanced Kubernetes', content_type: 'video', duration_minutes: 45 }]
        }
      ],
      met: [
        { skill_name: 'Communication', current_level: 'Intermediate', current_level_order: 2, required_level: 'Intermediate', required_level_order: 2 }
      ]
    })

    // recommended content is capped at RECOMMENDED_CONTENT_LIMIT (3)
    expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining('LIMIT $4'), ['tenant-1', 'skill-1', 'lvl-3', 3])
  })

  it('returns target_role: null when the user has no designation', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // designation lookup -> no profile

    const result = await skillService.getGapAnalysis({ actor: associate })

    expect(result).toEqual({ target_role: null, readiness_pct: 100, gaps: [], met: [] })
    expect(db.query).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// GET /skills/recommendations
// ---------------------------------------------------------------------------

describe('getRecommendations', () => {
  it('returns published assets that close the biggest gaps first, deduplicated', async () => {
    db.query
      // computeGapAnalysis: designation lookup
      .mockResolvedValueOnce({ rows: [{ designation: 'Senior Software Engineer' }] })
      // GAP_ANALYSIS_SELECT — one open gap
      .mockResolvedValueOnce({
        rows: [{
          skill_id: 'skill-1', skill_name: 'Kubernetes',
          required_level_id: 'lvl-3', required_level_name: 'Advanced', required_level_order: 3,
          current_level_name: 'Intermediate', gap_levels: '1'
        }]
      })
      // RECOMMENDED_ASSETS_SELECT for the Kubernetes gap — published only
      .mockResolvedValueOnce({
        rows: [{ id: 'asset-1', title: 'Advanced Kubernetes', content_type: 'video', duration_minutes: 45, proficiency_match: 0 }]
      })
      // ASSET_SKILLS_SELECT for asset-1
      .mockResolvedValueOnce({ rows: [{ name: 'Kubernetes' }] })

    const result = await skillService.getRecommendations({ actor: associate })

    expect(result).toEqual([
      {
        asset_id: 'asset-1', title: 'Advanced Kubernetes', content_type: 'video', duration_minutes: 45,
        skills: ['Kubernetes'], reason: 'Closes gap in Kubernetes'
      }
    ])

    // the asset query filters to published assets for the gapped skill
    expect(db.query).toHaveBeenNthCalledWith(3, expect.stringContaining("status = 'published'"), ['tenant-1', 'skill-1', 'lvl-3'])
  })

  it('returns an empty list when the user has no open gaps', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ designation: 'Senior Software Engineer' }] })
      .mockResolvedValueOnce({
        rows: [{
          skill_id: 'skill-2', skill_name: 'Communication',
          required_level_id: 'lvl-2', required_level_name: 'Intermediate', required_level_order: 2,
          current_level_name: 'Intermediate', gap_levels: '0'
        }]
      })

    const result = await skillService.getRecommendations({ actor: associate })

    expect(result).toEqual([])
    expect(db.query).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — Rule 10: at least one allowed role succeeds, one denied
// role gets a 403 + ACCESS_VIOLATION
// ---------------------------------------------------------------------------

describe('skill routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const skillRoutes = require('../../src/modules/skills/skillRoutes')

  const app = express()
  app.use(express.json())
  app.use(skillRoutes)

  describe('PUT /skills/:skillId/validate', () => {
    it('allows reporting_manager to validate a direct report (200)', async () => {
      const recordRow = {
        id: 'usr-1', tenant_id: 'tenant-1', user_id: 'user-2', skill_id: 'skill-1',
        current_level_id: 'lvl-2', status: 'self_declared', source: 'self_declared',
        manager_id: 'user-1', skill_name: 'Kubernetes'
      }
      const updatedRow = { ...recordRow, current_level_id: 'lvl-3', status: 'validated', validated_by: 'user-1', validated_at: '2026-06-13T00:00:00Z' }
      delete updatedRow.manager_id
      delete updatedRow.skill_name

      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(approve, skills, validation)
        .mockResolvedValueOnce({ rows: [] }) // getVisibilityScope: direct reports' org units
        .mockResolvedValueOnce({ rows: [] }) // getVisibilityScope: own profile
        .mockResolvedValueOnce({ rows: [recordRow] }) // recordResult
        .mockResolvedValueOnce({ rows: [{ id: 'lvl-3', name: 'Advanced' }] }) // validated_level_id lookup

      const client = txClient([{}, { rows: [updatedRow] }, {}])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .put('/skills/usr-1/validate')
        .set('x-test-role', 'reporting_manager')
        .send({ decision: 'approved', validated_level_id: 'lvl-3', note: 'Looks good' })

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('validated')
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .put('/skills/usr-1/validate')
        .set('x-test-role', 'associate')
        .send({ decision: 'approved', validated_level_id: 'lvl-3' })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })
})
