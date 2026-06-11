// tests/unit/scorm.test.js
//
// Unit tests for src/modules/content/scormService.js and the RBAC wiring in
// src/modules/content/scormRoutes.js.
//
// Pattern (matches tests/unit/progress.test.js): mock db, crypto.randomUUID,
// auditLog.write, and learning.progressService.recordProgressEvent so we can
// assert exactly what state changes, audit events, and SCORM->progress
// hand-offs each action produces. permissionEngine is NOT mocked — its real
// hasPermission/getVisibilityScope run against the mocked db.query.

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
jest.mock('../../src/modules/learning/progressService', () => ({
  recordProgressEvent: jest.fn()
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
const progressService = require('../../src/modules/learning/progressService')
const scormService = require('../../src/modules/content/scormService')

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

const associate = {
  id: 'user-1', tenantId: 'tenant-1', roles: ['associate'],
  activeRole: 'associate', activeRoleId: 'role-associate'
}

function sessionRow(overrides = {}) {
  return {
    id: 'session-1',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    asset_id: 'asset-1',
    session_data: {},
    lesson_status: null,
    score: null,
    suspend_data: null,
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    ...overrides
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  crypto.randomUUID.mockReturnValue('session-1')
})

// ---------------------------------------------------------------------------
// initializeSession
// ---------------------------------------------------------------------------

describe('scormService.initializeSession', () => {
  it('rejects when asset_id is missing', async () => {
    const result = await scormService.initializeSession({ actor: associate, assetId: undefined })
    expect(result).toEqual({ ok: false, status: 400, error: 'asset_id is required' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('rejects when asset_id does not exist for the tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // asset lookup

    const result = await scormService.initializeSession({ actor: associate, assetId: 'asset-1' })
    expect(result).toEqual({ ok: false, status: 400, error: 'asset_id does not exist for this tenant' })
  })

  it('rejects when the asset is not a SCORM asset', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'video' }] })

    const result = await scormService.initializeSession({ actor: associate, assetId: 'asset-1' })
    expect(result).toEqual({ ok: false, status: 400, error: 'asset_id is not a SCORM asset' })
  })

  it('creates a new session and audits SCORM_SESSION_STARTED', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'scorm' }] }) // asset lookup

    const client = txClient([
      {}, // BEGIN
      { rows: [sessionRow()] }, // INSERT ... ON CONFLICT DO NOTHING RETURNING *
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await scormService.initializeSession({
      actor: associate, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.session).toEqual({
      sessionToken: 'session-1',
      assetId: 'asset-1',
      lessonStatus: null,
      score: null,
      suspendData: null,
      sessionData: {}
    })

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO scorm_sessions'),
      ['session-1', 'tenant-1', 'user-1', 'asset-1']
    )
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.SCORM_SESSION_STARTED,
        entityType: 'ScormSession',
        entityId: 'session-1'
      }), client)
  })

  it('returns the existing session on relaunch without re-auditing', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'scorm' }] }) // asset lookup

    const existing = sessionRow({ lesson_status: 'incomplete', suspend_data: 'progress=42' })
    const client = txClient([
      {}, // BEGIN
      { rows: [] }, // INSERT ... ON CONFLICT DO NOTHING -> conflict, nothing inserted
      { rows: [existing] }, // SELECT existing session
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await scormService.initializeSession({ actor: associate, assetId: 'asset-1' })

    expect(result.ok).toBe(true)
    expect(result.session.lessonStatus).toBe('incomplete')
    expect(result.session.suspendData).toBe('progress=42')
    expect(auditLog.write).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// setValue
// ---------------------------------------------------------------------------

describe('scormService.setValue', () => {
  it('rejects when session_token is missing', async () => {
    const result = await scormService.setValue({ actor: associate, sessionToken: undefined, key: 'cmi.core.lesson_status', value: 'incomplete' })
    expect(result).toEqual({ ok: false, status: 400, error: 'session_token is required' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('rejects when neither key/value nor values is provided', async () => {
    const result = await scormService.setValue({ actor: associate, sessionToken: 'session-1' })
    expect(result).toEqual({ ok: false, status: 400, error: 'key/value or values is required' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns 404 when the session does not exist for this user/tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await scormService.setValue({ actor: associate, sessionToken: 'missing', key: 'cmi.core.lesson_status', value: 'incomplete' })
    expect(result).toEqual({ ok: false, status: 404, error: 'SCORM session not found' })
  })

  it('persists a single SCORM 1.2 key/value and updates the lesson_status column', async () => {
    db.query.mockResolvedValueOnce({ rows: [sessionRow({ lesson_status: 'incomplete', session_data: { 'cmi.core.lesson_status': 'incomplete' } })] })

    const result = await scormService.setValue({
      actor: associate, sessionToken: 'session-1', key: 'cmi.core.lesson_status', value: 'incomplete'
    })

    expect(result.ok).toBe(true)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE scorm_sessions'),
      ['tenant-1', 'user-1', 'session-1', JSON.stringify({ 'cmi.core.lesson_status': 'incomplete' }), 'incomplete', null, null]
    )
  })

  it('persists a batch of SCORM 2004 keys, mapping completion_status/success_status/score/suspend_data', async () => {
    const values = {
      'cmi.completion_status': 'completed',
      'cmi.success_status': 'passed',
      'cmi.score.raw': '92',
      'cmi.suspend_data': 'bookmark=3'
    }
    db.query.mockResolvedValueOnce({ rows: [sessionRow({ lesson_status: 'passed', score: 92, suspend_data: 'bookmark=3', session_data: values })] })

    const result = await scormService.setValue({ actor: associate, sessionToken: 'session-1', values })

    expect(result.ok).toBe(true)
    // success_status overwrites completion_status in lesson_status (last key wins)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE scorm_sessions'),
      ['tenant-1', 'user-1', 'session-1', JSON.stringify(values), 'passed', 92, 'bookmark=3']
    )
  })
})

// ---------------------------------------------------------------------------
// extractColumnUpdates (CMI 1.2 / 2004 key mapping)
// ---------------------------------------------------------------------------

describe('scormService.extractColumnUpdates', () => {
  it('maps SCORM 1.2 keys', () => {
    expect(scormService.extractColumnUpdates({
      'cmi.core.lesson_status': 'completed',
      'cmi.core.score.raw': '80',
      'cmi.suspend_data': 'data'
    })).toEqual({ lesson_status: 'completed', score: 80, suspend_data: 'data' })
  })

  it('maps SCORM 2004 keys, with success_status taking precedence over completion_status', () => {
    expect(scormService.extractColumnUpdates({
      'cmi.completion_status': 'completed',
      'cmi.success_status': 'failed',
      'cmi.score.raw': '40'
    })).toEqual({ lesson_status: 'failed', score: 40 })
  })

  it('ignores unrecognised keys and non-numeric scores', () => {
    expect(scormService.extractColumnUpdates({
      'cmi.objectives.0.id': 'obj-1',
      'cmi.core.score.raw': 'not-a-number'
    })).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

describe('scormService.commit', () => {
  it('rejects when session_token is missing', async () => {
    const result = await scormService.commit({ actor: associate, sessionToken: undefined })
    expect(result).toEqual({ ok: false, status: 400, error: 'session_token is required' })
  })

  it('audits SCORM_SESSION_COMMITTED and returns ok', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [sessionRow({ lesson_status: 'incomplete', score: 50 })] }, // UPDATE ... RETURNING *
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await scormService.commit({ actor: associate, sessionToken: 'session-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result).toEqual({ ok: true, status: 200 })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.SCORM_SESSION_COMMITTED,
        entityType: 'ScormSession',
        entityId: 'session-1'
      }), client)
  })

  it('returns 404 and rolls back when the session does not exist', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [] }, // UPDATE ... RETURNING * -> nothing
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await scormService.commit({ actor: associate, sessionToken: 'missing' })

    expect(result).toEqual({ ok: false, status: 404, error: 'SCORM session not found' })
    expect(client.query).toHaveBeenLastCalledWith('ROLLBACK')
    expect(auditLog.write).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// terminate
// ---------------------------------------------------------------------------

describe('scormService.terminate', () => {
  it('rejects when session_token is missing', async () => {
    const result = await scormService.terminate({ actor: associate, sessionToken: undefined })
    expect(result).toEqual({ ok: false, status: 400, error: 'session_token is required' })
  })

  it('returns 404 when the session does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await scormService.terminate({ actor: associate, sessionToken: 'missing' })
    expect(result).toEqual({ ok: false, status: 404, error: 'SCORM session not found' })
    expect(progressService.recordProgressEvent).not.toHaveBeenCalled()
  })

  it('audits SCORM_SESSION_TERMINATED but does not fire a progress event for an incomplete session', async () => {
    db.query.mockResolvedValueOnce({ rows: [sessionRow({ lesson_status: 'incomplete' })] })

    const result = await scormService.terminate({ actor: associate, sessionToken: 'session-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result).toEqual({ ok: true, status: 200, completed: false, completion: null })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.SCORM_SESSION_TERMINATED, entityId: 'session-1' }))
    expect(progressService.recordProgressEvent).not.toHaveBeenCalled()
  })

  it.each(['completed', 'passed'])('forwards a "%s" lesson_status to progressService as event_type=completed', async (lessonStatus) => {
    db.query.mockResolvedValueOnce({ rows: [sessionRow({ lesson_status: lessonStatus, score: 85, asset_id: 'asset-1' })] })
    progressService.recordProgressEvent.mockResolvedValueOnce({ ok: true, completion: { id: 'completion-1', assetId: 'asset-1', score: 85 } })

    const result = await scormService.terminate({ actor: associate, sessionToken: 'session-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.completed).toBe(true)
    expect(result.completion).toEqual({ id: 'completion-1', assetId: 'asset-1', score: 85 })

    expect(progressService.recordProgressEvent).toHaveBeenCalledWith({
      actor: associate,
      input: {
        asset_id: 'asset-1',
        event_type: 'completed',
        metadata: {
          scorm_completion_status: lessonStatus,
          score: 85,
          time_spent_minutes: expect.any(Number)
        }
      },
      ipAddress: '127.0.0.1',
      userAgent: 'jest'
    })
  })

  it('propagates a progressService failure', async () => {
    db.query.mockResolvedValueOnce({ rows: [sessionRow({ lesson_status: 'completed' })] })
    progressService.recordProgressEvent.mockResolvedValueOnce({ ok: false, status: 400, error: 'Referenced asset or user does not exist' })

    const result = await scormService.terminate({ actor: associate, sessionToken: 'session-1' })

    expect(result).toEqual({ ok: false, status: 400, error: 'Referenced asset or user does not exist' })
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — Rule 10: at least one allowed role succeeds, one denied
// role gets a 403 + ACCESS_VIOLATION
// ---------------------------------------------------------------------------

describe('scorm routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const scormRoutes = require('../../src/modules/content/scormRoutes')

  const app = express()
  app.use(express.json())
  app.use(scormRoutes)

  function expectDenied(res) {
    expect(res.status).toBe(403)
    expect(res.body).toEqual({ error: 'Forbidden' })
  }

  function mockDenied() {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
      .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert
  }

  function mockAllowed() {
    db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(create, learning, progress)
  }

  describe('POST /scorm/initialize', () => {
    it('allows associate to initialize a session (200)', async () => {
      mockAllowed()
      db.query.mockResolvedValueOnce({ rows: [{ id: 'asset-1', content_type: 'scorm' }] }) // asset lookup

      const client = txClient([
        {}, // BEGIN
        { rows: [sessionRow()] }, // INSERT ... RETURNING *
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/scorm/initialize')
        .set('x-test-role', 'associate')
        .send({ asset_id: 'asset-1' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ session_token: 'session-1', lesson_status: null, score: null, suspend_data: null })
    })

    it('denies a role without learning.progress.create (403) and logs ACCESS_VIOLATION', async () => {
      mockDenied()

      const res = await request(app)
        .post('/scorm/initialize')
        .set('x-test-role', 'external')
        .send({ asset_id: 'asset-1' })

      expectDenied(res)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('POST /scorm/set-value', () => {
    it('allows associate to persist a CMI value (200)', async () => {
      mockAllowed()
      db.query.mockResolvedValueOnce({ rows: [sessionRow({ lesson_status: 'incomplete' })] }) // UPDATE ... RETURNING *

      const res = await request(app)
        .post('/scorm/set-value')
        .set('x-test-role', 'associate')
        .send({ session_token: 'session-1', key: 'cmi.core.lesson_status', value: 'incomplete' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
    })

    it('denies a role without learning.progress.create (403) and logs ACCESS_VIOLATION', async () => {
      mockDenied()

      const res = await request(app)
        .post('/scorm/set-value')
        .set('x-test-role', 'external')
        .send({ session_token: 'session-1', key: 'cmi.core.lesson_status', value: 'incomplete' })

      expectDenied(res)
    })
  })

  describe('POST /scorm/commit', () => {
    it('allows associate to commit a session (200)', async () => {
      mockAllowed()

      const client = txClient([
        {}, // BEGIN
        { rows: [sessionRow({ lesson_status: 'incomplete' })] }, // UPDATE ... RETURNING *
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/scorm/commit')
        .set('x-test-role', 'associate')
        .send({ session_token: 'session-1' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
    })

    it('denies a role without learning.progress.create (403) and logs ACCESS_VIOLATION', async () => {
      mockDenied()

      const res = await request(app)
        .post('/scorm/commit')
        .set('x-test-role', 'external')
        .send({ session_token: 'session-1' })

      expectDenied(res)
    })
  })

  describe('POST /scorm/terminate', () => {
    it('allows associate to terminate a session (200)', async () => {
      mockAllowed()
      db.query.mockResolvedValueOnce({ rows: [sessionRow({ lesson_status: 'incomplete' })] }) // SELECT session

      const res = await request(app)
        .post('/scorm/terminate')
        .set('x-test-role', 'associate')
        .send({ session_token: 'session-1' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, completed: false, completion: null })
    })

    it('denies a role without learning.progress.create (403) and logs ACCESS_VIOLATION', async () => {
      mockDenied()

      const res = await request(app)
        .post('/scorm/terminate')
        .set('x-test-role', 'external')
        .send({ session_token: 'session-1' })

      expectDenied(res)
    })
  })
})
