// tests/unit/paths.test.js
//
// Unit tests for src/modules/learning/pathService.js and the RBAC wiring in
// src/modules/learning/pathRoutes.js.
//
// Pattern (matches tests/unit/content.test.js): mock db, crypto.randomUUID,
// and auditLog.write so we can assert exactly what gets written, and that
// Rule 6 (asset_id FK validation) and Rule 7 (draft-path visibility) are
// enforced. permissionEngine is NOT mocked — its real hasPermission/
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
const pathService = require('../../src/modules/learning/pathService')

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

function pathRow(overrides = {}) {
  return {
    id: 'path-1',
    tenant_id: 'tenant-1',
    title: 'Kubernetes Fundamentals',
    description: 'Get up to speed on Kubernetes',
    path_type: 'competency',
    proficiency_level_id: 'pl-1',
    proficiency_level_name: 'Intermediate',
    proficiency_level_order: 2,
    estimated_duration_minutes: 120,
    status: 'draft',
    created_by: 'user-1',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides
  }
}

function pathItemRow(overrides = {}) {
  return {
    id: 'item-1',
    path_id: 'path-1',
    asset_id: 'asset-1',
    item_order: 1,
    is_mandatory: true,
    prerequisite_item_id: null,
    asset_title: 'Intro to Kubernetes',
    asset_content_type: 'video',
    asset_duration_minutes: 45,
    asset_status: 'published',
    asset_proficiency_level_id: 'pl-1',
    asset_proficiency_level_name: 'Intermediate',
    asset_proficiency_level_order: 2,
    ...overrides
  }
}

const ldAdmin = { id: 'user-1', tenantId: 'tenant-1', roles: ['ld_admin'], activeRole: 'ld_admin', activeRoleId: 'role-ld_admin' }
const associate = { id: 'user-2', tenantId: 'tenant-1', roles: ['associate'], activeRole: 'associate', activeRoleId: 'role-associate' }

beforeEach(() => {
  jest.clearAllMocks()
  crypto.randomUUID.mockReturnValue('path-1')
})

// ---------------------------------------------------------------------------
// createPath
// ---------------------------------------------------------------------------

describe('createPath', () => {
  const baseInput = {
    title: 'Kubernetes Fundamentals',
    description: 'Get up to speed on Kubernetes',
    path_type: 'competency',
    proficiency_level_id: 'pl-1',
    estimated_duration_minutes: 120,
    items: [
      { asset_id: 'asset-1', item_order: 1 },
      { asset_id: 'asset-2', item_order: 2, prerequisite_item_order: 1 }
    ]
  }

  it('creates a path with ordered items, resolves prerequisites, and writes LEARNING_PATH_CREATED', async () => {
    crypto.randomUUID
      .mockReturnValueOnce('path-1')
      .mockReturnValueOnce('item-1')
      .mockReturnValueOnce('item-2')

    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'pl-1' }] }) // proficiency level lookup
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1' }, { id: 'asset-2' }] }) // findMissingAssetIds

    const client = txClient([
      {}, // BEGIN
      {}, // INSERT learning_paths
      {}, // INSERT learning_path_items item-1
      {}, // INSERT learning_path_items item-2
      { rows: [pathRow()] }, // fetchPathWithItems -> path
      { rows: [
        pathItemRow({ id: 'item-1', item_order: 1 }),
        pathItemRow({ id: 'item-2', item_order: 2, asset_id: 'asset-2', prerequisite_item_id: 'item-1' })
      ] }, // fetchPathWithItems -> items
      {}, // audit insert
      {}  // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.createPath({
      actor: ldAdmin, input: baseInput, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.path.items).toHaveLength(2)
    expect(result.path.items[1].prerequisiteItemId).toBe('item-1')

    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        actionType: auditLog.AuditActions.LEARNING_PATH_CREATED,
        entityType: 'LearningPath',
        entityId: 'path-1',
        result: 'success'
      }),
      client
    )
  })

  it('returns 400 for an invalid path_type without touching the database', async () => {
    const result = await pathService.createPath({
      actor: ldAdmin, input: { ...baseInput, path_type: 'invalid' }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('path_type') })
    expect(db.query).not.toHaveBeenCalled()
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 400 when items have a duplicated item_order', async () => {
    const result = await pathService.createPath({
      actor: ldAdmin,
      input: { ...baseInput, items: [{ asset_id: 'asset-1', item_order: 1 }, { asset_id: 'asset-2', item_order: 1 }] },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('duplicated') })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 400 when prerequisite_item_order does not match any item_order in items', async () => {
    const result = await pathService.createPath({
      actor: ldAdmin,
      input: { ...baseInput, items: [{ asset_id: 'asset-1', item_order: 1, prerequisite_item_order: 99 }] },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('prerequisite_item_order') })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 400 when an asset_id does not exist for the tenant (Rule 6)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'pl-1' }] }) // proficiency level lookup
      .mockResolvedValueOnce({ rows: [{ id: 'asset-1' }] }) // asset-2 missing

    const result = await pathService.createPath({
      actor: ldAdmin, input: baseInput, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('asset-2') })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 400 when proficiency_level_id does not exist for the tenant', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // proficiency level lookup -> not found

    const result = await pathService.createPath({
      actor: ldAdmin, input: baseInput, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('proficiency_level_id') })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getPathById (Rule 7 — visibility)
// ---------------------------------------------------------------------------

describe('getPathById', () => {
  it('returns a published path to an associate without any visibility lookup', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [pathRow({ status: 'published', created_by: 'user-1' })] }) // path lookup
      .mockResolvedValueOnce({ rows: [pathItemRow()] }) // items lookup

    const result = await pathService.getPathById({
      actor: associate, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.path.status).toBe('published')
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('returns 404 when the path does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await pathService.getPathById({
      actor: associate, pathId: 'missing', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Learning path not found' })
  })

  it('allows the creator to view their own draft path without an extra lookup', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [pathRow({ status: 'draft', created_by: 'user-2' })] }) // path lookup
      .mockResolvedValueOnce({ rows: [pathItemRow()] }) // items lookup

    const result = await pathService.getPathById({
      actor: associate, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.path.status).toBe('draft')
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('allows an assignee to view a draft path they did not create', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [pathRow({ status: 'draft', created_by: 'user-1' })] }) // path lookup
      .mockResolvedValueOnce({ rows: [pathItemRow()] }) // items lookup
      .mockResolvedValueOnce({ rows: [] }) // hasPermission(create, learning, paths) -> denied for associate
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // assignments lookup -> found

    const result = await pathService.getPathById({
      actor: associate, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.path.status).toBe('draft')
  })

  it('hides a draft path from a non-creator, non-assignee associate, and logs ACCESS_VIOLATION', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [pathRow({ status: 'draft', created_by: 'user-1' })] }) // path lookup
      .mockResolvedValueOnce({ rows: [pathItemRow()] }) // items lookup
      .mockResolvedValueOnce({ rows: [] }) // hasPermission(create, learning, paths) -> denied
      .mockResolvedValueOnce({ rows: [] }) // assignments lookup -> not found

    const result = await pathService.getPathById({
      actor: associate, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.ACCESS_VIOLATION,
        entityType: 'LearningPath',
        entityId: 'path-1',
        result: 'failure'
      })
    )
  })

  it('allows ld_admin to view any draft path without an assignment', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [pathRow({ status: 'draft', created_by: 'user-2' })] }) // path lookup
      .mockResolvedValueOnce({ rows: [pathItemRow()] }) // items lookup
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(create, learning, paths) -> granted

    const result = await pathService.getPathById({
      actor: ldAdmin, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — Rule 10: at least one allowed role succeeds, one denied
// role gets a 403 + ACCESS_VIOLATION
// ---------------------------------------------------------------------------

describe('learning path routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const pathRoutes = require('../../src/modules/learning/pathRoutes')

  const app = express()
  app.use(express.json())
  app.use(pathRoutes)

  describe('POST /learning-paths', () => {
    const validBody = {
      title: 'Kubernetes Fundamentals',
      path_type: 'competency',
      items: [{ asset_id: 'asset-1', item_order: 1 }]
    }

    it('allows ld_admin (201)', async () => {
      crypto.randomUUID
        .mockReturnValueOnce('path-1')
        .mockReturnValueOnce('item-1')

      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(create, learning, paths)
        .mockResolvedValueOnce({ rows: [{ id: 'asset-1' }] }) // findMissingAssetIds

      const client = txClient([
        {}, // BEGIN
        {}, // INSERT learning_paths
        {}, // INSERT learning_path_items
        { rows: [pathRow({ proficiency_level_id: null, proficiency_level_name: null, proficiency_level_order: null })] }, // fetchPathWithItems -> path
        { rows: [pathItemRow()] }, // fetchPathWithItems -> items
        {}, // audit insert
        {}  // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/learning-paths')
        .set('x-test-role', 'ld_admin')
        .send(validBody)

      expect(res.status).toBe(201)
      expect(res.body.status).toBe('draft')
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/learning-paths')
        .set('x-test-role', 'associate')
        .send(validBody)

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('GET /learning-paths/:id', () => {
    it('allows associate to view a published path (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, learning, paths)
        .mockResolvedValueOnce({ rows: [pathRow({ status: 'published' })] }) // path lookup
        .mockResolvedValueOnce({ rows: [pathItemRow()] }) // items lookup

      const res = await request(app)
        .get('/learning-paths/path-1')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('published')
    })

    it('returns 404 for a path that does not exist', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, learning, paths)
        .mockResolvedValueOnce({ rows: [] }) // path lookup -> none

      const res = await request(app)
        .get('/learning-paths/missing')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(404)
    })
  })
})
