-- Migration 016: Catalogue Search Index + Saved Items
--
-- Backs GET /catalog/search, /catalog/browse, /catalog/assets/:id/save and
-- /catalog/saved (searchService.js):
--   - search_vector is a generated/maintained tsvector over title (weight A),
--     description (weight B) and tags (weight C) so ts_rank can favour
--     title/tag matches over description matches for sort=relevant
--   - the trigger keeps search_vector in sync on INSERT and on UPDATE of
--     title/description/tags — contentService.createAsset/updateAsset do not
--     need to know search_vector exists
--   - skills are matched via a join to learning_asset_skills/skills at query
--     time (Rule 6 — FK relationships, not folded into the tsvector)
--   - saved_items backs the per-user bookmark toggle (SavedItem in
--     specs/002-learning-catalog-discovery/spec.md); saving does not affect
--     visibility (Rule 7) — it is purely a per-user join table

-- ---------------------------------------------------------------------------
-- search_vector
-- ---------------------------------------------------------------------------

ALTER TABLE learning_assets ADD COLUMN search_vector tsvector;

CREATE INDEX idx_assets_search ON learning_assets USING gin(search_vector);

CREATE FUNCTION learning_assets_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, ARRAY[]::text[]), ' ')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_learning_assets_search_vector
  BEFORE INSERT OR UPDATE OF title, description, tags ON learning_assets
  FOR EACH ROW EXECUTE FUNCTION learning_assets_search_vector_update();

-- Backfill rows that existed before this migration (trigger only fires on
-- future inserts/updates)
UPDATE learning_assets SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
  setweight(to_tsvector('english', array_to_string(coalesce(tags, ARRAY[]::text[]), ' ')), 'C');

-- ---------------------------------------------------------------------------
-- saved_items — per-user bookmarks (GET /catalog/assets/:id/save, /catalog/saved)
-- ---------------------------------------------------------------------------

CREATE TABLE saved_items (
  tenant_id   UUID        NOT NULL REFERENCES tenants(id),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id    UUID        NOT NULL REFERENCES learning_assets(id) ON DELETE CASCADE,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, asset_id)
);

CREATE INDEX idx_saved_items_tenant ON saved_items(tenant_id);
CREATE INDEX idx_saved_items_user   ON saved_items(user_id);

-- DOWN
-- DROP TABLE saved_items;
--
-- DROP TRIGGER IF EXISTS trg_learning_assets_search_vector ON learning_assets;
-- DROP FUNCTION IF EXISTS learning_assets_search_vector_update();
-- DROP INDEX IF EXISTS idx_assets_search;
-- ALTER TABLE learning_assets DROP COLUMN search_vector;
