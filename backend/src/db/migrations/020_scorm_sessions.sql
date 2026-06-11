-- Migration 020: SCORM Runtime Sessions
--
-- Backs scormService.js/scormRoutes.js — minimal SCORM 1.2 / SCORM 2004
-- runtime support (initialize / set-value / commit / terminate):
--   - scorm_sessions: one row per (user, asset). session_data is a JSONB
--     bag of every raw CMI key/value the SCORM package has set
--     (cmi.core.lesson_status, cmi.suspend_data, cmi.core.score.raw, the
--     SCORM 2004 equivalents cmi.completion_status / cmi.success_status /
--     cmi.score.raw, etc.) merged in via `||` on each set-value call.
--     lesson_status / score / suspend_data are denormalized convenience
--     columns updated whenever a recognised CMI key is set, so terminate
--     can decide "did this attempt complete?" without parsing session_data.
--   - tenant_id is added on top of the column list given in the feature
--     request — every entity has a tenant_id and every query filters by it
--     (Rule 3); there is no other path to the tenant on this table.
--   - No new permissions/config: scormRoutes reuses the existing
--     'learning.progress.create' permission from migration 018
--     (granted to every role — SCORM runtime calls are just another way
--     the learner records progress on their own asset, same as
--     POST /progress/events). On terminate, a 'completed'/'passed'
--     lesson_status is forwarded to learning.progressService as an
--     event_type='completed' progress event, which is what actually
--     creates the completion_record (content_type 'scorm' already has
--     completion_type 'external_status' from migration 018).

CREATE TABLE scorm_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  user_id       UUID        NOT NULL REFERENCES users(id),
  asset_id      UUID        NOT NULL REFERENCES learning_assets(id),
  session_data  JSONB       NOT NULL DEFAULT '{}',
  lesson_status VARCHAR(50),
  score         INT,
  suspend_data  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, asset_id)
);

CREATE INDEX idx_scorm_sessions_tenant ON scorm_sessions(tenant_id);
CREATE INDEX idx_scorm_sessions_asset  ON scorm_sessions(asset_id);

-- DOWN
-- DROP TABLE scorm_sessions;
