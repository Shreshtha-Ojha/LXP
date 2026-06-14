// tests/unit/pathBuilder.test.js
//
// Unit tests for the path-builder additions to
// src/modules/learning/pathService.js (createPathWithNodes, updatePath,
// submitForReview, publishPath, duplicatePath, getAllPaths) and the RBAC
// wiring for the corresponding routes in pathRoutes.js (migration 022).
//
// Pattern matches tests/unit/paths.test.js (db/crypto/auditLog/authenticate
// mocks, txClient helper, persona objects) plus tests/unit/content.test.js
// (configService + workflowService mocks for the status-transition /
// review-workflow flows).

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
jest.mock('../../src/modules/config/configService', () => ({ get: jest.fn() }))
jest.mock('../../src/modules/workflow/workflowService', () => ({ startWorkflow: jest.fn() }))
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
const pathService = require('../../src/modules/learning/pathService')

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

const STATUS_TRANSITIONS = {
  draft: ['in_review', 'published', 'retired'],
  in_review: ['published', 'draft', 'retired'],
  published: ['retired'],
  retired: []
}

// ---------------------------------------------------------------------------
// Row factories (path_nodes / path_node_items / path_node_questions /
// path_node_question_options / learning_path_skills — migration 022)
// ---------------------------------------------------------------------------

function pathNodeRow(overrides = {}) {
  return {
    id: 'path-1',
    tenant_id: 'tenant-1',
    title: 'React Fundamentals',
    description: 'Learn React from scratch',
    path_type: 'competency',
    proficiency_level_id: null,
    proficiency_level_name: null,
    proficiency_level_order: null,
    estimated_duration_minutes: 180,
    status: 'draft',
    created_by: 'user-1',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides
  }
}

function nodeRow(overrides = {}) {
  return {
    id: 'node-1',
    path_id: 'path-1',
    type: 'content',
    title: 'Getting started',
    coins: 10,
    node_order: 1,
    ...overrides
  }
}

function nodeItemRow(overrides = {}) {
  return {
    id: 'item-1',
    node_id: 'node-1',
    asset_id: null,
    title: 'Welcome video',
    content_type: 'video',
    duration_minutes: 5,
    external_url: 'https://youtu.be/abc',
    body: null,
    item_order: 1,
    asset_title: null,
    asset_content_type: null,
    asset_duration_minutes: null,
    ...overrides
  }
}

function questionRow(overrides = {}) {
  return {
    id: 'question-1',
    node_id: 'node-2',
    question_text: 'What is JSX?',
    question_order: 1,
    ...overrides
  }
}

function optionRow(overrides = {}) {
  return {
    id: 'option-1',
    question_id: 'question-1',
    option_text: 'A templating syntax',
    is_correct: true,
    option_order: 1,
    ...overrides
  }
}

const ldAdmin = { id: 'user-1', tenantId: 'tenant-1', roles: ['ld_admin'], activeRole: 'ld_admin', activeRoleId: 'role-ld_admin', visibilityScope: { type: 'all', orgUnitIds: null } }
const trainer = { id: 'user-2', tenantId: 'tenant-1', roles: ['program_manager'], activeRole: 'program_manager', activeRoleId: 'role-program_manager', visibilityScope: { type: 'team', orgUnitIds: ['ou-1'] } }
const associate = { id: 'user-3', tenantId: 'tenant-1', roles: ['associate'], activeRole: 'associate', activeRoleId: 'role-associate', visibilityScope: { type: 'own', orgUnitIds: ['ou-1'] } }

beforeEach(() => {
  jest.clearAllMocks()
  crypto.randomUUID.mockReturnValue('path-1')
})

// ---------------------------------------------------------------------------
// createPathWithNodes
// ---------------------------------------------------------------------------

describe('createPathWithNodes', () => {
  const baseInput = {
    title: 'React Fundamentals',
    description: 'Learn React from scratch',
    path_type: 'competency',
    proficiency_level_name: 'Intermediate',
    skill_ids: ['skill-1'],
    estimated_duration_minutes: 180,
    nodes: [
      {
        type: 'content',
        title: 'Getting started',
        coins: 10,
        node_order: 1,
        items: [
          { title: 'Welcome video', content_type: 'video', duration_minutes: 5, external_url: 'https://youtu.be/abc', item_order: 1 }
        ],
        questions: []
      },
      {
        type: 'quiz',
        title: 'Check your understanding',
        coins: 5,
        node_order: 2,
        items: [],
        questions: [
          {
            question_text: 'What is JSX?',
            question_order: 1,
            options: [
              { text: 'A templating syntax', is_correct: true, option_order: 1 },
              { text: 'A database', is_correct: false, option_order: 2 }
            ]
          }
        ]
      }
    ]
  }

  it('creates a path with content and quiz nodes (201)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'pl-1' }] }) // resolveProficiencyLevelId
      .mockResolvedValueOnce({ rows: [{ id: 'skill-1' }] }) // findMissingSkillIds

    const client = txClient([
      {}, // BEGIN
      {}, // INSERT learning_paths
      {}, // INSERT path_nodes (node 1)
      {}, // INSERT path_node_items (item 1 of node 1)
      {}, // INSERT path_nodes (node 2)
      {}, // INSERT path_node_questions (question 1 of node 2)
      {}, // INSERT path_node_question_options (option 1)
      {}, // INSERT path_node_question_options (option 2)
      {}, // INSERT learning_path_skills (skill-1)
      { rows: [pathNodeRow({ proficiency_level_id: 'pl-1', proficiency_level_name: 'Intermediate', proficiency_level_order: 2 })] }, // fetch -> path
      { rows: [nodeRow({ id: 'node-1', type: 'content', title: 'Getting started', coins: 10, node_order: 1 }), nodeRow({ id: 'node-2', type: 'quiz', title: 'Check your understanding', coins: 5, node_order: 2 })] }, // fetch -> nodes
      { rows: [nodeItemRow({ id: 'item-1', node_id: 'node-1', item_order: 1 })] }, // fetch -> items
      { rows: [questionRow({ id: 'question-1', node_id: 'node-2', question_order: 1 })] }, // fetch -> questions
      { rows: [
        optionRow({ id: 'option-1', question_id: 'question-1', option_order: 1, is_correct: true, option_text: 'A templating syntax' }),
        optionRow({ id: 'option-2', question_id: 'question-1', option_order: 2, is_correct: false, option_text: 'A database' })
      ] }, // fetch -> options
      { rows: [{ id: 'skill-1', name: 'React' }] }, // fetch -> skills
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.createPathWithNodes({ actor: ldAdmin, input: baseInput, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.path.id).toBe('path-1')
    expect(result.path.status).toBe('draft')
    expect(result.path.proficiencyLevel).toEqual({ id: 'pl-1', name: 'Intermediate', levelOrder: 2 })
    expect(result.path.skills).toEqual([{ id: 'skill-1', name: 'React' }])

    expect(result.path.nodes).toHaveLength(2)
    const [contentNode, quizNode] = result.path.nodes
    expect(contentNode.items).toEqual([{
      id: 'item-1', itemOrder: 1, assetId: null, title: 'Welcome video', contentType: 'video', durationMinutes: 5, externalUrl: 'https://youtu.be/abc', body: null
    }])
    expect(quizNode.questions).toHaveLength(1)
    expect(quizNode.questions[0].options).toEqual([
      { id: 'option-1', text: 'A templating syntax', isCorrect: true, optionOrder: 1 },
      { id: 'option-2', text: 'A database', isCorrect: false, optionOrder: 2 }
    ])

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'LEARNING_PATH_CREATED',
        entityType: 'LearningPath',
        entityId: 'path-1',
        newValue: result.path,
        result: 'success'
      }),
      client
    )
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('rejects an invalid path_type (400)', async () => {
    const input = { ...baseInput, path_type: 'not-a-real-type' }

    const result = await pathService.createPathWithNodes({ actor: ldAdmin, input, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('path_type')
    expect(db.query).not.toHaveBeenCalled()
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('rejects a duplicate node_order (400)', async () => {
    const input = {
      ...baseInput,
      nodes: [
        { ...baseInput.nodes[0], node_order: 1 },
        { ...baseInput.nodes[1], node_order: 1 }
      ]
    }

    const result = await pathService.createPathWithNodes({ actor: ldAdmin, input, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('duplicated')
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('rejects an unknown skill_id (400, Rule 6)', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 'pl-1' }] }) // resolveProficiencyLevelId
      .mockResolvedValueOnce({ rows: [] }) // findMissingSkillIds -> skill-1 not found

    const result = await pathService.createPathWithNodes({ actor: ldAdmin, input: baseInput, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('skill-1')
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('rejects an unknown asset_id (400, Rule 6)', async () => {
    const input = {
      ...baseInput,
      proficiency_level_name: null,
      skill_ids: [],
      nodes: [
        {
          type: 'content',
          title: 'From catalogue',
          coins: 10,
          node_order: 1,
          items: [{ asset_id: 'asset-99', item_order: 1 }],
          questions: []
        }
      ]
    }

    db.query.mockResolvedValueOnce({ rows: [] }) // findMissingAssetIds -> asset-99 not found

    const result = await pathService.createPathWithNodes({ actor: ldAdmin, input, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('asset-99')
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('rejects an unknown proficiency_level_name (400)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // resolveProficiencyLevelId -> not found

    const result = await pathService.createPathWithNodes({ actor: ldAdmin, input: baseInput, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(400)
    expect(result.error).toContain('Unknown proficiency_level_name')
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// updatePath
// ---------------------------------------------------------------------------

describe('updatePath', () => {
  const updateInput = {
    title: 'React Fundamentals (Updated)',
    description: 'Updated description',
    path_type: 'competency',
    proficiency_level_name: null,
    skill_ids: [],
    estimated_duration_minutes: 200,
    nodes: [
      { type: 'content', title: 'Intro', coins: 10, node_order: 1, items: [{ title: 'Welcome', content_type: 'article', item_order: 1 }], questions: [] }
    ]
  }

  it('lets the creator update their own path (200)', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ created_by: 'user-2', status: 'draft', title: 'React Fundamentals' })] }, // SELECT current
      { rows: [pathNodeRow({ created_by: 'user-2', status: 'draft', title: 'React Fundamentals' })] }, // fetch (before) -> path
      { rows: [] }, // fetch (before) -> nodes
      { rows: [] }, // fetch (before) -> items
      { rows: [] }, // fetch (before) -> questions
      { rows: [] }, // fetch (before) -> options
      { rows: [] }, // fetch (before) -> skills
      {}, // UPDATE learning_paths
      {}, // DELETE path_nodes
      {}, // DELETE learning_path_skills
      {}, // INSERT path_nodes (node 1)
      {}, // INSERT path_node_items (item 1)
      { rows: [pathNodeRow({ created_by: 'user-2', status: 'draft', title: 'React Fundamentals (Updated)', estimated_duration_minutes: 200 })] }, // fetch (after) -> path
      { rows: [nodeRow({ id: 'node-1', type: 'content', title: 'Intro', coins: 10, node_order: 1 })] }, // fetch (after) -> nodes
      { rows: [nodeItemRow({ id: 'item-1', node_id: 'node-1', item_order: 1, asset_id: null, title: 'Welcome', content_type: 'article', duration_minutes: null, external_url: null })] }, // fetch (after) -> items
      { rows: [] }, // fetch (after) -> questions
      { rows: [] }, // fetch (after) -> options
      { rows: [] }, // fetch (after) -> skills
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.updatePath({ actor: trainer, pathId: 'path-1', input: updateInput, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.path.title).toBe('React Fundamentals (Updated)')
    expect(result.path.estimatedDurationMinutes).toBe(200)
    expect(result.path.nodes).toHaveLength(1)
    expect(result.path.nodes[0].items[0].title).toBe('Welcome')

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'LEARNING_PATH_UPDATED',
        entityType: 'LearningPath',
        entityId: 'path-1',
        oldValue: expect.objectContaining({ title: 'React Fundamentals' }),
        newValue: expect.objectContaining({ title: 'React Fundamentals (Updated)' }),
        result: 'success'
      }),
      client
    )
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(db.query).not.toHaveBeenCalled() // no proficiency/skill/asset lookups needed
  })

  it('returns 403 for a non-creator without learning.paths.approve, and logs ACCESS_VIOLATION', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ created_by: 'user-1', status: 'draft' })] }, // SELECT current
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)
    db.query.mockResolvedValueOnce({ rows: [] }) // hasPermission(associate, approve, learning, paths) -> denied

    const result = await pathService.updatePath({ actor: associate, pathId: 'path-1', input: updateInput, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(result.error).toBe('Forbidden')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'ACCESS_VIOLATION',
        entityType: 'LearningPath',
        entityId: 'path-1',
        result: 'failure'
      })
    )
  })

  it('returns 404 for a path that does not exist', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [] }, // SELECT current -> none
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.updatePath({ actor: trainer, pathId: 'missing', input: updateInput, ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// submitForReview
// ---------------------------------------------------------------------------

describe('submitForReview', () => {
  it('moves a draft path to in_review and starts the Learning Path Review workflow (200)', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)
    workflowService.startWorkflow.mockResolvedValueOnce({
      instance: { id: 'instance-1', status: 'in_progress' },
      tasks: [{ id: 'task-1' }]
    })

    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ created_by: 'user-2', status: 'draft' })] }, // SELECT current
      {}, // UPDATE status='in_review'
      { rows: [{ id: 'def-1' }] }, // SELECT workflow_definitions
      { rows: [pathNodeRow({ created_by: 'user-2', status: 'in_review' })] }, // fetch -> path
      { rows: [] }, // fetch -> nodes
      { rows: [] }, // fetch -> items
      { rows: [] }, // fetch -> questions
      { rows: [] }, // fetch -> options
      { rows: [] }, // fetch -> skills
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.submitForReview({ actor: trainer, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.path.status).toBe('in_review')
    expect(result.workflow.instance.id).toBe('instance-1')

    expect(workflowService.startWorkflow).toHaveBeenCalledWith('def-1', 'LearningPath', 'path-1', 'user-2', client)
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'LEARNING_PATH_SUBMITTED',
        entityType: 'LearningPath',
        entityId: 'path-1',
        oldValue: { status: 'draft' },
        newValue: { status: 'in_review' },
        metadata: { workflowInstanceId: 'instance-1' },
        result: 'success'
      }),
      client
    )
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('returns 409 when the current status cannot transition to in_review', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)

    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ created_by: 'user-2', status: 'published' })] }, // SELECT current
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.submitForReview({ actor: trainer, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
    expect(result.error).toContain('Cannot transition')
    expect(workflowService.startWorkflow).not.toHaveBeenCalled()
  })

  it('returns 403 for a non-creator without learning.paths.approve, and logs ACCESS_VIOLATION', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ created_by: 'user-1', status: 'draft' })] }, // SELECT current
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)
    db.query.mockResolvedValueOnce({ rows: [] }) // hasPermission(associate, approve, learning, paths) -> denied

    const result = await pathService.submitForReview({ actor: associate, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(403)
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'ACCESS_VIOLATION', entityType: 'LearningPath', entityId: 'path-1', result: 'failure' })
    )
  })
})

// ---------------------------------------------------------------------------
// publishPath
// ---------------------------------------------------------------------------

describe('publishPath', () => {
  it('lets a bypass role publish a draft path directly (200)', async () => {
    configService.get
      .mockResolvedValueOnce(STATUS_TRANSITIONS) // learning.status_transitions
      .mockResolvedValueOnce(['ld_admin', 'super_admin']) // learning.publish_bypass_roles

    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ status: 'draft' })] }, // SELECT current
      {}, // UPDATE status='published'
      { rows: [pathNodeRow({ status: 'published' })] }, // fetch -> path
      { rows: [] }, // fetch -> nodes
      { rows: [] }, // fetch -> items
      { rows: [] }, // fetch -> questions
      { rows: [] }, // fetch -> options
      { rows: [] }, // fetch -> skills
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.publishPath({ actor: ldAdmin, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.path.status).toBe('published')
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'LEARNING_PATH_PUBLISHED',
        oldValue: { status: 'draft' },
        newValue: { status: 'published' }
      }),
      client
    )
  })

  it('publishes a path already in_review without a bypass-role lookup (200)', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS) // only status_transitions is read

    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ status: 'in_review' })] }, // SELECT current
      {}, // UPDATE status='published'
      { rows: [pathNodeRow({ status: 'published' })] }, // fetch -> path
      { rows: [] }, // fetch -> nodes
      { rows: [] }, // fetch -> items
      { rows: [] }, // fetch -> questions
      { rows: [] }, // fetch -> options
      { rows: [] }, // fetch -> skills
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.publishPath({ actor: ldAdmin, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.path.status).toBe('published')
    expect(configService.get).toHaveBeenCalledTimes(1)
  })

  it('returns 409 when the current status cannot transition to published', async () => {
    configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)

    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ status: 'published' })] }, // SELECT current
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.publishPath({ actor: ldAdmin, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
    expect(result.error).toContain('Cannot transition')
  })

  it('returns 409 when publishing from draft and the active role is not in publish_bypass_roles (config-driven, Rule 1)', async () => {
    configService.get
      .mockResolvedValueOnce(STATUS_TRANSITIONS)
      .mockResolvedValueOnce(['super_admin']) // ld_admin no longer bypasses, per this tenant's config

    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ status: 'draft' })] }, // SELECT current
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.publishPath({ actor: ldAdmin, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
    expect(result.error).toContain('review')
  })

  it('returns 404 for a path that does not exist', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [] }, // SELECT current -> none
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.publishPath({ actor: ldAdmin, pathId: 'missing', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// duplicatePath
// ---------------------------------------------------------------------------

describe('duplicatePath', () => {
  it('lets the creator duplicate their own path as a new draft, titled "(Copy)" (201)', async () => {
    crypto.randomUUID.mockReturnValueOnce('path-2') // newPathId; insertNodes ids fall back to the default 'path-1'

    const client = txClient([
      {}, // BEGIN
      { rows: [pathNodeRow({ id: 'path-1', created_by: 'user-2', status: 'draft', title: 'React Fundamentals' })] }, // fetch (original) -> path
      { rows: [nodeRow({ id: 'node-1', type: 'content', title: 'Intro', coins: 10, node_order: 1 })] }, // fetch (original) -> nodes
      { rows: [nodeItemRow({ id: 'item-1', node_id: 'node-1', item_order: 1, asset_id: null, title: 'Welcome', content_type: 'article' })] }, // fetch (original) -> items
      { rows: [] }, // fetch (original) -> questions
      { rows: [] }, // fetch (original) -> options
      { rows: [{ id: 'skill-1', name: 'React' }] }, // fetch (original) -> skills
      {}, // INSERT learning_paths (new)
      {}, // INSERT path_nodes (node 1)
      {}, // INSERT path_node_items (item 1)
      {}, // INSERT learning_path_skills (skill-1)
      { rows: [pathNodeRow({ id: 'path-2', created_by: 'user-2', status: 'draft', title: 'React Fundamentals (Copy)' })] }, // fetch (created) -> path
      { rows: [nodeRow({ id: 'new-node-1', type: 'content', title: 'Intro', coins: 10, node_order: 1 })] }, // fetch (created) -> nodes
      { rows: [nodeItemRow({ id: 'new-item-1', node_id: 'new-node-1', item_order: 1, asset_id: null, title: 'Welcome', content_type: 'article' })] }, // fetch (created) -> items
      { rows: [] }, // fetch (created) -> questions
      { rows: [] }, // fetch (created) -> options
      { rows: [{ id: 'skill-1', name: 'React' }] }, // fetch (created) -> skills
      {} // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.duplicatePath({ actor: trainer, pathId: 'path-1', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(201)
    expect(result.path.title).toBe('React Fundamentals (Copy)')
    expect(result.path.status).toBe('draft')
    expect(result.path.nodes).toHaveLength(1)

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'LEARNING_PATH_DUPLICATED',
        entityType: 'LearningPath',
        entityId: 'path-2',
        oldValue: { sourcePathId: 'path-1' },
        newValue: result.path,
        result: 'success'
      }),
      client
    )
    expect(client.query).toHaveBeenCalledWith('COMMIT')
  })

  it('returns 404 for a path that does not exist', async () => {
    const client = txClient([
      {}, // BEGIN
      { rows: [] }, // fetch (original) -> path: none
      {} // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await pathService.duplicatePath({ actor: trainer, pathId: 'missing', ipAddress: '127.0.0.1', userAgent: 'jest' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// getAllPaths
// ---------------------------------------------------------------------------

describe('getAllPaths', () => {
  const summaryRow = {
    id: 'path-1',
    title: 'React Fundamentals',
    description: 'Learn React from scratch',
    status: 'draft',
    estimated_duration_minutes: 180,
    created_by: 'user-2',
    created_at: '2026-06-01T00:00:00Z',
    node_count: '2',
    total_coins: '15',
    skills: ['React'],
    created_by_name: 'Jane Doe'
  }

  it('lets ld_admin (visibilityScope.type=all) see every path, unfiltered (Rule 7)', async () => {
    db.query.mockResolvedValueOnce({ rows: [summaryRow] })

    const result = await pathService.getAllPaths({ actor: ldAdmin })

    expect(result).toEqual([{
      id: 'path-1',
      title: 'React Fundamentals',
      description: 'Learn React from scratch',
      status: 'draft',
      node_count: 2,
      duration_minutes: 180,
      total_coins: 15,
      skills: ['React'],
      created_by: 'Jane Doe',
      created_at: '2026-06-01T00:00:00Z'
    }])

    const [, params] = db.query.mock.calls[0]
    expect(params).toEqual(['tenant-1'])
  })

  it('restricts a program_manager (visibilityScope.type=team) to their own paths plus published paths', async () => {
    db.query.mockResolvedValueOnce({ rows: [summaryRow] })

    await pathService.getAllPaths({ actor: trainer })

    const [sql, params] = db.query.mock.calls[0]
    expect(params).toEqual(['tenant-1', 'user-2'])
    expect(sql).toContain("lp.created_by = $2 OR lp.status = 'published'")
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC) — every endpoint: authenticate -> requirePermission -> handler.
// The mocked authenticate middleware always sets req.user.id = 'user-1', so
// "creator" personas below use created_by: 'user-1' to exercise the ownership
// branch (current.created_by === actor.id) without an extra hasPermission
// ('approve', ...) lookup.
// ---------------------------------------------------------------------------

describe('path builder routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const pathRoutes = require('../../src/modules/learning/pathRoutes')

  const app = express()
  app.use(express.json())
  app.use(pathRoutes)

  describe('POST /learning-paths (nodes payload)', () => {
    const nodesBody = {
      title: 'React Fundamentals',
      path_type: 'competency',
      nodes: [
        { type: 'content', title: 'Intro', coins: 10, node_order: 1, items: [{ title: 'Welcome', content_type: 'article', item_order: 1 }], questions: [] }
      ]
    }

    it('allows program_manager (201)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(create, learning, paths)

      const client = txClient([
        {}, // BEGIN
        {}, // INSERT learning_paths
        {}, // INSERT path_nodes
        {}, // INSERT path_node_items
        { rows: [pathNodeRow({ status: 'draft' })] }, // fetch -> path
        { rows: [nodeRow({ id: 'node-1', type: 'content', title: 'Intro', coins: 10, node_order: 1 })] }, // fetch -> nodes
        { rows: [nodeItemRow({ id: 'item-1', node_id: 'node-1', item_order: 1, asset_id: null, title: 'Welcome', content_type: 'article' })] }, // fetch -> items
        { rows: [] }, // fetch -> questions
        { rows: [] }, // fetch -> options
        { rows: [] }, // fetch -> skills
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/learning-paths')
        .set('x-test-role', 'program_manager')
        .send(nodesBody)

      expect(res.status).toBe(201)
      expect(res.body.status).toBe('draft')
      expect(res.body.nodes).toHaveLength(1)
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/learning-paths')
        .set('x-test-role', 'associate')
        .send(nodesBody)

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('PUT /learning-paths/:id', () => {
    const updateBody = { title: 'Updated title', path_type: 'competency', nodes: [] }

    it('allows the creator (program_manager) to update their path (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(edit, learning, paths)

      const client = txClient([
        {}, // BEGIN
        { rows: [pathNodeRow({ created_by: 'user-1', status: 'draft' })] }, // SELECT current
        { rows: [pathNodeRow({ created_by: 'user-1', status: 'draft' })] }, // fetch (before) -> path
        { rows: [] }, // fetch (before) -> nodes
        { rows: [] }, // fetch (before) -> items
        { rows: [] }, // fetch (before) -> questions
        { rows: [] }, // fetch (before) -> options
        { rows: [] }, // fetch (before) -> skills
        {}, // UPDATE learning_paths
        {}, // DELETE path_nodes
        {}, // DELETE learning_path_skills
        { rows: [pathNodeRow({ created_by: 'user-1', status: 'draft', title: 'Updated title' })] }, // fetch (after) -> path
        { rows: [] }, // fetch (after) -> nodes
        { rows: [] }, // fetch (after) -> items
        { rows: [] }, // fetch (after) -> questions
        { rows: [] }, // fetch (after) -> options
        { rows: [] }, // fetch (after) -> skills
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .put('/learning-paths/path-1')
        .set('x-test-role', 'program_manager')
        .send(updateBody)

      expect(res.status).toBe(200)
      expect(res.body.title).toBe('Updated title')
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission(edit, learning, paths) denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .put('/learning-paths/path-1')
        .set('x-test-role', 'associate')
        .send(updateBody)

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('POST /learning-paths/:id/submit-review', () => {
    it('allows the creator (program_manager) to submit for review (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(edit, learning, paths)
      configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS)
      workflowService.startWorkflow.mockResolvedValueOnce({ instance: { id: 'instance-1', status: 'in_progress' }, tasks: [] })

      const client = txClient([
        {}, // BEGIN
        { rows: [pathNodeRow({ created_by: 'user-1', status: 'draft' })] }, // SELECT current
        {}, // UPDATE status='in_review'
        { rows: [{ id: 'def-1' }] }, // SELECT workflow_definitions
        { rows: [pathNodeRow({ created_by: 'user-1', status: 'in_review' })] }, // fetch -> path
        { rows: [] }, // fetch -> nodes
        { rows: [] }, // fetch -> items
        { rows: [] }, // fetch -> questions
        { rows: [] }, // fetch -> options
        { rows: [] }, // fetch -> skills
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/learning-paths/path-1/submit-review')
        .set('x-test-role', 'program_manager')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('in_review')
      expect(workflowService.startWorkflow).toHaveBeenCalledWith('def-1', 'LearningPath', 'path-1', 'user-1', client)
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission(edit, learning, paths) denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/learning-paths/path-1/submit-review')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('POST /learning-paths/:id/publish', () => {
    it('allows ld_admin (200)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(approve, learning, paths)
      configService.get.mockResolvedValueOnce(STATUS_TRANSITIONS) // in_review -> published, no bypass-role lookup

      const client = txClient([
        {}, // BEGIN
        { rows: [pathNodeRow({ status: 'in_review' })] }, // SELECT current
        {}, // UPDATE status='published'
        { rows: [pathNodeRow({ status: 'published' })] }, // fetch -> path
        { rows: [] }, // fetch -> nodes
        { rows: [] }, // fetch -> items
        { rows: [] }, // fetch -> questions
        { rows: [] }, // fetch -> options
        { rows: [] }, // fetch -> skills
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/learning-paths/path-1/publish')
        .set('x-test-role', 'ld_admin')

      expect(res.status).toBe(200)
      expect(res.body.status).toBe('published')
    })

    it('denies program_manager (403, lacks learning.paths.approve)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission(approve, learning, paths) denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/learning-paths/path-1/publish')
        .set('x-test-role', 'program_manager')

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('POST /learning-paths/:id/duplicate', () => {
    it('allows the creator (program_manager) to duplicate their path (201)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(edit, learning, paths)
      crypto.randomUUID.mockReturnValueOnce('path-2') // newPathId

      const client = txClient([
        {}, // BEGIN
        { rows: [pathNodeRow({ id: 'path-1', created_by: 'user-1', status: 'draft', title: 'React Fundamentals' })] }, // fetch (original) -> path
        { rows: [] }, // fetch (original) -> nodes
        { rows: [] }, // fetch (original) -> items
        { rows: [] }, // fetch (original) -> questions
        { rows: [] }, // fetch (original) -> options
        { rows: [] }, // fetch (original) -> skills
        {}, // INSERT learning_paths (new)
        { rows: [pathNodeRow({ id: 'path-2', created_by: 'user-1', status: 'draft', title: 'React Fundamentals (Copy)' })] }, // fetch (created) -> path
        { rows: [] }, // fetch (created) -> nodes
        { rows: [] }, // fetch (created) -> items
        { rows: [] }, // fetch (created) -> questions
        { rows: [] }, // fetch (created) -> options
        { rows: [] }, // fetch (created) -> skills
        {} // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/learning-paths/path-1/duplicate')
        .set('x-test-role', 'program_manager')

      expect(res.status).toBe(201)
      expect(res.body.title).toBe('React Fundamentals (Copy)')
    })

    it('denies associate (403)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission(edit, learning, paths) denies
        .mockResolvedValueOnce({}) // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/learning-paths/path-1/duplicate')
        .set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('GET /learning-paths', () => {
    it('allows ld_admin to list all paths (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission(view, learning, paths)
        .mockResolvedValueOnce({ rows: [] }) // getAllPaths

      const res = await request(app)
        .get('/learning-paths')
        .set('x-test-role', 'ld_admin')

      expect(res.status).toBe(200)
      expect(Array.isArray(res.body)).toBe(true)
    })
  })
})
