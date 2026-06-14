-- Migration 023: User Invitations
--
-- Backs the /admin/users "Invite user" flow (inviteService.js/inviteRoutes.js):
--   - invite_tokens: one row per invitation/resend. `token` is a random
--     32-byte hex string mailed as a magic link to /set-password?token=...
--     `user_id` references the placeholder `users` row created at invite
--     time (status='invited', no password_hash). Accepting the invite sets
--     the password and activates the user (Rule 4: audit logged).
--   - allowed_email_domains: Rule 1 — which email domains may be invited is
--     admin-configurable per tenant, not a hardcoded array in code.
--   - users.status gains 'invited' so a placeholder account can exist before
--     the invite is accepted, without weakening the existing CHECK.
--   - notification_templates: 'user.invited' email, same shape as migration
--     007's seeds.
--   - permission catalogue: 'users.invitations.{create,view,edit}' — create
--     covers POST /users/invite + resend, view covers GET /users/invited,
--     edit covers DELETE /users/invite/:id (revoke). Seeded for ld_admin and
--     super_admin, mirroring migration 010's seeding pattern.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE invite_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         VARCHAR(255) NOT NULL UNIQUE,
  invited_by    UUID        REFERENCES users(id),
  invited_email VARCHAR(255) NOT NULL,
  role_name     VARCHAR(100) NOT NULL,
  status        VARCHAR(50) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
  accepted_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invite_tokens_token  ON invite_tokens(token);
CREATE INDEX idx_invite_tokens_user   ON invite_tokens(user_id);
CREATE INDEX idx_invite_tokens_status ON invite_tokens(status);

CREATE TABLE allowed_email_domains (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  domain      VARCHAR(255) NOT NULL,
  created_by  UUID        REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, domain)
);

CREATE INDEX idx_allowed_email_domains_tenant ON allowed_email_domains(tenant_id);

-- Seed allowed domains for the internal tenant
INSERT INTO allowed_email_domains (tenant_id, domain) VALUES
  ('00000000-0000-0000-0000-000000000001', 'sg.com'),
  ('00000000-0000-0000-0000-000000000001', 'senecaglobal.com');

-- ---------------------------------------------------------------------------
-- users.status: add 'invited'
-- ---------------------------------------------------------------------------

ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active', 'inactive', 'on_leave', 'suspended', 'terminated', 'invited'));

-- ---------------------------------------------------------------------------
-- Notification template: user.invited
-- ---------------------------------------------------------------------------

INSERT INTO notification_templates (tenant_id, name, event_type, channel, subject, body) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'User Invitation Email',
   'user.invited', 'email',
   'You''ve been invited to SG LXP',
   'Hi {{first_name}},

{{invited_by_name}} has invited you to join SG LXP.

{{personal_note}}

Set up your account by clicking the link below:
{{magic_link}}

This link expires in 72 hours.');

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

INSERT INTO permissions (module, feature, action, description) VALUES
  ('users', 'invitations', 'create', 'Invite a new user and resend pending invitations'),
  ('users', 'invitations', 'view',   'View pending user invitations'),
  ('users', 'invitations', 'edit',   'Revoke a pending user invitation');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) IN (
    ('users', 'invitations', 'create'),
    ('users', 'invitations', 'view'),
    ('users', 'invitations', 'edit')
  );

-- DOWN
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('users', 'invitations', 'create'),
--     ('users', 'invitations', 'view'),
--     ('users', 'invitations', 'edit')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('users', 'invitations', 'create'),
--     ('users', 'invitations', 'view'),
--     ('users', 'invitations', 'edit')
--   );
--
-- DELETE FROM notification_templates
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND event_type = 'user.invited';
--
-- ALTER TABLE users DROP CONSTRAINT users_status_check;
-- ALTER TABLE users ADD CONSTRAINT users_status_check
--   CHECK (status IN ('active', 'inactive', 'on_leave', 'suspended', 'terminated'));
--
-- DROP TABLE allowed_email_domains;
-- DROP TABLE invite_tokens;
