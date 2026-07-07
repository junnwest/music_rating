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
-- NOTE: get_silla_leaderboard also genre-filters via _rg_has_genre and has the SAME leak, but its
-- live definition (the 2026-07-05 durable timeout fix) was applied via the SQL editor and never
-- committed as a migration file — reproducing it here would regress that fix. It needs the same
-- one-line swap applied to its live body separately (follow-up).

ALTER TABLE release_groups ADD COLUMN IF NOT EXISTS primary_genre text;

-- Match p_slug against the album's PRIMARY genre; fall back to the full array until backfilled.
CREATE OR REPLACE FUNCTION _rg_primary_matches(p_primary text, p_genres text[], p_slug text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_primary IS NOT NULL THEN _rg_has_genre(ARRAY[p_primary], p_slug)
    ELSE _rg_has_genre(p_genres, p_slug)
  END;
$$;

-- ── genre charts: filter on primary_genre instead of the whole genres[] array ──
-- (bodies reproduced from their live definitions — 20260705000005 for top_rated, 20260626000002
--  for the rest — with ONLY the genre-filter predicate changed.)

CREATE OR REPLACE FUNCTION get_charts_top_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric,
              rating_count bigint, native_title text, artist_native text)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id),
         rg.native_title, a.name_native
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  LEFT JOIN artists a ON a.id = rg.primary_artist_id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_primary_matches(rg.primary_genre, rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url, rg.native_title, a.name_native
  HAVING COUNT(rt.id) >= 3
  ORDER BY (8 * 2.75 + SUM(rt.score)) / (8 + COUNT(rt.id)) DESC, COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION get_charts_most_rated(
  p_limit int DEFAULT 20, p_genre text DEFAULT NULL,
  p_year_start int DEFAULT NULL, p_year_end int DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score) FILTER (WHERE rt.score IS NOT NULL)::numeric, 2), COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE (p_genre IS NULL OR _rg_primary_matches(rg.primary_genre, rg.genres, p_genre))
    AND (p_year_start IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int >= p_year_start)
    AND (p_year_end   IS NULL OR NULLIF(LEFT(rg.first_release_date::text, 4), '')::int <= p_year_end)
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION get_charts_trending_for_genres(p_genres text[], p_limit int DEFAULT 10)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, new_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url, COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE rt.created_at > now() - interval '7 days'
    AND EXISTS (SELECT 1 FROM unnest(p_genres) gg WHERE _rg_primary_matches(rg.primary_genre, rg.genres, gg))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  ORDER BY COUNT(rt.id) DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION get_charts_hidden_gems(p_limit int DEFAULT 20, p_genre text DEFAULT NULL)
RETURNS TABLE(release_id uuid, title text, artist text, cover_url text, avg_score numeric, rating_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         ROUND(AVG(rt.score)::numeric, 2), COUNT(rt.id)
  FROM release_groups rg
  JOIN ratings rt ON rt.release_group_id = rg.id
  WHERE rt.score IS NOT NULL
    AND (p_genre IS NULL OR _rg_primary_matches(rg.primary_genre, rg.genres, p_genre))
  GROUP BY rg.id, rg.title, rg.artist_display, rg.cover_url
  HAVING COUNT(rt.id) BETWEEN 3 AND 9 AND AVG(rt.score) >= 4.0
  ORDER BY AVG(rt.score) DESC
  LIMIT p_limit;
$$;
