-- Semantic search: pgvector extension + embedding column + hybrid search function.
--
-- Run in Supabase SQL editor after 20260527000002_search_improvements.sql.
-- After running: execute `npm run backfill:embeddings` to populate the embedding column.

-- ── 1. Extension ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── 2. Embedding column ───────────────────────────────────────────────────────
-- 1024 dimensions matches jina-embeddings-v3 default output size.
ALTER TABLE releases ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- ── 3. HNSW index for approximate nearest-neighbor search ─────────────────────
-- m=16, ef_construction=64: good defaults for catalogs under 1M rows.
-- Cosine distance (<=>): correct for Jina embeddings (L2-normalized output).
CREATE INDEX IF NOT EXISTS idx_releases_embedding_hnsw
  ON releases USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── 4. Hybrid search function (replaces previous version) ────────────────────
-- Drops the old 3-arg signature so we can add the optional query_embedding param.
DROP FUNCTION IF EXISTS search_releases(text, text, int);

-- Scoring weights:
--   10 000  exact title/native match
--    9 000  exact artist/native match
--      500  prefix match
--    0–1000 word_similarity (fuzzy/typo)
--    0–100  ts_rank (full-text)
--    0–~55  popularity  ln(ratings_count+1)*8
--    0–1500 semantic cosine similarity (when query_embedding supplied)
--
-- When query_embedding IS NOT NULL every release that has an embedding is a
-- candidate, so pure semantic queries ("sad rainy indie") surface even when
-- no lexical token matches. At 6 000 rows this full scan is < 10 ms.
CREATE OR REPLACE FUNCTION search_releases(
  q               text,
  yr              text           DEFAULT NULL,
  lim             int            DEFAULT 15,
  query_embedding vector(1024)   DEFAULT NULL
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
    r.release_type NOT ILIKE 'single'
    AND (yr IS NULL OR r.release_date LIKE yr || '%')
    AND (
      -- Semantic candidates: all releases with embeddings when vector supplied
      (query_embedding IS NOT NULL AND r.embedding IS NOT NULL)
      -- Lexical candidates: always included regardless of embedding
      OR r.title          ILIKE '%' || q || '%'
      OR r.artist         ILIKE '%' || q || '%'
      OR r.title_native   ILIKE '%' || q || '%'
      OR r.artist_native  ILIKE '%' || q || '%'
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
    -- Exact match
    CASE
      WHEN lower(r.title)  = lower(q) OR lower(coalesce(r.title_native,  '')) = lower(q) THEN 10000
      WHEN lower(r.artist) = lower(q) OR lower(coalesce(r.artist_native, '')) = lower(q) THEN  9000
      ELSE 0
    END
    -- Prefix
    + CASE
        WHEN lower(r.title)  LIKE lower(q) || '%' THEN 500
        WHEN lower(r.artist) LIKE lower(q) || '%' THEN 400
        ELSE 0
      END
    -- Fuzzy word similarity
    + GREATEST(
        word_similarity(lower(q), lower(r.title)),
        word_similarity(lower(q), lower(r.artist)),
        COALESCE(word_similarity(lower(q), lower(r.title_native)),  0),
        COALESCE(word_similarity(lower(q), lower(r.artist_native)), 0)
      ) * 1000
    -- Full-text rank
    + ts_rank(
        to_tsvector('simple',
          coalesce(r.title, '')        || ' ' || coalesce(r.artist, '')        || ' ' ||
          coalesce(r.title_native, '') || ' ' || coalesce(r.artist_native, '')),
        plainto_tsquery('simple', q)
      ) * 100
    -- Popularity
    + ln(GREATEST(r.ratings_count::float, 0) + 1) * 8
    -- Semantic similarity: cosine_distance 0=identical → similarity 1=identical
    -- Weight 1500 puts semantic on par with strong word_similarity matches
    + CASE
        WHEN query_embedding IS NOT NULL AND r.embedding IS NOT NULL
        THEN (1.0 - (r.embedding <=> query_embedding)) * 1500
        ELSE 0
      END
  ) DESC
  LIMIT lim;
$$;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM releases)                    AS total_releases,
  (SELECT COUNT(*) FROM releases WHERE embedding IS NOT NULL) AS with_embedding;
