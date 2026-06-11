// tests/unit/progress.test.js
//
// Unit tests for src/modules/learning/progressService.js and the RBAC
// wiring in src/modules/learning/progressRoutes.js.
//
// Pattern (matches tests/unit/assignments.test.js / paths.test.js): mock db,
// crypto.randomUUID, auditLog.write, and configService.get so we can assert
// exactly what state changes, audit events, and config-driven completion
// rules (Rule 1) each action produces. permissionEngine is NOT mocked — its
// real hasPermission/getVisibilityScope run against the mocked db.query.

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

const crypto = require('crypto')
const db = require('../../src/db')
const auditLog = require('../../src/modules/audit/auditLog')
const configService = require('../../src/modules/config/configService')
const progressService = require('../../src/modules/learning/progressService')

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

const COMPLETION_RULES = {
  video: { completion_type: 'threshold', threshold_pct: 90 },
  pdf: { completion_type: 'manual' },
  article: { completion_type: 'manual' },
  scorm: { completion_type: 'external_status' }
}

const associate = {
  id: 'user-1', tenantId: 'tenant-1', roles: ['associate'],
  activeRole: 'associate', activeRoleId: 'role-associate'
}

function progressEventRow(overrides = {}) {
  return {
    id: 'event-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    asset_id: 'asset-1',
    event_type: 'progress_updated',
    progress_pct: 50,
    position_seconds: 300,
    metadata: null,
    created_at: '2026-06-10T00:00:00Z',
    ...overrides
  }
}

function completionRow(overrides = {}) {
  return {
    id: 'completion-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    asset_id: 'asset-1',
    path_id: null,
    assignment_id: null,
    completed_at: '2026-06-10T00:00:00Z',
    score: null,
    time_spent_minutes: null,
    ...overrides
  }
}

function assignmentRow(overrides = {}) {
  return {
    id: 'assignment-1',
    tenant_id: 'tenant-1',
    asset_id: 'asset-1',
    path_id: null,
    assigned_to: 'user-1',
    assigned_by: 'mgr-1',
    due_date: null,
    is_mandatory: true,
    status: 'in_progress',
    note: null,
    created_at: '2026-06-01T00:00:00Z',
    ...overrides
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  crypto.randomUUID.mockReturnValue('event-1')
})

// ---------------------------------------------------------------------------
// isCompletionTriggered / getCompletionRule (Rule 1 — config-driven rules)
// ---------------------------------------------------------------------------

describe('isCompletionTriggered', () => {
  const thresholdRule = { completion_type: 'threshold', threshold_pct: 90 }
  const manualRule = { completion_type: 'manual' }

  it('completes a threshold-rule asset once progress_pct meets the configured threshold', () => {
    expect(progressService.isCompletionTriggered({ event_type: 'progress_updated', progress_pct: 89 }, thresholdRule)).toBe(false)
    expect(progressService.isCompletionTriggered({ event_type: 'progress_updated', progress_pct: 90 }, thresholdRule)).toBe(true)
  })

  it('an explicit completed event always completes, regardless of the rule type', () => {
    expect(progressService.isCompletionTriggered({ event_type: 'completed', progress_pct: 10 }, manualRule)).toBe(true)
    expect(progressService.isCompletionTriggered({ event_type: 'completed' }, thresholdRule)).toBe(true)
  })

  it('a manual-rule asset does not complete from progress_pct alone', () => {
    expect(progressService.isCompletionTriggered({ event_type: 'progress_updated', progress_pct: 100 }, manualRule)).toBe(false)
  })
})

describe('getCompletionRule', () => {
  it('falls back to manual completion when no rule is configured for the content_type', async () => {
    configService.get.mockResolvedValueOnce({ video: { completion_type: 'threshold', threshold_pct: 90 } })

    const rule = await progressService.getCompletionRule('tenant-1', 'unknown_type')

    expect(rule).toEqual({ completion_type: 'manual' })
  })

  it('falls back to manual when configurations.learning.completion_rules is not set at all', async () => {
    configService.get.mockResolvedValueOnce(null)

    const rule = await progressService.getCompletionRule('tenant-1', 'video')

    expect(rule).toEqual({ completion_type: 'manual' })
  })
})

// ---------------------------------------------------------------------------
// recordProgressEvent
// ---------------------------------------------------------------------------

describe('recordProgressEvent', () => {
  it('records a "started" event without triggering completion', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'video' }] }) // asset lookup
    configService.get.mockResolvedValueOnce(COMPLETION_RULES)

    const client = txClient([
      {}, // BEGIN
      { rows: [progressEventRow({ event_type: 'started', progress_pct: 0, position_seconds: 0 })] }, // INSERT progress_events
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await progressService.recordProgressEvent({
      actor: associate,
      input: { asset_id: 'asset-1', event_type: 'started', progress_pct: 0, position_seconds: 0 },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.event.eventType).toBe('started')
    expect(result.completion).toBeNull()

    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(auditLog.write).toHaveBeenCalledTimes(1)
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        actionType: auditLog.AuditActions.PROGRESS_EVENT_RECORDED,
        entityType: 'ProgressEvent',
        entityId: 'event-1',
        result: 'success'
      }),
      client
    )
  })

  it('does not complete a video below its configured threshold (90%)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'video' }] }) // asset lookup
    configService.get.mockResolvedValueOnce(COMPLETION_RULES)

    const client = txClient([
      {}, // BEGIN
      { rows: [progressEventRow({ event_type: 'progress_updated', progress_pct: 50, position_seconds: 300 })] }, // INSERT progress_events
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await progressService.recordProgressEvent({
      actor: associate,
      input: { asset_id: 'asset-1', event_type: 'progress_updated', progress_pct: 50, position_seconds: 300 },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.completion).toBeNull()
    expect(auditLog.write).toHaveBeenCalledTimes(1)
  })

  it('completes a video at the configured 90% threshold and marks its direct assignment completed', async () => {
    crypto.randomUUID
      .mockReturnValueOnce('event-1')
      .mockReturnValueOnce('completion-1')

    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'video' }] }) // asset lookup
    configService.get.mockResolvedValueOnce(COMPLETION_RULES)

    const client = txClient([
      {}, // BEGIN
      { rows: [progressEventRow({ event_type: 'progress_updated', progress_pct: 90, position_seconds: 1000 })] }, // INSERT progress_events
      { rows: [] }, // SELECT completion_records (no existing record)
      { rows: [assignmentRow({ id: 'assignment-1', status: 'in_progress' })] }, // direct asset assignment
      { rows: [] }, // path assignments containing this asset as mandatory
      { rows: [completionRow({ id: 'completion-1', assignment_id: 'assignment-1' })] }, // INSERT completion_records
      {}, // UPDATE assignments SET status = 'completed' (direct)
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await progressService.recordProgressEvent({
      actor: associate,
      input: { asset_id: 'asset-1', event_type: 'progress_updated', progress_pct: 90, position_seconds: 1000 },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.completion).not.toBeNull()
    expect(result.completion.assetId).toBe('asset-1')
    expect(result.completion.assignmentId).toBe('assignment-1')

    expect(client.query).toHaveBeenCalledWith(`UPDATE assignments SET status = 'completed' WHERE id = $1`, ['assignment-1'])

    expect(auditLog.write).toHaveBeenCalledTimes(3)
    expect(auditLog.write).toHaveBeenNthCalledWith(1,
      expect.objectContaining({ actionType: auditLog.AuditActions.PROGRESS_EVENT_RECORDED }), client)
    expect(auditLog.write).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ actionType: auditLog.AuditActions.ASSET_COMPLETED, entityType: 'CompletionRecord', entityId: 'completion-1' }), client)
    expect(auditLog.write).toHaveBeenNthCalledWith(3,
      expect.objectContaining({
        actionType: auditLog.AuditActions.ASSIGNMENT_COMPLETED,
        entityType: 'Assignment',
        entityId: 'assignment-1',
        oldValue: { status: 'in_progress' },
        newValue: { status: 'completed' }
      }), client)
  })

  it('completes a PDF only on an explicit "completed" event (manual rule)', async () => {
    crypto.randomUUID
      .mockReturnValueOnce('event-2')
      .mockReturnValueOnce('completion-2')

    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-2', content_type: 'pdf' }] }) // asset lookup
    configService.get.mockResolvedValueOnce(COMPLETION_RULES)

    const client = txClient([
      {}, // BEGIN
      { rows: [progressEventRow({ id: 'event-2', asset_id: 'asset-2', event_type: 'completed', progress_pct: null, position_seconds: null })] }, // INSERT progress_events
      { rows: [] }, // SELECT completion_records (no existing record)
      { rows: [] }, // direct asset assignment -> none
      { rows: [] }, // path assignments -> none
      { rows: [completionRow({ id: 'completion-2', asset_id: 'asset-2' })] }, // INSERT completion_records
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await progressService.recordProgressEvent({
      actor: associate,
      input: { asset_id: 'asset-2', event_type: 'completed' },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.completion.assetId).toBe('asset-2')
    expect(result.completion.assignmentId).toBeNull()
    expect(result.completion.pathId).toBeNull()
    expect(auditLog.write).toHaveBeenCalledTimes(2) // PROGRESS_EVENT_RECORDED + ASSET_COMPLETED, no assignment to update
  })

  it('stores score and time_spent_minutes from metadata when a SCORM runtime reports completion', async () => {
    crypto.randomUUID
      .mockReturnValueOnce('event-3')
      .mockReturnValueOnce('completion-3')

    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-4', content_type: 'scorm' }] }) // asset lookup
    configService.get.mockResolvedValueOnce(COMPLETION_RULES)

    const metadata = { scorm_completion_status: 'completed', score: 85, time_spent_minutes: 42 }

    const client = txClient([
      {}, // BEGIN
      { rows: [progressEventRow({ id: 'event-3', asset_id: 'asset-4', event_type: 'completed', progress_pct: null, metadata })] }, // INSERT progress_events
      { rows: [] }, // SELECT completion_records (no existing record)
      { rows: [] }, // direct asset assignment -> none
      { rows: [] }, // path assignments -> none
      { rows: [completionRow({ id: 'completion-3', asset_id: 'asset-4', score: 85, time_spent_minutes: 42 })] }, // INSERT completion_records
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await progressService.recordProgressEvent({
      actor: associate,
      input: { asset_id: 'asset-4', event_type: 'completed', metadata },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.completion.score).toBe(85)
    expect(result.completion.timeSpentMinutes).toBe(42)

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO completion_records'),
      ['completion-3', 'tenant-1', 'user-1', 'asset-4', null, null, 85, 42]
    )
  })

  it('does not re-create a completion_record or re-touch assignments when the asset is already completed', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'video' }] }) // asset lookup
    configService.get.mockResolvedValueOnce(COMPLETION_RULES)

    const client = txClient([
      {}, // BEGIN
      { rows: [progressEventRow({ event_type: 'completed', progress_pct: 100 })] }, // INSERT progress_events
      { rows: [completionRow({ id: 'completion-existing' })] }, // SELECT completion_records -> already exists
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await progressService.recordProgressEvent({
      actor: associate,
      input: { asset_id: 'asset-1', event_type: 'completed', progress_pct: 100 },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.completion.id).toBe('completion-existing')
    expect(auditLog.write).toHaveBeenCalledTimes(1) // PROGRESS_EVENT_RECORDED only
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO completion_records'), expect.anything())
  })

  it('marks a learning path assignment completed once its last mandatory item completes', async () => {
    crypto.randomUUID
      .mockReturnValueOnce('event-4')
      .mockReturnValueOnce('completion-4')

    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-3', content_type: 'video' }] }) // asset lookup
    configService.get.mockResolvedValueOnce(COMPLETION_RULES)

    const pathAssignment = assignmentRow({ id: 'assignment-2', asset_id: null, path_id: 'path-1', status: 'in_progress' })

    const client = txClient([
      {}, // BEGIN
      { rows: [progressEventRow({ id: 'event-4', asset_id: 'asset-3', event_type: 'completed', progress_pct: null })] }, // INSERT progress_events
      { rows: [] }, // SELECT completion_records (no existing record)
      { rows: [] }, // direct asset assignment -> none
      { rows: [pathAssignment] }, // path assignments containing asset-3 as mandatory
      { rows: [completionRow({ id: 'completion-4', asset_id: 'asset-3', path_id: 'path-1', assignment_id: 'assignment-2' })] }, // INSERT completion_records
      { rows: [{ asset_id: 'asset-2' }, { asset_id: 'asset-3' }] }, // mandatory asset_ids for path-1
      { rows: [{ asset_id: 'asset-2' }, { asset_id: 'asset-3' }] }, // both mandatory assets now have completion_records
      {}, // UPDATE assignments SET status = 'completed' (path)
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await progressService.recordProgressEvent({
      actor: associate,
      input: { asset_id: 'asset-3', event_type: 'completed' },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.completion.pathId).toBe('path-1')
    expect(result.completion.assignmentId).toBe('assignment-2')

    expect(client.query).toHaveBeenCalledWith(`UPDATE assignments SET status = 'completed' WHERE id = $1`, ['assignment-2'])

    expect(auditLog.write).toHaveBeenCalledTimes(3)
    expect(auditLog.write).toHaveBeenNthCalledWith(3,
      expect.objectContaining({
        actionType: auditLog.AuditActions.ASSIGNMENT_COMPLETED,
        entityType: 'Assignment',
        entityId: 'assignment-2',
        metadata: { pathId: 'path-1', reason: 'all_mandatory_items_completed' }
      }), client)
  })

  it('leaves a path assignment in progress while other mandatory items are incomplete', async () => {
    crypto.randomUUID
      .mockReturnValueOnce('event-5')
      .mockReturnValueOnce('completion-5')

    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-3', content_type: 'video' }] }) // asset lookup
    configService.get.mockResolvedValueOnce(COMPLETION_RULES)

    const pathAssignment = assignmentRow({ id: 'assignment-2', asset_id: null, path_id: 'path-1', status: 'in_progress' })

    const client = txClient([
      {}, // BEGIN
      { rows: [progressEventRow({ id: 'event-5', asset_id: 'asset-3', event_type: 'completed', progress_pct: null })] }, // INSERT progress_events
      { rows: [] }, // SELECT completion_records (no existing record)
      { rows: [] }, // direct asset assignment -> none
      { rows: [pathAssignment] }, // path assignments containing asset-3 as mandatory
      { rows: [completionRow({ id: 'completion-5', asset_id: 'asset-3', path_id: 'path-1', assignment_id: 'assignment-2' })] }, // INSERT completion_records
      { rows: [{ asset_id: 'asset-2' }, { asset_id: 'asset-3' }] }, // mandatory asset_ids for path-1
      { rows: [{ asset_id: 'asset-3' }] }, // only asset-3 completed so far -- asset-2 still pending
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await progressService.recordProgressEvent({
      actor: associate,
      input: { asset_id: 'asset-3', event_type: 'completed' },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(client.query).not.toHaveBeenCalledWith(`UPDATE assignments SET status = 'completed' WHERE id = $1`, ['assignment-2'])
    expect(auditLog.write).toHaveBeenCalledTimes(2) // PROGRESS_EVENT_RECORDED + ASSET_COMPLETED only
  })

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('rejects a missing asset_id without touching the database', async () => {
    const result = await progressService.recordProgressEvent({
      actor: associate, input: { event_type: 'started' }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('asset_id') })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('rejects an invalid event_type', async () => {
    const result = await progressService.recordProgressEvent({
      actor: associate, input: { asset_id: 'asset-1', event_type: 'paused' }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('event_type must be one of') })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('rejects a progress_pct outside 0-100', async () => {
    const result = await progressService.recordProgressEvent({
      actor: associate, input: { asset_id: 'asset-1', event_type: 'progress_updated', progress_pct: 150 }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('progress_pct') })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('rejects a negative position_seconds', async () => {
    const result = await progressService.recordProgressEvent({
      actor: associate, input: { asset_id: 'asset-1', event_type: 'resumed', position_seconds: -5 }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('position_seconds') })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns 400 when asset_id does not exist for the tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // asset lookup -> not found

    const result = await progressService.recordProgressEvent({
      actor: associate, input: { asset_id: 'missing-asset', event_type: 'started' }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('asset_id') })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getMyProgress
// ---------------------------------------------------------------------------

describe('getMyProgress', () => {
  it('derives started/in_progress/completed status per asset', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { asset_id: 'asset-1', progress_pct: 90, position_seconds: 1000, last_event_at: '2026-06-10T00:00:00Z', asset_title: 'Intro to Kubernetes', content_type: 'video', completed_at: '2026-06-10T00:05:00Z', score: null, time_spent_minutes: null },
        { asset_id: 'asset-2', progress_pct: 40, position_seconds: 200, last_event_at: '2026-06-09T00:00:00Z', asset_title: 'Networking Basics', content_type: 'video', completed_at: null, score: null, time_spent_minutes: null },
        { asset_id: 'asset-3', progress_pct: null, position_seconds: null, last_event_at: '2026-06-08T00:00:00Z', asset_title: 'Read this PDF', content_type: 'pdf', completed_at: null, score: null, time_spent_minutes: null }
      ]
    })

    const result = await progressService.getMyProgress({ actor: associate })

    expect(result.progress).toHaveLength(3)
    expect(result.progress[0]).toMatchObject({ assetId: 'asset-1', status: 'completed', progressPct: 90 })
    expect(result.progress[1]).toMatchObject({ assetId: 'asset-2', status: 'in_progress', progressPct: 40 })
    expect(result.progress[2]).toMatchObject({ assetId: 'asset-3', status: 'started', progressPct: null })

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE pe.tenant_id = $1 AND pe.user_id = $2'), ['tenant-1', 'user-1'])
  })

  it('returns an empty list when the user has no progress events', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await progressService.getMyProgress({ actor: associate })

    expect(result).toEqual({ progress: [] })
  })
})

// ---------------------------------------------------------------------------
// getResumePosition
// ---------------------------------------------------------------------------

describe('getResumePosition', () => {
  it('returns the last recorded position_seconds for a video', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1' }] }) // asset lookup
      .mockResolvedValueOnce({ rows: [{ position_seconds: 742, created_at: '2026-06-10T00:00:00Z' }] })

    const result = await progressService.getResumePosition({ actor: associate, assetId: 'asset-1' })

    expect(result).toEqual({ ok: true, assetId: 'asset-1', positionSeconds: 742, lastUpdatedAt: '2026-06-10T00:00:00Z' })
  })

  it('returns 0 when no position has ever been recorded for the asset', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1' }] }) // asset lookup
      .mockResolvedValueOnce({ rows: [] })

    const result = await progressService.getResumePosition({ actor: associate, assetId: 'asset-1' })

    expect(result).toEqual({ ok: true, assetId: 'asset-1', positionSeconds: 0, lastUpdatedAt: null })
  })

  it('returns 404 for an asset that does not exist for the tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // asset lookup -> not found

    const result = await progressService.getResumePosition({ actor: associate, assetId: 'missing' })

    expect(result).toEqual({ ok: false, status: 404, error: 'Learning asset not found' })
    expect(db.query).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — Rule 10: at least one allowed role succeeds, one denied
// role gets a 403 + ACCESS_VIOLATION
// ---------------------------------------------------------------------------

describe('progress routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const progressRoutes = require('../../src/modules/learning/progressRoutes')

  const app = express()
  app.use(express.json())
  app.use(progressRoutes)

  describe('POST /progress/events', () => {
    it('allows associate to record their own progress (201)', async () => {
      configService.get.mockResolvedValueOnce(COMPLETION_RULES)

      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(create, learning, progress)
        .mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'video' }] }) // asset lookup

      const client = txClient([
        {}, // BEGIN
        { rows: [progressEventRow({ event_type: 'started', progress_pct: 0, position_seconds: 0 })] }, // INSERT progress_events
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/progress/events')
        .set('x-test-role', 'associate')
        .send({ asset_id: 'asset-1', event_type: 'started', progress_pct: 0, position_seconds: 0 })

      expect(res.status).toBe(201)
      expect(res.body.event.eventType).toBe('started')
      expect(res.body.completion).toBeNull()
    })

    it('denies a role without learning.progress.create (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/progress/events')
        .set('x-test-role', 'external')
        .send({ asset_id: 'asset-1', event_type: 'started' })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('GET /progress/me', () => {
    it('allows associate to view their own progress (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, learning, progress)
        .mockResolvedValueOnce({ rows: [] }) // getMyProgress -> nothing started yet

      const res = await request(app)
        .get('/progress/me')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ progress: [] })
    })

    it('denies a role without learning.progress.view (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .get('/progress/me')
        .set('x-test-role', 'external')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('GET /progress/resume/:assetId', () => {
    it('allows associate to fetch their resume position (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, learning, progress)
        .mockResolvedValueOnce({ rows: [{ id: 'asset-1' }] }) // asset lookup
        .mockResolvedValueOnce({ rows: [{ position_seconds: 120, created_at: '2026-06-10T00:00:00Z' }] })

      const res = await request(app)
        .get('/progress/resume/asset-1')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ assetId: 'asset-1', positionSeconds: 120, lastUpdatedAt: '2026-06-10T00:00:00Z' })
    })
  })
})
