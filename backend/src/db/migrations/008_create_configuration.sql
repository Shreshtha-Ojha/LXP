-- Migration 008: Configuration and Feature Flags
-- All business-level settings live here, not in code or .env files.
-- feature_flags controls which features are enabled per tenant.

CREATE TABLE configurations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  module          VARCHAR(100) NOT NULL,   -- e.g. 'auth', 'learning', 'notifications'
  key             VARCHAR(255) NOT NULL,
  value           JSONB       NOT NULL,
  description     TEXT,
  updated_by      UUID        REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, module, key)
);

CREATE TABLE feature_flags (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  feature         VARCHAR(255) NOT NULL,
  is_enabled      BOOLEAN     NOT NULL DEFAULT FALSE,
  description     TEXT,
  updated_by      UUID        REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, feature)
);

CREATE INDEX idx_config_tenant_module ON configurations(tenant_id, module);
CREATE INDEX idx_flags_tenant         ON feature_flags(tenant_id);

-- Seed default configuration for the internal tenant
INSERT INTO configurations (tenant_id, module, key, value, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'auth', 'password_min_length',     '{"value": 8}',    'Minimum password length'),
  ('00000000-0000-0000-0000-000000000001', 'auth', 'password_require_upper',  '{"value": true}', 'Require uppercase letter in password'),
  ('00000000-0000-0000-0000-000000000001', 'auth', 'password_require_number', '{"value": true}', 'Require number in password'),
  ('00000000-0000-0000-0000-000000000001', 'auth', 'session_timeout_minutes', '{"value": 60}',   'Session idle timeout in minutes'),
  ('00000000-0000-0000-0000-000000000001', 'auth', 'mfa_required_roles',      '{"value": ["super_admin", "hr_admin"]}', 'Roles that require MFA'),
  ('00000000-0000-0000-0000-000000000001', 'org',  'hierarchy_levels',
   '{"value": ["Organisation","Business Unit","Practice","Department","Account","Program","Project","Team"]}',
   'Configurable names for each level of the org hierarchy');

-- Seed feature flags (all off by default, turned on as features are built)
INSERT INTO feature_flags (tenant_id, feature, is_enabled, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'sso',                   FALSE, 'Single Sign-On login'),
  ('00000000-0000-0000-0000-000000000001', 'mfa',                   FALSE, 'Multi-factor authentication'),
  ('00000000-0000-0000-0000-000000000001', 'learning_catalog',      FALSE, 'Learning catalogue (Release 1)'),
  ('00000000-0000-0000-0000-000000000001', 'ai_recommendations',    FALSE, 'AI-powered recommendations (Release 4)'),
  ('00000000-0000-0000-0000-000000000001', 'ai_tutor',              FALSE, 'AI tutor inside courses (Release 4)'),
  ('00000000-0000-0000-0000-000000000001', 'ai_content_generation', FALSE, 'AI content generation (Release 4)');

-- DOWN
-- DROP TABLE feature_flags;
-- DROP TABLE configurations;
