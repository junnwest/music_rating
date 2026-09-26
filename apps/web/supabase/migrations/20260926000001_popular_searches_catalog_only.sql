-- ================================================================
-- Popular Searches (인기 검색어): only artists and releases
-- 2026-09-26
-- ================================================================
-- search_query_log stores raw query text with no record of what it
-- matched, so the chips showed anything typed twice: usernames,
-- fragments ("uchicago", "john k"), titles we don't have. Now a query
-- only surfaces if its normalized form exactly names an artist (name,
-- native name, Korean phonetic name or alias) or a release group
-- (title or native title). The chip shows the catalog's own spelling
-- ("kid cudi'" → "Kid Cudi", "아카네리제" → "아카네 리제"), and
-- queries that land on the same name are merged.
--
-- Filtering at read time covers old app builds and past log rows with
-- no client change. Both clients read this through the cached
-- /api/search/popular route (cache key bumped there).
--
-- Btree indexes for the exact lookups: the existing trigram indexes
-- don't cover name_native/aliases, and trigram can't serve 2-character
-- names like "iu". Building them briefly blocks writes to these
-- tables (a few seconds on ~630k release groups).
--
-- Run in the Supabase SQL editor.
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_artists_name_norm_eq          ON artists (normalize_text(name));
CREATE INDEX IF NOT EXISTS idx_artists_name_native_norm_eq   ON artists (normalize_text(name_native));
CREATE INDEX IF NOT EXISTS idx_artists_phonetic_ko_norm_eq   ON artists (normalize_text(name_phonetic_ko));
CREATE INDEX IF NOT EXISTS idx_artist_aliases_alias_norm_eq  ON artist_aliases (normalize_text(alias));
CREATE INDEX IF NOT EXISTS idx_rg_title_norm_eq              ON release_groups (normalize_text(title));
CREATE INDEX IF NOT EXISTS idx_rg_native_title_norm_eq       ON release_groups (normalize_text(native_title));

CREATE OR REPLACE FUNCTION get_popular_searches(lim int DEFAULT 12, days int DEFAULT 7)
RETURNS TABLE (query text, search_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH recent AS (
    SELECT normalize_text(l.query) AS qn
    FROM search_query_log l
    WHERE l.searched_at > now() - (days || ' days')::interval
      AND length(l.query) <= 60
  ),
  grouped AS (
    SELECT r.qn, count(*) AS search_count
    FROM recent r
    WHERE r.qn <> '' AND length(r.qn) >= 2
    GROUP BY r.qn
    HAVING count(*) >= 2
    -- Enough headroom that dropping non-catalog queries still fills `lim`.
    ORDER BY count(*) DESC
    LIMIT lim * 5
  ),
  matched AS (
    SELECT g.search_count,
      COALESCE(
        (SELECT a.name FROM artists a
          WHERE normalize_text(a.name) = g.qn
          ORDER BY a.popularity DESC NULLS LAST LIMIT 1),
        (SELECT a.name_native FROM artists a
          WHERE normalize_text(a.name_native) = g.qn
          ORDER BY a.popularity DESC NULLS LAST LIMIT 1),
        (SELECT a.name_phonetic_ko FROM artists a
          WHERE normalize_text(a.name_phonetic_ko) = g.qn
          ORDER BY a.popularity DESC NULLS LAST LIMIT 1),
        (SELECT al.alias FROM artist_aliases al
          WHERE normalize_text(al.alias) = g.qn LIMIT 1),
        (SELECT rg.title FROM release_groups rg
          WHERE normalize_text(rg.title) = g.qn LIMIT 1),
        (SELECT rg.native_title FROM release_groups rg
          WHERE normalize_text(rg.native_title) = g.qn LIMIT 1)
      ) AS name
    FROM grouped g
  )
  SELECT min(m.name) AS query, sum(m.search_count)::bigint AS search_count
  FROM matched m
  WHERE m.name IS NOT NULL
  GROUP BY normalize_text(m.name)
  ORDER BY 2 DESC, 1 ASC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION get_popular_searches(int, int) TO anon, authenticated, service_role;
