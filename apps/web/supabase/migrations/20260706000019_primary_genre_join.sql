-- Move primary_genre off release_groups into a join table (2026-07-07).
--
-- WHY: release_groups has an HNSW vector index (embedding) + 7 GIN trigram indexes, so ANY UPDATE
-- to it — even the unindexed primary_genre column — rewrites the row and maintains all 13 indexes.
-- On this instance a 400-row UPDATE times out at 120s (the HNSW graph maintenance alone; even
-- rebuilding that index has timed out here historically). So the primary_genre COLUMN on
-- release_groups (20260706000001/2) is unfillable. Fix: a lightweight side table rg_primary_genre
-- (created + populated separately — a 3,644-row INSERT ran in 6.5s vs the 400-row UPDATE timing out),
-- and the 5 genre-filtered RPCs read primary_genre from it via a LEFT JOIN instead of rg.primary_genre.
--
-- rg_primary_genre is populated for the CHART-ELIGIBLE set (rated OR prestige albums) — the only
-- albums that can appear in a genre-filtered chart (the RPCs JOIN ratings / read prestige_score).
-- _rg_primary_matches falls back to whole-array membership when the value is NULL, so anything not
-- yet populated degrades gracefully to the old behavior. (Durability follow-up: populate a newly
-- rated album's row on first rating — trigger or app-side — so the set stays complete post-launch.)
--
-- The release_groups.primary_genre column (20260706000001) is now dead; left in place (unused) to
-- avoid an expensive DROP COLUMN rewrite on the indexed table.

-- ── get_charts_top_rated ──
CREATE OR REPLACE FUNCTION public.get_charts_top_rated(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text, p_year_start integer DEFAULT NULL::integer, p_year_end integer DEFAULT NULL::integer)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) >= 3
  ORDER BY (8 * 2.75 + SUM(rt.score)) / (8 + COUNT(rt.id)) DESC, COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;

-- ── get_charts_most_rated ──
CREATE OR REPLACE FUNCTION public.get_charts_most_rated(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text, p_year_start integer DEFAULT NULL::integer, p_year_end integer DEFAULT NULL::integer)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score) FILTER (WHERE rt.score IS NOT NULL)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
  WHERE (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;

-- ── get_charts_hidden_gems ──
CREATE OR REPLACE FUNCTION public.get_charts_hidden_gems(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) BETWEEN 3 AND 9 AND AVG(rt.score) >= 4.0
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$function$;

-- ── get_charts_trending_for_genres ──
CREATE OR REPLACE FUNCTION public.get_charts_trending_for_genres(p_genres text[], p_limit integer DEFAULT 10)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
  WHERE rt.created_at > now() - interval '7 days'
    AND EXISTS (SELECT 1 FROM unnest(p_genres) gg WHERE _rg_primary_matches(pg.primary_genre, rg.genres, gg))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;

-- ── get_silla_leaderboard (3 genre-filter blocks, each gets the join) ──
CREATE OR REPLACE FUNCTION public.get_silla_leaderboard(p_genre text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(release_id uuid, spotify_id text, title text, artist text, cover_url text, release_date text, silla_score double precision, rating_norm double precision, prestige_score double precision, rating_count bigint, source_count integer, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET enable_nestloop TO 'off'
AS $function$
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
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE r.score IS NOT NULL
        AND (p_genre   IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
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
        rg.title,
        rg.artist_display,
        rg.cover_url,
        rg.first_release_date,
        rg.native_title,
        rg.primary_artist_id,
        rg.release_group_type,
        rg.prestige_score        AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE
          WHEN ra.bayesian_score IS NULL THEN
            rg.prestige_score
          ELSE
            (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
              * rg.prestige_score
            + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
              * ((ra.bayesian_score - 0.5) / 4.5)
        END                      AS silla
      FROM release_groups rg
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE p_country IS NULL
        AND rg.prestige_score IS NOT NULL
        AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))

      UNION ALL

      SELECT
        rg.id                    AS rg_id,
        rg.mb_release_group_id   AS mb_rg_id,
        rg.title,
        rg.artist_display,
        rg.cover_url,
        rg.first_release_date,
        rg.native_title,
        rg.primary_artist_id,
        rg.release_group_type,
        ap.prestige              AS p_score,
        CASE WHEN ra.bayesian_score IS NOT NULL
          THEN (ra.bayesian_score - 0.5) / 4.5
          ELSE NULL
        END                      AS r_norm,
        COALESCE(ra.rating_count, 0) AS rating_count,
        CASE
          WHEN ra.bayesian_score IS NULL THEN
            ap.prestige
          ELSE
            (1.0 - LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55))
              * ap.prestige
            + LEAST(0.55 * ra.rating_count::float8 / (ra.rating_count + 50.0), 0.55)
              * ((ra.bayesian_score - 0.5) / 4.5)
        END                      AS silla
      FROM all_prestige ap
      JOIN release_groups rg ON rg.mb_release_group_id = ap.mb_release_group_id
      LEFT JOIN rating_agg ra ON ra.release_group_id = rg.id
      LEFT JOIN rg_primary_genre pg ON pg.release_group_id = rg.id
      WHERE p_country IS NOT NULL
        AND rg.primary_artist_id IN (
              SELECT id FROM artists WHERE country = upper(p_country)
            )
        AND (p_genre IS NULL OR _rg_primary_matches(pg.primary_genre, rg.genres, p_genre))
    )
  SELECT
    s.rg_id,
    (SELECT rel.spotify_id FROM releases rel
     WHERE rel.release_group_id = s.rg_id AND rel.is_canonical = true LIMIT 1) AS spotify_id,
    s.title,
    s.artist_display                                 AS artist,
    s.cover_url,
    s.first_release_date::text                       AS release_date,
    LEAST(GREATEST(COALESCE(s.silla, 0), 0), 1)     AS silla_score,
    s.r_norm                                         AS rating_norm,
    s.p_score                                        AS prestige_score,
    s.rating_count,
    COALESCE((
      SELECT COUNT(*)::int FROM external_scores es
      WHERE es.mb_release_group_id = s.mb_rg_id AND s.mb_rg_id IS NOT NULL
    ), 0)                                            AS source_count,
    s.native_title,
    a.name_native                                    AS artist_native,
    s.release_group_type
  FROM scored s
  LEFT JOIN artists a ON a.id = s.primary_artist_id
  WHERE s.silla IS NOT NULL
  ORDER BY silla_score DESC
  LIMIT  p_limit
  OFFSET p_offset;
$function$;
