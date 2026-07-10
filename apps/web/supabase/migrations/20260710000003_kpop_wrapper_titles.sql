-- K-pop wrapper-title normalization on the search query side (backlog follow-on
-- to 20260710000002's edition strip). iTunes/Spotify often present a K-pop
-- release as a wrapper string — "NewJeans 2nd EP 'Get Up'", "TAEYEON The 3rd
-- Album 'INVU'", "IU 5th Mini Album 'Love poem'" — while our catalog stores just
-- the quoted title ("Get Up", "INVU", "Love poem"). So the recently-played album
-- reads as "not in catalog".
--
-- Fix: extend strip_edition_decorations to FIRST extract the quoted title when the
-- string matches an "<ordinal> [mini/full/…] album|ep|single|mixtape '<title>'"
-- wrapper, THEN run the existing edition/version strip on the result (so e.g.
-- "…Album 'INVU (Deluxe)'" → "INVU (Deluxe)" → "INVU"). Query-side only, same as
-- 20260710000002 — no client change, no normalize_text/GIN reindex.
--
-- The wrapper pattern requires an ORDINAL (1st/2nd/3rd/…) + a release-type word +
-- a quoted segment, which is highly K-pop-specific — validated live against real
-- wrappers AND a control set ("good kid, m.A.A.d city", "1989", "21", "4 Your
-- Eyez Only", "2 Cool 4 Skool", "Nothin' On You", "Section.80") that all pass
-- through unchanged. NOTE: Postgres regex word boundary is \y (\b is backspace).

CREATE OR REPLACE FUNCTION strip_edition_decorations(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $func$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          -- STEP 0: K-pop wrapper — "<ordinal> [mini/…] album|ep|single 'TITLE'" → TITLE.
          CASE
            WHEN coalesce(t, '') ~* '[0-9]+(st|nd|rd|th)\s+(mini\s+|full\s+|studio\s+|the\s+|repackage\s+)*(album|ep|single|mixtape)\y[^''‘’"“”]*[''‘’"“”][^''‘’"“”]+[''‘’"“”]'
            THEN regexp_replace(t, '^.*[0-9]+(st|nd|rd|th)\s+(?:mini\s+|full\s+|studio\s+|the\s+|repackage\s+)*(?:album|ep|single|mixtape)\y[^''‘’"“”]*[''‘’"“”]([^''‘’"“”]+)[''‘’"“”].*$', '\2', 'i')
            ELSE coalesce(t, '')
          END,
          -- STEP 1: trailing parenthetical/bracket edition group.
          '\s*[\(\[][^\)\]]*(deluxe|edition|version|remaster|remastered|live|extended|acoustic|anniversary|remix|remixes|instrumental|expanded|bonus|special|reissue|explicit|clean|demo|sessions?|director''?s cut|mono|stereo|karaoke)[^\)\]]*[\)\]]\s*',
          '', 'gi'),
        -- STEP 2: trailing dash/colon edition clause.
        '\s*[-–—:]\s*(live\s*(from|at|album)|director''?s cut|.*(edition|version|remaster(ed)?|deluxe|remix|acoustic|expanded|reissue)).*$',
        '', 'i'),
      -- STEP 3: trailing "+ …" bundle.
      '\s*\+\s*(("|“|”).*|.*(collection|edition|version|acoustic|deluxe|remaster|track by track|behind the curtain).*)$',
      '', 'i')
  );
$func$;

GRANT EXECUTE ON FUNCTION strip_edition_decorations(text) TO anon, authenticated, service_role;
