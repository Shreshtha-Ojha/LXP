-- Migration 012: Seed notification inbox permissions
--
-- Adds the permission catalogue entries that back:
--   GET  /notifications/me
--   POST /notifications/:id/read
--   POST /notifications/read-all
--
-- Every notification is addressed to a single user_id, so "view"/"edit"
-- here only ever covers the caller's own inbox (enforced in
-- notificationService, not by visibility scope) — granted to every role,
-- including associate and external, since "own records only" is already
-- the floor of every persona's visibility (Rule 7).

INSERT INTO permissions (module, feature, action, description) VALUES
  ('notifications', 'inbox', 'view', 'View own notification inbox'),
  ('notifications', 'inbox', 'edit', 'Mark own notifications as read');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND (p.module, p.feature, p.action) IN (
    ('notifications', 'inbox', 'view'),
    ('notifications', 'inbox', 'edit')
  );

-- DOWN
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('notifications', 'inbox', 'view'),
--     ('notifications', 'inbox', 'edit')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('notifications', 'inbox', 'view'),
--     ('notifications', 'inbox', 'edit')
--   );
