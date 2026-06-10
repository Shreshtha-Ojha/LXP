-- Migration 011: Seed workflow task permissions
--
-- Adds the permission catalogue entries that back:
--   GET  /workflows/tasks/me
--   POST /workflows/:instanceId/actions
--
-- Granted to every system role except 'associate' and 'external'. These are
-- the roles workflow_steps.approver_role / escalation_role can reference as
-- approvers or escalation targets (reporting_manager, program_manager,
-- competency_leader, trainer, assessor, mentor, hr_admin, ld_admin), plus
-- super_admin for administration. Whether a given user can act on a *specific*
-- task is enforced in workflowService (assigned_to/delegated_to/initiated_by
-- match) — this permission only gates access to the endpoints themselves.

INSERT INTO permissions (module, feature, action, description) VALUES
  ('workflow', 'tasks', 'view',    'View workflow tasks assigned to self'),
  ('workflow', 'tasks', 'approve', 'Action a workflow task (approve/reject/send back/request info/escalate/delegate/withdraw)');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name NOT IN ('associate', 'external')
  AND (p.module, p.feature, p.action) IN (
    ('workflow', 'tasks', 'view'),
    ('workflow', 'tasks', 'approve')
  );

-- DOWN
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('workflow', 'tasks', 'view'),
--     ('workflow', 'tasks', 'approve')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('workflow', 'tasks', 'view'),
--     ('workflow', 'tasks', 'approve')
--   );
