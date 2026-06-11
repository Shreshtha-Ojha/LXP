-- Seed 001: Local content catalogue data
--
-- Populates competency_areas, skills, and learning_assets (+ links) so the
-- /content and /catalog endpoints have realistic data to develop against
-- locally. Mirrors the fixtures in
-- frontend/src/components/catalogue/mockCourses.ts.
--
-- Run once against a freshly migrated, empty database for tenant
-- '00000000-0000-0000-0000-000000000001' (the Release 0 internal tenant).
--
-- competency_categories is intentionally left empty here — skills.category_id
-- is nullable (migration 009) and the category taxonomy is governed in
-- Release 2, so these skills sit directly under their competency area for now
-- without an intermediate category.

-- ---------------------------------------------------------------------------
-- Competency areas
-- ---------------------------------------------------------------------------

INSERT INTO competency_areas (tenant_id, name, description, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Backend Engineering',    'Server-side application design, APIs, and service architecture.', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'Cloud & Infrastructure', 'Cloud platforms, containers, and infrastructure operations.', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'Security & Quality',     'Application security, secure coding, and quality assurance practices.', 'active');

-- ---------------------------------------------------------------------------
-- Skills
-- ---------------------------------------------------------------------------

INSERT INTO skills (tenant_id, name, description, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'API Design',      'Designing consistent, versioned, and well-documented APIs.', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'Docker',          'Building and running containerised applications with Docker.', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'Kubernetes',      'Deploying and operating containerised workloads on Kubernetes.', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'OWASP/Security',  'Identifying and mitigating common application security risks (OWASP Top 10).', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'System Design',   'Designing scalable, maintainable systems and architectures.', 'active');

-- ---------------------------------------------------------------------------
-- Learning assets
-- ---------------------------------------------------------------------------

INSERT INTO learning_assets (tenant_id, title, description, content_type, proficiency_level_id, duration_minutes, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'REST API design patterns and versioning',
   'Best practices for designing RESTful APIs, including resource modelling, pagination, error handling, and versioning strategies.',
   'video',
   (SELECT id FROM proficiency_levels WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND name = 'Intermediate'),
   135, 'published'),

  ('00000000-0000-0000-0000-000000000001', 'Docker fundamentals and container orchestration',
   'An introduction to containerisation with Docker and the basics of orchestrating containers at scale.',
   'video',
   (SELECT id FROM proficiency_levels WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND name = 'Beginner'),
   210, 'published'),

  ('00000000-0000-0000-0000-000000000001', 'OWASP Top 10 security awareness',
   'An overview of the OWASP Top 10 web application security risks and how to recognise them.',
   'article',
   (SELECT id FROM proficiency_levels WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND name = 'Beginner'),
   60, 'published'),

  ('00000000-0000-0000-0000-000000000001', 'Kubernetes for backend engineers',
   'Practical Kubernetes concepts for backend engineers: deployments, services, scaling, and configuration.',
   'video',
   (SELECT id FROM proficiency_levels WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND name = 'Intermediate'),
   180, 'published'),

  ('00000000-0000-0000-0000-000000000001', 'System design fundamentals',
   'Core principles of designing large-scale systems, covering scalability, reliability, and trade-off analysis.',
   'article',
   (SELECT id FROM proficiency_levels WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND name = 'Advanced'),
   90, 'published'),

  ('00000000-0000-0000-0000-000000000001', 'PostgreSQL advanced patterns',
   'Advanced PostgreSQL techniques including indexing strategies, query optimisation, and schema design patterns.',
   'video',
   (SELECT id FROM proficiency_levels WHERE tenant_id = '00000000-0000-0000-0000-000000000001' AND name = 'Advanced'),
   150, 'published');

-- search_vector is normally maintained by the trg_learning_assets_search_vector
-- trigger (migration 016), but refresh it explicitly here too so the seeded
-- rows are searchable even if the trigger isn't present yet on this DB.
UPDATE learning_assets SET search_vector =
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''));

-- ---------------------------------------------------------------------------
-- Learning asset <-> skill links (Rule 6 — FK relationships, not strings)
-- ---------------------------------------------------------------------------

INSERT INTO learning_asset_skills (asset_id, skill_id)
SELECT la.id, s.id
FROM learning_assets la
JOIN skills s ON s.tenant_id = la.tenant_id
WHERE la.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND (la.title, s.name) IN (
    ('REST API design patterns and versioning',          'API Design'),
    ('Docker fundamentals and container orchestration',  'Docker'),
    ('Docker fundamentals and container orchestration',  'Kubernetes'),
    ('OWASP Top 10 security awareness',                  'OWASP/Security'),
    ('Kubernetes for backend engineers',                 'Kubernetes'),
    ('Kubernetes for backend engineers',                 'Docker'),
    ('System design fundamentals',                       'System Design'),
    ('PostgreSQL advanced patterns',                      'System Design')
  );
