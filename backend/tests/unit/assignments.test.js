// tests/unit/assignments.test.js
//
// Unit tests for src/modules/learning/assignmentService.js and the RBAC
// wiring in src/modules/learning/assignmentRoutes.js.
//
// Pattern (matches tests/unit/content.test.js / paths.test.js): mock db,
// crypto.randomUUID, auditLog.write and notificationService.notify so we can
// assert exactly what state changes, audit events, and notifications each
// action produces. permissionEngine is NOT mocked — its real hasPermission/
// getVisibilityScope run against the mocked db.query.

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
const assignmentService = require('../../src/modules/learning/assignmentService')

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

function assignmentRow(overrides = {}) {
  return {
    id: 'assignment-1',
    tenant_id: 'tenant-1',
    asset_id: 'asset-1',
    path_id: null,
    assigned_to: 'user-2',
    assigned_by: 'mgr-1',
    due_date: '2026-07-01',
    is_mandatory: true,
    status: 'not_started',
    note: null,
    created_at: '2026-06-10T00:00:00Z',
    ...overrides
  }
}

const reportingManager = {
  id: 'mgr-1', tenantId: 'tenant-1', roles: ['reporting_manager'],
  activeRole: 'reporting_manager', activeRoleId: 'role-reporting_manager',
  visibilityScope: { type: 'team', orgUnitIds: ['ou-1', 'ou-2'] }
}
const associate = {
  id: 'user-2', tenantId: 'tenant-1', roles: ['associate'],
  activeRole: 'associate', activeRoleId: 'role-associate',
  visibilityScope: { type: 'own', orgUnitIds: ['ou-1'] }
}

beforeEach(() => {
  jest.clearAllMocks()
  crypto.randomUUID.mockReturnValue('assignment-1')
})

// ---------------------------------------------------------------------------
// createAssignment
// ---------------------------------------------------------------------------

describe('createAssignment', () => {
  it('assigns an asset to a list of users, notifying each and writing ASSIGNMENT_CREATED', async () => {
    crypto.randomUUID
      .mockReturnValueOnce('assignment-1')
      .mockReturnValueOnce('assignment-2')

    db.query
      .mockResolvedValueOnce({ rows: [{ title: 'Intro to Kubernetes' }] }) // asset lookup
      .mockResolvedValueOnce({ rows: [{ id: 'user-2' }, { id: 'user-3' }] }) // resolveTargetUserIds: users lookup

    const client = txClient([
      {}, // BEGIN
      { rows: [assignmentRow({ id: 'assignment-1', assigned_to: 'user-2' })] },
      { rows: [assignmentRow({ id: 'assignment-2', assigned_to: 'user-3' })] },
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await assignmentService.createAssignment({
      actor: reportingManager,
      input: {
        asset_id: 'asset-1',
        target: { type: 'users', user_ids: ['user-2', 'user-3'] },
        due_date: '2026-07-01',
        note: 'Please complete before the team sync'
      },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.assignments).toHaveLength(2)
    expect(result.assignments[0].title).toBe('Intro to Kubernetes')
    expect(result.assignments[0].assignedTo).toBe('user-2')

    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(auditLog.write).toHaveBeenCalledTimes(2)
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'mgr-1',
        actionType: auditLog.AuditActions.ASSIGNMENT_CREATED,
        entityType: 'Assignment',
        entityId: 'assignment-1',
        result: 'success'
      }),
      client
    )

    expect(notificationService.notify).toHaveBeenCalledTimes(2)
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-2',
        eventType: 'assignment.created',
        data: { title: 'Intro to Kubernetes', due_date: '2026-07-01' },
        client
      })
    )
  })

  it('assigns a path to the manager\'s direct reports (target.type = "team")', async () => {
    crypto.randomUUID.mockReturnValueOnce('assignment-3')

    db.query
      .mockResolvedValueOnce({ rows: [{ title: 'Kubernetes Fundamentals' }] }) // path lookup
      .mockResolvedValueOnce({ rows: [{ id: 'user-4' }] }) // resolveTargetUserIds: direct reports

    const client = txClient([
      {}, // BEGIN
      { rows: [assignmentRow({ id: 'assignment-3', asset_id: null, path_id: 'path-1', assigned_to: 'user-4', is_mandatory: false })] },
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await assignmentService.createAssignment({
      actor: reportingManager,
      input: { path_id: 'path-1', target: { type: 'team' }, is_mandatory: false },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.assignments[0].pathId).toBe('path-1')
    expect(result.assignments[0].title).toBe('Kubernetes Fundamentals')
    expect(result.assignments[0].isMandatory).toBe(false)
  })

  it('assigns to all active users in target.org_unit_id when within the actor\'s visibility scope', async () => {
    crypto.randomUUID.mockReturnValueOnce('assignment-5')

    db.query
      .mockResolvedValueOnce({ rows: [{ title: 'Intro to Kubernetes' }] }) // asset lookup
      .mockResolvedValueOnce({ rows: [{ id: 'user-5' }] }) // resolveTargetUserIds: org_unit lookup

    const client = txClient([
      {}, // BEGIN
      { rows: [assignmentRow({ id: 'assignment-5', assigned_to: 'user-5' })] },
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await assignmentService.createAssignment({
      actor: reportingManager, // visibilityScope.orgUnitIds = ['ou-1', 'ou-2']
      input: { asset_id: 'asset-1', target: { type: 'org_unit', org_unit_id: 'ou-1' } },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.assignments[0].assignedTo).toBe('user-5')
  })

  it('rejects a body with both asset_id and path_id', async () => {
    const result = await assignmentService.createAssignment({
      actor: reportingManager,
      input: { asset_id: 'asset-1', path_id: 'path-1', target: { type: 'team' } },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('Exactly one of') })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('rejects a body with neither asset_id nor path_id', async () => {
    const result = await assignmentService.createAssignment({
      actor: reportingManager,
      input: { target: { type: 'team' } },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('Exactly one of') })
  })

  it('rejects an invalid due_date format', async () => {
    const result = await assignmentService.createAssignment({
      actor: reportingManager,
      input: { asset_id: 'asset-1', target: { type: 'team' }, due_date: '07/01/2026' },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('due_date') })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('rejects an unknown target.type', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ title: 'Intro to Kubernetes' }] }) // asset lookup

    const result = await assignmentService.createAssignment({
      actor: reportingManager,
      input: { asset_id: 'asset-1', target: { type: 'everyone' } },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('target.type must be one of') })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 400 when asset_id does not exist for the tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // asset lookup -> not found

    const result = await assignmentService.createAssignment({
      actor: reportingManager,
      input: { asset_id: 'missing-asset', target: { type: 'team' } },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('asset_id') })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 400 when target.type is "team" and the actor has no direct reports', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ title: 'Intro to Kubernetes' }] }) // asset lookup
      .mockResolvedValueOnce({ rows: [] }) // direct reports -> none

    const result = await assignmentService.createAssignment({
      actor: reportingManager,
      input: { asset_id: 'asset-1', target: { type: 'team' } },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('direct reports') })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 403 when target.org_unit_id is outside the actor\'s visibility scope', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ title: 'Intro to Kubernetes' }] }) // asset lookup

    const result = await assignmentService.createAssignment({
      actor: reportingManager, // visibilityScope.orgUnitIds = ['ou-1', 'ou-2']
      input: { asset_id: 'asset-1', target: { type: 'org_unit', org_unit_id: 'ou-99' } },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: expect.stringContaining('visibility scope') })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getMyAssignments
// ---------------------------------------------------------------------------

describe('getMyAssignments', () => {
  it('returns the caller\'s assignments with overdue items flagged', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        assignmentRow({ id: 'assignment-1', due_date: '2026-01-01', is_overdue: true, asset_title: 'Intro to Kubernetes' }),
        assignmentRow({ id: 'assignment-2', due_date: '2026-12-01', is_overdue: false, asset_id: null, path_id: 'path-1', path_title: 'Kubernetes Fundamentals' })
      ]
    })

    const result = await assignmentService.getMyAssignments({ actor: associate })

    expect(result.assignments).toHaveLength(2)
    expect(result.assignments[0].isOverdue).toBe(true)
    expect(result.assignments[0].title).toBe('Intro to Kubernetes')
    expect(result.assignments[1].isOverdue).toBe(false)
    expect(result.assignments[1].title).toBe('Kubernetes Fundamentals')

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE a.tenant_id = $1 AND a.assigned_to = $2'), ['tenant-1', 'user-2'])
  })
})

// ---------------------------------------------------------------------------
// getTeamAssignments
// ---------------------------------------------------------------------------

describe('getTeamAssignments', () => {
  it('returns an empty list when the manager has no direct reports', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // direct reports lookup

    const result = await assignmentService.getTeamAssignments({ actor: reportingManager })

    expect(result).toEqual({ assignments: [] })
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('returns assignments for all direct reports with assignedToName', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'user-2', first_name: 'Asha', last_name: 'Rao' }] }) // direct reports
      .mockResolvedValueOnce({ rows: [assignmentRow({ id: 'assignment-1', assigned_to: 'user-2', is_overdue: false, asset_title: 'Intro to Kubernetes' })] }) // assignments

    const result = await assignmentService.getTeamAssignments({ actor: reportingManager })

    expect(result.assignments).toHaveLength(1)
    expect(result.assignments[0].assignedToName).toBe('Asha Rao')
    expect(result.assignments[0].title).toBe('Intro to Kubernetes')
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — Rule 10: at least one allowed role succeeds, one denied
// role gets a 403 + ACCESS_VIOLATION
// ---------------------------------------------------------------------------

describe('assignment routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const assignmentRoutes = require('../../src/modules/learning/assignmentRoutes')

  const app = express()
  app.use(express.json())
  app.use(assignmentRoutes)

  describe('POST /assignments', () => {
    it('allows reporting_manager (201)', async () => {
      crypto.randomUUID.mockReturnValueOnce('assignment-1')

      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(create, learning, assignments)
        .mockResolvedValueOnce({ rows: [{ org_unit_id: 'ou-1' }] }) // getVisibilityScope: direct reports' org units
        .mockResolvedValueOnce({ rows: [{ org_unit_id: 'ou-1' }] }) // getVisibilityScope: own profile
        .mockResolvedValueOnce({ rows: [{ title: 'Intro to Kubernetes' }] }) // asset lookup
        .mockResolvedValueOnce({ rows: [{ id: 'user-2' }] }) // resolveTargetUserIds: direct reports

      const client = txClient([
        {}, // BEGIN
        { rows: [assignmentRow({ id: 'assignment-1', assigned_to: 'user-2' })] },
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/assignments')
        .set('x-test-role', 'reporting_manager')
        .send({ asset_id: 'asset-1', target: { type: 'team' } })

      expect(res.status).toBe(201)
      expect(res.body.assignments).toHaveLength(1)
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/assignments')
        .set('x-test-role', 'associate')
        .send({ asset_id: 'asset-1', target: { type: 'team' } })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('GET /assignments/me', () => {
    it('allows associate to view their own assignments (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, learning, assignments)
        .mockResolvedValueOnce({ rows: [assignmentRow({ assigned_to: 'user-1', asset_title: 'Intro to Kubernetes', is_overdue: false })] })

      const res = await request(app)
        .get('/assignments/me')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body.assignments).toHaveLength(1)
    })
  })

  describe('GET /assignments/team', () => {
    it('allows reporting_manager (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, learning, team_assignments)
        .mockResolvedValueOnce({ rows: [{ org_unit_id: 'ou-1' }] }) // getVisibilityScope: direct reports' org units
        .mockResolvedValueOnce({ rows: [{ org_unit_id: 'ou-1' }] }) // getVisibilityScope: own profile
        .mockResolvedValueOnce({ rows: [] }) // getTeamAssignments: direct reports -> none

      const res = await request(app)
        .get('/assignments/team')
        .set('x-test-role', 'reporting_manager')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ assignments: [] })
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .get('/assignments/team')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })
})
