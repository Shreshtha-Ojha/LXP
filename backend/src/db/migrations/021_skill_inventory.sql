-- Migration 021: Skill Inventory & Role Skill Requirements
--
-- Backs skillService.js/skillRoutes.js:
--   - user_skill_records: one row per (user, skill) — a learner's declared or
--     validated proficiency for a skill (Rule 6 — skill_id/current_level_id/
--     target_level_id are FKs into skills/proficiency_levels, never free
--     text). status tracks the record's lifecycle (self_declared ->
--     pending_validation -> validated/rejected, or course_completed/expired
--     from other sources); source records how the level was determined.
--     validated_at/validated_by are set when PUT /skills/:skillId/validate
--     is actioned.
--   - role_skill_requirements: the proficiency level a designation
--     (user_profiles.designation) requires for a skill — drives
--     GET /skills/gap-analysis and GET /skills/recommendations. Tenant-scoped
--     and admin-editable (Rule 1 — no role->skill expectations hardcoded
--     in skillService).
--   - permission catalogue entries for module='skills':
--       'inventory'        view/create — every role manages their own skill
--                           inventory (same "always available to every role"
--                           convention as migration 019's dashboard.me);
--                           skillService additionally allows a reporting
--                           manager to view a direct report's inventory via
--                           ?userId= (Rule 7) — 403 + ACCESS_VIOLATION for
--                           anyone else requesting another user's records.
--       'validation'       approve — PUT /skills/:skillId/validate, granted
--                           to reporting_manager and competency_leader only.
--                           reporting_manager is restricted in skillService to
--                           their direct reports (user_profiles.manager_id).
--                           competency_leader "practice members" visibility
--                           resolution is still a placeholder (deferred to
--                           Release 3, same as migration 019's team
--                           dashboard), so for now a competency_leader may
--                           validate any record in their tenant.
--       'gap_analysis'     view — GET /skills/gap-analysis, own records only.
--       'recommendations'  view — GET /skills/recommendations, own records
--                           only.
--       'catalog'          view — GET /skills/all, the skill picker behind
--                           POST /skills/declare.
--   - notification_templates for 'skill.declared' (to the declarer's
--     manager), 'skill.validated' and 'skill.rejected' (to the declarer) —
--     Rule 1, copy and channels are config, never hardcoded strings in
--     skillService.
--
-- Rule 5 note: PUT /skills/:skillId/validate is a single-step,
-- single-authorized-validator status transition on the learner's own
-- self-declared record — the same "role-observed transition, not a
-- multi-step approval chain" exception documented in
-- learning.assignmentService/progressService. There is no routing, SLA
-- tracking, or escalation here, so it does not go through
-- WorkflowDefinition/WorkflowInstance.

CREATE TABLE user_skill_records (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id          UUID        NOT NULL REFERENCES skills(id),
  current_level_id  UUID        REFERENCES proficiency_levels(id),
  target_level_id   UUID        REFERENCES proficiency_levels(id),
  status            VARCHAR(50) NOT NULL DEFAULT 'self_declared'
                    CHECK (status IN (
                      'self_declared',
                      'pending_validation',
                      'validated',
                      'course_completed',
                      'rejected',
                      'expired'
                    )),
  source            VARCHAR(50) NOT NULL DEFAULT 'self_declared'
                    CHECK (source IN (
                      'self_declared',
                      'course_completion',
                      'assessment',
                      'manager_assigned',
                      'import'
                    )),
  evidence_url      TEXT,
  validation_note   TEXT,
  declared_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at      TIMESTAMPTZ,
  validated_by      UUID        REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, skill_id)
);

CREATE TABLE role_skill_requirements (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  role_name         VARCHAR(255) NOT NULL,
  skill_id          UUID        NOT NULL REFERENCES skills(id),
  required_level_id UUID        NOT NULL REFERENCES proficiency_levels(id),
  is_mandatory      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, role_name, skill_id)
);

CREATE INDEX idx_user_skills_user   ON user_skill_records(user_id);
CREATE INDEX idx_user_skills_skill  ON user_skill_records(skill_id);
CREATE INDEX idx_user_skills_status ON user_skill_records(status);
CREATE INDEX idx_role_requirements  ON role_skill_requirements(tenant_id, role_name);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

INSERT INTO permissions (module, feature, action, description) VALUES
  ('skills', 'inventory', 'view',       'View own (or, for a reporting manager, a direct report''s) skill inventory'),
  ('skills', 'inventory', 'create',     'Self-declare a skill and proficiency level'),
  ('skills', 'validation', 'approve',   'Validate or reject a self-declared skill'),
  ('skills', 'gap_analysis', 'view',    'View own skill gap analysis against role requirements'),
  ('skills', 'recommendations', 'view', 'View own content recommendations based on skill gaps'),
  ('skills', 'catalog', 'view',         'View the skill catalogue grouped by competency category');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND (p.module, p.feature, p.action) IN (
    ('skills', 'inventory', 'view'),
    ('skills', 'inventory', 'create'),
    ('skills', 'gap_analysis', 'view'),
    ('skills', 'recommendations', 'view'),
    ('skills', 'catalog', 'view')
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('reporting_manager', 'competency_leader')
  AND (p.module, p.feature, p.action) = ('skills', 'validation', 'approve');

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

INSERT INTO notification_templates (tenant_id, name, event_type, channel, subject, body) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Skill Declared - Email', 'skill.declared', 'email',
   '{{user_name}} declared a new skill: {{skill_name}}',
   'Hi,\n\n{{user_name}} has self-declared "{{skill_name}}" at {{level_name}} level and is awaiting your validation.\n\nReview it: {{action_url}}'),

  ('00000000-0000-0000-0000-000000000001',
   'Skill Declared - In App', 'skill.declared', 'in_app',
   NULL,
   '{{user_name}} declared "{{skill_name}}" at {{level_name}} level.'),

  ('00000000-0000-0000-0000-000000000001',
   'Skill Validated - Email', 'skill.validated', 'email',
   'Your skill "{{skill_name}}" was validated',
   'Hi,\n\nYour declared skill "{{skill_name}}" was validated at {{level_name}} level.\n\nNote: {{note}}'),

  ('00000000-0000-0000-0000-000000000001',
   'Skill Validated - In App', 'skill.validated', 'in_app',
   NULL,
   '"{{skill_name}}" was validated at {{level_name}} level.'),

  ('00000000-0000-0000-0000-000000000001',
   'Skill Rejected - Email', 'skill.rejected', 'email',
   'Your skill "{{skill_name}}" declaration was not validated',
   'Hi,\n\nYour declared skill "{{skill_name}}" was not validated.\n\nNote: {{note}}'),

  ('00000000-0000-0000-0000-000000000001',
   'Skill Rejected - In App', 'skill.rejected', 'in_app',
   NULL,
   '"{{skill_name}}" declaration was not validated. Note: {{note}}');

-- DOWN
-- DELETE FROM notification_templates
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
--   AND event_type IN ('skill.declared', 'skill.validated', 'skill.rejected');
--
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('skills', 'inventory', 'view'),
--     ('skills', 'inventory', 'create'),
--     ('skills', 'validation', 'approve'),
--     ('skills', 'gap_analysis', 'view'),
--     ('skills', 'recommendations', 'view'),
--     ('skills', 'catalog', 'view')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('skills', 'inventory', 'view'),
--     ('skills', 'inventory', 'create'),
--     ('skills', 'validation', 'approve'),
--     ('skills', 'gap_analysis', 'view'),
--     ('skills', 'recommendations', 'view'),
--     ('skills', 'catalog', 'view')
--   );
--
-- DROP TABLE role_skill_requirements;
-- DROP TABLE user_skill_records;
