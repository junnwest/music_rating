-- External prestige scores for the Silla Score ranking system.
--
-- Each row is one source's opinion of one album.
-- normalized_score is always 0.0–1.0 regardless of the original scale:
--   list rank (1/500):  1 - ((rank - 1) / (list_size - 1))   → #1 = 1.0, last = 0.0
--   review score (0–100): value / 100
--   review score (0–10):  value / 10
--   stars (1–5):          (value - 1) / 4
--   award win:            1.0
--   award nomination:     0.35
--   award absent:         row omitted (NOT 0.0 — absence is not evidence against)
--
-- source_tier controls weighting in the final blend:
--   1 = broad aggregators  (AOTY, Metacritic)         → weight 0.45
--   2 = authority publications (genre critics, polls) → weight 0.30
--   3 = awards                                        → weight 0.25
--
-- scope_genre / scope_country = null means "counts for all filters".
-- Non-null means the row only contributes when that filter is active.

CREATE TABLE IF NOT EXISTS external_scores (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id       text        NOT NULL,   -- Spotify track/album ID (matches releases.id)
  album_title      text        NOT NULL,   -- kept for human readability + fuzzy matching
  artist           text        NOT NULL,
  source           text        NOT NULL,   -- 'grammy_aoty', 'rolling_stone_500', 'korean_music_awards', etc.
  raw_score        numeric,                -- original value before normalization
  normalized_score numeric     NOT NULL CHECK (normalized_score >= 0 AND normalized_score <= 1),
  score_type       text        NOT NULL CHECK (score_type IN (
                                  'list_rank',        -- position in a ranked list
                                  'review_score',     -- publication score
                                  'award_win',        -- won the award
                                  'award_nomination'  -- nominated but didn't win
                                )),
  source_tier      int         NOT NULL DEFAULT 2 CHECK (source_tier IN (1, 2, 3)),
  scope_genre      text,                  -- null = global; 'hip_hop', 'jazz', 'electronic', etc.
  scope_country    text,                  -- null = global; 'kr', 'jp', 'uk', 'la', etc.
  year             int,                   -- list edition year or award year
  notes            text,
  created_at       timestamptz DEFAULT now(),
  UNIQUE (release_id, source, year)
);

-- Index for the scoring RPC: look up by release + filter
CREATE INDEX IF NOT EXISTS external_scores_release_idx ON external_scores (release_id);
CREATE INDEX IF NOT EXISTS external_scores_scope_idx   ON external_scores (scope_genre, scope_country);
CREATE INDEX IF NOT EXISTS external_scores_source_idx  ON external_scores (source, source_tier);

ALTER TABLE external_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "external_scores_select" ON external_scores FOR SELECT USING (true);

-- ── Scoring RPC ──────────────────────────────────────────────────────────────
-- Returns one external prestige score per album (0–1), weighted by tier,
-- filtered by genre + country. Called by the iOS ranking query.

CREATE OR REPLACE FUNCTION get_external_prestige_scores(
  release_ids  text[],
  p_genre      text DEFAULT NULL,
  p_country    text DEFAULT NULL
)
RETURNS TABLE (
  release_id       text,
  prestige_score   float8,   -- 0.0–1.0 weighted average across all applicable sources
  source_count     int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    applicable AS (
      SELECT
        es.release_id,
        es.normalized_score,
        es.source_tier,
        -- Tier weights: 1→0.45, 2→0.30, 3→0.25
        CASE es.source_tier
          WHEN 1 THEN 0.45
          WHEN 2 THEN 0.30
          ELSE        0.25
        END AS tier_weight
      FROM external_scores es
      WHERE es.release_id = ANY(release_ids)
        AND (es.scope_genre   IS NULL OR es.scope_genre   = p_genre)
        AND (es.scope_country IS NULL OR es.scope_country = p_country)
    ),
    per_tier AS (
      -- Average within each tier first, then blend tiers (prevents AOTY from
      -- dominating just because it has more rows than The Source)
      SELECT
        release_id,
        source_tier,
        tier_weight,
        AVG(normalized_score) AS tier_avg,
        COUNT(*)::int         AS tier_count
      FROM applicable
      GROUP BY release_id, source_tier, tier_weight
    ),
    blended AS (
      SELECT
        release_id,
        SUM(tier_avg * tier_weight) / NULLIF(SUM(tier_weight), 0) AS prestige_score,
        SUM(tier_count)::int AS source_count
      FROM per_tier
      GROUP BY release_id
    )
  SELECT
    b.release_id,
    LEAST(GREATEST(b.prestige_score, 0), 1) AS prestige_score,
    b.source_count
  FROM blended b;
$$;

GRANT EXECUTE ON FUNCTION get_external_prestige_scores(text[], text, text)
  TO anon, authenticated, service_role;
