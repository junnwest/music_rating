-- Genre-aware search: "korean hiphop" should surface Korean hip-hop albums, not just
-- releases literally titled that. Today search_release_groups is purely lexical (title/
-- artist/native_title substring+trigram match) -- release_groups.genres is never consulted.
--
-- This adds a small alias table mapping normalized query phrases to the genre-tag substrings
-- _rg_has_genre() already knows how to match (apps/web/supabase/migrations/
-- 20260626000002_charts_rpcs_rebuild.sql), then blends genre hits into the SAME ranked result
-- list search_release_groups already returns -- no new endpoint, no client changes on either
-- platform, ships the moment this migration is applied.
--
-- Seed data is pulled directly from the two genre taxonomies that already exist in this repo
-- (both otherwise-unused at runtime today -- see SESSIONS.md/prior research) rather than
-- invented here:
--   - apps/web/lib/genre-categories.ts's 30 GENRE_CATEGORIES (key/name/genreFilters)
--   - _compute_primary_genre's 31-family synonym table (20260706000002_primary_genre_compute.sql)
--
-- NOTE for future maintainers: if the genre taxonomy in genre-categories.ts changes (a category
-- added/renamed), this table does NOT pick that up automatically -- it needs a matching update.

CREATE TABLE IF NOT EXISTS genre_query_aliases (
  id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phrase  text NOT NULL,        -- raw human-readable phrase; matched via normalize_text() at query time
  filters text[] NOT NULL       -- genre-tag substrings to check via _rg_has_genre (one category's genreFilters)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_genre_query_aliases_phrase_norm
  ON genre_query_aliases (normalize_text(phrase));

ALTER TABLE genre_query_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "genre_query_aliases_select" ON genre_query_aliases
  FOR SELECT USING (true);

-- Dedup by normalized form (several raw phrases below normalize to the same string, e.g.
-- "hip-hop" and "hip hop" both -> "hiphop" -- normalize_text strips ALL whitespace/punctuation).
INSERT INTO genre_query_aliases (phrase, filters)
SELECT DISTINCT ON (normalize_text(phrase)) phrase, filters
FROM (VALUES
  -- ── Korean ──
  ('k-pop',            ARRAY['k-pop','korean pop']),
  ('kpop',             ARRAY['k-pop','korean pop']),
  ('korean pop',       ARRAY['k-pop','korean pop']),
  ('k pop',            ARRAY['k pop','korean pop']),

  ('korean indie',     ARRAY['k-indie','korean indie','korean folk','korean ballad']),
  ('korean indie and ballad', ARRAY['k-indie','korean indie','korean folk','korean ballad']),
  ('k indie',          ARRAY['k indie','korean indie']),

  ('korean r&b',       ARRAY['k-r&b','korean r&b']),
  ('korean rnb',       ARRAY['k-r&b','korean r&b']),
  ('k-r&b',            ARRAY['k-r&b','korean r&b']),
  ('k r&b',            ARRAY['k r and b','korean rnb']),

  ('korean hip-hop',   ARRAY['k-rap','korean rap','korean hip hop']),
  ('korean hip hop',   ARRAY['k-rap','korean rap','korean hip hop']),
  ('korean hiphop',    ARRAY['k-rap','korean rap','korean hip hop']),
  ('korean rap',       ARRAY['k-rap','korean rap','korean hip hop']),
  ('k rap',            ARRAY['k rap','korean rap']),
  ('k-rap',            ARRAY['k-rap','korean rap']),

  ('korean ballads',   ARRAY['korean ballad','k-ballad']),
  ('korean ballad',    ARRAY['korean ballad','k-ballad']),
  ('k ballad',         ARRAY['k ballad','korean ballad']),

  ('korean folk',      ARRAY['korean folk','k-folk']),
  ('k folk',           ARRAY['k folk','korean folk']),

  -- ── Japanese ──
  ('j-pop',            ARRAY['j-pop','japanese pop']),
  ('jpop',             ARRAY['j-pop','japanese pop']),
  ('japanese pop',     ARRAY['j-pop','japanese pop']),

  ('j-rock',           ARRAY['j-rock','japanese rock','visual kei']),
  ('jrock',            ARRAY['j-rock','japanese rock','visual kei']),
  ('japanese rock',    ARRAY['j-rock','japanese rock','visual kei']),
  ('visual kei',       ARRAY['visual kei']),

  ('city pop',         ARRAY['city pop']),

  -- ── Indie / Alt rock ──
  ('indie rock',       ARRAY['indie rock']),
  ('indie pop',        ARRAY['indie pop','bedroom pop']),
  ('bedroom pop',      ARRAY['bedroom pop','indie pop']),
  ('alternative',      ARRAY['alternative rock','alt-rock','alternative']),
  ('alternative rock', ARRAY['alternative rock','alt-rock','alternative']),
  ('alt rock',         ARRAY['alternative rock','alt-rock','alternative']),
  ('post-rock',        ARRAY['post-rock']),
  ('post rock',        ARRAY['post-rock']),
  ('shoegaze',         ARRAY['shoegaze','dream pop']),
  ('dream pop',        ARRAY['dream pop','shoegaze']),
  ('math rock',        ARRAY['math rock','progressive rock']),
  ('progressive rock', ARRAY['math rock','progressive rock','prog rock']),
  ('prog rock',        ARRAY['prog rock','progressive rock']),

  -- ── Hip-Hop / Rap ──
  ('hip-hop',          ARRAY['hip-hop','hip hop','rap','jazz rap','trap']),
  ('hip hop',          ARRAY['hip-hop','hip hop','rap','jazz rap','trap']),
  ('hiphop',           ARRAY['hip-hop','hip hop','rap','jazz rap','trap']),
  ('rap',              ARRAY['hip-hop','hip hop','rap','jazz rap','trap']),
  ('trap',             ARRAY['trap','hip hop']),
  ('jazz rap',         ARRAY['jazz rap','hip hop']),

  -- ── R&B / Soul / Funk ──
  ('r&b',              ARRAY['r&b','soul','neo-soul']),
  ('rnb',              ARRAY['r&b','soul','neo-soul']),
  ('r&b and soul',     ARRAY['r&b','soul','neo-soul']),
  ('soul',             ARRAY['soul','r&b','neo-soul']),
  ('neo soul',         ARRAY['neo-soul','soul']),
  ('funk',             ARRAY['funk','disco']),
  ('disco',            ARRAY['disco','funk']),

  -- ── Jazz / Classical / Acoustic ──
  ('jazz',             ARRAY['jazz','jazz fusion']),
  ('jazz fusion',      ARRAY['jazz fusion','jazz']),
  ('folk',             ARRAY['folk','singer-songwriter','americana']),
  ('folk and singer songwriter', ARRAY['folk','singer-songwriter','americana']),
  ('singer songwriter',ARRAY['singer-songwriter','folk']),
  ('americana',        ARRAY['americana','folk']),
  ('classical',        ARRAY['classical','orchestral','baroque']),
  ('orchestral',       ARRAY['orchestral','classical']),

  -- ── Rock canon ──
  ('classic rock',     ARRAY['classic rock','hard rock','psychedelic rock']),
  ('hard rock',        ARRAY['hard rock','classic rock']),
  ('psychedelic rock', ARRAY['psychedelic rock','classic rock']),
  ('metal',            ARRAY['metal','heavy metal']),
  ('heavy metal',      ARRAY['heavy metal','metal']),
  ('punk',             ARRAY['punk','post-punk']),
  ('post punk',        ARRAY['post-punk','punk']),

  -- ── Electronic ──
  ('electronic',       ARRAY['electronic','house','techno']),
  ('house',            ARRAY['house','electronic']),
  ('techno',           ARRAY['techno','electronic']),
  ('edm',              ARRAY['edm','electronic']),
  ('idm',              ARRAY['idm','electronic']),
  ('synth pop',        ARRAY['synth pop','synthpop','electronic']),
  ('synthpop',         ARRAY['synthpop','synth pop','electronic']),
  ('ambient',          ARRAY['ambient','lo-fi']),
  ('lo-fi',            ARRAY['lo-fi','ambient']),
  ('lofi',             ARRAY['lo-fi','lofi','ambient']),

  -- ── Pop ──
  ('pop',              ARRAY['pop']),

  -- ── World / Country ──
  ('country',          ARRAY['country','americana']),
  ('bossa nova',       ARRAY['bossa nova']),
  ('afrobeat',         ARRAY['afrobeat'])
) AS seed(phrase, filters);

-- Blend genre-tagged albums into search_release_groups' existing ranked results. Signature is
-- UNCHANGED from apps/web/supabase/migrations/20260710000002_edition_decoration_normalize.sql
-- (q, lim, yr, query_embedding) -- iOS and web call sites need zero changes.
CREATE OR REPLACE FUNCTION search_release_groups(
  q               text,
  lim             int          DEFAULT 30,
  yr              text         DEFAULT NULL,
  query_embedding vector(1024) DEFAULT NULL
)
RETURNS TABLE (
  id uuid, title text, artist_display text, cover_url text, native_title text,
  release_group_type text, first_release_date text, artist_native text, primary_artist_id uuid
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (
    SELECT normalize_text(strip_edition_decorations(q)) AS qn,
           lower(btrim(strip_edition_decorations(q)))    AS ql
  ),
  genre_hit AS (
    SELECT gqa.filters
    FROM genre_query_aliases gqa, nq
    WHERE normalize_text(gqa.phrase) = nq.qn
    LIMIT 1
  )
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text,
         a.name_native, rg.primary_artist_id
  FROM release_groups rg
  LEFT JOIN artists a ON a.id = rg.primary_artist_id, nq
  LEFT JOIN genre_hit ON true
  WHERE rg.release_group_type IN ('album', 'ep')
    AND nq.qn <> ''
    AND (yr IS NULL OR rg.first_release_date::text LIKE yr || '%')
    AND (
         normalize_text(rg.title)          LIKE '%' || nq.qn || '%'
      OR normalize_text(rg.artist_display) LIKE '%' || nq.qn || '%'
      OR normalize_text(rg.native_title)   LIKE '%' || nq.qn || '%'
      OR nq.ql <% lower(rg.title)
      OR nq.ql <% lower(rg.artist_display)
      -- Genre branch: only ever evaluated when the query matched a seeded genre phrase above --
      -- everyday artist/title searches (the overwhelming majority) pay zero extra cost.
      OR (
           genre_hit.filters IS NOT NULL
           AND EXISTS (SELECT 1 FROM unnest(genre_hit.filters) f WHERE _rg_has_genre(rg.genres, f))
         )
    )
  ORDER BY (
      CASE WHEN normalize_text(rg.title) = nq.qn OR normalize_text(rg.artist_display) = nq.qn THEN 10000 ELSE 0 END
    + CASE WHEN normalize_text(rg.title) LIKE nq.qn || '%' THEN 500
           WHEN normalize_text(rg.artist_display) LIKE nq.qn || '%' THEN 400 ELSE 0 END
    + GREATEST(word_similarity(nq.ql, lower(rg.title)), word_similarity(nq.ql, lower(rg.artist_display))) * 1000
    + coalesce(rg.prestige_score, 0) * 2
    + CASE WHEN query_embedding IS NOT NULL AND rg.embedding IS NOT NULL
           THEN (1.0 - (rg.embedding <=> query_embedding)) * 1500 ELSE 0 END
    -- Sits below exact-match (10000) and prefix-match (400-500) tiers, so a literal title/artist
    -- hit always outranks a genre-blended one (e.g. an album actually titled "Pop").
    + CASE WHEN genre_hit.filters IS NOT NULL
           AND EXISTS (SELECT 1 FROM unnest(genre_hit.filters) f WHERE _rg_has_genre(rg.genres, f))
           THEN 300 ELSE 0 END
  ) DESC
  LIMIT lim;
$$;
