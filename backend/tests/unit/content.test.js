// tests/unit/content.test.js
//
// Unit tests for src/modules/content/contentService.js and the RBAC wiring
// in src/modules/content/contentRoutes.js.
//
// Pattern (matches tests/unit/users.test.js / workflow.test.js): mock db,
// auditLog, configService, workflowService and contentStorage so we can
// assert exactly what state changes, audit events, and workflow/storage
// calls each action produces — and that visibility (Rule 7) and config-driven
// status transitions (Rule 1) are enforced before any write.

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

const crypto = require('crypto')
const db = require('../../src/db')
const auditLog = require('../../src/modules/audit/auditLog')
const configService = require('../../src/modules/config/configService')
const workflowService = require('../../src/modules/workflow/workflowService')
const contentStorage = require('../../src/modules/content/contentStorage')
const contentService = require('../../src/modules/content/contentService')

const STATUS_TRANSITIONS = {
  draft: ['in_review', 'published', 'retired'],
  in_review: ['published', 'draft', 'retired'],
  published: ['retired'],
  retired: []
}

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

function assetRow(overrides = {}) {
  return {
    id: 'asset-1',
    tenant_id: 'tenant-1',
    title: 'Intro to Communication',
    description: 'A short article on workplace communication',
    content_type: 'article',
    proficiency_level_id: 'pl-1',
    proficiency_level_name: 'Intermediate',
    proficiency_level_order: 2,
    duration_minutes: 30,
    language: 'en',
    version: 1,
    status: 'draft',
    effective_from: null,
    effective_to: null,
    author_user_id: 'user-1',
    storage_url: null,
    external_url: null,
    tags: ['communication', 'onboarding'],
    skills: [{ id: 'skill-1', name: 'Communication' }, { id: 'skill-2', name: 'Teamwork' }],
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides
  }
}

const ldAdmin = { id: 'user-1', tenantId: 'tenant-1', roles: ['ld_admin'], activeRole: 'ld_admin', activeRoleId: 'role-ld_admin' }
const superAdmin = { id: 'user-2', tenantId: 'tenant-1', roles: ['super_admin'], activeRole: 'super_admin', activeRoleId: 'role-super_admin' }
const associate = { id: 'user-1', tenantId: 'tenant-1', roles: ['associate'], activeRole: 'associate', activeRoleId: 'role-associate' }

beforeEach(() => {
  jest.clearAllMocks()
  crypto.randomUUID.mockReturnValue('asset-1')
})

// ---------------------------------------------------------------------------
// createAsset
// ---------------------------------------------------------------------------

describe('createAsset', () => {
  const baseInput = {
    title: 'Intro to Communication',
    description: 'A short article on workplace communication',
    content_type: 'article',
    proficiency_level_id: 'pl-1',
    duration_minutes: 30,
    language: 'en',
    skill_ids: ['skill-1', 'skill-2'],
    tags: ['communication', 'onboarding']
  }

  it('creates a draft asset linked to skills via FK and writes CONTENT_CREATED', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'skill-1' }, { id: 'skill-2' }] }) // findMissingSkillIds
      .mockResolvedValueOnce({ rows: [{ id: 'pl-1' }] }) // proficiency level lookup

    const client = txClient([
      {},                     // BEGIN
      {},                     // INSERT learning_assets
      {},                     // INSERT learning_asset_skills (skill-1)
      {},                     // INSERT learning_asset_skills (skill-2)
      { rows: [assetRow()] }, // fetchAssetWithRelations
      {},                     // audit insert
      {}                      // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.createAsset({
      actor: ldAdmin, input: baseInput, file: undefined, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.asset.status).toBe('draft')
    expect(result.asset.skills).toHaveLength(2)
    expect(result.asset.tags).toEqual(['communication', 'onboarding'])

    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        actionType: auditLog.AuditActions.CONTENT_CREATED,
        entityType: 'LearningAsset',
        entityId: 'asset-1',
        result: 'success'
      }),
      client
    )
  })

  it('rejects video content without a valid YouTube/Vimeo external_url, before touching the database', async () => {
    const result = await contentService.createAsset({
      actor: ldAdmin,
      input: { ...baseInput, content_type: 'video', external_url: 'https://example.com/clip.mp4' },
      file: undefined, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('external_url') })
    expect(db.query).not.toHaveBeenCalled()
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('rejects unknown skill_ids with 400 before opening a transaction', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'skill-1' }] }) // skill-2 not found

    const result = await contentService.createAsset({
      actor: ldAdmin, input: baseInput, file: undefined, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('skill-2') })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('uploads pdf files to storage before inserting the row, and stores storage_url', async () => {
    crypto.randomUUID.mockReturnValueOnce('asset-2')
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'skill-1' }, { id: 'skill-2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pl-1' }] })
    contentStorage.uploadAssetFile.mockResolvedValueOnce('https://storage.example.com/tenant-1/asset-2/guide.pdf')

    const client = txClient([
      {}, {}, {}, {},
      { rows: [assetRow({ id: 'asset-2', content_type: 'pdf', storage_url: 'https://storage.example.com/tenant-1/asset-2/guide.pdf' })] },
      {}, {}
    ])
    db.getClient.mockResolvedValueOnce(client)

    const file = { originalname: 'guide.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fake content') }
    const result = await contentService.createAsset({
      actor: ldAdmin,
      input: { ...baseInput, content_type: 'pdf' },
      file, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.storageUrl).toBe('https://storage.example.com/tenant-1/asset-2/guide.pdf')
    expect(contentStorage.uploadAssetFile).toHaveBeenCalledWith({ tenantId: 'tenant-1', assetId: 'asset-2', file })
  })

  it('rejects a pdf upload whose file header is not a valid PDF, without touching the database', async () => {
    const file = { originalname: 'guide.pdf', mimetype: 'application/pdf', buffer: Buffer.from('not a pdf') }

    const result = await contentService.createAsset({
      actor: ldAdmin,
      input: { ...baseInput, content_type: 'pdf' },
      file, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('PDF header') })
    expect(db.query).not.toHaveBeenCalled()
    expect(contentStorage.uploadAssetFile).not.toHaveBeenCalled()
  })

  it('returns 400 when proficiency_level_id does not exist for the tenant', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'skill-1' }, { id: 'skill-2' }] })
      .mockResolvedValueOnce({ rows: [] })

    const result = await contentService.createAsset({
      actor: ldAdmin, input: baseInput, file: undefined, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('proficiency_level_id') })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// updateAsset
// ---------------------------------------------------------------------------

describe('updateAsset', () => {
  it('updates fields and writes CONTENT_UPDATED with old/new snapshots', async () => {
    const before = assetRow()
    const after = assetRow({ title: 'Updated title' })
    const client = txClient([
      {},                  // BEGIN
      { rows: [before] },  // fetchAssetWithRelations (before)
      {},                  // UPDATE learning_assets
      { rows: [after] },   // fetchAssetWithRelations (after)
      {},                  // audit insert
      {}                   // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.updateAsset({
      actor: ldAdmin, assetId: 'asset-1', updates: { title: 'Updated title' },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.title).toBe('Updated title')
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.CONTENT_UPDATED,
        entityId: 'asset-1',
        oldValue: expect.objectContaining({ title: 'Intro to Communication' }),
        newValue: expect.objectContaining({ title: 'Updated title' }),
        result: 'success'
      }),
      client
    )
  })

  it('returns 404 when the asset does not exist', async () => {
    const client = txClient([
      {},           // BEGIN
      { rows: [] }, // fetchAssetWithRelations -> none
      {}            // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.updateAsset({
      actor: ldAdmin, assetId: 'missing', updates: { title: 'X' }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Learning asset not found' })
    expect(auditLog.write).not.toHaveBeenCalled()
  })

  it('returns 400 when no recognised fields are provided, without opening a transaction', async () => {
    const result = await contentService.updateAsset({
      actor: ldAdmin, assetId: 'asset-1', updates: { nonsense: 'value' }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'No valid fields to update' })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('replaces linked skills via learning_asset_skills when skill_ids is provided', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 'skill-3' }] }) // findMissingSkillIds

    const before = assetRow()
    const after = assetRow({ skills: [{ id: 'skill-3', name: 'Negotiation' }] })
    const client = txClient([
      {},                 // BEGIN
      { rows: [before] }, // fetchAssetWithRelations (before)
      {},                 // DELETE learning_asset_skills
      {},                 // INSERT learning_asset_skills (skill-3)
      { rows: [after] },  // fetchAssetWithRelations (after)
      {},                 // audit insert
      {}                  // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.updateAsset({
      actor: ldAdmin, assetId: 'asset-1', updates: { skill_ids: ['skill-3'] },
      ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.skills).toEqual([{ id: 'skill-3', name: 'Negotiation' }])
    expect(client.query).toHaveBeenCalledWith('DELETE FROM learning_asset_skills WHERE asset_id = $1', ['asset-1'])
  })

  it('rejects an empty skill_ids array with 400, without opening a transaction', async () => {
    const result = await contentService.updateAsset({
      actor: ldAdmin, assetId: 'asset-1', updates: { skill_ids: [] }, ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 400, error: 'skill_ids must be a non-empty array' })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// submitForReview
// ---------------------------------------------------------------------------

describe('submitForReview', () => {
  it('transitions draft -> in_review, starts the content publication workflow, and writes CONTENT_SUBMITTED_FOR_REVIEW', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)
    workflowService.startWorkflow.mockResolvedValueOnce({
      instance: { id: 'instance-1', status: 'in_progress' },
      tasks: [{ id: 'task-1' }]
    })

    const client = txClient([
      {},                                      // BEGIN
      { rows: [assetRow({ status: 'draft' })] }, // SELECT current
      {},                                      // UPDATE status='in_review'
      { rows: [{ id: 'def-1' }] },             // SELECT workflow_definitions
      { rows: [assetRow({ status: 'in_review' })] }, // fetchAssetWithRelations
      {},                                      // audit insert
      {}                                       // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.submitForReview({
      actor: ldAdmin, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.status).toBe('in_review')
    expect(result.workflow.instance.id).toBe('instance-1')
    expect(workflowService.startWorkflow).toHaveBeenCalledWith('def-1', 'LearningAsset', 'asset-1', 'user-1', client)
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.CONTENT_SUBMITTED_FOR_REVIEW,
        oldValue: { status: 'draft' },
        newValue: { status: 'in_review' },
        metadata: { workflowInstanceId: 'instance-1' },
        result: 'success'
      }),
      client
    )
  })

  it('returns 409 when the current status cannot transition to in_review', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)

    const client = txClient([
      {},                                          // BEGIN
      { rows: [assetRow({ status: 'published' })] }, // SELECT current
      {}                                           // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.submitForReview({
      actor: ldAdmin, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 409, error: expect.stringContaining('Cannot transition') })
    expect(workflowService.startWorkflow).not.toHaveBeenCalled()
  })

  it('returns 500 when no active content publication workflow is configured', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)

    const client = txClient([
      {},                                       // BEGIN
      { rows: [assetRow({ status: 'draft' })] }, // SELECT current
      {},                                       // UPDATE status='in_review'
      { rows: [] },                             // SELECT workflow_definitions -> none
      {}                                        // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.submitForReview({
      actor: ldAdmin, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 500, error: expect.stringContaining('workflow') })
  })
})

// ---------------------------------------------------------------------------
// publishAsset
// ---------------------------------------------------------------------------

describe('publishAsset', () => {
  it('publishes content that has gone through review (in_review -> published)', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)

    const client = txClient([
      {},                                          // BEGIN
      { rows: [assetRow({ status: 'in_review' })] }, // SELECT current
      {},                                          // UPDATE status='published'
      { rows: [assetRow({ status: 'published' })] }, // fetchAssetWithRelations
      {},                                          // audit insert
      {}                                           // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.publishAsset({
      actor: ldAdmin, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.status).toBe('published')
    expect(configService.get).toHaveBeenCalledTimes(1) // no bypass-role lookup needed from in_review
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.CONTENT_PUBLISHED,
        oldValue: { status: 'in_review' },
        newValue: { status: 'published' },
        result: 'success'
      }),
      client
    )
  })

  it('allows super_admin to publish directly from draft, bypassing review', async () => {
    configService.get
      .mockResolvedValueOnce(STATUS_TRANSITIONS) // status_transitions
      .mockResolvedValueOnce(['super_admin'])    // publish_bypass_roles

    const client = txClient([
      {},                                       // BEGIN
      { rows: [assetRow({ status: 'draft' })] }, // SELECT current
      {},                                       // UPDATE status='published'
      { rows: [assetRow({ status: 'published' })] }, // fetchAssetWithRelations
      {},                                       // audit insert
      {}                                        // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.publishAsset({
      actor: superAdmin, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.status).toBe('published')
  })

  it('returns 409 when a non-bypass role tries to publish directly from draft', async () => {
    configService.get
      .mockResolvedValueOnce(STATUS_TRANSITIONS)
      .mockResolvedValueOnce(['super_admin'])

    const client = txClient([
      {},                                       // BEGIN
      { rows: [assetRow({ status: 'draft' })] }, // SELECT current
      {}                                        // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.publishAsset({
      actor: ldAdmin, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 409, error: expect.stringContaining('review') })
  })

  it('returns 404 when the asset does not exist', async () => {
    const client = txClient([
      {},          // BEGIN
      { rows: [] }, // SELECT current -> none
      {}            // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.publishAsset({
      actor: ldAdmin, assetId: 'missing', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Learning asset not found' })
  })
})

// ---------------------------------------------------------------------------
// retireAsset
// ---------------------------------------------------------------------------

describe('retireAsset', () => {
  it('retires a published asset and writes CONTENT_RETIRED', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)

    const client = txClient([
      {},                                          // BEGIN
      { rows: [assetRow({ status: 'published' })] }, // SELECT current
      {},                                          // UPDATE status='retired'
      { rows: [assetRow({ status: 'retired' })] }, // fetchAssetWithRelations
      {},                                          // audit insert
      {}                                           // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.retireAsset({
      actor: ldAdmin, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.status).toBe('retired')
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: auditLog.AuditActions.CONTENT_RETIRED,
        oldValue: { status: 'published' },
        newValue: { status: 'retired' },
        result: 'success'
      }),
      client
    )
  })

  it('returns 409 when already-retired content is retired again', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)

    const client = txClient([
      {},                                        // BEGIN
      { rows: [assetRow({ status: 'retired' })] }, // SELECT current
      {}                                         // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await contentService.retireAsset({
      actor: ldAdmin, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 409, error: expect.stringContaining('Cannot transition') })
  })
})

// ---------------------------------------------------------------------------
// getAssetById (Rule 7 — visibility)
// ---------------------------------------------------------------------------

describe('getAssetById', () => {
  it('returns a published asset to an associate', async () => {
    db.query.mockResolvedValueOnce({ rows: [assetRow({ status: 'published', author_user_id: 'author-1' })] })

    const result = await contentService.getAssetById({
      actor: associate, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.status).toBe('published')
  })

  it('hides a draft asset from an associate who is not the author, and logs ACCESS_VIOLATION', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [assetRow({ status: 'draft', author_user_id: 'author-1' })] }) // fetchAssetWithRelations
      .mockResolvedValueOnce({ rows: [] }) // hasPermission('edit', 'content', 'assets') -> denied for associate

    const result = await contentService.getAssetById({
      actor: associate, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.ACCESS_VIOLATION, entityId: 'asset-1', result: 'failure' })
    )
  })

  it('allows the author to view their own draft asset without an extra permission lookup', async () => {
    db.query.mockResolvedValueOnce({ rows: [assetRow({ status: 'draft', author_user_id: 'user-1' })] })

    const result = await contentService.getAssetById({
      actor: associate, assetId: 'asset-1', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result.ok).toBe(true)
    expect(result.asset.status).toBe('draft')
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('returns 404 when the asset does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await contentService.getAssetById({
      actor: associate, assetId: 'missing', ipAddress: '127.0.0.1', userAgent: 'jest'
    })

    expect(result).toEqual({ ok: false, status: 404, error: 'Learning asset not found' })
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — Rule 10: at least one allowed role succeeds, one denied
// role gets a 403 + ACCESS_VIOLATION
// ---------------------------------------------------------------------------

describe('content routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const contentRoutes = require('../../src/modules/content/contentRoutes')

  const app = express()
  app.use(express.json())
  app.use('/content/assets', contentRoutes)

  describe('POST /content/assets', () => {
    const validBody = {
      title: 'Intro to Communication',
      description: 'A short article',
      content_type: 'article',
      proficiency_level_id: 'pl-1',
      duration_minutes: 30,
      language: 'en',
      skill_ids: ['skill-1'],
      tags: ['onboarding']
    }

    it('allows ld_admin (201)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(create)
        .mockResolvedValueOnce({ rows: [{ id: 'skill-1' }] })  // findMissingSkillIds
        .mockResolvedValueOnce({ rows: [{ id: 'pl-1' }] })     // proficiency lookup

      const client = txClient([
        {}, {}, {},
        { rows: [assetRow({ skills: [{ id: 'skill-1', name: 'Communication' }], tags: ['onboarding'] })] },
        {}, {}
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/content/assets')
        .set('x-test-role', 'ld_admin')
        .send(validBody)

      expect(res.status).toBe(201)
      expect(res.body.status).toBe('draft')
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/content/assets')
        .set('x-test-role', 'associate')
        .send(validBody)

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('GET /content/assets/:id', () => {
    it('allows associate to view a published asset (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view)
        .mockResolvedValueOnce({ rows: [assetRow({ status: 'published', author_user_id: 'author-1' })] }) // fetchAssetWithRelations

      const res = await request(app)
        .get('/content/assets/asset-1')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('published')
    })

    it('denies external (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission(view) denies — 'external' has no content.assets.view
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app)
        .get('/content/assets/asset-1')
        .set('x-test-role', 'external')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
    })
  })

  describe('PUT /content/assets/:id', () => {
    it('allows ld_admin (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(edit)

      const client = txClient([
        {}, { rows: [assetRow()] }, {}, { rows: [assetRow({ title: 'Updated title' })] }, {}, {}
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .put('/content/assets/asset-1')
        .set('x-test-role', 'ld_admin')
        .send({ title: 'Updated title' })

      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Updated title')
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app)
        .put('/content/assets/asset-1')
        .set('x-test-role', 'associate')
        .send({ title: 'Hacked' })

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('POST /content/assets/:id/submit-review', () => {
    it('allows ld_admin (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(edit)
      configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)
      workflowService.startWorkflow.mockResolvedValueOnce({ instance: { id: 'instance-1', status: 'in_progress' }, tasks: [] })

      const client = txClient([
        {},
        { rows: [assetRow({ status: 'draft' })] },
        {},
        { rows: [{ id: 'def-1' }] },
        { rows: [assetRow({ status: 'in_review' })] },
        {},
        {}
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/content/assets/asset-1/submit-review')
        .set('x-test-role', 'ld_admin')

      expect(res.status).toBe(200)
      expect(res.body.asset.status).toBe('in_review')
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({})

      const res = await request(app)
        .post('/content/assets/asset-1/submit-review')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('POST /content/assets/:id/publish', () => {
    it('allows super_admin to publish directly from draft (200)', async () => {
      configService.get
        .mockResolvedValueOnce(STATUS_TRANSITIONS)
        .mockResolvedValueOnce(['super_admin'])

      const client = txClient([
        {},
        { rows: [assetRow({ status: 'draft' })] },
        {},
        { rows: [assetRow({ status: 'published' })] },
        {},
        {}
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/content/assets/asset-1/publish')
        .set('x-test-role', 'super_admin')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('published')
      expect(db.query).not.toHaveBeenCalled() // super_admin bypasses hasPermission's db lookup
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({})

      const res = await request(app)
        .post('/content/assets/asset-1/publish')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('POST /content/assets/:id/retire', () => {
    it('allows ld_admin (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(edit)
      configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)

      const client = txClient([
        {},
        { rows: [assetRow({ status: 'published' })] },
        {},
        { rows: [assetRow({ status: 'retired' })] },
        {},
        {}
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/content/assets/asset-1/retire')
        .set('x-test-role', 'ld_admin')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('retired')
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({})

      const res = await request(app)
        .post('/content/assets/asset-1/retire')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })
})
