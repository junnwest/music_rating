-- Durability for the primary_genre join table (2026-07-07).
--
-- rg_primary_genre is populated for the currently chart-eligible set (rated OR prestige albums).
-- As users rate NEW albums post-launch, those need a primary_genre row too, or they'd fall back to
-- whole-array membership (and idol/scene content could leak into the style charts again). This
-- trigger populates a rated album's row on its first rating — cheap (one PK lookup + INSERT, skipped
-- if already present). Keeps the fix complete without a periodic backfill.

CREATE OR REPLACE FUNCTION _sync_primary_genre() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rg_primary_genre (release_group_id, primary_genre)
  SELECT NEW.release_group_id, _compute_primary_genre(rg.genres)
  FROM release_groups rg
  WHERE rg.id = NEW.release_group_id AND rg.genres IS NOT NULL
  ON CONFLICT (release_group_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_primary_genre ON ratings;
CREATE TRIGGER trg_sync_primary_genre
  AFTER INSERT ON ratings
  FOR EACH ROW EXECUTE FUNCTION _sync_primary_genre();
