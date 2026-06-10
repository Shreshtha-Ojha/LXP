// tests/unit/workflow.test.js
//
// Unit tests for src/modules/workflow/workflowService.js and the RBAC wiring
// in src/modules/workflow/workflowRoutes.js.
//
// Pattern (matches tests/unit/roles.test.js): mock db, auditLog, and
// notificationService so we can assert exactly what state changes, audit
// events, and notifications each action produces. authenticate is mocked at
// the top level so every required module shares the same mocked db singleton.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})
jest.mock('../../src/modules/notifications/notificationService', () => ({
  notify: jest.fn().mockResolvedValue([])
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
const notificationService = require('../../src/modules/notifications/notificationService')
const workflowService = require('../../src/modules/workflow/workflowService')

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// startWorkflow
// ---------------------------------------------------------------------------

describe('startWorkflow', () => {
  const definitionRow = { id: 'def-1', tenant_id: 'tenant-1', name: 'Content Approval', is_active: true }
  const step1Row = {
    id: 'step-1', definition_id: 'def-1', step_order: 1, step_type: 'approval',
    approver_role: null, approver_user_id: 'manager-1', sla_hours: 24, escalation_role: 'ld_admin'
  }

  it('creates a WorkflowInstance and assigns the first task to the configured approver', async () => {
    const instanceRow = {
      id: 'instance-1', tenant_id: 'tenant-1', definition_id: 'def-1',
      entity_type: 'LearningAsset', entity_id: 'asset-1', initiated_by: 'user-1',
      current_step: 1, status: 'in_progress', due_at: null, completed_at: null
    }
    const taskRow = { id: 'task-1', instance_id: 'instance-1', step_id: 'step-1', assigned_to: 'manager-1', status: 'pending', due_at: null }

    const client = txClient([
      { rows: [definitionRow] },             // workflow_definitions lookup
      { rows: [step1Row] },                  // workflow_steps for definition, ordered
      { rows: [instanceRow] },               // INSERT workflow_instances
      { rows: [taskRow] },                   // INSERT workflow_tasks for manager-1
      { rows: [{ name: 'reporting_manager' }] } // fetchActiveRoleNames(initiatedBy)
    ])

    const result = await workflowService.startWorkflow('def-1', 'LearningAsset', 'asset-1', 'user-1', client)

    expect(result.instance).toEqual(expect.objectContaining({ id: 'instance-1', status: 'in_progress', currentStep: 1 }))
    expect(result.tasks).toEqual([expect.objectContaining({ id: 'task-1', assignedTo: 'manager-1', status: 'pending' })])

    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        actorUserId: 'user-1',
        actionType: auditLog.AuditActions.WORKFLOW_STARTED,
        entityType: 'WorkflowInstance',
        entityId: 'instance-1',
        result: 'success'
      }),
      client
    )

    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'manager-1', eventType: 'workflow.task.assigned', client })
    )
  })

  it('fans out to every active user holding approver_role when no approver_user_id is set', async () => {
    const fanOutStep = { ...step1Row, approver_role: 'ld_admin', approver_user_id: null }
    const instanceRow = {
      id: 'instance-2', tenant_id: 'tenant-1', definition_id: 'def-1',
      entity_type: 'LearningAsset', entity_id: 'asset-2', initiated_by: 'user-1',
      current_step: 1, status: 'in_progress', due_at: null, completed_at: null
    }

    const client = txClient([
      { rows: [definitionRow] },
      { rows: [fanOutStep] },
      { rows: [{ user_id: 'ldadmin-1' }, { user_id: 'ldadmin-2' }] }, // resolveApproverUserIds fan-out
      { rows: [instanceRow] },
      { rows: [{ id: 'task-a', instance_id: 'instance-2', step_id: 'step-1', assigned_to: 'ldadmin-1', status: 'pending', due_at: null }] },
      { rows: [{ id: 'task-b', instance_id: 'instance-2', step_id: 'step-1', assigned_to: 'ldadmin-2', status: 'pending', due_at: null }] },
      { rows: [{ name: 'associate' }] }
    ])

    const result = await workflowService.startWorkflow('def-1', 'LearningAsset', 'asset-2', 'user-1', client)

    expect(result.tasks.map((t) => t.assignedTo)).toEqual(['ldadmin-1', 'ldadmin-2'])
    expect(notificationService.notify).toHaveBeenCalledTimes(2)
  })

  it('throws when no approver can be resolved for step 1', async () => {
    const unresolvableStep = { ...step1Row, approver_role: 'ld_admin', approver_user_id: null }
    const client = txClient([
      { rows: [definitionRow] },
      { rows: [unresolvableStep] },
      { rows: [] } // fan-out finds nobody
    ])

    await expect(
      workflowService.startWorkflow('def-1', 'LearningAsset', 'asset-1', 'user-1', client)
    ).rejects.toThrow('No approver could be resolved')
  })
})

// ---------------------------------------------------------------------------
// takeAction
// ---------------------------------------------------------------------------

describe('takeAction', () => {
  const definitionRow = { id: 'def-1', tenant_id: 'tenant-1', name: 'Content Approval' }
  const step1Row = {
    id: 'step-1', definition_id: 'def-1', step_order: 1, step_type: 'approval',
    approver_role: null, approver_user_id: 'manager-1', sla_hours: 24, escalation_role: 'ld_admin'
  }
  const step2Row = {
    id: 'step-2', definition_id: 'def-1', step_order: 2, step_type: 'approval',
    approver_role: 'ld_admin', approver_user_id: null, sla_hours: 48, escalation_role: null
  }
  const baseInstance = {
    id: 'instance-1', tenant_id: 'tenant-1', definition_id: 'def-1',
    entity_type: 'LearningAsset', entity_id: 'asset-1', initiated_by: 'user-1',
    current_step: 1, status: 'in_progress', due_at: null, completed_at: null
  }
  const myTask = {
    id: 'task-1', instance_id: 'instance-1', step_id: 'step-1', assigned_to: 'manager-1',
    status: 'pending', due_at: null, assigned_at: '2026-06-01T00:00:00Z'
  }
  const manager = { id: 'manager-1', tenantId: 'tenant-1', roles: ['reporting_manager'] }

  describe('approve', () => {
    it('advances current_step and creates a task for the next step approver', async () => {
      const updatedInstance = { ...baseInstance, current_step: 2 }
      const client = txClient([
        {},                                  // BEGIN
        { rows: [baseInstance] },            // workflow_instances lookup
        { rows: [definitionRow] },           // workflow_definitions lookup
        { rows: [step1Row] },                // current step (step_order = 1)
        { rows: [myTask] },                  // tasks assigned to manager-1
        {},                                  // UPDATE workflow_tasks (task-1 -> approved)
        { rows: [step2Row] },                // next step (step_order = 2)
        { rows: [{ user_id: 'ldadmin-1' }] }, // resolveStepApprovers(step2) fan-out
        { rows: [updatedInstance] },         // UPDATE workflow_instances (current_step = 2)
        {},                                  // INSERT workflow_tasks for ldadmin-1
        {},                                  // supersedeSiblingTasks
        {}                                   // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({
        actor: manager, instanceId: 'instance-1', action: 'approve', comment: 'looks good',
        ipAddress: '127.0.0.1', userAgent: 'jest'
      })

      expect(result).toEqual({ ok: true, instance: expect.objectContaining({ id: 'instance-1', currentStep: 2, status: 'in_progress' }) })

      const [updateTaskSql, updateTaskParams] = client.query.mock.calls[5]
      expect(updateTaskSql).toContain('UPDATE workflow_tasks')
      expect(updateTaskParams).toEqual(['approved', 'approve', 'looks good', 'task-1'])

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: auditLog.AuditActions.WORKFLOW_APPROVED, entityType: 'WorkflowInstance', entityId: 'instance-1', result: 'success' }),
        client
      )
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'ldadmin-1', eventType: 'workflow.task.assigned' })
      )
      expect(client.query).toHaveBeenCalledWith('COMMIT')
    })

    it('marks the instance approved and notifies the initiator when there is no next step', async () => {
      const finalInstance = { ...baseInstance, status: 'approved', completed_at: '2026-06-10T00:00:00Z' }
      const client = txClient([
        {},                          // BEGIN
        { rows: [baseInstance] },    // workflow_instances lookup
        { rows: [definitionRow] },   // workflow_definitions lookup
        { rows: [step1Row] },        // current step
        { rows: [myTask] },          // tasks assigned to manager-1
        {},                          // UPDATE workflow_tasks (approved)
        { rows: [] },                // no next step
        { rows: [finalInstance] },   // UPDATE workflow_instances (status = approved)
        {},                          // supersedeSiblingTasks
        {}                           // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({
        actor: manager, instanceId: 'instance-1', action: 'approve', comment: 'final sign-off'
      })

      expect(result.ok).toBe(true)
      expect(result.instance.status).toBe('approved')

      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', eventType: 'workflow.approved' })
      )
    })
  })

  describe('reject', () => {
    it('marks the instance rejected and notifies the initiator with the comment', async () => {
      const rejectedInstance = { ...baseInstance, status: 'rejected', completed_at: '2026-06-10T00:00:00Z' }
      const client = txClient([
        {},                          // BEGIN
        { rows: [baseInstance] },    // workflow_instances lookup
        { rows: [definitionRow] },   // workflow_definitions lookup
        { rows: [step1Row] },        // current step
        { rows: [myTask] },          // tasks assigned to manager-1
        {},                          // UPDATE workflow_tasks (rejected)
        { rows: [rejectedInstance] }, // UPDATE workflow_instances (status = rejected)
        {},                          // supersedeSiblingTasks
        {}                           // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({
        actor: manager, instanceId: 'instance-1', action: 'reject', comment: 'needs more detail'
      })

      expect(result).toEqual({ ok: true, instance: expect.objectContaining({ status: 'rejected' }) })

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: auditLog.AuditActions.WORKFLOW_REJECTED, result: 'success' }),
        client
      )
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', eventType: 'workflow.rejected', data: expect.objectContaining({ comment: 'needs more detail' }) })
      )
    })
  })

  describe('send_back', () => {
    it('resets current_step to 1, keeps the instance in_progress, and notifies the initiator', async () => {
      const inProgressStep2 = { ...baseInstance, current_step: 2, status: 'in_progress' }
      const sentBackInstance = { ...inProgressStep2, current_step: 1 }
      const taskOnStep2 = { ...myTask, step_id: 'step-2' }

      const client = txClient([
        {},                            // BEGIN
        { rows: [inProgressStep2] },   // workflow_instances lookup (currently on step 2)
        { rows: [definitionRow] },     // workflow_definitions lookup
        { rows: [step2Row] },          // current step (step_order = 2)
        { rows: [taskOnStep2] },       // tasks assigned to manager-1
        {},                            // UPDATE workflow_tasks (sent_back)
        { rows: [sentBackInstance] },  // UPDATE workflow_instances (current_step = 1)
        {},                            // supersedeSiblingTasks
        {}                             // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({
        actor: manager, instanceId: 'instance-1', action: 'send_back', comment: 'please revise the budget section'
      })

      expect(result).toEqual({ ok: true, instance: expect.objectContaining({ currentStep: 1, status: 'in_progress' }) })

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: auditLog.AuditActions.WORKFLOW_SENT_BACK, result: 'success' }),
        client
      )
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', eventType: 'workflow.sent_back' })
      )
    })
  })

  describe('request_info', () => {
    it('notifies the initiator without changing current_step or instance status', async () => {
      const client = txClient([
        {},                         // BEGIN
        { rows: [baseInstance] },   // workflow_instances lookup
        { rows: [definitionRow] },  // workflow_definitions lookup
        { rows: [step1Row] },       // current step
        { rows: [myTask] },         // tasks assigned to manager-1
        {},                         // UPDATE workflow_tasks (info_requested)
        { rows: [baseInstance] },   // UPDATE workflow_instances (touch updated_at)
        {}                          // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({
        actor: manager, instanceId: 'instance-1', action: 'request_info', comment: 'what is the budget owner?'
      })

      expect(result).toEqual({ ok: true, instance: expect.objectContaining({ currentStep: 1, status: 'in_progress' }) })
      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: auditLog.AuditActions.WORKFLOW_INFO_REQUESTED, result: 'success' }),
        client
      )
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', eventType: 'workflow.info_requested' })
      )
    })
  })

  describe('escalate', () => {
    it('creates a task for the resolved escalation_role and marks the instance escalated', async () => {
      const escalatedInstance = { ...baseInstance, status: 'escalated' }
      const client = txClient([
        {},                              // BEGIN
        { rows: [baseInstance] },        // workflow_instances lookup
        { rows: [definitionRow] },       // workflow_definitions lookup
        { rows: [step1Row] },            // current step (escalation_role = 'ld_admin')
        { rows: [myTask] },              // tasks assigned to manager-1
        {},                              // UPDATE workflow_tasks (escalated)
        { rows: [{ user_id: 'ldadmin-1' }] }, // resolve escalation_role fan-out
        { rows: [escalatedInstance] },   // UPDATE workflow_instances (status = escalated)
        {},                              // INSERT workflow_tasks for ldadmin-1
        {}                               // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({
        actor: manager, instanceId: 'instance-1', action: 'escalate', comment: 'out of office, please pick this up'
      })

      expect(result).toEqual({ ok: true, instance: expect.objectContaining({ status: 'escalated' }) })
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'ldadmin-1', eventType: 'workflow.task.assigned' })
      )
    })

    it('returns 400 when the current step has no escalation_role configured', async () => {
      const noEscalationStep = { ...step1Row, escalation_role: null }
      const client = txClient([
        {},                       // BEGIN
        { rows: [baseInstance] }, // workflow_instances lookup
        { rows: [definitionRow] }, // workflow_definitions lookup
        { rows: [noEscalationStep] }, // current step
        { rows: [myTask] },       // tasks assigned to manager-1
        {},                       // UPDATE workflow_tasks (escalated)
        {}                        // ROLLBACK
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({
        actor: manager, instanceId: 'instance-1', action: 'escalate'
      })

      expect(result).toEqual({ ok: false, status: 400, error: 'This step has no escalation_role configured' })
      expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    })
  })

  describe('delegate', () => {
    it('creates a new pending task for delegateTo and links it via delegated_to', async () => {
      const client = txClient([
        {},                          // BEGIN
        { rows: [baseInstance] },    // workflow_instances lookup
        { rows: [definitionRow] },   // workflow_definitions lookup
        { rows: [step1Row] },        // current step
        { rows: [myTask] },          // tasks assigned to manager-1
        {},                          // UPDATE workflow_tasks (delegated)
        { rows: [{ id: 'delegate-1' }] }, // delegateTo user lookup
        {},                          // UPDATE workflow_tasks SET delegated_to
        {},                          // INSERT workflow_tasks for delegate-1
        { rows: [baseInstance] },    // UPDATE workflow_instances (touch updated_at)
        {}                           // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({
        actor: manager, instanceId: 'instance-1', action: 'delegate', delegateTo: 'delegate-1', comment: 'covering for me this week'
      })

      expect(result.ok).toBe(true)
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'delegate-1', eventType: 'workflow.task.assigned' })
      )
      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: auditLog.AuditActions.WORKFLOW_DELEGATED }),
        client
      )
    })

    it('returns 400 when delegateTo is missing, without touching the database', async () => {
      const result = await workflowService.takeAction({ actor: manager, instanceId: 'instance-1', action: 'delegate' })

      expect(result).toEqual({ ok: false, status: 400, error: 'delegateTo is required for the delegate action' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('withdraw', () => {
    it('allows the initiator to withdraw and marks all pending tasks withdrawn', async () => {
      const initiator = { id: 'user-1', tenantId: 'tenant-1', roles: ['associate'] }
      const withdrawnInstance = { ...baseInstance, status: 'withdrawn', completed_at: '2026-06-10T00:00:00Z' }

      const client = txClient([
        {},                            // BEGIN
        { rows: [baseInstance] },      // workflow_instances lookup
        {},                            // UPDATE workflow_tasks (withdrawn)
        { rows: [withdrawnInstance] }, // UPDATE workflow_instances (status = withdrawn)
        { rows: [{ assigned_to: 'manager-1' }] }, // assignees to notify
        {}                             // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({ actor: initiator, instanceId: 'instance-1', action: 'withdraw', comment: 'no longer needed' })

      expect(result).toEqual({ ok: true, instance: expect.objectContaining({ status: 'withdrawn' }) })
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'manager-1', eventType: 'workflow.withdrawn' })
      )
    })

    it('returns 403 and logs ACCESS_VIOLATION when the actor did not initiate the workflow', async () => {
      const client = txClient([
        {},                       // BEGIN
        { rows: [baseInstance] }, // workflow_instances lookup (initiated_by = user-1)
        {}                        // ROLLBACK
      ])
      db.getClient.mockResolvedValueOnce(client)

      const result = await workflowService.takeAction({ actor: manager, instanceId: 'instance-1', action: 'withdraw' })

      expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: auditLog.AuditActions.ACCESS_VIOLATION, result: 'failure' })
      )
    })
  })

  it('returns 400 for an unknown action without touching the database', async () => {
    const result = await workflowService.takeAction({ actor: manager, instanceId: 'instance-1', action: 'approve_with_extreme_prejudice' })

    expect(result).toEqual({ ok: false, status: 400, error: expect.stringContaining('action must be one of') })
    expect(db.getClient).not.toHaveBeenCalled()
  })

  it('returns 404 when the instance does not exist for this tenant', async () => {
    const client = txClient([
      {},          // BEGIN
      { rows: [] }, // workflow_instances lookup -> not found
      {}            // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await workflowService.takeAction({ actor: manager, instanceId: 'missing', action: 'approve' })

    expect(result).toEqual({ ok: false, status: 404, error: 'Workflow instance not found' })
  })

  it('returns 409 when the instance is already in a terminal state', async () => {
    const client = txClient([
      {},                                              // BEGIN
      { rows: [{ ...baseInstance, status: 'approved' }] }, // workflow_instances lookup
      {}                                               // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await workflowService.takeAction({ actor: manager, instanceId: 'instance-1', action: 'approve' })

    expect(result).toEqual({ ok: false, status: 409, error: expect.stringContaining('already approved') })
  })

  it('returns 403 and logs ACCESS_VIOLATION when the actor has no task on this instance', async () => {
    const client = txClient([
      {},                       // BEGIN
      { rows: [baseInstance] }, // workflow_instances lookup
      { rows: [definitionRow] }, // workflow_definitions lookup
      { rows: [step1Row] },     // current step
      { rows: [] },             // tasks assigned to actor -> none
      {}                        // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const stranger = { id: 'stranger-1', tenantId: 'tenant-1', roles: ['ld_admin'] }
    const result = await workflowService.takeAction({ actor: stranger, instanceId: 'instance-1', action: 'approve' })

    expect(result).toEqual({ ok: false, status: 403, error: 'Forbidden' })
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.ACCESS_VIOLATION, actorUserId: 'stranger-1', result: 'failure' })
    )
  })
})

// ---------------------------------------------------------------------------
// getMyTasks
// ---------------------------------------------------------------------------

describe('getMyTasks', () => {
  it('returns pending tasks assigned to the caller, scoped by tenant_id', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-1', instance_id: 'instance-1', step_id: 'step-1', assigned_to: 'manager-1',
        assigned_at: '2026-06-01T00:00:00Z', due_at: '2026-06-02T00:00:00Z', status: 'pending',
        action_taken: null, comment: null, acted_at: null, delegated_to: null,
        entity_type: 'LearningAsset', entity_id: 'asset-1', instance_status: 'in_progress',
        definition_id: 'def-1', workflow_name: 'Content Approval'
      }]
    })

    const result = await workflowService.getMyTasks({ actor: { id: 'manager-1', tenantId: 'tenant-1' } })

    expect(result).toEqual([
      expect.objectContaining({
        id: 'task-1', status: 'pending', workflowName: 'Content Approval',
        entityType: 'LearningAsset', entityId: 'asset-1', instanceStatus: 'in_progress'
      })
    ])

    const [sql, params] = db.query.mock.calls[0]
    expect(sql).toContain('wi.tenant_id = $1')
    expect(sql).toContain("wt.status = 'pending'")
    expect(params).toEqual(['tenant-1', 'manager-1'])
  })
})

// ---------------------------------------------------------------------------
// checkSLABreaches
// ---------------------------------------------------------------------------

describe('checkSLABreaches', () => {
  it('escalates a past-due task to the resolved escalation_role and audit-logs as system', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-1', instance_id: 'instance-1', step_id: 'step-1', assigned_to: 'manager-1',
        tenant_id: 'tenant-1', definition_id: 'def-1', current_step: 1,
        initiated_by: 'user-1', instance_status: 'in_progress'
      }]
    })

    const updatedInstance = {
      id: 'instance-1', tenant_id: 'tenant-1', definition_id: 'def-1',
      entity_type: 'LearningAsset', entity_id: 'asset-1', initiated_by: 'user-1',
      current_step: 1, status: 'escalated', due_at: null, completed_at: null
    }

    const client = txClient([
      {},                          // BEGIN
      { rows: [{ id: 'step-1', sla_hours: 24, escalation_role: 'ld_admin' }] }, // step lookup
      { rows: [{ user_id: 'ldadmin-1' }] }, // resolveApproverUserIds fan-out for escalation_role
      {},                          // UPDATE workflow_tasks (escalated)
      { rows: [updatedInstance] }, // UPDATE workflow_instances (status = escalated)
      { rows: [{ name: 'Content Approval' }] }, // workflow_definitions name lookup
      {},                          // INSERT workflow_tasks for ldadmin-1
      {}                           // COMMIT
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await workflowService.checkSLABreaches()

    expect(result).toEqual({ checked: 1, escalated: 1 })
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'ldadmin-1', eventType: 'workflow.task.assigned', metadata: expect.objectContaining({ reason: 'sla_breach' }) })
    )
    expect(auditLog.write).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: auditLog.AuditActions.WORKFLOW_ESCALATED, actorRoleAtTime: 'system', result: 'success' }),
      client
    )
  })

  it('skips tasks whose step has no escalation_role configured', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'task-1', instance_id: 'instance-1', step_id: 'step-1', assigned_to: 'manager-1',
        tenant_id: 'tenant-1', definition_id: 'def-1', current_step: 1,
        initiated_by: 'user-1', instance_status: 'in_progress'
      }]
    })

    const client = txClient([
      {},                                                // BEGIN
      { rows: [{ id: 'step-1', sla_hours: 24, escalation_role: null }] }, // step lookup
      {}                                                 // ROLLBACK
    ])
    db.getClient.mockResolvedValueOnce(client)

    const result = await workflowService.checkSLABreaches()

    expect(result).toEqual({ checked: 1, escalated: 0 })
    expect(notificationService.notify).not.toHaveBeenCalled()
  })

  it('returns checked: 0 and does nothing when no tasks are past due', async () => {
    db.query.mockResolvedValueOnce({ rows: [] })

    const result = await workflowService.checkSLABreaches()

    expect(result).toEqual({ checked: 0, escalated: 0 })
    expect(db.getClient).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC)
// ---------------------------------------------------------------------------

describe('workflow routes (RBAC)', () => {
  const request = require('supertest')
  const express = require('express')
  const workflowRoutes = require('../../src/modules/workflow/workflowRoutes')

  const app = express()
  app.use(express.json())
  app.use(workflowRoutes)

  describe('GET /workflows/tasks/me', () => {
    it('allows ld_admin (200)', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission
        .mockResolvedValueOnce({ rows: [] })                  // getMyTasks

      const res = await request(app).get('/workflows/tasks/me').set('x-test-role', 'ld_admin')

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([])
    })

    it('denies associate (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app).get('/workflows/tasks/me').set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })

      const [violationSql, violationParams] = db.query.mock.calls[1]
      expect(violationSql).toContain('ACCESS_VIOLATION')
      expect(violationParams).toEqual(
        expect.arrayContaining(['tenant-1', 'user-1', 'associate', 'workflow.tasks'])
      )
    })
  })

  describe('POST /workflows/:instanceId/actions', () => {
    it('allows ld_admin to withdraw their own request (200)', async () => {
      const instanceRow = {
        id: 'instance-1', tenant_id: 'tenant-1', definition_id: 'def-1',
        entity_type: 'LearningAsset', entity_id: 'asset-1', initiated_by: 'user-1',
        current_step: 1, status: 'in_progress', due_at: null, completed_at: null
      }
      const withdrawnInstance = { ...instanceRow, status: 'withdrawn', completed_at: '2026-06-10T00:00:00Z' }

      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission

      const client = txClient([
        {},                            // BEGIN
        { rows: [instanceRow] },       // workflow_instances lookup
        {},                            // UPDATE workflow_tasks (withdrawn)
        { rows: [withdrawnInstance] }, // UPDATE workflow_instances (status = withdrawn)
        { rows: [] },                  // assignees to notify
        {}                             // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app)
        .post('/workflows/instance-1/actions')
        .set('x-test-role', 'ld_admin')
        .send({ action: 'withdraw', comment: 'no longer needed' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual(expect.objectContaining({ status: 'withdrawn' }))
    })

    it('denies external (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app)
        .post('/workflows/instance-1/actions')
        .set('x-test-role', 'external')
        .send({ action: 'approve' })

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })
})
