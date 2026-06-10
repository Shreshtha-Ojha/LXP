-- Migration 004: Roles, Permissions, and RBAC
-- Roles and permissions are fully database-driven. Nothing hardcoded in code.
-- scope_conditions is JSONB for future ABAC rules (Release 3+).

CREATE TABLE roles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  is_system_role  BOOLEAN     NOT NULL DEFAULT FALSE,  -- system roles cannot be deleted
  status          VARCHAR(50) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'retired')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE permissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  module          VARCHAR(100) NOT NULL,   -- e.g. 'learning', 'assessments', 'users'
  feature         VARCHAR(100) NOT NULL,   -- e.g. 'catalog', 'assignments', 'bulk_upload'
  action          VARCHAR(50)  NOT NULL,   -- view | create | edit | approve | configure | administer
                  CHECK (action IN ('view', 'create', 'edit', 'approve', 'configure', 'administer')),
  description     TEXT,
  UNIQUE (module, feature, action)
);

CREATE TABLE role_permissions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id           UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id     UUID        NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  scope_conditions  JSONB,       -- null now; used for ABAC rules in Release 3+
                                 -- e.g. {"org_unit_ids": [...], "practice_ids": [...]}
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (role_id, permission_id)
);

CREATE TABLE user_roles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         UUID        NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by     UUID        REFERENCES users(id),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_from  DATE,
  effective_to    DATE,
  UNIQUE (user_id, role_id)
);

CREATE INDEX idx_roles_tenant          ON roles(tenant_id);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_user_roles_user       ON user_roles(user_id);
CREATE INDEX idx_user_roles_role       ON user_roles(role_id);

-- Seed system roles for the internal tenant
INSERT INTO roles (tenant_id, name, description, is_system_role) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin',        'Full platform access. All actions audit logged.', TRUE),
  ('00000000-0000-0000-0000-000000000001', 'ld_admin',           'Learning and development administrator.',         TRUE),
  ('00000000-0000-0000-0000-000000000001', 'hr_admin',           'HR and workforce planning administrator.',        TRUE),
  ('00000000-0000-0000-0000-000000000001', 'associate',          'Standard employee learner.',                      TRUE),
  ('00000000-0000-0000-0000-000000000001', 'reporting_manager',  'Manages a team of direct reports.',               TRUE),
  ('00000000-0000-0000-0000-000000000001', 'program_manager',    'Manages projects and programs.',                  TRUE),
  ('00000000-0000-0000-0000-000000000001', 'competency_leader',  'Owns competency standards and strategy.',         TRUE),
  ('00000000-0000-0000-0000-000000000001', 'trainer',            'Creates and delivers training.',                  TRUE),
  ('00000000-0000-0000-0000-000000000001', 'assessor',           'Evaluates assessments and validates skills.',     TRUE),
  ('00000000-0000-0000-0000-000000000001', 'mentor',             'Guides associates in learning and career growth.',TRUE),
  ('00000000-0000-0000-0000-000000000001', 'external',           'External participant with restricted access.',    TRUE);

-- DOWN
-- DROP TABLE user_roles;
-- DROP TABLE role_permissions;
-- DROP TABLE permissions;
-- DROP TABLE roles;
