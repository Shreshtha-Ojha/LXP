// src/modules/notifications/notificationService.js
//
// Notification dispatch and inbox on top of notification_templates /
// notifications / notification_preferences (Rule 1 — copy, channels, and
// opt-outs are config, never hardcoded strings in feature code).
//
// Two ways in:
//  - notify({ tenantId, userId, eventType, data, metadata, client }) — for
//    callers that already know the tenant (e.g. workflowService), often
//    from inside their own transaction so notification rows commit
//    atomically with the state change that triggered them (Rule 4).
//  - send(userId, eventType, variables, client) — for callers that only
//    have a userId; the tenant and email address are resolved here.
//
// Both dispatch one row per active, non-opted-out template/channel for the
// event type, and send a real email via nodemailer for any 'email' channel
// template.

const nodemailer = require('nodemailer')
const db = require('../../db')
const auditLog = require('../audit/auditLog')

const { AuditActions } = auditLog

/** Replace {{key}} placeholders with values from `data`. Unknown keys are left as-is. */
function renderTemplate(text, data = {}) {
  if (!text) return text
  return text.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match
  ))
}

// ---------------------------------------------------------------------------
// Email transport
// ---------------------------------------------------------------------------

let transporter

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    })
  }
  return transporter
}

async function sendEmail({ to, subject, body }) {
  if (!to) return
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: subject || '(no subject)',
    text: body
  })
}

async function getUserEmail(runner, userId) {
  const result = await runner.query(`SELECT email FROM users WHERE id = $1`, [userId])
  return result.rows[0]?.email
}

// ---------------------------------------------------------------------------
// Shared dispatch
// ---------------------------------------------------------------------------

/**
 * Render+insert one notification row per active template/channel for
 * `eventType`, skipping channels the user has opted out of via
 * notification_preferences. Email-channel rows are also sent via nodemailer
 * — a delivery failure is logged but never fails the dispatch (the in-app
 * row and whatever triggered it must still commit).
 */
async function dispatch({ tenantId, userId, userEmail, eventType, data = {}, metadata, client }) {
  const runner = client || db

  const templatesResult = await runner.query(
    `SELECT * FROM notification_templates
     WHERE tenant_id = $1 AND event_type = $2 AND is_active = TRUE`,
    [tenantId, eventType]
  )

  const sent = []
  for (const template of templatesResult.rows) {
    const prefResult = await runner.query(
      `SELECT is_enabled FROM notification_preferences
       WHERE user_id = $1 AND event_type = $2 AND channel = $3`,
      [userId, eventType, template.channel]
    )
    if (prefResult.rows[0]?.is_enabled === false) continue

    const subject = renderTemplate(template.subject, data)
    const body = renderTemplate(template.body, data)

    const insertResult = await runner.query(
      `INSERT INTO notifications
         (tenant_id, user_id, template_id, channel, subject, body, sent_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       RETURNING *`,
      [tenantId, userId, template.id, template.channel, subject, body, metadata ? JSON.stringify(metadata) : null]
    )
    sent.push(insertResult.rows[0])

    if (template.channel === 'email') {
      try {
        const recipient = userEmail || (await getUserEmail(runner, userId))
        await sendEmail({ to: recipient, subject, body })
      } catch (err) {
        console.error('Failed to send notification email:', err.message)
      }
    }
  }

  return sent
}

/**
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.userId
 * @param {string} params.eventType   - e.g. 'workflow.task.assigned'
 * @param {object} [params.data]      - values for {{placeholder}} substitution in subject/body
 * @param {object} [params.metadata]  - stored as JSONB on the notification row
 * @param {object} [params.client]    - pg transaction client
 * @returns {Promise<object[]>} the notification rows that were created
 */
async function notify({ tenantId, userId, eventType, data = {}, metadata, client }) {
  return dispatch({ tenantId, userId, eventType, data, metadata, client })
}

/**
 * notificationService.send(userId, eventType, variables, client)
 *
 * Resolves the user's tenant_id and email (the tenant can't be known until
 * the user is identified, same reasoning as authService.findUserByEmail —
 * Rule 3 still applies to every query once tenantId is known), then
 * dispatches like notify() above.
 *
 * @param {string} userId
 * @param {string} eventType
 * @param {object} [variables]  - values for {{placeholder}} substitution
 * @param {object} [client]     - pg transaction client
 * @returns {Promise<object[]>} the notification rows that were created
 */
async function send(userId, eventType, variables = {}, client) {
  const runner = client || db

  const userResult = await runner.query(`SELECT tenant_id, email FROM users WHERE id = $1`, [userId])
  const user = userResult.rows[0]
  if (!user) return []

  return dispatch({
    tenantId: user.tenant_id,
    userId,
    userEmail: user.email,
    eventType,
    data: variables,
    metadata: undefined,
    client
  })
}

// ---------------------------------------------------------------------------
// Inbox — GET /notifications/me, POST /notifications/:id/read, POST /notifications/read-all
// ---------------------------------------------------------------------------

function serializeNotification(row) {
  if (!row) return null
  return {
    id: row.id,
    channel: row.channel,
    subject: row.subject,
    body: row.body,
    isRead: row.is_read,
    readAt: row.read_at,
    sentAt: row.sent_at,
    metadata: row.metadata,
    createdAt: row.created_at
  }
}

/** GET /notifications/me — unread notifications for the caller, newest first. */
async function getUnreadForUser({ actor }) {
  const result = await db.query(
    `SELECT * FROM notifications
     WHERE tenant_id = $1 AND user_id = $2 AND is_read = FALSE
     ORDER BY created_at DESC`,
    [actor.tenantId, actor.id]
  )
  return result.rows.map(serializeNotification)
}

/** POST /notifications/:id/read — mark one of the caller's notifications as read. */
async function markAsRead({ actor, notificationId, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const result = await client.query(
      `SELECT * FROM notifications WHERE id = $1 AND tenant_id = $2`,
      [notificationId, actor.tenantId]
    )
    const notification = result.rows[0]
    if (!notification) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, error: 'Notification not found' }
    }

    if (notification.user_id !== actor.id) {
      await client.query('ROLLBACK')
      await auditLog.write({
        tenantId: actor.tenantId,
        actorUserId: actor.id,
        actorRoleAtTime: actor.roles?.join(','),
        actionType: AuditActions.ACCESS_VIOLATION,
        entityType: 'Notification',
        entityId: notificationId,
        ipAddress,
        userAgent,
        result: 'failure',
        metadata: { action: 'notifications.inbox.edit', reason: 'not_owner' }
      })
      return { ok: false, status: 403, error: 'Forbidden' }
    }

    if (notification.is_read) {
      await client.query('ROLLBACK')
      return { ok: true, notification: serializeNotification(notification) }
    }

    const updateResult = await client.query(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1 RETURNING *`,
      [notificationId]
    )
    const updated = updateResult.rows[0]

    await auditLog.write({
      tenantId: actor.tenantId,
      actorUserId: actor.id,
      actorRoleAtTime: actor.roles?.join(','),
      actionType: AuditActions.NOTIFICATION_READ,
      entityType: 'Notification',
      entityId: notificationId,
      oldValue: { isRead: false },
      newValue: { isRead: true, readAt: updated.read_at },
      ipAddress,
      userAgent,
      result: 'success'
    }, client)

    await client.query('COMMIT')
    return { ok: true, notification: serializeNotification(updated) }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** POST /notifications/read-all — mark every unread notification for the caller as read. */
async function markAllAsRead({ actor, ipAddress, userAgent }) {
  const client = await db.getClient()
  try {
    await client.query('BEGIN')

    const result = await client.query(
      `UPDATE notifications
       SET is_read = TRUE, read_at = NOW()
       WHERE tenant_id = $1 AND user_id = $2 AND is_read = FALSE
       RETURNING id`,
      [actor.tenantId, actor.id]
    )

    if (result.rows.length > 0) {
      await auditLog.write({
        tenantId: actor.tenantId,
        actorUserId: actor.id,
        actorRoleAtTime: actor.roles?.join(','),
        actionType: AuditActions.NOTIFICATION_ALL_READ,
        entityType: 'Notification',
        newValue: { count: result.rows.length },
        ipAddress,
        userAgent,
        result: 'success',
        metadata: { notificationIds: result.rows.map((r) => r.id) }
      }, client)
    }

    await client.query('COMMIT')
    return { markedCount: result.rows.length }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

module.exports = {
  notify,
  send,
  renderTemplate,
  getUnreadForUser,
  markAsRead,
  markAllAsRead,
  serializeNotification
}
