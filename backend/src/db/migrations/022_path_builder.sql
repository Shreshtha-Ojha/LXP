-- Migration 022: Path Builder — node-based learning paths
--
-- Backs the /admin/paths visual path builder (pathService.js/pathRoutes.js):
--   - path_nodes / path_node_items / path_node_questions /
--     path_node_question_options: the node-based curriculum structure behind
--     the wizard and canvas editor (frontend `BuilderNode` / `toCreatePayload`
--     in path-builder/types.ts). A content node's items reference an existing
--     learning_asset via asset_id (Rule 6) OR carry their own
--     title/content_type/duration_minutes/external_url/body for content
--     authored inline in the builder (no catalogue UI exists yet for these —
--     R0/R1 boundary, migration 009's note). A quiz node's questions/options
--     are owned outright by the path (not a reusable assessment bank).
--   - learning_path_skills: paths <-> skills (Rule 6 — FK, never free text),
--     mirrors migration 009's learning_asset_skills.
--   - learning_paths.status gains 'in_review' so the builder's
--     "submit for review" -> "publish" flow (Rule 5) has somewhere to sit
--     between draft and published.
--   - permission catalogue: 'learning.paths.edit' (update/duplicate/submit a
--     path) and 'learning.paths.approve' (publish directly, and the approver
--     role for the review workflow below). 'learning.paths.create' (from
--     migration 017, currently ld_admin/super_admin only) is broadened to the
--     same practice-leadership roles already trusted with
--     'learning.assignments.create' — the path builder targets that wider
--     "trainer" population, not L&D admin alone (Rule 1: this is a
--     role_permissions seed, changeable by an admin without a code deploy).
--   - WorkflowDefinition "Learning Path Review" (module='learning',
--     trigger_event='learning_path.submitted') — submitForReview calls
--     workflowService.startWorkflow, same as migration 015's content
--     publication review (Rule 5, no inline approval logic in pathService).
--   - configurations: learning.status_transitions / learning.publish_bypass_roles
--     — same shape as migration 015's content.* keys, scoped to module='learning'.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE path_nodes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id     UUID        NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  type        VARCHAR(50) NOT NULL CHECK (type IN ('content', 'quiz')),
  title       VARCHAR(500) NOT NULL,
  coins       INT         NOT NULL DEFAULT 0,
  node_order  INT         NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (path_id, node_order)
);

CREATE TABLE path_node_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id           UUID        NOT NULL REFERENCES path_nodes(id) ON DELETE CASCADE,
  asset_id          UUID        REFERENCES learning_assets(id),
  title             VARCHAR(500),
  content_type      VARCHAR(50) CHECK (content_type IN ('video', 'article', 'pdf', 'scorm', 'external_link')),
  duration_minutes  INT,
  external_url      VARCHAR(1000),
  body              TEXT,
  item_order        INT         NOT NULL,
  UNIQUE (node_id, item_order)
);

CREATE TABLE path_node_questions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id         UUID        NOT NULL REFERENCES path_nodes(id) ON DELETE CASCADE,
  question_text   TEXT        NOT NULL,
  question_order  INT         NOT NULL,
  UNIQUE (node_id, question_order)
);

CREATE TABLE path_node_question_options (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id     UUID        NOT NULL REFERENCES path_node_questions(id) ON DELETE CASCADE,
  option_text     TEXT        NOT NULL,
  is_correct      BOOLEAN     NOT NULL DEFAULT FALSE,
  option_order    INT         NOT NULL,
  UNIQUE (question_id, option_order)
);

CREATE TABLE learning_path_skills (
  path_id   UUID NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  skill_id  UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (path_id, skill_id)
);

CREATE INDEX idx_path_nodes_path            ON path_nodes(path_id);
CREATE INDEX idx_path_node_items_node       ON path_node_items(node_id);
CREATE INDEX idx_path_node_items_asset      ON path_node_items(asset_id);
CREATE INDEX idx_path_node_questions_node   ON path_node_questions(node_id);
CREATE INDEX idx_path_node_options_question ON path_node_question_options(question_id);
CREATE INDEX idx_learning_path_skills_skill ON learning_path_skills(skill_id);

-- ---------------------------------------------------------------------------
-- learning_paths.status: add 'in_review'
-- ---------------------------------------------------------------------------

ALTER TABLE learning_paths DROP CONSTRAINT learning_paths_status_check;
ALTER TABLE learning_paths ADD CONSTRAINT learning_paths_status_check
  CHECK (status IN ('draft', 'published', 'retired', 'in_review'));

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

INSERT INTO permissions (module, feature, action, description) VALUES
  ('learning', 'paths', 'edit',    'Update, duplicate, or submit a learning path for review'),
  ('learning', 'paths', 'approve', 'Publish a learning path, including direct publish bypassing review');

-- Broaden 'learning.paths.create' to the same roles already trusted with
-- 'learning.assignments.create' (migration 017) — the path builder targets
-- this practice-leadership population, not L&D admin alone.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('reporting_manager', 'program_manager', 'competency_leader')
  AND (p.module, p.feature, p.action) = ('learning', 'paths', 'create');

-- 'edit' goes to the same set as the (now-broadened) 'create'.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('reporting_manager', 'program_manager', 'competency_leader', 'ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) = ('learning', 'paths', 'edit');

-- 'approve' (direct publish + review-workflow approver) stays L&D admin only.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) = ('learning', 'paths', 'approve');

-- ---------------------------------------------------------------------------
-- Workflow: Learning Path Review
-- ---------------------------------------------------------------------------

WITH wd AS (
  INSERT INTO workflow_definitions (tenant_id, name, description, module, trigger_event, is_active, version)
  VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Learning Path Review',
    'L&D review of a learning path before it is published.',
    'learning',
    'learning_path.submitted',
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

INSERT INTO configurations (tenant_id, module, key, value, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'learning', 'status_transitions',
   '{"value": {
       "draft":     ["in_review", "published", "retired"],
       "in_review": ["published", "draft", "retired"],
       "published": ["retired"],
       "retired":   []
     }}',
   'Allowed learning_paths.status transitions, keyed by current status'),
  ('00000000-0000-0000-0000-000000000001', 'learning', 'publish_bypass_roles',
   '{"value": ["ld_admin", "super_admin"]}',
   'Roles that may publish a learning path directly from draft, bypassing the in_review workflow');

-- DOWN
-- DELETE FROM configurations
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND module = 'learning'
--   AND key IN ('status_transitions', 'publish_bypass_roles');
--
-- DELETE FROM workflow_steps
-- USING workflow_definitions wd
-- WHERE workflow_steps.definition_id = wd.id
--   AND wd.tenant_id = '00000000-0000-0000-0000-000000000001'
--   AND wd.module = 'learning' AND wd.trigger_event = 'learning_path.submitted';
-- DELETE FROM workflow_definitions
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
--   AND module = 'learning' AND trigger_event = 'learning_path.submitted';
--
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('learning', 'paths', 'edit'),
--     ('learning', 'paths', 'approve')
--   );
-- DELETE FROM role_permissions
-- USING permissions p, roles r
-- WHERE role_permissions.permission_id = p.id
--   AND role_permissions.role_id = r.id
--   AND (p.module, p.feature, p.action) = ('learning', 'paths', 'create')
--   AND r.tenant_id = '00000000-0000-0000-0000-000000000001'
--   AND r.name IN ('reporting_manager', 'program_manager', 'competency_leader');
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('learning', 'paths', 'edit'),
--     ('learning', 'paths', 'approve')
--   );
--
-- ALTER TABLE learning_paths DROP CONSTRAINT learning_paths_status_check;
-- ALTER TABLE learning_paths ADD CONSTRAINT learning_paths_status_check
--   CHECK (status IN ('draft','published','retired'));
--
-- DROP TABLE learning_path_skills;
-- DROP TABLE path_node_question_options;
-- DROP TABLE path_node_questions;
-- DROP TABLE path_node_items;
-- DROP TABLE path_nodes;
