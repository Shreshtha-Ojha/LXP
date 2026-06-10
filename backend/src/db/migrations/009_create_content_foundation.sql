-- Migration 009: Content Repository Foundation
-- Schema only. No catalogue UI until Release 1.
-- Skills/competency FK references added here so content is properly tagged from day one.

-- Competency taxonomy (schema only in Release 0, governed in Release 2)
CREATE TABLE competency_areas (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  status      VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE competency_categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  area_id     UUID        NOT NULL REFERENCES competency_areas(id),
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  status      VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE skills (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  category_id   UUID        REFERENCES competency_categories(id),
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  status        VARCHAR(50) NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE proficiency_levels (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  name        VARCHAR(100) NOT NULL,   -- e.g. Beginner, Intermediate, Advanced, Expert
  level_order INT         NOT NULL,    -- 1, 2, 3, 4 — for gap calculations
  description TEXT,
  UNIQUE (tenant_id, name)
);

-- Seed default proficiency levels
INSERT INTO proficiency_levels (tenant_id, name, level_order, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Beginner',     1, 'Awareness level. Can perform with guidance.'),
  ('00000000-0000-0000-0000-000000000001', 'Intermediate',  2, 'Can perform independently on standard tasks.'),
  ('00000000-0000-0000-0000-000000000001', 'Advanced',      3, 'Can perform complex tasks and guide others.'),
  ('00000000-0000-0000-0000-000000000001', 'Expert',        4, 'Recognised authority. Shapes standards and strategy.');

-- Learning assets (schema only — no catalogue UI until Release 1)
CREATE TABLE learning_assets (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id),
  title                 VARCHAR(500) NOT NULL,
  description           TEXT,
  content_type          VARCHAR(50) NOT NULL
                        CHECK (content_type IN ('video', 'pdf', 'article', 'scorm', 'external_link', 'lab', 'assessment')),
  proficiency_level_id  UUID        REFERENCES proficiency_levels(id),
  duration_minutes      INT,
  language              VARCHAR(10) DEFAULT 'en',
  version               VARCHAR(50) DEFAULT '1.0',
  status                VARCHAR(50) NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'in_review', 'published', 'retired')),
  effective_from        DATE,
  effective_to          DATE,
  author_user_id        UUID        REFERENCES users(id),
  storage_url           VARCHAR(1000),   -- S3/blob URL for uploaded files
  external_url          VARCHAR(1000),   -- for external_link type
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Many-to-many: learning assets ↔ skills
CREATE TABLE learning_asset_skills (
  asset_id    UUID NOT NULL REFERENCES learning_assets(id) ON DELETE CASCADE,
  skill_id    UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (asset_id, skill_id)
);

CREATE INDEX idx_assets_tenant  ON learning_assets(tenant_id);
CREATE INDEX idx_assets_status  ON learning_assets(status);
CREATE INDEX idx_assets_type    ON learning_assets(content_type);
CREATE INDEX idx_skills_tenant  ON skills(tenant_id);

-- DOWN
-- DROP TABLE learning_asset_skills;
-- DROP TABLE learning_assets;
-- DROP TABLE proficiency_levels;
-- DROP TABLE skills;
-- DROP TABLE competency_categories;
-- DROP TABLE competency_areas;
