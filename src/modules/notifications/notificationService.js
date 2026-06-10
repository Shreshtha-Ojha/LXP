// src/modules/notifications/notificationService.js
//
// Minimal notification dispatch on top of notification_templates /
// notification_preferences (Rule 1 — copy, channels, and opt-outs are config,
// never hardcoded strings in feature code).
//
// Callers that are inside their own transaction (e.g. workflowService) pass
// `client` so the notification rows commit atomically with the state change
// that triggered them (Rule 4).

const db = require('../../db')

/** Replace {{key}} placeholders with values from `data`. Unknown keys are left as-is. */
function renderTemplate(text, data = {}) {
  if (!text) return text
  return text.replace(/{{\s*([\w.]+)\s*}}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : match
  ))
}

/**
 * Dispatch `eventType` to `userId` — one notification row per active,
 * non-opted-out template/channel for this tenant + event type.
 *
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

    const insertResult = await runner.query(
      `INSERT INTO notifications
         (tenant_id, user_id, template_id, channel, subject, body, sent_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       RETURNING *`,
      [
        tenantId,
        userId,
        template.id,
        template.channel,
        renderTemplate(template.subject, data),
        renderTemplate(template.body, data),
        metadata ? JSON.stringify(metadata) : null
      ]
    )
    sent.push(insertResult.rows[0])
  }

  return sent
}

module.exports = { notify, renderTemplate }
