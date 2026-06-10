-- Migration 002: Organisation Units
-- Configurable hierarchy. Level names are not hardcoded.
-- Parent-child self-reference supports unlimited depth.

CREATE TABLE organisation_units (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  name            VARCHAR(255) NOT NULL,
  code            VARCHAR(100),                        -- optional short code e.g. "BU-APAC"
  parent_id       UUID        REFERENCES organisation_units(id),
  level           INT         NOT NULL DEFAULT 0,      -- 0 = root org, 1 = BU, 2 = Practice etc.
  level_label     VARCHAR(100) NOT NULL DEFAULT 'Unit', -- configurable: "Business Unit", "Practice", etc.
  status          VARCHAR(50) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'archived')),
  effective_from  DATE,
  effective_to    DATE,
  created_by      UUID,                                -- user id, nullable on seed
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_org_units_tenant    ON organisation_units(tenant_id);
CREATE INDEX idx_org_units_parent    ON organisation_units(parent_id);
CREATE INDEX idx_org_units_status    ON organisation_units(status);

-- DOWN
-- DROP TABLE organisation_units;
