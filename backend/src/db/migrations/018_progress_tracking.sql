-- Migration 018: Progress Tracking & Completion Records
--
-- Backs progressRoutes.js/progressService.js:
--   - progress_events: append-only log of every started/progress_updated/
--     completed/resumed event a learner sends for a learning_asset.
--     position_seconds drives GET /progress/resume/:assetId (video resume).
--   - completion_records: one row per (user, asset) once the configured
--     completion rule for that asset's content_type is met. path_id/
--     assignment_id are denormalized links recorded at completion time so
--     reporting can trace "this asset was completed as part of path X /
--     assignment Y" without re-deriving it later.
--   - configurations.learning.completion_rules (Rule 1 — completion
--     thresholds are config, never hardcoded as e.g. `progressPct >= 90`):
--     per content_type, either
--       { "completion_type": "threshold", "threshold_pct": N } -- auto-completes
--         when progress_pct >= N (used for video)
--       { "completion_type": "manual" }          -- only an explicit
--         event_type='completed' event completes it (pdf/article/etc.)
--       { "completion_type": "external_status" } -- same trigger as manual,
--         but the 'completed' event is expected to come from an external
--         runtime (SCORM) rather than the learner directly
--   - permission catalogue entries for module='learning', feature='progress'
--     ('create'/'view'), granted to every role — progress is always "my own
--     records" (Rule 7), so there is no role restriction here.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE progress_events (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  user_id           UUID        NOT NULL REFERENCES users(id),
  asset_id          UUID        NOT NULL REFERENCES learning_assets(id),
  event_type        VARCHAR(50) NOT NULL CHECK (event_type IN ('started','progress_updated','completed','resumed')),
  progress_pct      INT         CHECK (progress_pct BETWEEN 0 AND 100),
  position_seconds  INT,
  metadata          JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE completion_records (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),
  user_id             UUID        NOT NULL REFERENCES users(id),
  asset_id            UUID        NOT NULL REFERENCES learning_assets(id),
  path_id             UUID        REFERENCES learning_paths(id),
  assignment_id       UUID        REFERENCES assignments(id),
  completed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score               INT,
  time_spent_minutes  INT,
  UNIQUE(user_id, asset_id)
);

CREATE INDEX idx_progress_events_tenant        ON progress_events(tenant_id);
CREATE INDEX idx_progress_events_user_asset    ON progress_events(user_id, asset_id);
CREATE INDEX idx_progress_events_asset         ON progress_events(asset_id);
CREATE INDEX idx_completion_records_tenant     ON completion_records(tenant_id);
CREATE INDEX idx_completion_records_user       ON completion_records(user_id);
CREATE INDEX idx_completion_records_asset      ON completion_records(asset_id);
CREATE INDEX idx_completion_records_path       ON completion_records(path_id);
CREATE INDEX idx_completion_records_assignment ON completion_records(assignment_id);

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- Progress is always the caller's own data (Rule 7) — every role gets both
-- 'progress.create' (POST /progress/events) and 'progress.view'
-- (GET /progress/me, GET /progress/resume/:assetId), matching migration
-- 017's 'assignments.view' convention (granted to all roles, no filter).

INSERT INTO permissions (module, feature, action, description) VALUES
  ('learning', 'progress', 'create', 'Record a progress event for own learning'),
  ('learning', 'progress', 'view',   'View own learning progress and resume position');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND (p.module, p.feature, p.action) IN (
    ('learning', 'progress', 'create'),
    ('learning', 'progress', 'view')
  );

-- ---------------------------------------------------------------------------
-- Configuration: completion rules per content_type (Rule 1)
-- ---------------------------------------------------------------------------

INSERT INTO configurations (tenant_id, module, key, value, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'learning', 'completion_rules',
   '{"value": {
       "video":         {"completion_type": "threshold", "threshold_pct": 90},
       "pdf":           {"completion_type": "manual"},
       "article":       {"completion_type": "manual"},
       "scorm":         {"completion_type": "external_status"},
       "external_link": {"completion_type": "manual"},
       "lab":           {"completion_type": "manual"},
       "assessment":    {"completion_type": "manual"}
   }}',
   'Per content_type rule for when a learning asset counts as complete (learning.progressService)');

-- DOWN
-- DELETE FROM configurations
-- WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND module = 'learning' AND key = 'completion_rules';
--
-- DELETE FROM role_permissions
-- USING permissions p
-- WHERE role_permissions.permission_id = p.id
--   AND (p.module, p.feature, p.action) IN (
--     ('learning', 'progress', 'create'),
--     ('learning', 'progress', 'view')
--   );
-- DELETE FROM permissions
-- WHERE (module, feature, action) IN (
--     ('learning', 'progress', 'create'),
--     ('learning', 'progress', 'view')
--   );
--
-- DROP TABLE completion_records;
-- DROP TABLE progress_events;
