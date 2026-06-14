-- Migration 024: Seed the user-directory view permission
--
-- userRoutes.js's GET /admin/users (and DELETE /admin/users/:id) have always
-- been gated by requirePermission('view'|'edit', 'users', 'directory'|'profile'),
-- but no migration ever inserted a 'users','directory','view' row into
-- permissions/role_permissions — only super_admin (which bypasses
-- hasPermission entirely) could call it.
--
-- The new /admin/users page (Active/Pending/Inactive tabs, built on top of
-- the invite flow from migration 023) is the first ld_admin-facing consumer
-- of GET /admin/users, so seed the row ld_admin needs, mirroring migration
-- 010/023's seeding pattern.

INSERT INTO permissions (module, feature, action, description) VALUES
  ('users', 'directory', 'view', 'View the user directory for the tenant');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) IN (
    ('users', 'directory', 'view')
  );

-- DOWN
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('users', 'directory', 'view')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('users', 'directory', 'view')
--   );
