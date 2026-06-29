-- get_silla_leaderboard: combined internal + external Silla Score ranking.
--
-- Post-renovation schema:
--   ratings.release_group_id  uuid → release_groups.id
--   external_scores.release_id text (Spotify ID) → releases.spotify_id
--                                                 → releases.release_group_id
--                                                 → release_groups.id
--   Metadata lives on release_groups (title, artist_display, cover_url, genres text[])
--
-- Formula:
--   rating_norm    = (bayesian_score - 0.5) / 4.5          → [0, 1]
--   prestige       = tier-weighted external score           → [0, 1]
--
--   silla_score =
--     prestige IS NULL  → rating_norm             (rating-only; α=1.0)
--     rating IS NULL    → prestige                (prestige-only; no ratings yet)
--     both present      → 0.55 × rating_norm + 0.45 × prestige
--
-- Filters:
--   p_genre    — uses _rg_has_genre(rg.genres, p_genre) + external_scores.scope_genre
--   p_country  — only affects which prestige sources fire (scope_country)

CREATE OR REPLACE FUNCTION get_silla_leaderboard(
  p_genre    text DEFAULT NULL,
  p_country  text DEFAULT NULL,
  p_limit    int  DEFAULT 50,
  p_offset   int  DEFAULT 0
)
RETURNS TABLE (
  release_id     uuid,    -- = release_groups.id (aliased for iOS compat)
  spotify_id     text,
  title          text,
  artist         text,
  cover_url      text,
  release_date   text,
  silla_score    float8,
  rating_norm    float8,   -- internal rating [0,1]
  prestige_score float8,   -- external prestige [0,1], null if no sources
  rating_count   bigint,
  source_count   int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH

    -- ── 1. Candidate release_groups ──────────────────────────────────────────
    prestige_candidates AS (
      SELECT DISTINCT rel.release_group_id
      FROM external_scores es
      JOIN releases rel ON rel.spotify_id = es.release_id
      WHERE rel.release_group_id IS NOT NULL
        AND (es.scope_genre   IS NULL OR es.scope_genre   = p_genre)
        AND (es.scope_country IS NULL OR es.scope_country = p_country)
    ),
    rating_candidates AS (
      SELECT DISTINCT ra.release_group_id
      FROM ratings ra
      JOIN release_groups rg ON rg.id = ra.release_group_id
      WHERE ra.score IS NOT NULL
        AND ra.release_group_id IS NOT NULL
        AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
    ),
    candidates AS (
      SELECT release_group_id FROM prestige_candidates
      UNION
      SELECT release_group_id FROM rating_candidates
    ),

    -- ── 2. Bayesian rating score ─────────────────────────────────────────────
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c
      FROM ratings
      WHERE score IS NOT NULL
    ),
    user_stats AS (
      SELECT user_id,
             AVG(score)    AS mean_score,
             STDDEV(score) AS vol,
             COUNT(*)      AS n
      FROM ratings
      WHERE score IS NOT NULL
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
      JOIN candidates c ON c.release_group_id = r.release_group_id
      LEFT JOIN user_stats us ON us.user_id = r.user_id
      WHERE r.score IS NOT NULL
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

    -- ── 3. External prestige scores ──────────────────────────────────────────
    prestige_by_tier AS (
      SELECT
        rel.release_group_id,
        es.source_tier,
        CASE es.source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END AS tier_weight,
        AVG(es.normalized_score) AS tier_avg,
        COUNT(*)::int             AS tier_count
      FROM external_scores es
      JOIN releases rel ON rel.spotify_id = es.release_id
      JOIN candidates c ON c.release_group_id = rel.release_group_id
      WHERE rel.release_group_id IS NOT NULL
        AND (es.scope_genre   IS NULL OR es.scope_genre   = p_genre)
        AND (es.scope_country IS NULL OR es.scope_country = p_country)
      GROUP BY rel.release_group_id, es.source_tier
    ),
    prestige_agg AS (
      SELECT
        release_group_id,
        SUM(tier_avg * tier_weight) / NULLIF(SUM(tier_weight), 0) AS prestige,
        SUM(tier_count)::int AS source_count
      FROM prestige_by_tier
      GROUP BY release_group_id
    ),

    -- ── 4. Combine ───────────────────────────────────────────────────────────
    scored AS (
      SELECT
        c.release_group_id,
        COALESCE(ra.rating_count, 0) AS rating_count,
        COALESCE(pa.source_count, 0) AS source_count,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END AS r_norm,
        pa.prestige AS p_score,
        CASE
          WHEN ra.bayesian_score IS NULL AND pa.prestige IS NULL THEN NULL
          WHEN ra.bayesian_score IS NULL THEN pa.prestige
          WHEN pa.prestige       IS NULL THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE 0.55 * ((ra.bayesian_score - 0.5) / 4.5) + 0.45 * pa.prestige
        END AS silla
      FROM candidates c
      LEFT JOIN rating_agg   ra ON ra.release_group_id = c.release_group_id
      LEFT JOIN prestige_agg pa ON pa.release_group_id = c.release_group_id
    )

  SELECT
    rg.id                                         AS release_id,
    (SELECT spotify_id FROM releases
     WHERE release_group_id = rg.id
       AND is_canonical = true
     LIMIT 1)                                     AS spotify_id,
    rg.title,
    rg.artist_display                             AS artist,
    rg.cover_url,
    rg.first_release_date::text                   AS release_date,
    LEAST(GREATEST(COALESCE(s.silla, 0), 0), 1)  AS silla_score,
    s.r_norm                                      AS rating_norm,
    s.p_score                                     AS prestige_score,
    s.rating_count,
    s.source_count
  FROM scored s
  JOIN release_groups rg ON rg.id = s.release_group_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_silla_leaderboard(text, text, int, int)
  TO anon, authenticated, service_role;
