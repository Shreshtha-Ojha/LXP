-- Migration 019: Role Dashboards
--
-- Backs dashboardRoutes.js/dashboardService.js:
--   - permission catalogue entries for module='dashboard', features 'me'
--     (every role's personal dashboard — same "always my own records" (Rule 7)
--     convention as migration 018's learning.progress.view, granted to every
--     role without restriction), 'team' (direct-reports view, restricted the
--     same as migration 017's learning.team_assignments.view: reporting
--     managers plus L&D admin/super_admin oversight — program_manager/
--     competency_leader "team" visibility resolution is still a placeholder
--     in permissionEngine.getVisibilityScope and is deferred to Release 3),
--     and 'admin' (platform-wide stats, L&D admin/super_admin only).
--   - configurations.dashboard.thresholds (Rule 1 — the "due soon" window and
--     overdue urgency bands are config, never hardcoded as e.g.
--     `daysOverdue >= 7`):
--       { "due_soon_days": N,
--         "overdue_urgency_days": { "medium": N, "high": N } }
--     An assignment becomes "due soon" once due_date is within due_soon_days
--     of today. An overdue item is "high" urgency once it is at least
--     overdue_urgency_days.high days late, "medium" once at least .medium
--     days late, otherwise "low".
--
-- NOTE: Several fields in the /dashboard/me, /dashboard/team responses
-- (promotion_readiness, skills_validated/skills_total, certifications_active,
-- competency_progress, promotion_pipeline, skill_heatmap) require entities
-- that don't exist yet — SkillRecord/ValidationStatus (Release 2) and
-- CareerAspiration/RoleRequirement/ReadinessScore/Certification (Release 3).
-- dashboardService returns these as empty/zero placeholders until that
-- schema lands; no new tables are created here for them (do not build ahead
-- of the current release).

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

INSERT INTO permissions (module, feature, action, description) VALUES
  ('dashboard', 'me',    'view', 'View own associate dashboard'),
  ('dashboard', 'team',  'view', 'View team dashboard for direct reports'),
  ('dashboard', 'admin', 'view', 'View platform-wide L&D admin dashboard');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND (p.module, p.feature, p.action) = ('dashboard', 'me', 'view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('reporting_manager', 'ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) = ('dashboard', 'team', 'view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) = ('dashboard', 'admin', 'view');

-- ---------------------------------------------------------------------------
-- Configuration: dashboard thresholds (Rule 1)
-- ---------------------------------------------------------------------------

INSERT INTO configurations (tenant_id, module, key, value, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'dashboard', 'thresholds',
   '{"value": {
       "due_soon_days": 3,
       "overdue_urgency_days": {"medium": 3, "high": 7}
   }}',
   'Dashboard "due soon" window and overdue urgency bands (dashboard.dashboardService)');

-- DOWN
-- DELETE FROM configurations
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND module = 'dashboard' AND key = 'thresholds';
--
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('dashboard', 'me', 'view'),
--     ('dashboard', 'team', 'view'),
--     ('dashboard', 'admin', 'view')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('dashboard', 'me', 'view'),
--     ('dashboard', 'team', 'view'),
--     ('dashboard', 'admin', 'view')
--   );
