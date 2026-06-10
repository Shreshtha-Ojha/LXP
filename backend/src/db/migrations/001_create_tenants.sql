-- Migration 001: Tenants
-- Every entity in the system belongs to a tenant.
-- Release 0 runs single-tenant but the column must exist from day one.

CREATE TABLE tenants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(100) NOT NULL UNIQUE,  -- used in subdomains later
  status        VARCHAR(50)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'trial', 'offboarded')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed the single internal tenant for Release 0
INSERT INTO tenants (id, name, slug, status)
VALUES ('00000000-0000-0000-0000-000000000001', 'Internal', 'internal', 'active');

-- DOWN
-- DROP TABLE tenants;
