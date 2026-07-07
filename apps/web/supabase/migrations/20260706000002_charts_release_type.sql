-- Add release_group_type to every Charts/Rankings RPC.
--
-- Why: none of these RPCs ever selected release_group_type, so every row
-- decoded on iOS with releaseType = nil (RankingsView.swift's ChartEntry/
-- ChartSongEntry have no slot for it at all -- asRelease hardcodes nil).
-- Release.typeLabel's default case falls through to the localized generic
-- word "Release" when releaseType is nil, which renders as "릴리스" in
-- Korean -- so every album reached via any Charts/Rankings section (and any
-- album opened by tapping through a song chart entry) showed that instead
-- of "Album"/"EP"/"Single". Not a real album-type value; a data-plumbing gap.
--
-- Bodies below are copied from each function's current live definition
-- (get_charts_top_rated: 20260705000005 Bayesian version; the rest:
-- 20260703000004; get_silla_leaderboard: 20260703000004's dynamic-prestige-
-- weighted version) with only release_group_type added to the SELECT list,
-- GROUP BY, and RETURNS TABLE. Changing RETURNS TABLE columns requires DROP
-- FUNCTION first. Safe to re-run.

-- ── Album charts ──────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_charts_top_rated(int, text, int, int);
CREATE FUNCTION get_charts_top_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text, release_group_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) >= 3
  -- Bayesian average: (C·μ + Σscore) / (C + n), C=8, μ=2.75
  ORDER BY (8 * 2.75 + SUM(rt.score)) / (8 + COUNT(rt.id)) DESC, COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_most_rated(int, text, int, int);
CREATE FUNCTION get_charts_most_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text, release_group_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score) FILTER (WHERE rt.score IS NOT NULL)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_trending(int);
CREATE FUNCTION get_charts_trending(p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint,
              native_title text, artist_native text, release_group_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.created_at > now() - interval '7 days'
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_trending_for_genres(text[], int);
CREATE FUNCTION get_charts_trending_for_genres(p_genres text[], p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint,
              native_title text, artist_native text, release_group_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.created_at > now() - interval '7 days'
    AND EXISTS (SELECT 1 FROM unnest(p_genres) gg WHERE _rg_has_genre(rg.genres, gg))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_hidden_gems(int, text);
CREATE FUNCTION get_charts_hidden_gems(p_limit int DEFAULT 20, p_genre text DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text, release_group_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_has_genre(rg.genres, p_genre))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) BETWEEN 3 AND 9 AND AVG(rt.score) >= 4.0
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_controversial(int);
CREATE FUNCTION get_charts_controversial(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text, release_group_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) >= 5
  ORDER BY STDDEV(rt.score) DESC NULLS LAST
  LIMIT p_limit;
$$;

-- ── Song charts (release_group_type describes the containing ALBUM, not the
--    song itself -- exposed as album_release_type to avoid implying songs
--    have their own type) ────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_charts_top_rated_songs(int);
CREATE FUNCTION get_charts_top_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, avg_score numeric, rating_count bigint,
              album_title_native text, artist_native text, album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.avg_score DESC, s.rating_count DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_most_rated_songs(int);
CREATE FUNCTION get_charts_most_rated_songs(p_limit int DEFAULT 20)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, avg_score numeric, rating_count bigint,
              album_title_native text, artist_native text, album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, ROUND(AVG(score)::numeric, 2) AS avg_score, COUNT(*) AS rating_count
    FROM track_ratings WHERE score IS NOT NULL GROUP BY recording_id
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.avg_score, s.rating_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.rating_count DESC
  LIMIT p_limit;
$$;

DROP FUNCTION IF EXISTS get_charts_trending_songs(int);
CREATE FUNCTION get_charts_trending_songs(p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, track_position int, track_title text, artist text, album_title text,
              cover_url text, new_count bigint, album_title_native text, artist_native text,
              album_release_type text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH stats AS (
    SELECT recording_id, COUNT(*) AS new_count
    FROM track_ratings WHERE created_at > now() - interval '7 days' GROUP BY recording_id
  ), loc AS (
    SELECT DISTINCT ON (rtk.recording_id) rtk.recording_id, rtk.position, rel.release_group_id
    FROM release_tracks rtk JOIN releases rel ON rel.id = rtk.release_id
    ORDER BY rtk.recording_id, rel.is_canonical DESC NULLS LAST
  )
  SELECT rg.id, loc.position, rec.title, rec.artist_display, rg.title, rg.cover_url,
         s.new_count, rg.native_title, a.name_native, rg.release_group_type
  FROM stats s
  JOIN recordings rec ON rec.id = s.recording_id
  JOIN loc ON loc.recording_id = s.recording_id
  JOIN release_groups rg ON rg.id = loc.release_group_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  ORDER BY s.new_count DESC
  LIMIT p_limit;
$$;

-- ── Silla leaderboard ───────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_silla_leaderboard(text, text, int, int);
CREATE FUNCTION get_silla_leaderboard(
  p_genre   text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_limit   int  DEFAULT 50,
  p_offset  int  DEFAULT 0
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
  source_count   int,
  native_title   text,
  artist_native  text,
  release_group_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
    global_mean AS (
      SELECT COALESCE(AVG(score), 2.75) AS c FROM ratings WHERE score IS NOT NULL
    ),
    user_stats AS (
      SELECT user_id, AVG(score) AS mean_score, STDDEV(score) AS vol, COUNT(*) AS n
      FROM ratings WHERE score IS NOT NULL GROUP BY user_id
    ),
    calibrated AS (
      SELECT
        r.release_group_id,
        CASE
          WHEN us.n >= 5 AND COALESCE(us.vol, 0) >= 0.1
          THEN LEAST(GREATEST(
                 2.75 + LEAST(GREATEST(
                   (r.score - us.mean_score) / GREATEST(COALESCE(us.vol, 0.3), 0.3),
                   -2.5), 2.5) * 0.75, 0.5), 5.0)
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
      FROM calibrated GROUP BY release_group_id
    ),
    global_prestige AS (
      SELECT
        mb_release_group_id,
        LEAST(
          GREATEST(
            SUM(tier_max * CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END)
              / NULLIF(SUM(CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END), 0)
              * (1.0 + 0.04 * LEAST(SUM(tier_src_count) - 1, 4)::float8),
            MAX(tier_max)
          ),
          0.95
        ) AS prestige
      FROM (
        SELECT
          mb_release_group_id,
          source_tier,
          MAX(normalized_score)  AS tier_max,
          COUNT(DISTINCT source) AS tier_src_count
        FROM external_scores
        WHERE mb_release_group_id IS NOT NULL
          AND scope_country IS NULL
        GROUP BY mb_release_group_id, source_tier
      ) g
      GROUP BY mb_release_group_id
    ),
    all_prestige AS (
      SELECT
        mb_release_group_id,
        LEAST(
          GREATEST(
            SUM(tier_max * CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END)
              / NULLIF(SUM(CASE source_tier WHEN 1 THEN 0.45 WHEN 2 THEN 0.30 ELSE 0.25 END), 0)
              * (1.0 + 0.04 * LEAST(SUM(tier_src_count) - 1, 4)::float8),
            MAX(tier_max)
          ),
          0.95
        ) AS prestige
      FROM (
        SELECT
          mb_release_group_id,
          source_tier,
          MAX(normalized_score)  AS tier_max,
          COUNT(DISTINCT source) AS tier_src_count
        FROM external_scores
        WHERE mb_release_group_id IS NOT NULL
        GROUP BY mb_release_group_id, source_tier
      ) g
      GROUP BY mb_release_group_id
    ),
    scored AS (
      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        CASE WHEN p_country IS NULL THEN gp.prestige ELSE ap.prestige END AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE WHEN p_country IS NULL THEN
          CASE
            WHEN ra.bayesian_score IS NULL THEN
              gp.prestige
            ELSE
              (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
                * gp.prestige
              + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
                * ((ra.bayesian_score - 0.5) / 4.5)
          END
        ELSE
          CASE
            WHEN ra.bayesian_score IS NULL THEN
              ap.prestige
            ELSE
              (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
                * ap.prestige
              + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
                * ((ra.bayesian_score - 0.5) / 4.5)
          END
        END                      AS silla
      FROM release_groups rg
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN global_prestige gp ON gp.mb_release_group_id = rg.mb_release_group_id
      LEFT JOIN all_prestige    ap ON ap.mb_release_group_id = rg.mb_release_group_id
      WHERE (
          (p_country IS NULL     AND gp.prestige IS NOT NULL)
          OR
          (p_country IS NOT NULL AND ap.prestige IS NOT NULL)
        )
        AND (p_genre   IS NULL OR _rg_has_genre(rg.genres, p_genre))
        AND (p_country IS NULL OR rg.primary_artist_id IN (
               SELECT id FROM artists WHERE country = upper(p_country)
             ))
    )
  SELECT
    rg.id,
    (SELECT rel.spotify_id FROM releases rel
     WHERE rel.release_group_id = rg.id AND rel.is_canonical = true LIMIT 1) AS spotify_id,
    rg.title,
    rg.artist_display                                AS artist,
    rg.cover_url,
    rg.first_release_date::text                      AS release_date,
    LEAST(GREATEST(COALESCE(s.silla, 0), 0), 1)     AS silla_score,
    s.r_norm                                         AS rating_norm,
    s.p_score                                        AS prestige_score,
    s.rating_count,
    COALESCE((
      SELECT COUNT(*)::int FROM external_scores es
      WHERE es.mb_release_group_id = s.mb_rg_id AND s.mb_rg_id IS NOT NULL
    ), 0)                                            AS source_count,
    rg.native_title,
    a.name_native                                    AS artist_native,
    rg.release_group_type
  FROM scored s
  JOIN release_groups rg ON rg.id = s.rg_id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION get_charts_top_rated(int, text, int, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_most_rated(int, text, int, int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_trending(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_trending_for_genres(text[], int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_hidden_gems(int, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_controversial(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_top_rated_songs(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_most_rated_songs(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_charts_trending_songs(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_silla_leaderboard(text, text, int, int) TO anon, authenticated, service_role;
