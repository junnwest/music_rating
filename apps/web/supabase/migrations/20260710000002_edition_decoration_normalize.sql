-- Edition/version decoration normalization on the SEARCH QUERY side.
--
-- The 2026-07-10 coverage baseline found that ~all remaining album/EP "match-
-- bugs" were the same shape: the external platform (iTunes/Spotify) carries an
-- edition-decorated title for an album we DO have under its base title, e.g.
--   "SCARING THE HOES: DIRECTOR'S CUT"   vs catalog "SCARING THE HOES"
--   "The Life of a Showgirl (Track by Track Version)" vs "The Life of a Showgirl"
--   "Num-Heavymetallic (15th Anniversary Edition)"    vs "Num-Heavymetallic"
--   "The King of Limbs - Live from the Basement"      vs "The King of Limbs"
-- So a recently-played album silently reads as "not in catalog".
--
-- FIX: strip trailing edition/version decorations from the QUERY before matching,
-- inside search_release_groups. This is deliberately QUERY-SIDE only:
--   - It fixes the iOS taste flow (fetchRelease's fuzzy step-2 passes the raw
--     decorated title to this RPC, which now strips it), web search, and the
--     main search bar — with NO client change.
--   - It does NOT touch normalize_text(), so the functional GIN trigram indexes
--     built on normalize_text(title)/(artist_display) stay valid — no reindex.
--   - Catalog titles are base (release-GROUP granularity — deluxe/remaster/live
--     are editions under the same group), so stripping the query's decoration to
--     match the base group is the correct behavior, not a loss of precision.
--
-- The regex is intentionally conservative: it only strips a trailing paren/bracket
-- group, dash/colon clause, or "+ …" bundle that CONTAINS an edition keyword.
-- Validated against the real match-bug titles AND a legit-title control set
-- (2026-07-10): "Live Through This", "MTV Unplugged in New York", "Sound & Color",
-- "good kid, m.A.A.d city" etc. all pass through unchanged.
--
-- NOT covered here (separate, smaller passes): singles/compilations excluded by
-- the album/ep type filter (needs the exact-match client step), K-pop wrapper
-- titles ("NewJeans 2nd EP 'Get Up'"), and accent folding (Blase vs BLASÉ — needs
-- a normalize_text change + a GIN reindex maintenance window).

CREATE OR REPLACE FUNCTION strip_edition_decorations(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $func$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(t, ''),
          '\s*[\(\[][^\)\]]*(deluxe|edition|version|remaster|remastered|live|extended|acoustic|anniversary|remix|remixes|instrumental|expanded|bonus|special|reissue|explicit|clean|demo|sessions?|director''?s cut|mono|stereo|karaoke)[^\)\]]*[\)\]]\s*',
          '', 'gi'),
        '\s*[-–—:]\s*(live\s*(from|at|album)|director''?s cut|.*(edition|version|remaster(ed)?|deluxe|remix|acoustic|expanded|reissue)).*$',
        '', 'i'),
      '\s*\+\s*(("|“|”).*|.*(collection|edition|version|acoustic|deluxe|remaster|track by track|behind the curtain).*)$',
      '', 'i')
  );
$func$;

-- search_release_groups: strip the query before building the normalized/lowered
-- match keys. Body is otherwise identical to 20260710000001 (primary_artist_id +
-- artist_native projection preserved). Signature unchanged → CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION search_release_groups(
  q               text,
  lim             int          DEFAULT 30,
  yr              text         DEFAULT NULL,
  query_embedding vector(1024) DEFAULT NULL
)
RETURNS TABLE (
  id                 uuid,
  title              text,
  artist_display     text,
  cover_url          text,
  native_title       text,
  release_group_type text,
  first_release_date text,
  artist_native      text,
  primary_artist_id  uuid
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (
    SELECT normalize_text(strip_edition_decorations(q)) AS qn,
           lower(btrim(strip_edition_decorations(q)))    AS ql
  )
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text,
         a.name_native, rg.primary_artist_id
  FROM release_groups rg
  LEFT JOIN artists a ON a.id = rg.primary_artist_id, nq
  WHERE rg.release_group_type IN ('album', 'ep')
    AND nq.qn <> ''
    AND (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
    AND (
         normalize_text(rg.title)          LIKE '%' || nq.qn || '%'
      OR normalize_text(rg.artist_display) LIKE '%' || nq.qn || '%'
      OR normalize_text(rg.native_title)   LIKE '%' || nq.qn || '%'
      OR nq.ql <% lower(rg.title)
      OR nq.ql <% lower(rg.artist_display)
    )
  ORDER BY (
      CASE WHEN normalize_text(rg.title) = nq.qn
             OR normalize_text(rg.artist_display) = nq.qn THEN 10000 ELSE 0 END
    + CASE WHEN normalize_text(rg.title)          LIKE nq.qn || '%' THEN 500
           WHEN normalize_text(rg.artist_display) LIKE nq.qn || '%' THEN 400 ELSE 0 END
    + GREATEST(
        word_similarity(nq.ql, lower(rg.title)),
        word_similarity(nq.ql, lower(rg.artist_display))
      ) * 1000
    + coalesce(rg.prestige_score, 0) * 2
    + CASE WHEN query_embedding IS NOT NULL AND rg.embedding IS NOT NULL
           THEN (1.0 - (rg.embedding <=> query_embedding)) * 1500 ELSE 0 END
  ) DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION strip_edition_decorations(text)                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION search_release_groups(text, int, text, vector) TO anon, authenticated, service_role;
