-- Migration 017: Learning Paths & Assignments
--
-- Backs pathRoutes.js/pathService.js and assignmentRoutes.js/assignmentService.js:
--   - learning_paths / learning_path_items: an ordered curriculum of existing
--     learning_assets (Rule 6 — asset_id is a FK, never free text).
--     prerequisite_item_id is a self-referencing FK so the engine can express
--     "item B unlocks after item A" without a separate sequencing table.
--   - assignments: one row per (asset_or_path, assigned_to) pair.
--     POST /assignments fans a "team"/"org_unit" target out into one row per
--     resolved user — there is intentionally no group/target table here.
--   - permission catalogue entries for module='learning', features
--     'paths' / 'assignments' / 'team_assignments'
--   - notification_templates for 'assignment.created' (Rule 1 — copy and
--     channels are config, never hardcoded strings in assignmentService)

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE learning_paths (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   UUID        NOT NULL REFERENCES tenants(id),
  title                       VARCHAR(500) NOT NULL,
  description                 TEXT,
  path_type                   VARCHAR(50) CHECK (path_type IN ('competency','career','certification','development','strategic')),
  proficiency_level_id        UUID        REFERENCES proficiency_levels(id),
  estimated_duration_minutes  INT,
  status                      VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  created_by                  UUID        REFERENCES users(id),
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE learning_path_items (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  path_id                 UUID    NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
  asset_id                UUID    NOT NULL REFERENCES learning_assets(id),
  item_order              INT     NOT NULL,
  is_mandatory            BOOLEAN DEFAULT TRUE,
  prerequisite_item_id    UUID    REFERENCES learning_path_items(id),
  UNIQUE(path_id, item_order)
);

CREATE TABLE assignments (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  asset_id      UUID        REFERENCES learning_assets(id),
  path_id       UUID        REFERENCES learning_paths(id),
  assigned_to   UUID        NOT NULL REFERENCES users(id),
  assigned_by   UUID        NOT NULL REFERENCES users(id),
  due_date      DATE,
  is_mandatory  BOOLEAN     DEFAULT TRUE,
  status        VARCHAR(50) DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','completed','overdue')),
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_learning_paths_tenant   ON learning_paths(tenant_id);
CREATE INDEX idx_learning_paths_status   ON learning_paths(status);
CREATE INDEX idx_path_items_path         ON learning_path_items(path_id);
CREATE INDEX idx_path_items_asset        ON learning_path_items(asset_id);
CREATE INDEX idx_assignments_tenant      ON assignments(tenant_id);
CREATE INDEX idx_assignments_assigned_to ON assignments(assigned_to);
CREATE INDEX idx_assignments_assigned_by ON assignments(assigned_by);
CREATE INDEX idx_assignments_asset       ON assignments(asset_id);
CREATE INDEX idx_assignments_path        ON assignments(path_id);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- 'paths.view' is granted to every role: published paths are visible to
-- anyone who can see the catalogue, and pathService additionally lets a
-- draft/retired path's creator, learning.paths.create holders, or anyone
-- with an assignment against that path view it (Rule 7).
-- 'paths.create' is L&D admin only, matching migration 015's content
-- authoring convention.
-- 'assignments.create' goes to roles that have a team/practice/org scope to
-- assign into (Rule 7's "team", "practice members", "all"); associates and
-- external users cannot assign.
-- 'assignments.view' covers GET /assignments/me — every role sees its own
-- assignments (matches migration 012's notification-inbox convention).
-- 'team_assignments.view' covers GET /assignments/team — reporting managers
-- (direct reports) plus L&D admin/super_admin oversight.

INSERT INTO permissions (module, feature, action, description) VALUES
  ('learning', 'paths', 'view',             'View a learning path and its items'),
  ('learning', 'paths', 'create',           'Create a learning path with ordered items'),
  ('learning', 'assignments', 'create',     'Assign a learning asset or path to users, a team, or an org unit'),
  ('learning', 'assignments', 'view',       'View own learning assignments'),
  ('learning', 'team_assignments', 'view',  'View direct reports'' learning assignments');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND (p.module, p.feature, p.action) IN (
    ('learning', 'paths', 'view'),
    ('learning', 'assignments', 'view')
  );

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) = ('learning', 'paths', 'create');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('reporting_manager', 'program_manager', 'competency_leader', 'ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) = ('learning', 'assignments', 'create');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND r.name IN ('reporting_manager', 'ld_admin', 'super_admin')
  AND (p.module, p.feature, p.action) = ('learning', 'team_assignments', 'view');

-- ---------------------------------------------------------------------------
-- Notifications: assignment.created
-- ---------------------------------------------------------------------------

INSERT INTO notification_templates (tenant_id, name, event_type, channel, subject, body) VALUES
  ('00000000-0000-0000-0000-000000000001',
   'Learning Assignment - Email',
   'assignment.created', 'email',
   'New learning assignment: {{title}}',
   'Hi {{user_name}},\n\n{{assigned_by_name}} has assigned you "{{title}}".\n\nDue date: {{due_date}}.\n\nLogin to start: {{action_url}}'),

  ('00000000-0000-0000-0000-000000000001',
   'Learning Assignment - In App',
   'assignment.created', 'in_app',
   NULL,
   '{{assigned_by_name}} assigned you "{{title}}". Due date: {{due_date}}.');

-- DOWN
-- DELETE FROM notification_templates
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND event_type = 'assignment.created';
--
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('learning', 'paths', 'view'),
--     ('learning', 'paths', 'create'),
--     ('learning', 'assignments', 'create'),
--     ('learning', 'assignments', 'view'),
--     ('learning', 'team_assignments', 'view')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('learning', 'paths', 'view'),
--     ('learning', 'paths', 'create'),
--     ('learning', 'assignments', 'create'),
--     ('learning', 'assignments', 'view'),
--     ('learning', 'team_assignments', 'view')
--   );
--
-- DROP TABLE assignments;
-- DROP TABLE learning_path_items;
-- DROP TABLE learning_paths;
