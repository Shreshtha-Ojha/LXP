// src/modules/workflow/workflowService.js
//
// The central workflow engine (Rule 5). Features call startWorkflow() inside
// their own transaction when an approval is triggered; everything else —
// routing, SLA tracking, escalation, notifications, audit — happens here.
// Features should listen for the resulting workflow_instances.status
// transitioning to 'approved'/'rejected' (e.g. via a future workflow.completed
// event) rather than re-implementing any of this.
//
// Approver/escalation-target resolution (Rule 1 — config driven, not
// hardcoded role checks):
//   - workflow_steps.approver_user_id, if set, wins outright.
//   - approver_role = 'reporting_manager' resolves to the workflow
//     initiator's own user_profiles.manager_id.
//   - any other approver_role / escalation_role fans out to every active user
//     in the tenant holding that role: one WorkflowTask per user. Whichever
//     of them acts first resolves the step; the others' pending tasks are
//     superseded (see supersedeSiblingTasks).

const db = require('../../db')
const auditLog = require('../audit/auditLog')
const notificationService = require('../notifications/notificationService')

const { AuditActions } = auditLog

const ACTIONS = ['approve', 'reject', 'send_back', 'request_info', 'escalate', 'delegate', 'withdraw']

// workflow_tasks.status value each action moves the actor's task to.
const TASK_STATUS_BY_ACTION = {
  approve: 'approved',
  reject: 'rejected',
  send_back: 'sent_back',
  request_info: 'info_requested',
  escalate: 'escalated',
  delegate: 'delegated',
  withdraw: 'withdrawn'
}

const AUDIT_ACTION_BY_ACTION = {
  approve: AuditActions.WORKFLOW_APPROVED,
  reject: AuditActions.WORKFLOW_REJECTED,
  send_back: AuditActions.WORKFLOW_SENT_BACK,
  request_info: AuditActions.WORKFLOW_INFO_REQUESTED,
  escalate: AuditActions.WORKFLOW_ESCALATED,
  delegate: AuditActions.WORKFLOW_DELEGATED,
  withdraw: AuditActions.WORKFLOW_WITHDRAWN
}

// Once an instance reaches one of these, no further actions are accepted.
const TERMINAL_INSTANCE_STATUSES = ['approved', 'rejected', 'withdrawn']

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function serializeInstance(row) {
  if (!row) return null
  return {
    id: row.id,
    tenantId: row.tenant_id,
    definitionId: row.definition_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    initiatedBy: row.initiated_by,
    currentStep: row.current_step,
    status: row.status,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function serializeTask(row) {
  if (!row) return null
  return {
    id: row.id,
    instanceId: row.instance_id,
    stepId: row.step_id,
    assignedTo: row.assigned_to,
    assignedAt: row.assigned_at,
    dueAt: row.due_at,
    status: row.status,
    actionTaken: row.action_taken,
    comment: row.comment,
    actedAt: row.acted_at,
    delegatedTo: row.delegated_to
  }
}

/** sla_hours -> a due_at timestamp, or null if the step has no SLA configured. */
function computeDueAt(slaHours) {
  if (!slaHours) return null
  return new Date(Date.now() + slaHours * 60 * 60 * 1000)
}

/**
 * Resolve a workflow_steps approver_role/escalation_role + approver_user_id
 * into the user id(s) a WorkflowTask should be created for.
 *  - userId set                -> that user, exclusively.
 *  - roleName 'reporting_manager' -> the initiator's manager (0 or 1 users).
 *  - any other roleName        -> every active user in the tenant holding it.
 */
async function resolveApproverUserIds(client, tenantId, { roleName, userId, initiatorId }) {
  if (userId) return [userId]
  if (!roleName) return []

  if (roleName === 'reporting_manager') {
    const result = await client.query(
      `SELECT manager_id FROM user_profiles WHERE user_id = $1 AND manager_id IS NOT NULL`,
      [initiatorId]
    )
    return result.rows[0]?.manager_id ? [result.rows[0].manager_id] : []
  }

  const result = await client.query(
    `SELECT DISTINCT ur.user_id
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     JOIN users u ON u.id = ur.user_id
     WHERE r.tenant_id = $1 AND r.name = $2 AND r.status = 'active'
       AND u.status = 'active'
       AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
       AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)`,
    [tenantId, roleName]
  )
  return result.rows.map((r) => r.user_id)
}

function resolveStepApprovers(client, tenantId, step, initiatorId) {
  return resolveApproverUserIds(client, tenantId, {
    roleName: step.approver_role,
    userId: step.approver_user_id,
    initiatorId
  })
}

async function fetchActiveRoleNames(runner, tenantId, userId) {
  const result = await runner.query(
    `SELECT r.name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 AND r.tenant_id = $2 AND r.status = 'active'
       AND (ur.effective_from IS NULL OR ur.effective_from <= CURRENT_DATE)
       AND (ur.effective_to   IS NULL OR ur.effective_to   >= CURRENT_DATE)`,
    [userId, tenantId]
  )
  return result.rows.map((r) => r.name)
}

/**
 * When a fan-out step is resolved by one approver (approve/reject/send_back),
 * the other role-holders' pending tasks for that step no longer need action.
 * 'withdrawn' is the closest fit in the workflow_tasks.status CHECK constraint
 * for "removed from your queue, not by you".
 */
async function supersedeSiblingTasks(client, instanceId, stepId, excludeTaskId) {
  await client.query(
    `UPDATE workflow_tasks
     SET status = 'withdrawn', comment = COALESCE(comment, 'Resolved by another approver'), acted_at = NOW()
     WHERE instance_id = $1 AND step_id = $2 AND status = 'pending' AND id != $3`,
    [instanceId, stepId, excludeTaskId]
  )
}

/** Resource-level failure: actor passed requirePermission(workflow.tasks.approve) but isn't party to this instance. */
async function recordAccessViolation({ actor, action, entityId, ipAddress, userAgent }) {
  await auditLog.write({
    tenantId: actor.tenantId,
    actorUserId: actor.id,
    actorRoleAtTime: actor.roles?.join(','),
    actionType: AuditActions.ACCESS_VIOLATION,
    entityType: 'WorkflowInstance',
    entityId,
    ipAddress,
    userAgent,
    result: 'failure',
    metadata: { action, reason: 'not_assigned_to_actor' }
  })
}

// ---------------------------------------------------------------------------
// startWorkflow
// ---------------------------------------------------------------------------

/**
 * Create a WorkflowInstance from `definitionId` and assign the first
 * WorkflowTask to the resolved approver(s) for step 1.
 *
 * Caller-managed transaction: this runs entirely on `client` and does not
 * BEGIN/COMMIT/ROLLBACK itself — call it from inside the triggering feature's
 * own transaction so the instance and the entity it approves commit together.
 *
 * @param {string} definitionId
 * @param {string} entityType   - e.g. 'LearningAsset', 'SkillDeclaration'
 * @param {string} entityId
 * @param {string} initiatedBy  - user id of whoever triggered the workflow
 * @param {object} client       - pg transaction client (required)
 */
async function startWorkflow(definitionId, entityType, entityId, initiatedBy, client) {
  const definitionResult = await client.query(
    `SELECT * FROM workflow_definitions WHERE id = $1 AND is_active = TRUE`,
    [definitionId]
  )
  const definition = definitionResult.rows[0]
  if (!definition) {
    throw new Error(`No active workflow definition found for id ${definitionId}`)
  }

  const stepsResult = await client.query(
    `SELECT * FROM workflow_steps WHERE definition_id = $1 ORDER BY step_order ASC`,
    [definitionId]
  )
  const firstStep = stepsResult.rows[0]
  if (!firstStep) {
    throw new Error(`Workflow definition ${definitionId} has no steps configured`)
  }
  if (firstStep.step_type !== 'approval') {
    throw new Error(`Workflow definition ${definitionId} step 1 must be an 'approval' step (got '${firstStep.step_type}')`)
  }

  const approverIds = await resolveStepApprovers(client, definition.tenant_id, firstStep, initiatedBy)
  if (approverIds.length === 0) {
    throw new Error(`No approver could be resolved for step 1 of workflow definition ${definitionId}`)
  }

  const dueAt = computeDueAt(firstStep.sla_hours)

  const instanceResult = await client.query(
    `INSERT INTO workflow_instances
       (tenant_id, definition_id, entity_type, entity_id, initiated_by, current_step, status, due_at)
     VALUES ($1, $2, $3, $4, $5, 1, 'in_progress', $6)
     RETURNING *`,
    [definition.tenant_id, definitionId, entityType, entityId, initiatedBy, dueAt]
  )
  const instance = instanceResult.rows[0]

  const tasks = []
  for (const approverId of approverIds) {
    const taskResult = await client.query(
      `INSERT INTO workflow_tasks (instance_id, step_id, assigned_to, due_at, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [instance.id, firstStep.id, approverId, dueAt]
    )
    tasks.push(taskResult.rows[0])
  }

  const initiatorRoles = await fetchActiveRoleNames(client, definition.tenant_id, initiatedBy)

  await auditLog.write({
    tenantId: definition.tenant_id,
    actorUserId: initiatedBy,
    actorRoleAtTime: initiatorRoles.join(','),
    actionType: AuditActions.WORKFLOW_STARTED,
    entityType: 'WorkflowInstance',
    entityId: instance.id,
    newValue: serializeInstance(instance),
    result: 'success',
    metadata: { definitionId, entityType, entityId, assignedTo: approverIds }
  }, client)

  for (const approverId of approverIds) {
    await notificationService.notify({
      tenantId: definition.tenant_id,
      userId: approverId,
      eventType: 'workflow.task.assigned',
      data: {
        workflow_name: definition.name,
        due_date: dueAt ? dueAt.toISOString() : ''
      },
      metadata: { workflow_instance_id: instance.id, entity_type: entityType, entity_id: entityId },
      client
    })
  }

  return { instance: serializeInstance(instance), tasks: tasks.map(serializeTask) }
}

// ---------------------------------------------------------------------------
// POST /workflows/:instanceId/actions
// ---------------------------------------------------------------------------

async function takeAction({ actor, instanceId, action, comment, attachment, delegateTo, ipAddress, userAgent }) {
  if (!ACTIONS.includes(action)) {
    return { ok: false, status: 400, error: `action must be one of: ${ACTIONS.join(', ')}` }
  }
  if (action === 'delegate' && !delegateTo) {
    return { ok: false, status: 400, error: 'delegateTo is required for the delegate action' }
  }

  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const instanceResult = await client.query(
      `SELECT * FROM workflow_instances WHERE id = $1 AND tenant_id = $2`,
      [instanceId, actor.tenantId]
    )
    const instance = instanceResult.rows[0]
    if (!instance) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Workflow instance not found' }
    }

    if (TERMINAL_INSTANCE_STATUSES.includes(instance.status)) {
      await client.query('ROLLBACK')
      return { ok: false, status: 409, error: `This workflow is already ${instance.status} and cannot be actioned further` }
    }

    const oldValue = serializeInstance(instance)
    let updated
    let notifications = []

    if (action === 'withdraw') {
      if (instance.initiated_by !== actor.id) {
        await client.query('ROLLBACK')
        await recordAccessViolation({ actor, action: 'workflow.tasks.approve', entityId: instanceId, ipAddress, userAgent })
        return { ok: false, status: 403, error: 'Forbidden' }
      }

      await client.query(
        `UPDATE workflow_tasks SET status = 'withdrawn', acted_at = NOW() WHERE instance_id = $1 AND status = 'pending'`,
        [instanceId]
      )

      const updatedResult = await client.query(
        `UPDATE workflow_instances SET status = 'withdrawn', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
        [instanceId]
      )
      updated = updatedResult.rows[0]

      const assigneesResult = await client.query(
        `SELECT DISTINCT assigned_to FROM workflow_tasks WHERE instance_id = $1 AND assigned_to != $2`,
        [instanceId, actor.id]
      )
      notifications = assigneesResult.rows.map((row) => ({
        userId: row.assigned_to,
        eventType: 'workflow.withdrawn',
        data: { comment: comment || '' }
      }))
    } else {
      const definitionResult = await client.query(
        `SELECT * FROM workflow_definitions WHERE id = $1 AND tenant_id = $2`,
        [instance.definition_id, actor.tenantId]
      )
      const definition = definitionResult.rows[0]

      const stepResult = await client.query(
        `SELECT * FROM workflow_steps WHERE definition_id = $1 AND step_order = $2`,
        [instance.definition_id, instance.current_step]
      )
      const step = stepResult.rows[0]

      const myTasksResult = await client.query(
        `SELECT * FROM workflow_tasks WHERE instance_id = $1 AND assigned_to = $2 ORDER BY assigned_at DESC`,
        [instanceId, actor.id]
      )
      const task = myTasksResult.rows.find((t) => t.status === 'pending' && t.step_id === step.id)

      if (myTasksResult.rows.length === 0) {
        await client.query('ROLLBACK')
        await recordAccessViolation({ actor, action: 'workflow.tasks.approve', entityId: instanceId, ipAddress, userAgent })
        return { ok: false, status: 403, error: 'Forbidden' }
      }
      if (!task) {
        await client.query('ROLLBACK')
        return { ok: false, status: 409, error: 'Your task on this workflow has already been actioned or is no longer the active step' }
      }

      await client.query(
        `UPDATE workflow_tasks SET status = $1, action_taken = $2, comment = $3, acted_at = NOW() WHERE id = $4`,
        [TASK_STATUS_BY_ACTION[action], action, comment || null, task.id]
      )

      if (action === 'approve') {
        const nextStepResult = await client.query(
          `SELECT * FROM workflow_steps WHERE definition_id = $1 AND step_order = $2`,
          [instance.definition_id, instance.current_step + 1]
        )
        const nextStep = nextStepResult.rows[0]

        if (nextStep) {
          if (nextStep.step_type !== 'approval') {
            await client.query('ROLLBACK')
            return { ok: false, status: 500, error: `Step ${nextStep.step_order} of this workflow must be an 'approval' step (got '${nextStep.step_type}')` }
          }

          const approverIds = await resolveStepApprovers(client, actor.tenantId, nextStep, instance.initiated_by)
          if (approverIds.length === 0) {
            await client.query('ROLLBACK')
            return { ok: false, status: 500, error: `No approver could be resolved for step ${nextStep.step_order} of this workflow` }
          }

          const dueAt = computeDueAt(nextStep.sla_hours)
          const updatedResult = await client.query(
            `UPDATE workflow_instances SET current_step = $2, status = 'in_progress', due_at = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [instanceId, instance.current_step + 1, dueAt]
          )
          updated = updatedResult.rows[0]

          for (const approverId of approverIds) {
            await client.query(
              `INSERT INTO workflow_tasks (instance_id, step_id, assigned_to, due_at, status) VALUES ($1, $2, $3, $4, 'pending')`,
              [instanceId, nextStep.id, approverId, dueAt]
            )
            notifications.push({ userId: approverId, eventType: 'workflow.task.assigned', data: { workflow_name: definition?.name || '', due_date: dueAt ? dueAt.toISOString() : '' } })
          }
        } else {
          const updatedResult = await client.query(
            `UPDATE workflow_instances SET status = 'approved', completed_at = NOW(), due_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [instanceId]
          )
          updated = updatedResult.rows[0]
          notifications.push({ userId: instance.initiated_by, eventType: 'workflow.approved', data: { workflow_name: definition?.name || '' } })
        }

        await supersedeSiblingTasks(client, instanceId, step.id, task.id)
      } else if (action === 'reject') {
        const updatedResult = await client.query(
          `UPDATE workflow_instances SET status = 'rejected', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`,
          [instanceId]
        )
        updated = updatedResult.rows[0]
        notifications.push({ userId: instance.initiated_by, eventType: 'workflow.rejected', data: { workflow_name: definition?.name || '', comment: comment || '' } })

        await supersedeSiblingTasks(client, instanceId, step.id, task.id)
      } else if (action === 'send_back') {
        // Needs-revision marker: instance stays in_progress, routing restarts
        // from step 1 once the feature re-submits (a new startWorkflow call).
        const updatedResult = await client.query(
          `UPDATE workflow_instances SET current_step = 1, status = 'in_progress', updated_at = NOW() WHERE id = $1 RETURNING *`,
          [instanceId]
        )
        updated = updatedResult.rows[0]
        notifications.push({ userId: instance.initiated_by, eventType: 'workflow.sent_back', data: { workflow_name: definition?.name || '', comment: comment || '' } })

        await supersedeSiblingTasks(client, instanceId, step.id, task.id)
      } else if (action === 'request_info') {
        // Pauses for clarification without re-routing — other fan-out
        // approvers, if any, can still act on this step independently.
        const updatedResult = await client.query(
          `UPDATE workflow_instances SET updated_at = NOW() WHERE id = $1 RETURNING *`,
          [instanceId]
        )
        updated = updatedResult.rows[0]
        notifications.push({ userId: instance.initiated_by, eventType: 'workflow.info_requested', data: { workflow_name: definition?.name || '', comment: comment || '' } })
      } else if (action === 'escalate') {
        if (!step.escalation_role) {
          await client.query('ROLLBACK')
          return { ok: false, status: 400, error: 'This step has no escalation_role configured' }
        }

        const escalationTargets = await resolveApproverUserIds(client, actor.tenantId, {
          roleName: step.escalation_role,
          userId: null,
          initiatorId: instance.initiated_by
        })
        if (escalationTargets.length === 0) {
          await client.query('ROLLBACK')
          return { ok: false, status: 400, error: `No user found holding the escalation role '${step.escalation_role}'` }
        }

        const dueAt = computeDueAt(step.sla_hours)
        const updatedResult = await client.query(
          `UPDATE workflow_instances SET status = 'escalated', due_at = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
          [instanceId, dueAt]
        )
        updated = updatedResult.rows[0]

        for (const userId of escalationTargets) {
          await client.query(
            `INSERT INTO workflow_tasks (instance_id, step_id, assigned_to, due_at, status) VALUES ($1, $2, $3, $4, 'pending')`,
            [instanceId, step.id, userId, dueAt]
          )
          notifications.push({ userId, eventType: 'workflow.task.assigned', data: { workflow_name: definition?.name || '', due_date: dueAt ? dueAt.toISOString() : '' } })
        }
      } else if (action === 'delegate') {
        const delegateResult = await client.query(
          `SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
          [delegateTo, actor.tenantId]
        )
        if (delegateResult.rows.length === 0) {
          await client.query('ROLLBACK')
          return { ok: false, status: 400, error: 'delegateTo must be an active user in this tenant' }
        }

        await client.query(`UPDATE workflow_tasks SET delegated_to = $1 WHERE id = $2`, [delegateTo, task.id])

        const dueAt = task.due_at || computeDueAt(step.sla_hours)
        await client.query(
          `INSERT INTO workflow_tasks (instance_id, step_id, assigned_to, due_at, status) VALUES ($1, $2, $3, $4, 'pending')`,
          [instanceId, step.id, delegateTo, dueAt]
        )

        const updatedResult = await client.query(
          `UPDATE workflow_instances SET updated_at = NOW() WHERE id = $1 RETURNING *`,
          [instanceId]
        )
        updated = updatedResult.rows[0]
        notifications.push({ userId: delegateTo, eventType: 'workflow.task.assigned', data: { workflow_name: definition?.name || '', due_date: dueAt ? dueAt.toISOString() : '' } })
      }
    }

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AUDIT_ACTION_BY_ACTION[action],
      entityType: 'WorkflowInstance',
      entityId: instanceId,
      oldValue,
      newValue: serializeInstance(updated),
      ipAddress,
      userAgent,
      result: 'success',
      metadata: { action, comment: comment || null, attachment: attachment || null }
    }, client)

    for (const n of notifications) {
      await notificationService.notify({
        tenantId: actor.tenantId,
        userId: n.userId,
        eventType: n.eventType,
        data: n.data,
        metadata: { workflow_instance_id: instanceId },
        client
      })
    }

    await client.query('COMMIT')
    return { ok: true, instance: serializeInstance(updated) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// GET /workflows/tasks/me
// ---------------------------------------------------------------------------

async function getMyTasks({ actor }) {
  const result = await db.query(
    `SELECT wt.*, wi.entity_type, wi.entity_id, wi.status AS instance_status,
            wi.definition_id, wd.name AS workflow_name
     FROM workflow_tasks wt
     JOIN workflow_instances wi ON wi.id = wt.instance_id
     JOIN workflow_definitions wd ON wd.id = wi.definition_id
     WHERE wi.tenant_id = $1 AND wt.assigned_to = $2 AND wt.status = 'pending'
     ORDER BY wt.due_at ASC NULLS LAST, wt.assigned_at ASC`,
    [actor.tenantId, actor.id]
  )

  return result.rows.map((row) => ({
    ...serializeTask(row),
    workflowName: row.workflow_name,
    definitionId: row.definition_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    instanceStatus: row.instance_status
  }))
}

// ---------------------------------------------------------------------------
// SLA escalation — called by a scheduled job
// ---------------------------------------------------------------------------

/**
 * Find pending tasks on the currently-active step of their workflow instance
 * whose due_at has passed, and escalate each to its step's escalation_role.
 * Tasks with no escalation_role configured (or that resolve to nobody) are
 * left pending — there's nowhere to route them, an admin needs to fix the
 * step configuration.
 */
async function checkSLABreaches() {
  const breachedResult = await db.query(
    `SELECT wt.*, wi.tenant_id, wi.definition_id, wi.current_step,
            wi.initiated_by, wi.status AS instance_status
     FROM workflow_tasks wt
     JOIN workflow_instances wi ON wi.id = wt.instance_id
     JOIN workflow_steps ws ON ws.id = wt.step_id
     WHERE wt.status = 'pending'
       AND wt.due_at IS NOT NULL
       AND wt.due_at < NOW()
       AND ws.step_order = wi.current_step`
  )

  let escalated = 0
  for (const task of breachedResult.rows) {
    const client = await db.getClient()
    try {
      await client.query('BEGIN')

      const stepResult = await client.query(`SELECT * FROM workflow_steps WHERE id = $1`, [task.step_id])
      const step = stepResult.rows[0]

      if (!step?.escalation_role) {
        await client.query('ROLLBACK')
        continue
      }

      const escalationTargets = await resolveApproverUserIds(client, task.tenant_id, {
        roleName: step.escalation_role,
        userId: null,
        initiatorId: task.initiated_by
      })

      if (escalationTargets.length === 0) {
        await client.query('ROLLBACK')
        continue
      }

      await client.query(
        `UPDATE workflow_tasks SET status = 'escalated', action_taken = 'escalate', comment = 'SLA breach - auto-escalated', acted_at = NOW() WHERE id = $1`,
        [task.id]
      )

      const dueAt = computeDueAt(step.sla_hours)
      const updatedInstanceResult = await client.query(
        `UPDATE workflow_instances SET status = 'escalated', due_at = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [task.instance_id, dueAt]
      )
      const updatedInstance = updatedInstanceResult.rows[0]

      const definitionResult = await client.query(`SELECT name FROM workflow_definitions WHERE id = $1`, [task.definition_id])
      const workflowName = definitionResult.rows[0]?.name || ''

      for (const userId of escalationTargets) {
        await client.query(
          `INSERT INTO workflow_tasks (instance_id, step_id, assigned_to, due_at, status) VALUES ($1, $2, $3, $4, 'pending')`,
          [task.instance_id, step.id, userId, dueAt]
        )
        await notificationService.notify({
          tenantId: task.tenant_id,
          userId,
          eventType: 'workflow.task.assigned',
          data: { workflow_name: workflowName, due_date: dueAt ? dueAt.toISOString() : '' },
          metadata: { workflow_instance_id: task.instance_id, reason: 'sla_breach' },
          client
        })
      }

      await auditLog.write({
        tenantId: task.tenant_id,
        actorRoleAtTime: 'system',
        actionType: AuditActions.WORKFLOW_ESCALATED,
        entityType: 'WorkflowInstance',
        entityId: task.instance_id,
        oldValue: { status: task.instance_status, currentStep: task.current_step },
        newValue: serializeInstance(updatedInstance),
        result: 'success',
        metadata: { reason: 'sla_breach', taskId: task.id, escalatedTo: escalationTargets }
      }, client)

      await client.query('COMMIT')
      escalated += 1
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  return { checked: breachedResult.rows.length, escalated }
}

module.exports = {
  startWorkflow,
  takeAction,
  getMyTasks,
  checkSLABreaches,
  resolveApproverUserIds,
  serializeInstance,
  serializeTask
}
