// src/modules/audit/auditLog.js
//
// Central audit logging service.
// Call audit.write() inside the SAME db transaction as the change.
// Never fire-and-forget after the response is sent.

const db = require('../../db')

const AuditActions = {
  // Auth
  LOGIN_SUCCESS:      'LOGIN_SUCCESS',
  LOGIN_FAILED:       'LOGIN_FAILED',
  LOGOUT:             'LOGOUT',
  MFA_ENABLED:        'MFA_ENABLED',
  PASSWORD_CHANGED:   'PASSWORD_CHANGED',
  ACCESS_VIOLATION:   'ACCESS_VIOLATION',

  // Users
  USER_CREATED:       'USER_CREATED',
  USER_UPDATED:       'USER_UPDATED',
  USER_DEACTIVATED:   'USER_DEACTIVATED',
  USER_BULK_UPLOADED: 'USER_BULK_UPLOADED',

  // Roles
  ROLE_CREATED:       'ROLE_CREATED',
  ROLE_UPDATED:       'ROLE_UPDATED',
  ROLE_ASSIGNED:      'ROLE_ASSIGNED',
  ROLE_REMOVED:       'ROLE_REMOVED',
  ROLE_SWITCHED:      'ROLE_SWITCHED',
  PERMISSION_CHANGED: 'PERMISSION_CHANGED',

  // Workflow
  WORKFLOW_STARTED:        'WORKFLOW_STARTED',
  WORKFLOW_APPROVED:       'WORKFLOW_APPROVED',
  WORKFLOW_REJECTED:       'WORKFLOW_REJECTED',
  WORKFLOW_SENT_BACK:      'WORKFLOW_SENT_BACK',
  WORKFLOW_INFO_REQUESTED: 'WORKFLOW_INFO_REQUESTED',
  WORKFLOW_ESCALATED:      'WORKFLOW_ESCALATED',
  WORKFLOW_DELEGATED:      'WORKFLOW_DELEGATED',
  WORKFLOW_WITHDRAWN:      'WORKFLOW_WITHDRAWN',

  // Notifications
  NOTIFICATION_READ:     'NOTIFICATION_READ',
  NOTIFICATION_ALL_READ: 'NOTIFICATION_ALL_READ',

  // Config
  CONFIG_CHANGED:     'CONFIG_CHANGED',
  FEATURE_FLAG_CHANGED: 'FEATURE_FLAG_CHANGED',

  // Content
  CONTENT_CREATED:     'CONTENT_CREATED',
  CONTENT_UPDATED:     'CONTENT_UPDATED',
  CONTENT_SUBMITTED_FOR_REVIEW: 'CONTENT_SUBMITTED_FOR_REVIEW',
  CONTENT_PUBLISHED:   'CONTENT_PUBLISHED',
  CONTENT_RETIRED:     'CONTENT_RETIRED',
}

/**
 * Write an audit event.
 *
 * @param {object} params
 * @param {object} [client]  - Optional pg transaction client.
 *                             Pass this when writing inside a transaction
 *                             so the audit event is part of the same tx.
 */
async function write(params, client) {
  const {
    tenantId,
    actorUserId,
    actorRoleAtTime,
    actionType,
    entityType,
    entityId,
    oldValue,
    newValue,
    ipAddress,
    userAgent,
    result = 'success',
    metadata
  } = params

  const query = `
    INSERT INTO audit_events
      (tenant_id, actor_user_id, actor_role_at_time, action_type,
       entity_type, entity_id, old_value, new_value,
       ip_address, user_agent, result, metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `

  const values = [
    tenantId,
    actorUserId || null,
    actorRoleAtTime || null,
    actionType,
    entityType || null,
    entityId || null,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    ipAddress || null,
    userAgent || null,
    result,
    metadata ? JSON.stringify(metadata) : null
  ]

  // Use transaction client if provided, otherwise use pool
  const runner = client || db
  await runner.query(query, values)
}

/**
 * Helper to build actor info from req.user
 */
function actorFromRequest(req) {
  const user = req?.user
  if (!user) return {}
  return {
    tenantId: user.tenantId,
    actorUserId: user.id,
    actorRoleAtTime: user.roles?.join(','),
    ipAddress: req.ip,
    userAgent: req.headers?.['user-agent']
  }
}

module.exports = { write, actorFromRequest, AuditActions }
