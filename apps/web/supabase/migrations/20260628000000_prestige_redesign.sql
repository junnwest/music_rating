-- Prestige system redesign (2026-06-28)
--
-- Changes:
--   1. external_scores: MBID-keyed, no scope columns, global scoring only
--      (filtering is UI — genres/countries restrict which albums appear, not how they score)
--   2. release_groups.prestige_score: precomputed float8 column, updated by reconciliation
--   3. reconcile_prestige_scores(): idempotent; call after seeding or pipeline artist ingest
--   4. get_silla_leaderboard: reads prestige_score directly, no more 3-hop Spotify bridge
--   5. p_country now filters albums by artist country, not by prestige scope

-- ── 1. Rebuild external_scores ────────────────────────────────────────────────

TRUNCATE TABLE external_scores;

ALTER TABLE external_scores DROP COLUMN IF EXISTS release_id;
ALTER TABLE external_scores DROP COLUMN IF EXISTS scope_genre;
ALTER TABLE external_scores DROP COLUMN IF EXISTS scope_country;

ALTER TABLE external_scores ADD COLUMN IF NOT EXISTS mb_release_group_id text;

ALTER TABLE external_scores
  DROP CONSTRAINT IF EXISTS external_scores_release_id_source_year_key;

-- Unique on content identity so re-runs are idempotent even before MBID is resolved.
ALTER TABLE external_scores
  ADD CONSTRAINT external_scores_content_key
  UNIQUE (album_title, artist, source, year);

CREATE INDEX IF NOT EXISTS external_scores_mb_rg_idx
  ON external_scores (mb_release_group_id)
  WHERE mb_release_group_id IS NOT NULL;

-- ── 2. prestige_score on release_groups ───────────────────────────────────────

ALTER TABLE release_groups ADD COLUMN IF NOT EXISTS prestige_score float8;

CREATE INDEX IF NOT EXISTS release_groups_prestige_idx
  ON release_groups (prestige_score DESC NULLS LAST)
  WHERE prestige_score IS NOT NULL;

-- ── 3. reconcile_prestige_scores() ────────────────────────────────────────────
-- Recomputes release_groups.prestige_score from external_scores rows that have
-- a resolved mb_release_group_id.
--
-- Call after:
--   • seeding a new prestige source
--   • pipeline ingests a batch of artists (mb_release_group_id now resolvable)
--
-- Idempotent — safe to call repeatedly.

CREATE OR REPLACE FUNCTION reconcile_prestige_scores()
RETURNS TABLE (updated int, pending int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
  v_pending int;
BEGIN
  -- Average within each tier first (prevents a source with many rows dominating),
  -- then blend tiers by weight.
  WITH tier_scores AS (
    SELECT
      es.mb_release_group_id,
      es.source_tier,
      AVG(es.normalized_score)                                               AS tier_avg,
      CASE es.source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END  AS tier_weight
    FROM external_scores es
    WHERE es.mb_release_group_id IS NOT NULL
    GROUP BY es.mb_release_group_id, es.source_tier
  ),
  blended AS (
    SELECT
      mb_release_group_id,
      SUM(tier_avg * tier_weight) / NULLIF(SUM(tier_weight), 0) AS prestige
    FROM tier_scores
    GROUP BY mb_release_group_id
  )
  UPDATE release_groups rg
  SET prestige_score = LEAST(GREATEST(b.prestige, 0), 1)
  FROM blended b
  WHERE rg.mb_release_group_id = b.mb_release_group_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT COUNT(*)::int INTO v_pending
  FROM external_scores
  WHERE mb_release_group_id IS NULL;

  RETURN QUERY SELECT v_updated, v_pending;
END;
$$;

GRANT EXECUTE ON FUNCTION reconcile_prestige_scores()
  TO anon, authenticated, service_role;

-- ── 4. Drop old Spotify-bridge RPC (replaced by reconcile) ───────────────────

DROP FUNCTION IF EXISTS get_external_prestige_scores(text[], text, text);

-- ── 5. Rebuild get_silla_leaderboard ──────────────────────────────────────────
-- Reads prestige_score directly from release_groups — no multi-hop join.
-- p_genre  filters by release_groups.genres (unchanged).
-- p_country filters by artists.country (album appears in country view if its
--            primary artist's country matches — not a prestige-scope filter).

CREATE OR REPLACE FUNCTION get_silla_leaderboard(
  p_genre    text DEFAULT NULL,
  p_country  text DEFAULT NULL,
  p_limit    int  DEFAULT 50,
  p_offset   int  DEFAULT 0
)
RETURNS TABLE (
  release_id     uuid,
  spotify_id     text,
  title          text,
  artist         text,
  cover_url      text,
  release_date   text,
  silla_score    float8,
  rating_norm    float8,
  prestige_score float8,
  rating_count   bigint,
  source_count   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    -- Calibrated per-user ratings
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c
      FROM ratings WHERE score IS NOT NULL
    ),
    user_stats AS (
      SELECT user_id, AVG(score) AS mean_score, STDDEV(score) AS vol, COUNT(*) AS n
      FROM ratings WHERE score IS NOT NULL
      GROUP BY user_id
    ),
    calibrated AS (
      SELECT
        r.release_group_id,
        CASE
          WHEN us.n >= 5 AND COALESCE(us.vol, 0) >= 0.1
          THEN LEAST(GREATEST(
                 2.75 + LEAST(GREATEST(
                   (r.score - us.mean_score) / GREATEST(COALESCE(us.vol, 0.3), 0.3),
                   -2.5), 2.5) * 0.75,
                 0.5), 5.0)
          ELSE r.score
        END AS cal_score
      FROM ratings r
      JOIN release_groups rg ON rg.id = r.release_group_id
      LEFT JOIN user_stats us ON us.user_id = r.user_id
      WHERE r.score IS NOT NULL
        AND (p_genre   IS NULL OR _rg_has_genre(rg.genres, p_genre))
        AND (p_country IS NULL OR rg.primary_artist_id IN (
               SELECT id FROM artists WHERE country = upper(p_country)
             ))
    ),
    rating_agg AS (
      SELECT
        release_group_id,
        (COUNT(*)::float8 / (COUNT(*) + 3)) * AVG(cal_score)
          + (3.0 / (COUNT(*) + 3)) * (SELECT c FROM global_mean) AS bayesian_score,
        COUNT(*)::bigint AS rating_count
      FROM calibrated
      GROUP BY release_group_id
    ),
    scored AS (
      SELECT
        rg.id                                               AS rg_id,
        rg.prestige_score                                   AS p_score,
        rg.mb_release_group_id                              AS mb_rg_id,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                                                 AS r_norm,
        COALESCE(ra.rating_count, 0)                       AS rating_count,
        CASE
          WHEN ra.bayesian_score IS NULL AND rg.prestige_score IS NULL THEN NULL
          WHEN ra.bayesian_score IS NULL THEN rg.prestige_score
          WHEN rg.prestige_score  IS NULL THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE 0.55 * ((ra.bayesian_score - 0.5) / 4.5) + 0.45 * rg.prestige_score
        END                                                 AS silla
      FROM release_groups rg
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      WHERE (rg.prestige_score IS NOT NULL OR ra.release_group_id IS NOT NULL)
        AND (p_genre   IS NULL OR _rg_has_genre(rg.genres, p_genre))
        AND (p_country IS NULL OR rg.primary_artist_id IN (
               SELECT id FROM artists WHERE country = upper(p_country)
             ))
    )
  SELECT
    rg.id,
    (SELECT rel.spotify_id FROM releases rel
     WHERE rel.release_group_id = rg.id
       AND rel.is_canonical = true
     LIMIT 1)                                         AS spotify_id,
    rg.title,
    rg.artist_display                                 AS artist,
    rg.cover_url,
    rg.first_release_date::text                       AS release_date,
    LEAST(GREATEST(COALESCE(s.silla, 0), 0), 1)      AS silla_score,
    s.r_norm                                          AS rating_norm,
    s.p_score                                         AS prestige_score,
    s.rating_count,
    COALESCE((
      SELECT COUNT(*)::int FROM external_scores es
      WHERE es.mb_release_group_id = s.mb_rg_id
        AND s.mb_rg_id IS NOT NULL
    ), 0)                                             AS source_count
  FROM scored s
  JOIN release_groups rg ON rg.id = s.rg_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_silla_leaderboard(text, text, int, int)
  TO anon, authenticated, service_role;
