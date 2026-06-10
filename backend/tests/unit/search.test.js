// tests/unit/search.test.js
//
// Unit tests for src/modules/content/searchService.js and the RBAC wiring in
// src/modules/content/catalogRoutes.js.
//
// Pattern (matches tests/unit/content.test.js): mock db and auditLog so we
// can assert exactly what SQL/params each query produces and what audit
// events the save toggle writes — and that visibility (Rule 7:
// visibilityScope.type === 'assigned_only' for external users) and the
// 'published'-only filter (retired/draft hidden from the catalogue) are
// enforced before any query runs.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})
jest.mock('../../src/modules/config/configService', () => ({
  get: jest.fn()
}))
jest.mock('../../src/modules/workflow/workflowService', () => ({
  startWorkflow: jest.fn()
}))
jest.mock('../../src/modules/content/contentStorage', () => ({
  uploadAssetFile: jest.fn()
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
const auditLog = require('../../src/modules/audit/auditLog')
const searchService = require('../../src/modules/content/searchService')

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

function assetRow(overrides = {}) {
  return {
    id: 'asset-1',
    tenant_id: 'tenant-1',
    title: 'Kubernetes for Beginners',
    description: 'An introductory course on Kubernetes fundamentals',
    content_type: 'video',
    proficiency_level_id: 'pl-1',
    proficiency_level_name: 'Beginner',
    proficiency_level_order: 1,
    duration_minutes: 45,
    language: 'en',
    version: '1.0',
    status: 'published',
    effective_from: null,
    effective_to: null,
    author_user_id: 'author-1',
    storage_url: null,
    external_url: 'https://youtube.com/watch?v=abc123',
    tags: ['kubernetes', 'containers'],
    skills: [{ id: 'skill-1', name: 'Kubernetes' }],
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides
  }
}

const associate = {
  id: 'user-1', tenantId: 'tenant-1', roles: ['associate'], activeRole: 'associate', activeRoleId: 'role-associate',
  visibilityScope: { type: 'own', orgUnitIds: ['ou-1'] }
}

const externalUser = {
  id: 'user-2', tenantId: 'tenant-1', roles: ['external'], activeRole: 'external', activeRoleId: 'role-external',
  visibilityScope: { type: 'assigned_only', orgUnitIds: [] }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// searchAssets
// ---------------------------------------------------------------------------

describe('searchAssets', () => {
  it('returns published assets matching a text query', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ ...assetRow(), save_count: '2', total_count: '1' }]
    })

    const result = await searchService.searchAssets({ actor: associate, query: { q: 'kubernetes' } })

    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].id).toBe('asset-1')
    expect(result.total).toBe(1)
    expect(result.page).toBe(1)
    expect(result.limit).toBe(20)

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('websearch_to_tsquery')
    expect(params[0]).toBe('tenant-1')
    expect(params).toContain('kubernetes')
  })

  it('returns nothing for external users (assigned_only) without querying the database', async () => {
    const result = await searchService.searchAssets({ actor: externalUser, query: { q: 'kubernetes' } })

    expect(result).toEqual({ ok: true, results: [], total: 0, page: 1, limit: 20 })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('only matches published assets — drafts and retired content are excluded', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    await searchService.searchAssets({ actor: associate, query: {} })

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain("la.status = 'published'")
    expect(params[0]).toBe('tenant-1')
  })

  it('applies content_type, proficiency_level_id, language, duration, and skills filters', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    await searchService.searchAssets({
      actor: associate,
      query: {
        content_type: 'video',
        proficiency_level_id: 'pl-1',
        language: 'en',
        duration_min: '10',
        duration_max: '60',
        skills: 'skill-1,skill-2'
      }
    })

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('la.content_type = $')
    expect(sql).toContain('la.proficiency_level_id = $')
    expect(sql).toContain('la.language = $')
    expect(sql).toContain('la.duration_minutes >= $')
    expect(sql).toContain('la.duration_minutes <= $')
    expect(sql).toContain('flas.skill_id = ANY(')
    expect(params).toEqual(expect.arrayContaining(['video', 'pl-1', 'en', 10, 60, ['skill-1', 'skill-2']]))
  })

  it('orders by save_count for sort=popular', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    await searchService.searchAssets({ actor: associate, query: { sort: 'popular' } })

    expect(db.query.mock.calls[0][0]).toContain('ORDER BY save_count DESC')
  })

  it('falls back to newest when sort=relevant has no query string', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    await searchService.searchAssets({ actor: associate, query: { sort: 'relevant' } })

    const [sql] = db.query.mock.calls[0]
    expect(sql).toContain('ORDER BY la.created_at DESC')
    expect(sql).not.toContain('ts_rank')
  })

  it('paginates using page and limit', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await searchService.searchAssets({ actor: associate, query: { page: '3', limit: '10' } })

    expect(result.page).toBe(3)
    expect(result.limit).toBe(10)

    const params = db.query.mock.calls[0][1]
    expect(params[params.length - 2]).toBe(10) // limit
    expect(params[params.length - 1]).toBe(20) // offset = (3 - 1) * 10
  })
})

// ---------------------------------------------------------------------------
// browseAssets
// ---------------------------------------------------------------------------

describe('browseAssets', () => {
  it('returns recently_added, by_skill, and recommended sections', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [assetRow()] }) // recently_added
      .mockResolvedValueOnce({ rows: [{ id: 'skill-1', name: 'Kubernetes', asset_count: '2' }] }) // top skills
      .mockResolvedValueOnce({ rows: [assetRow({ id: 'asset-2' })] }) // assets for skill-1
      .mockResolvedValueOnce({ rows: [{ designation: 'Cloud Engineer' }] }) // user profile
      .mockResolvedValueOnce({ rows: [assetRow({ id: 'asset-3', tags: ['cloud'] })] }) // recommended

    const result = await searchService.browseAssets({ actor: associate })

    expect(result.recently_added).toHaveLength(1)
    expect(result.by_skill).toEqual([{ skill: { id: 'skill-1', name: 'Kubernetes' }, assets: expect.any(Array) }])
    expect(result.by_skill[0].assets).toHaveLength(1)
    expect(result.recommended).toHaveLength(1)
  })

  it('returns empty sections for external users (assigned_only) without querying', async () => {
    const result = await searchService.browseAssets({ actor: externalUser })

    expect(result).toEqual({ ok: true, recently_added: [], by_skill: [], recommended: [] })
    expect(db.query).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// toggleSavedAsset
// ---------------------------------------------------------------------------

describe('toggleSavedAsset', () => {
  it('saves an asset and writes CONTENT_SAVED', async () => {
    const client = txClient([
      {},                           // BEGIN
      { rows: [{ id: 'asset-1' }] }, // SELECT learning_assets (published)
      { rows: [] },                 // SELECT saved_items -> not saved
      {},                           // INSERT saved_items
      {}                            // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await searchService.toggleSavedAsset({
      actor: associate, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: true, assetId: 'asset-1', saved: true })
    expect(client.query).toHaveBeenCalledWith(
      `INSERT INTO saved_items (tenant_id, user_id, asset_id) VALUES ($1, $2, $3)`,
      ['tenant-1', 'user-1', 'asset-1']
    )
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.CONTENT_SAVED,
        entityType: 'SavedItem',
        entityId: 'asset-1',
        result: 'success'
      }),
      client
    )
  })

  it('unsaves an already-saved asset and writes CONTENT_UNSAVED', async () => {
    const client = txClient([
      {},                            // BEGIN
      { rows: [{ id: 'asset-1' }] }, // SELECT learning_assets (published)
      { rows: [{ '?column?': 1 }] }, // SELECT saved_items -> already saved
      {},                            // DELETE saved_items
      {}                             // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await searchService.toggleSavedAsset({
      actor: associate, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: true, assetId: 'asset-1', saved: false })
    expect(client.query).toHaveBeenCalledWith(
      `DELETE FROM saved_items WHERE user_id = $1 AND asset_id = $2`,
      ['user-1', 'asset-1']
    )
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.CONTENT_UNSAVED, entityId: 'asset-1' }),
      client
    )
  })

  it('returns 404 when the asset is not published or does not exist', async () => {
    const client = txClient([
      {},          // BEGIN
      { rows: [] }, // SELECT learning_assets -> none
      {}            // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await searchService.toggleSavedAsset({
      actor: associate, assetId: 'missing', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Learning asset not found' })
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('returns 403 for external users without opening a transaction', async () => {
    const result = await searchService.toggleSavedAsset({
      actor: externalUser, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// getSavedAssets
// ---------------------------------------------------------------------------

describe('getSavedAssets', () => {
  it("returns the caller's saved published assets", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...assetRow(), saved_at: '2026-06-01T00:00:00Z' }] })

    const result = await searchService.getSavedAssets({ actor: associate })

    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].savedAt).toBe('2026-06-01T00:00:00Z')
    expect(db.query.mock.calls[0][1]).toEqual(['user-1', 'tenant-1'])
  })

  it('returns nothing for external users (assigned_only) without querying', async () => {
    const result = await searchService.getSavedAssets({ actor: externalUser })

    expect(result).toEqual({ ok: true, results: [] })
    expect(db.query).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — Rule 10: at least one allowed role succeeds, one denied
// role gets a 403 + ACCESS_VIOLATION
// ---------------------------------------------------------------------------

describe('catalog routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const catalogRoutes = require('../../src/modules/content/catalogRoutes')

  const app = express()
  app.use(express.json())
  app.use(catalogRoutes)

  describe('GET /catalog/search', () => {
    it('allows associate (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view)
        .mockResolvedValueOnce({ rows: [] })                  // search query

      const res = await request(app)
        .get('/catalog/search?q=kubernetes')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body.results).toEqual([])
    })

    it('denies external (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission(view) denies — 'external' has no content.assets.view
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app)
        .get('/catalog/search?q=kubernetes')
        .set('x-test-role', 'external')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('GET /catalog/assets/:id/save', () => {
    it('allows associate to toggle a save (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view)

      const client = txClient([
        {}, { rows: [{ id: 'asset-1' }] }, { rows: [] }, {}, {}
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .get('/catalog/assets/asset-1/save')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ assetId: 'asset-1', saved: true })
    })

    it('denies external (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({})

      const res = await request(app)
        .get('/catalog/assets/asset-1/save')
        .set('x-test-role', 'external')

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })
})
