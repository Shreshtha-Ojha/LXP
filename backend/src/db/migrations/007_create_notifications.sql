-- Migration 007: Notifications
-- Templates are stored in the DB, not hardcoded.
-- Channels: in_app and email in Release 0. Others added later.

CREATE TABLE notification_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  name            VARCHAR(255) NOT NULL,
  event_type      VARCHAR(100) NOT NULL,   -- e.g. 'workflow.task.assigned', 'user.created'
  channel         VARCHAR(50) NOT NULL
                  CHECK (channel IN ('in_app', 'email', 'sms', 'push', 'teams')),
  subject         VARCHAR(500),            -- for email
  body            TEXT        NOT NULL,    -- supports {{variable}} placeholders
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, event_type, channel)
);

CREATE TABLE notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id     UUID        REFERENCES notification_templates(id),
  channel         VARCHAR(50) NOT NULL,
  subject         VARCHAR(500),
  body            TEXT        NOT NULL,
  is_read         BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  metadata        JSONB,       -- e.g. { "workflow_instance_id": "...", "entity_type": "..." }
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_preferences (
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type      VARCHAR(100) NOT NULL,
  channel         VARCHAR(50) NOT NULL,
  is_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (user_id, event_type, channel)
);

CREATE INDEX idx_notifications_user      ON notifications(user_id);
CREATE INDEX idx_notifications_unread    ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_tenant    ON notifications(tenant_id);

-- Seed default notification templates for the internal tenant
INSERT INTO notification_templates (tenant_id, name, event_type, channel, subject, body) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Workflow Task Assigned - Email',
   'workflow.task.assigned', 'email',
   'Action Required: {{workflow_name}}',
   'Hi {{user_name}},\n\nYou have a pending approval task: {{workflow_name}}.\n\nPlease review and action it by {{due_date}}.\n\nLogin to review: {{action_url}}'),

  ('00000000-0000-0000-0000-000000000001',
   'Workflow Task Assigned - In App',
   'workflow.task.assigned', 'in_app',
   NULL,
   'You have a new approval task: {{workflow_name}}. Due: {{due_date}}.'),

  ('00000000-0000-0000-0000-000000000001',
   'Workflow Approved - In App',
   'workflow.approved', 'in_app',
   NULL,
   'Your {{workflow_name}} request has been approved.'),

  ('00000000-0000-0000-0000-000000000001',
   'Workflow Rejected - In App',
   'workflow.rejected', 'in_app',
   NULL,
   'Your {{workflow_name}} request was rejected. Reason: {{comment}}'),

  ('00000000-0000-0000-0000-000000000001',
   'Welcome - Email',
   'user.created', 'email',
   'Welcome to {{platform_name}}',
   'Hi {{user_name}},\n\nYour account has been created.\n\nLogin at: {{login_url}}');

-- DOWN
-- DROP TABLE notification_preferences;
-- DROP TABLE notifications;
-- DROP TABLE notification_templates;
