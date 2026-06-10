-- Migration 006: Workflow Engine
-- One central engine. Every approval in the system uses these tables.
-- Never build approval logic directly in feature code.

CREATE TABLE workflow_definitions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  module          VARCHAR(100) NOT NULL,  -- which module owns this workflow e.g. 'content', 'skills'
  trigger_event   VARCHAR(100) NOT NULL,  -- e.g. 'content.submitted', 'skill.declared'
  is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
  version         INT         NOT NULL DEFAULT 1,
  created_by      UUID        REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name, version)
);

CREATE TABLE workflow_steps (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id       UUID        NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  step_order          INT         NOT NULL,
  name                VARCHAR(255) NOT NULL,
  step_type           VARCHAR(50) NOT NULL
                      CHECK (step_type IN ('approval', 'notification', 'auto', 'condition')),
  approver_role       VARCHAR(100),  -- role name; null for auto/notification steps
  approver_user_id    UUID        REFERENCES users(id),  -- specific user override
  sla_hours           INT,           -- hours before escalation triggers
  escalation_role     VARCHAR(100),  -- role to escalate to on SLA breach
  is_required         BOOLEAN     NOT NULL DEFAULT TRUE,
  UNIQUE (definition_id, step_order)
);

CREATE TABLE workflow_instances (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id),
  definition_id     UUID        NOT NULL REFERENCES workflow_definitions(id),
  entity_type       VARCHAR(100) NOT NULL,  -- e.g. 'LearningAsset', 'SkillDeclaration'
  entity_id         UUID        NOT NULL,
  initiated_by      UUID        NOT NULL REFERENCES users(id),
  current_step      INT         NOT NULL DEFAULT 1,
  status            VARCHAR(50) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'approved', 'rejected', 'withdrawn', 'escalated')),
  due_at            TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_tasks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id     UUID        NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
  step_id         UUID        NOT NULL REFERENCES workflow_steps(id),
  assigned_to     UUID        NOT NULL REFERENCES users(id),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at          TIMESTAMPTZ,
  status          VARCHAR(50) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected', 'sent_back', 'info_requested', 'escalated', 'delegated', 'withdrawn')),
  action_taken    VARCHAR(50),
  comment         TEXT,
  acted_at        TIMESTAMPTZ,
  delegated_to    UUID        REFERENCES users(id)
);

CREATE INDEX idx_wf_instances_tenant   ON workflow_instances(tenant_id);
CREATE INDEX idx_wf_instances_entity   ON workflow_instances(entity_type, entity_id);
CREATE INDEX idx_wf_instances_status   ON workflow_instances(status);
CREATE INDEX idx_wf_tasks_assigned     ON workflow_tasks(assigned_to);
CREATE INDEX idx_wf_tasks_status       ON workflow_tasks(status);
CREATE INDEX idx_wf_tasks_instance     ON workflow_tasks(instance_id);

-- DOWN
-- DROP TABLE workflow_tasks;
-- DROP TABLE workflow_instances;
-- DROP TABLE workflow_steps;
-- DROP TABLE workflow_definitions;
