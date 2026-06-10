-- Migration 005: Audit Log
-- Append-only. No UPDATE or DELETE ever runs against this table.
-- Enforce at DB level with a rule, and at app level via code review.

CREATE TABLE audit_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),
  actor_user_id       UUID        REFERENCES users(id),   -- null for system actions
  actor_role_at_time  VARCHAR(100),                        -- snapshot of role name at time of action
  action_type         VARCHAR(100) NOT NULL,               -- e.g. USER_CREATED, ROLE_ASSIGNED, LOGIN_FAILED
  entity_type         VARCHAR(100),                        -- e.g. User, LearningAsset, WorkflowInstance
  entity_id           UUID,
  old_value           JSONB,                               -- state before change
  new_value           JSONB,                               -- state after change
  ip_address          INET,
  user_agent          TEXT,
  result              VARCHAR(20) NOT NULL DEFAULT 'success'
                      CHECK (result IN ('success', 'failure')),
  metadata            JSONB,                               -- any extra context
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()   -- no updated_at — append only
);

-- Prevent any UPDATE or DELETE on audit_events at the database level
CREATE RULE audit_no_update AS ON UPDATE TO audit_events DO INSTEAD NOTHING;
CREATE RULE audit_no_delete AS ON DELETE TO audit_events DO INSTEAD NOTHING;

CREATE INDEX idx_audit_tenant      ON audit_events(tenant_id);
CREATE INDEX idx_audit_actor       ON audit_events(actor_user_id);
CREATE INDEX idx_audit_action_type ON audit_events(action_type);
CREATE INDEX idx_audit_entity      ON audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_created_at  ON audit_events(created_at DESC);

-- DOWN
-- DROP RULE audit_no_delete ON audit_events;
-- DROP RULE audit_no_update ON audit_events;
-- DROP TABLE audit_events;
