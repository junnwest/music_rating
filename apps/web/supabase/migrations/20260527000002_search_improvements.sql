-- Search improvements: trigram fuzzy matching, full-text ranking, popularity signal.
--
-- Run in Supabase SQL editor (not via `supabase db push` — prior migrations already applied live).
--
-- What this adds:
--   1. pg_trgm extension   — powers fuzzy ILIKE and word_similarity scoring
--   2. ratings_count col   — denormalized popularity signal, kept live by trigger
--   3. GIN trigram indexes — accelerate ILIKE + word_similarity on all name fields
--   4. GIN full-text index — accelerate tsvector @@ tsquery matching
--   5. search_releases()   — scored RPC function replacing raw ilike queries

-- ── 1. Extension ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. Popularity signal ──────────────────────────────────────────────────────
ALTER TABLE releases ADD COLUMN IF NOT EXISTS ratings_count integer NOT NULL DEFAULT 0;

-- Backfill from existing ratings
UPDATE releases r
SET    ratings_count = (SELECT COUNT(*) FROM ratings WHERE release_id = r.id);

CREATE OR REPLACE FUNCTION _sync_release_ratings_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE releases SET ratings_count = ratings_count + 1 WHERE id = NEW.release_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE releases SET ratings_count = GREATEST(ratings_count - 1, 0) WHERE id = OLD.release_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.release_id IS DISTINCT FROM NEW.release_id THEN
    UPDATE releases SET ratings_count = GREATEST(ratings_count - 1, 0) WHERE id = OLD.release_id;
    UPDATE releases SET ratings_count = ratings_count + 1                WHERE id = NEW.release_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_ratings_count ON ratings;
CREATE TRIGGER trg_release_ratings_count
AFTER INSERT OR DELETE OR UPDATE OF release_id ON ratings
FOR EACH ROW EXECUTE FUNCTION _sync_release_ratings_count();

-- ── 3. Trigram indexes (GIN) ──────────────────────────────────────────────────
-- Accelerates: ILIKE '%query%' and word_similarity() calls on name fields.
CREATE INDEX IF NOT EXISTS idx_releases_title_trgm
  ON releases USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_releases_artist_trgm
  ON releases USING gin (artist gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_releases_title_native_trgm
  ON releases USING gin (title_native gin_trgm_ops)
  WHERE title_native IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_releases_artist_native_trgm
  ON releases USING gin (artist_native gin_trgm_ops)
  WHERE artist_native IS NOT NULL;

-- ── 4. Full-text search index (GIN) ──────────────────────────────────────────
-- 'simple' dictionary: no stemming, no stopwords — good for proper nouns / music titles.
CREATE INDEX IF NOT EXISTS idx_releases_fts
  ON releases USING gin (
    to_tsvector('simple',
      coalesce(title, '')         || ' ' ||
      coalesce(artist, '')        || ' ' ||
      coalesce(title_native, '')  || ' ' ||
      coalesce(artist_native, ''))
  );

-- ── 5. Scored search function ─────────────────────────────────────────────────
-- Scoring weights (subject to tuning):
--   10 000  exact title/artist match
--    9 000  exact title_native/artist_native match
--      500  prefix (starts with query)
--    0–1000 word_similarity across all name fields
--    0–100  full-text ts_rank
--    0–~55  popularity: ln(ratings_count + 1) * 8
--
-- Caller: supabase.rpc('search_releases', { q, yr, lim })
CREATE OR REPLACE FUNCTION search_releases(
  q    text,
  yr   text DEFAULT NULL,
  lim  int  DEFAULT 15
)
RETURNS TABLE (
  id            uuid,
  title         text,
  artist        text,
  title_native  text,
  artist_native text,
  release_date  text,
  release_type  text,
  cover_url     text
)
LANGUAGE sql STABLE AS $$
  SELECT
    r.id, r.title, r.artist, r.title_native, r.artist_native,
    r.release_date, r.release_type, r.cover_url
  FROM releases r
  WHERE
    -- Exclude singles
    r.release_type NOT ILIKE 'single'
    -- Optional year filter
    AND (yr IS NULL OR r.release_date LIKE yr || '%')
    -- Candidate set: ilike substring OR word-similarity fuzzy OR full-text
    AND (
      r.title          ILIKE '%' || q || '%'
      OR r.artist        ILIKE '%' || q || '%'
      OR r.title_native  ILIKE '%' || q || '%'
      OR r.artist_native ILIKE '%' || q || '%'
      OR word_similarity(lower(q), lower(r.title))   > 0.3
      OR word_similarity(lower(q), lower(r.artist))  > 0.3
      OR (r.title_native  IS NOT NULL AND word_similarity(lower(q), lower(r.title_native))  > 0.3)
      OR (r.artist_native IS NOT NULL AND word_similarity(lower(q), lower(r.artist_native)) > 0.3)
      OR to_tsvector('simple',
           coalesce(r.title, '')        || ' ' || coalesce(r.artist, '')        || ' ' ||
           coalesce(r.title_native, '') || ' ' || coalesce(r.artist_native, ''))
         @@ plainto_tsquery('simple', q)
    )
  ORDER BY (
    -- Exact full-string match (title beats artist for same score)
    CASE
      WHEN lower(r.title)  = lower(q) OR lower(coalesce(r.title_native,  '')) = lower(q) THEN 10000
      WHEN lower(r.artist) = lower(q) OR lower(coalesce(r.artist_native, '')) = lower(q) THEN  9000
      ELSE 0
    END
    -- Prefix / starts-with match
    + CASE
        WHEN lower(r.title)  LIKE lower(q) || '%' THEN 500
        WHEN lower(r.artist) LIKE lower(q) || '%' THEN 400
        ELSE 0
      END
    -- Best word-similarity across all name fields (0→1 → 0→1000)
    + GREATEST(
        word_similarity(lower(q), lower(r.title)),
        word_similarity(lower(q), lower(r.artist)),
        COALESCE(word_similarity(lower(q), lower(r.title_native)),  0),
        COALESCE(word_similarity(lower(q), lower(r.artist_native)), 0)
      ) * 1000
    -- Full-text rank (0→~1 → 0→100)
    + ts_rank(
        to_tsvector('simple',
          coalesce(r.title, '')        || ' ' || coalesce(r.artist, '')        || ' ' ||
          coalesce(r.title_native, '') || ' ' || coalesce(r.artist_native, '')),
        plainto_tsquery('simple', q)
      ) * 100
    -- Popularity: log-scale so 1 rating adds ~5.5 pts, 10 adds ~19, 100 adds ~39
    + ln(GREATEST(r.ratings_count::float, 0) + 1) * 8
  ) DESC
  LIMIT lim;
$$;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM releases WHERE ratings_count > 0) AS releases_with_ratings,
  (SELECT SUM(ratings_count) FROM releases)               AS total_rating_refs,
  (SELECT COUNT(*) FROM ratings)                          AS actual_ratings;
