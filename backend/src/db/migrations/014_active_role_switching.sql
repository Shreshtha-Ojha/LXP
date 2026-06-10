-- Migration 014: Active Role Switching (D-008)
-- Users with multiple roles explicitly switch which role is active.
-- Permissions and visibility are evaluated against the active role only —
-- see src/modules/roles/permissionEngine.js.

CREATE TABLE user_active_roles (
  user_id     UUID        PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role_id     UUID        NOT NULL REFERENCES roles(id),
  switched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_active_roles_role ON user_active_roles(role_id);

-- Default active-role priority for a multi-role user's first login after this
-- migration (lowest privilege first). authService reads this so the order is
-- configurable without a code change (Rule 1).
INSERT INTO configurations (tenant_id, module, key, value, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'auth', 'active_role_priority',
   '{"value": ["associate", "reporting_manager", "competency_leader", "ld_admin", "super_admin"]}',
   'Default active role on login for users with multiple roles, lowest privilege first (D-008)');

-- DOWN
-- DELETE FROM configurations
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND module = 'auth' AND key = 'active_role_priority';
-- DROP TABLE user_active_roles;
