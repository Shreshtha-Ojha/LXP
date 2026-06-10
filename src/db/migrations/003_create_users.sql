-- Migration 003: Users and User Profiles
-- users holds auth identity. user_profiles holds employment/personal info.
-- Separated so auth data and personal data have different access patterns.

CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  employee_id     VARCHAR(100),                        -- from HRMS, nullable until sync
  email           VARCHAR(255) NOT NULL,
  password_hash   VARCHAR(255),                        -- null for SSO-only users
  status          VARCHAR(50) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'on_leave', 'suspended', 'terminated')),
  user_type       VARCHAR(50) NOT NULL DEFAULT 'internal'
                  CHECK (user_type IN ('internal', 'external', 'system')),
  mfa_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
  mfa_secret      VARCHAR(255),                        -- encrypted
  last_login_at   TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE user_profiles (
  user_id           UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_name        VARCHAR(100) NOT NULL,
  last_name         VARCHAR(100) NOT NULL,
  preferred_name    VARCHAR(100),
  phone             VARCHAR(50),
  location          VARCHAR(255),
  time_zone         VARCHAR(100) DEFAULT 'UTC',
  language          VARCHAR(10)  DEFAULT 'en',
  avatar_url        VARCHAR(500),
  -- Employment info
  designation       VARCHAR(255),
  grade             VARCHAR(100),
  employment_type   VARCHAR(100),                      -- Permanent, Contract, Intern etc. (configurable)
  org_unit_id       UUID        REFERENCES organisation_units(id),
  manager_id        UUID        REFERENCES users(id),
  joining_date      DATE,
  -- Metadata
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant        ON users(tenant_id);
CREATE INDEX idx_users_email         ON users(email);
CREATE INDEX idx_users_status        ON users(status);
CREATE INDEX idx_users_employee_id   ON users(employee_id);
CREATE INDEX idx_profiles_org_unit   ON user_profiles(org_unit_id);
CREATE INDEX idx_profiles_manager    ON user_profiles(manager_id);

-- DOWN
-- DROP TABLE user_profiles;
-- DROP TABLE users;
