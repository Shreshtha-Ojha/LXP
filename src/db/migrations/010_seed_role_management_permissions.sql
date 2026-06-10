-- Migration 010: Seed role-management permissions
--
-- Adds the permission catalogue entries that back "Only super_admin and
-- ld_admin can manage roles" for:
--   GET/POST  /admin/roles
--   PUT       /admin/roles/:id
--   POST      /admin/roles/:id/permissions
--   POST/DELETE /admin/users/:id/roles[/:roleId]
--
-- super_admin already bypasses permissionEngine.hasPermission entirely, but
-- is granted these too so role_permissions stays a complete, self-documenting
-- record of what each role can do.

INSERT INTO permissions (module, feature, action, description) VALUES
  ('roles', 'definitions', 'view',      'View role definitions for the tenant'),
  ('roles', 'definitions', 'create',    'Create a custom role'),
  ('roles', 'definitions', 'edit',      'Edit a role''s name or description'),
  ('roles', 'permissions', 'configure', 'Assign permissions to a role'),
  ('roles', 'assignments', 'edit',      'Assign or remove a role from a user');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('super_admin', 'ld_admin')
  AND (p.module, p.feature, p.action) IN (
    ('roles', 'definitions', 'view'),
    ('roles', 'definitions', 'create'),
    ('roles', 'definitions', 'edit'),
    ('roles', 'permissions', 'configure'),
    ('roles', 'assignments', 'edit')
  );

-- DOWN
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('roles', 'definitions', 'view'),
--     ('roles', 'definitions', 'create'),
--     ('roles', 'definitions', 'edit'),
--     ('roles', 'permissions', 'configure'),
--     ('roles', 'assignments', 'edit')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('roles', 'definitions', 'view'),
--     ('roles', 'definitions', 'create'),
--     ('roles', 'definitions', 'edit'),
--     ('roles', 'permissions', 'configure'),
--     ('roles', 'assignments', 'edit')
--   );
