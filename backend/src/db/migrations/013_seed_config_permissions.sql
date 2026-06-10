-- Migration 013: Seed configuration and feature flag permissions
--
-- Adds the permission catalogue entries that back:
--   GET /admin/config            PUT /admin/config/:module/:key
--   GET /admin/features          PUT /admin/features/:feature
--
-- Tenant-wide configuration and feature flags are platform-level controls
-- (session policy, password policy, org hierarchy, release feature gating),
-- so these are granted to super_admin only — not ld_admin. super_admin
-- already bypasses permissionEngine.hasPermission entirely, but is granted
-- these too so role_permissions stays a complete, self-documenting record
-- of what each role can do.

INSERT INTO permissions (module, feature, action, description) VALUES
  ('config', 'settings',      'view',      'View tenant configuration values'),
  ('config', 'settings',      'configure', 'Update tenant configuration values'),
  ('config', 'feature_flags', 'view',      'View tenant feature flags'),
  ('config', 'feature_flags', 'configure', 'Toggle tenant feature flags');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name = 'super_admin'
  AND (p.module, p.feature, p.action) IN (
    ('config', 'settings',      'view'),
    ('config', 'settings',      'configure'),
    ('config', 'feature_flags', 'view'),
    ('config', 'feature_flags', 'configure')
  );

-- DOWN
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('config', 'settings',      'view'),
--     ('config', 'settings',      'configure'),
--     ('config', 'feature_flags', 'view'),
--     ('config', 'feature_flags', 'configure')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('config', 'settings',      'view'),
--     ('config', 'settings',      'configure'),
--     ('config', 'feature_flags', 'view'),
--     ('config', 'feature_flags', 'configure')
--   );
