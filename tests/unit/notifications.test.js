// tests/unit/notifications.test.js
//
// Unit tests for src/modules/notifications/notificationService.js and the
// RBAC wiring in src/modules/notifications/notificationRoutes.js.
//
// Pattern (matches tests/unit/workflow.test.js): mock db, auditLog, and
// nodemailer so we can assert exactly what gets queried/inserted, what's
// written to the audit log, and what's sent by email. authenticate is
// mocked at the top level so every required module shares the same mocked
// db singleton.

jest.mock('../../src/db', () => ({
  query: jest.fn(),
  getClient: jest.fn()
}))
jest.mock('../../src/modules/audit/auditLog', () => {
  const actual = jest.requireActual('../../src/modules/audit/auditLog')
  return { ...actual, write: jest.fn() }
})
const mockSendMail = jest.fn().mockResolvedValue(true)
jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: mockSendMail }))
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

function txClient(responses) {
  const query = jest.fn()
  responses.forEach((r) => query.mockResolvedValueOnce(r))
  return { query, release: jest.fn() }
}

beforeEach(() => {
  jest.clearAllMocks()
})

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  it('replaces {{variable}} placeholders with values from data', () => {
    expect(notificationService.renderTemplate('Hi {{name}}, your course is {{course}}', {
      name: 'Asha',
      course: 'Kubernetes 101'
    })).toBe('Hi Asha, your course is Kubernetes 101')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(notificationService.renderTemplate('Hi {{name}}', {})).toBe('Hi {{name}}')
  })

  it('returns falsy text as-is', () => {
    expect(notificationService.renderTemplate(null, { name: 'Asha' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// send(userId, eventType, variables, client)
// ---------------------------------------------------------------------------

describe('send', () => {
  const inAppTemplate = {
    id: 'tmpl-1', tenant_id: 'tenant-1', event_type: 'course.assigned', channel: 'in_app',
    subject: null, body: 'You were assigned {{course_name}}', is_active: true
  }
  const emailTemplate = {
    id: 'tmpl-2', tenant_id: 'tenant-1', event_type: 'course.assigned', channel: 'email',
    subject: 'New course: {{course_name}}', body: 'Hi, you were assigned {{course_name}}', is_active: true
  }

  it('renders the template, inserts a notification row, and returns it', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', email: 'alice@example.com' }] }) // user lookup
      .mockResolvedValueOnce({ rows: [inAppTemplate] }) // active templates for event type
      .mockResolvedValueOnce({ rows: [] }) // notification_preferences (none -> enabled)
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1', channel: 'in_app', body: 'You were assigned Kubernetes 101', is_read: false }] }) // INSERT

    const result = await notificationService.send('user-1', 'course.assigned', { course_name: 'Kubernetes 101' })

    expect(result).toEqual([expect.objectContaining({ id: 'notif-1', body: 'You were assigned Kubernetes 101' })])

    const [insertSql, insertParams] = db.query.mock.calls[3]
    expect(insertSql).toContain('INSERT INTO notifications')
    expect(insertParams).toEqual(['tenant-1', 'user-1', 'tmpl-1', 'in_app', null, 'You were assigned Kubernetes 101', null])
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('sends an email via nodemailer for an email-channel template', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', email: 'alice@example.com' }] }) // user lookup
      .mockResolvedValueOnce({ rows: [emailTemplate] })
      .mockResolvedValueOnce({ rows: [] }) // preferences
      .mockResolvedValueOnce({ rows: [{ id: 'notif-2', channel: 'email', subject: 'New course: Kubernetes 101', body: 'Hi, you were assigned Kubernetes 101', is_read: false }] })

    await notificationService.send('user-1', 'course.assigned', { course_name: 'Kubernetes 101' })

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'alice@example.com',
      subject: 'New course: Kubernetes 101',
      text: 'Hi, you were assigned Kubernetes 101'
    }))
  })

  it('skips a channel the user has disabled via notification_preferences', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1', email: 'alice@example.com' }] })
      .mockResolvedValueOnce({ rows: [emailTemplate] })
      .mockResolvedValueOnce({ rows: [{ is_enabled: false }] }) // opted out of email for this event

    const result = await notificationService.send('user-1', 'course.assigned', { course_name: 'Kubernetes 101' })

    expect(result).toEqual([])
    expect(mockSendMail).not.toHaveBeenCalled()
    expect(db.query).toHaveBeenCalledTimes(3) // no INSERT
  })

  it('returns an empty array when the user does not exist', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }) // user lookup finds nothing

    const result = await notificationService.send('missing-user', 'course.assigned', {})

    expect(result).toEqual([])
    expect(db.query).toHaveBeenCalledTimes(1)
  })

  it('uses the provided transaction client for every query instead of the pool', async () => {
    const client = txClient([
      { rows: [{ tenant_id: 'tenant-1', email: 'alice@example.com' }] }, // user lookup
      { rows: [inAppTemplate] },
      { rows: [] },
      { rows: [{ id: 'notif-1', channel: 'in_app', body: 'You were assigned Kubernetes 101', is_read: false }] }
    ])

    await notificationService.send('user-1', 'course.assigned', { course_name: 'Kubernetes 101' }, client)

    expect(client.query).toHaveBeenCalledTimes(4)
    expect(db.query).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// notify({ tenantId, userId, eventType, data, metadata, client }) — used by
// the workflow engine; tenantId is already known so no user lookup happens
// unless an email-channel template needs the recipient's address.
// ---------------------------------------------------------------------------

describe('notify', () => {
  it('dispatches without an extra user lookup for a non-email channel', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'tmpl-1', tenant_id: 'tenant-1', event_type: 'workflow.task.assigned', channel: 'in_app', subject: null, body: 'Task: {{workflow_name}}' }]
      })
      .mockResolvedValueOnce({ rows: [] }) // preferences
      .mockResolvedValueOnce({ rows: [{ id: 'notif-1', channel: 'in_app', body: 'Task: Content Approval', is_read: false }] })

    const result = await notificationService.notify({
      tenantId: 'tenant-1',
      userId: 'manager-1',
      eventType: 'workflow.task.assigned',
      data: { workflow_name: 'Content Approval' }
    })

    expect(result).toEqual([expect.objectContaining({ body: 'Task: Content Approval' })])
    expect(db.query).toHaveBeenCalledTimes(3)
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('looks up the recipient email and sends via nodemailer for an email-channel template', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ id: 'tmpl-2', tenant_id: 'tenant-1', event_type: 'workflow.task.assigned', channel: 'email', subject: 'Action required', body: 'Please review {{workflow_name}}' }]
      })
      .mockResolvedValueOnce({ rows: [] }) // preferences
      .mockResolvedValueOnce({ rows: [{ id: 'notif-2', channel: 'email', subject: 'Action required', body: 'Please review Content Approval', is_read: false }] })
      .mockResolvedValueOnce({ rows: [{ email: 'manager@example.com' }] }) // recipient email lookup

    await notificationService.notify({
      tenantId: 'tenant-1',
      userId: 'manager-1',
      eventType: 'workflow.task.assigned',
      data: { workflow_name: 'Content Approval' }
    })

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'manager@example.com', subject: 'Action required' }))
  })
})

// ---------------------------------------------------------------------------
// Routes (RBAC + behaviour)
// ---------------------------------------------------------------------------

describe('notification routes', () => {
  const request = require('supertest')
  const express = require('express')
  const notificationRoutes = require('../../src/modules/notifications/notificationRoutes')

  const app = express()
  app.use(express.json())
  app.use(notificationRoutes)

  describe('GET /notifications/me', () => {
    it('allows associate (200) and returns unread notifications newest first', async () => {
      const newer = { id: 'notif-2', channel: 'in_app', subject: null, body: 'Second', is_read: false, read_at: null, sent_at: '2026-06-10T01:00:00Z', metadata: null, created_at: '2026-06-10T01:00:00Z' }
      const older = { id: 'notif-1', channel: 'in_app', subject: null, body: 'First', is_read: false, read_at: null, sent_at: '2026-06-10T00:00:00Z', metadata: null, created_at: '2026-06-10T00:00:00Z' }

      db.query
        .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission
        .mockResolvedValueOnce({ rows: [newer, older] })      // getUnreadForUser

      const res = await request(app).get('/notifications/me').set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body.data).toEqual([
        expect.objectContaining({ id: 'notif-2', body: 'Second' }),
        expect.objectContaining({ id: 'notif-1', body: 'First' })
      ])

      const [sql, params] = db.query.mock.calls[1]
      expect(sql).toContain('is_read = FALSE')
      expect(sql).toContain('ORDER BY created_at DESC')
      expect(params).toEqual(['tenant-1', 'user-1'])
    })

    it('denies a role without notifications.inbox.view (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app).get('/notifications/me').set('x-test-role', 'external')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })

      const [violationSql, violationParams] = db.query.mock.calls[1]
      expect(violationSql).toContain('ACCESS_VIOLATION')
      expect(violationParams).toEqual(
        expect.arrayContaining(['tenant-1', 'user-1', 'external', 'notifications.inbox'])
      )
    })
  })

  describe('POST /notifications/:id/read', () => {
    it('allows associate to mark their own notification as read (200) and audit logs it', async () => {
      const notifRow = { id: 'notif-1', tenant_id: 'tenant-1', user_id: 'user-1', channel: 'in_app', subject: null, body: 'Hi', is_read: false, read_at: null, created_at: '2026-06-10T00:00:00Z' }
      const updatedRow = { ...notifRow, is_read: true, read_at: '2026-06-10T01:00:00Z' }

      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission

      const client = txClient([
        {},                     // BEGIN
        { rows: [notifRow] },   // SELECT notification
        { rows: [updatedRow] }, // UPDATE ... RETURNING
        {}                      // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app).post('/notifications/notif-1/read').set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body).toEqual(expect.objectContaining({ id: 'notif-1', isRead: true }))

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          actorUserId: 'user-1',
          actionType: auditLog.AuditActions.NOTIFICATION_READ,
          entityType: 'Notification',
          entityId: 'notif-1',
          result: 'success'
        }),
        client
      )
    })

    it('returns 200 without writing audit log if already read (idempotent)', async () => {
      const notifRow = { id: 'notif-1', tenant_id: 'tenant-1', user_id: 'user-1', channel: 'in_app', is_read: true, read_at: '2026-06-10T00:00:00Z' }

      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission

      const client = txClient([
        {},                   // BEGIN
        { rows: [notifRow] }, // SELECT - already read
        {}                    // ROLLBACK
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app).post('/notifications/notif-1/read').set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body).toEqual(expect.objectContaining({ id: 'notif-1', isRead: true }))
      expect(auditLog.write).not.toHaveBeenCalled()
    })

    it('returns 403 and logs ACCESS_VIOLATION when the notification belongs to another user', async () => {
      const notifRow = { id: 'notif-1', tenant_id: 'tenant-1', user_id: 'someone-else', is_read: false }

      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission

      const client = txClient([
        {},                   // BEGIN
        { rows: [notifRow] }, // SELECT - belongs to someone-else
        {}                    // ROLLBACK
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app).post('/notifications/notif-1/read').set('x-test-role', 'associate')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: auditLog.AuditActions.ACCESS_VIOLATION,
          entityType: 'Notification',
          entityId: 'notif-1',
          result: 'failure'
        })
      )
    })

    it('returns 404 when the notification does not exist', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission

      const client = txClient([
        {},          // BEGIN
        { rows: [] }, // SELECT - not found
        {}            // ROLLBACK
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app).post('/notifications/missing/read').set('x-test-role', 'associate')

      expect(res.status).toBe(404)
    })

    it('denies a role without notifications.inbox.edit (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app).post('/notifications/notif-1/read').set('x-test-role', 'external')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })

  describe('POST /notifications/read-all', () => {
    it('marks every unread notification as read and audit logs the bulk action', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission

      const client = txClient([
        {},                                                 // BEGIN
        { rows: [{ id: 'notif-1' }, { id: 'notif-2' }] },   // UPDATE ... RETURNING id
        {}                                                  // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app).post('/notifications/read-all').set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ markedCount: 2 })

      expect(auditLog.write).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          actorUserId: 'user-1',
          actionType: auditLog.AuditActions.NOTIFICATION_ALL_READ,
          entityType: 'Notification',
          newValue: { count: 2 },
          result: 'success'
        }),
        client
      )
    })

    it('does not write an audit event when there is nothing to mark read', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }) // hasPermission

      const client = txClient([
        {},          // BEGIN
        { rows: [] }, // UPDATE ... RETURNING id - nothing unread
        {}            // COMMIT
      ])
      db.getClient.mockResolvedValueOnce(client)

      const res = await request(app).post('/notifications/read-all').set('x-test-role', 'associate')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ markedCount: 0 })
      expect(auditLog.write).not.toHaveBeenCalled()
    })

    it('denies a role without notifications.inbox.edit (403) and logs ACCESS_VIOLATION', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [] }) // hasPermission denies
        .mockResolvedValueOnce({})           // ACCESS_VIOLATION insert

      const res = await request(app).post('/notifications/read-all').set('x-test-role', 'external')

      expect(res.status).toBe(403)
      expect(res.body).toEqual({ error: 'Forbidden' })
      expect(db.getClient).not.toHaveBeenCalled()
    })
  })
})
