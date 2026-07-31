-- Hide zero-release artists from artist search.
--
-- WHY: the `area` discovery lane (added 2026-07-17) sweeps MusicBrainz for every `country:KR` /
-- `area:<city>` ARTIST ENTITY and queues them all by MBID. MB artist entities exist independently
-- of releases — anyone can create one to hang a credit, a URL relationship, or a standalone
-- recording on. Our ingest walks release-groups → releases → recordings, so an entity with zero
-- release-groups writes nothing, yet mb-ingest still marks it `tracks_done`. Result: 8,973 artists
-- (13.3% of the catalog; 7,662 of them KR = 61.7% of all KR artists) are searchable, land on an
-- artist page with nothing on it, and are indistinguishable from a real artist until you click.
-- Reported by a user finding "Skyminhyuk" (a real act with 25 albums on iTunes, 0 releases in MB).
--
-- WHAT: search_artists now requires at least one release the artist page could actually render.
-- The "has releases" test mirrors `get_artist_release_groups` exactly — primary_artist_id UNION
-- release_group_artists — so search can never return an artist whose page renders empty. Filtering
-- on primary_artist_id alone would wrongly hide 36,022 credits-only artists whose pages DO render.
--
-- Both EXISTS probes are index-backed (idx_release_groups_artist, idx_rga_artist) and short-circuit
-- on the first hit, so this is cheap despite running before the LIMIT.
--
-- NOT a data fix: the rows stay, keep `tracks_done`, and keep their `next_check_at`, so the
-- FRESHNESS lane goes on re-polling them and they reappear in search by themselves the moment
-- MusicBrainz catalogs a release. This only stops us showing a dead end in the meantime.
--
-- Signature is unchanged (same RETURNS TABLE), so no web/iOS client changes are needed.

CREATE OR REPLACE FUNCTION search_artists(q text, lim int DEFAULT 10)
RETURNS TABLE (
  id            uuid,
  name          text,
  name_native   text,
  genres        text,
  popularity    int,
  cover_url     text,
  release_count bigint,
  aliases       text[]
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT a.id, a.name, a.name_native, a.genres, a.popularity, a.cover_url,
         (SELECT count(*) FROM release_groups rg WHERE rg.primary_artist_id = a.id) AS release_count,
         ARRAY(SELECT al.alias FROM artist_aliases al WHERE al.artist_id = a.id LIMIT 25) AS aliases
  FROM artists a, nq
  WHERE nq.qn <> ''
    -- Must have something to show: mirrors get_artist_release_groups' primary UNION credited.
    AND (
         EXISTS (SELECT 1 FROM release_groups rg WHERE rg.primary_artist_id = a.id)
      OR EXISTS (SELECT 1 FROM release_group_artists rga WHERE rga.artist_id = a.id)
    )
    AND (
         normalize_text(a.name)                          LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(a.name_native, ''))     LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(a.name_phonetic_ko, '')) LIKE '%' || nq.qn || '%'
      OR EXISTS (
           SELECT 1 FROM artist_aliases al
           WHERE al.artist_id = a.id
             AND normalize_text(al.alias) LIKE '%' || nq.qn || '%'
         )
      OR word_similarity(nq.ql, lower(a.name)) > 0.5
    )
  ORDER BY (
      CASE WHEN normalize_text(a.name) = nq.qn
             OR normalize_text(coalesce(a.name_native, '')) = nq.qn
             OR normalize_text(coalesce(a.name_phonetic_ko, '')) = nq.qn
             OR EXISTS (
                  SELECT 1 FROM artist_aliases al
                  WHERE al.artist_id = a.id AND normalize_text(al.alias) = nq.qn
                ) THEN 10000 ELSE 0 END
    + CASE WHEN normalize_text(a.name) LIKE nq.qn || '%' THEN 500 ELSE 0 END
    + CASE WHEN normalize_text(coalesce(a.name_phonetic_ko, '')) LIKE nq.qn || '%' THEN 400 ELSE 0 END
    + GREATEST(
        word_similarity(nq.ql, lower(a.name)),
        coalesce(word_similarity(nq.ql, lower(a.name_native)), 0)
      ) * 1000
    + coalesce(a.popularity, 0)
  ) DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_artists(text, int) TO anon, authenticated, service_role;

-- ── artists_with_releases: the same "has something to show" test, for the typeahead ──
-- /api/search/suggest queries `artists` directly (prefix pool + JS re-rank) rather than through
-- search_artists, so it needs its own filter. Doing that over PostgREST would mean selecting the
-- pool's release rows and de-duplicating client-side — unsafe, because one prolific artist (BoA
-- has 124 groups) can push the shared 1000-row response cap and silently truncate ANOTHER artist's
-- rows, which reads as "no releases" and hides a real artist. Answering server-side returns one
-- row per artist, so the cap can't be reached.
CREATE OR REPLACE FUNCTION artists_with_releases(p_ids uuid[])
RETURNS TABLE (artist_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT a.id
  FROM unnest(p_ids) AS a(id)
  WHERE EXISTS (SELECT 1 FROM release_groups rg WHERE rg.primary_artist_id = a.id)
     OR EXISTS (SELECT 1 FROM release_group_artists rga WHERE rga.artist_id = a.id);
$$;

GRANT EXECUTE ON FUNCTION artists_with_releases(uuid[]) TO anon, authenticated, service_role;
