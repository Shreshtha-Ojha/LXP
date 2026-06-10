-- Migration 015: Content Management — permissions, workflow, status config
--
-- Backs the /content/assets endpoints (contentRoutes.js / contentService.js):
--   - tags[] was part of the LearningAsset contract (data-model.md) but missing
--     from migration 009 — added here as a plain TEXT[] (Rule 6 only requires
--     FK relationships for skills/competencies/technologies/domains, not tags)
--   - permission catalogue entries for module='content', feature='assets'
--   - the WorkflowDefinition that POST /content/assets/:id/submit-review
--     instantiates via workflowService.startWorkflow (Rule 5 — no inline
--     approval logic in the feature)
--   - configuration-driven status transitions and publish-bypass roles
--     (Rule 1 — "cannot publish without going through in_review unless
--     super_admin" must be changeable by an admin without a code deploy)

ALTER TABLE learning_assets ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- 'view' is granted to every role except 'external' — external users only see
-- explicitly assigned content (not yet modelled in Release 0), so they get no
-- blanket view permission on the asset catalogue. 'create'/'edit'/'approve'
-- are L&D admin only; super_admin bypasses permissionEngine.hasPermission
-- entirely but is granted these too so role_permissions stays a complete,
-- self-documenting record (matches migration 010's convention).

INSERT INTO permissions (module, feature, action, description) VALUES
  ('content', 'assets', 'view',    'View learning asset detail'),
  ('content', 'assets', 'create',  'Create a learning asset (draft)'),
  ('content', 'assets', 'edit',    'Edit learning asset metadata, submit for review, retire'),
  ('content', 'assets', 'approve', 'Publish a learning asset, including direct publish bypassing review');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name != 'external'
  AND (p.module, p.feature, p.action) = ('content', 'assets', 'view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) IN (
    ('content', 'assets', 'create'),
    ('content', 'assets', 'edit'),
    ('content', 'assets', 'approve')
  );

-- ---------------------------------------------------------------------------
-- Workflow: Content Publication Review
-- ---------------------------------------------------------------------------
-- contentService.submitForReview looks this up by
-- (tenant_id, module='content', trigger_event='content.submitted', is_active)
-- and calls workflowService.startWorkflow — routing, SLA, escalation, and
-- notifications are entirely handled by the engine from here on.

WITH wd AS (
  INSERT INTO workflow_definitions (tenant_id, name, description, module, trigger_event, is_active, version)
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Content Publication Review',
    'L&D review of a learning asset before it is published to the catalogue.',
    'content',
    'content.submitted',
    TRUE,
    1
  )
  RETURNING id
)
INSERT INTO workflow_steps (definition_id, step_order, name, step_type, approver_role, sla_hours, escalation_role, is_required)
SELECT id, 1, 'L&D Review', 'approval', 'ld_admin', 72, 'super_admin', TRUE FROM wd;

-- ---------------------------------------------------------------------------
-- Configuration: status transitions and publish bypass
-- ---------------------------------------------------------------------------
-- learning_assets.status transitions allowed from each current status.
-- 'published' is reachable directly from 'draft' only for roles listed in
-- publish_bypass_roles (contentService.publishAsset) — everyone else must go
-- through 'in_review' first via POST /content/assets/:id/submit-review.

INSERT INTO configurations (tenant_id, module, key, value, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'content', 'status_transitions',
   '{"value": {
       "draft":     ["in_review", "published", "retired"],
       "in_review": ["published", "draft", "retired"],
       "published": ["retired"],
       "retired":   []
     }}',
   'Allowed learning_assets.status transitions, keyed by current status'),
  ('00000000-0000-0000-0000-000000000001', 'content', 'publish_bypass_roles',
   '{"value": ["super_admin"]}',
   'Roles that may publish a learning asset directly from draft, bypassing the in_review workflow');

-- DOWN
-- DELETE FROM configurations
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND module = 'content'
--   AND key IN ('status_transitions', 'publish_bypass_roles');
--
-- DELETE FROM workflow_steps
-- USING workflow_definitions wd
-- WHERE workflow_steps.definition_id = wd.id
--   AND wd.tenant_id = '00000000-0000-0000-0000-000000000001'
--   AND wd.module = 'content' AND wd.trigger_event = 'content.submitted';
-- DELETE FROM workflow_definitions
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
--   AND module = 'content' AND trigger_event = 'content.submitted';
--
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('content', 'assets', 'view'),
--     ('content', 'assets', 'create'),
--     ('content', 'assets', 'edit'),
--     ('content', 'assets', 'approve')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('content', 'assets', 'view'),
--     ('content', 'assets', 'create'),
--     ('content', 'assets', 'edit'),
--     ('content', 'assets', 'approve')
--   );
--
-- ALTER TABLE learning_assets DROP COLUMN tags;
