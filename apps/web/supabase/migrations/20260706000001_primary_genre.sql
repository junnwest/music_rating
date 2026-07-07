-- Primary-genre hierarchy for genre charts (2026-07-06).
--
-- WHY: release_groups.genres is a flat multi-tag array and the genre charts filter by MEMBERSHIP
-- (_rg_has_genre), so a k-pop album tagged [k-pop, hip hop, pop] appears in the Hip-Hop, Pop AND
-- K-Pop charts at once. Measured: ~60% of k-pop albums carry a generic style co-tag. Per the
-- 2026-07-06 decision (scene-first), each album gets ONE primary_genre chosen by a scene-first
-- precedence (national scenes outrank cross-cutting styles), and the genre charts match p_genre
-- against primary_genre only — so idol/scene content stops polluting the Western/global style charts.
--
-- primary_genre is a clean canonical STRING chosen to substring-match the existing client slugs
-- (k-pop / hip-hop / rock / electronic / indie / r&b), so the RPC signatures are unchanged and NO
-- iOS/web change is needed. Populated by scripts/backfill-primary-genre.ts.
--
-- Transition-safe: _rg_primary_matches falls back to the old whole-array behavior while
-- primary_genre IS NULL (i.e. before/while the backfill runs), so charts never go empty.
--
-- The 4 chart function bodies below are reproduced VERBATIM from their live definitions
-- (pg_get_functiondef, 2026-07-06 — incl. native_title / artist_native / release_group_type, which
-- were added via the SQL editor and never committed to a migration file) with ONLY the genre-filter
-- predicate swapped from _rg_has_genre(rg.genres, …) to _rg_primary_matches(rg.primary_genre, …).
--
-- NOTE: get_silla_leaderboard genre-filters the same way and has the same leak; its live body wasn't
-- provided here, so its one-line swap is a separate follow-up.

ALTER TABLE release_groups ADD COLUMN IF NOT EXISTS primary_genre text;

-- Match p_slug against the album's PRIMARY genre; fall back to the full array until backfilled.
CREATE OR REPLACE FUNCTION _rg_primary_matches(p_primary text, p_genres text[], p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_primary IS NOT NULL THEN _rg_has_genre(ARRAY[p_primary], p_slug)
    ELSE _rg_has_genre(p_genres, p_slug)
  END;
$$;

-- ── get_charts_top_rated ──
CREATE OR REPLACE FUNCTION public.get_charts_top_rated(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text, p_year_start integer DEFAULT NULL::integer, p_year_end integer DEFAULT NULL::integer)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_primary_matches(rg.primary_genre, rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) >= 3
  -- Bayesian average: (C·μ + Σscore) / (C + n), C=8, μ=2.75
  ORDER BY (8 * 2.75 + SUM(rt.score)) / (8 + COUNT(rt.id)) DESC, COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;

-- ── get_charts_most_rated ──
CREATE OR REPLACE FUNCTION public.get_charts_most_rated(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text, p_year_start integer DEFAULT NULL::integer, p_year_end integer DEFAULT NULL::integer)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score) FILTER (WHERE rt.score IS NOT NULL)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE (p_genre IS NULL OR _rg_primary_matches(rg.primary_genre, rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;

-- ── get_charts_hidden_gems ──
CREATE OR REPLACE FUNCTION public.get_charts_hidden_gems(p_limit integer DEFAULT 20, p_genre text DEFAULT NULL::text)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_primary_matches(rg.primary_genre, rg.genres, p_genre))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  HAVING COUNT(rt.id) BETWEEN 3 AND 9 AND AVG(rt.score) >= 4.0
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$function$;

-- ── get_charts_trending_for_genres ──
CREATE OR REPLACE FUNCTION public.get_charts_trending_for_genres(p_genres text[], p_limit integer DEFAULT 10)
 RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint, native_title text, artist_native text, release_group_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id),
         rg.native_title, a.name_native, rg.release_group_type
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.created_at > now() - interval '7 days'
    AND EXISTS (SELECT 1 FROM unnest(p_genres) gg WHERE _rg_primary_matches(rg.primary_genre, rg.genres, gg))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native, rg.release_group_type
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$function$;
