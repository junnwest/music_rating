-- search_songs_title_artist, bounded (2026-09-30). The first version
-- (20260930000004) scanned up to 3000 title-prefix recordings per (split x
-- artist) and then ILIKE-checked them, so a query of two common words ("love
-- you": artists Love / You, titles starting "you" / "love") hit the statement
-- timeout. Clients call it for every multi-word song search, so that is
-- avoidable load.
--
-- Now two small candidate sources per resolved artist:
--   * main-artist songs: recordings WHERE primary_artist_id = artist (indexed)
--     AND title prefix, <= 200;
--   * featured credits: exact normalized title (btree), <= 500, then the same
--     artist_display name/alias check.
-- Artist candidates per split: 10 -> 5. Scores and signature unchanged.

BEGIN;

CREATE OR REPLACE FUNCTION search_songs_title_artist(q text, lim int DEFAULT 20)
RETURNS TABLE (id uuid, title text, artist_display text, score double precision)
LANGUAGE sql STABLE AS $$
  WITH w AS (
    SELECT ws, array_length(ws, 1) AS n
    FROM (SELECT regexp_split_to_array(btrim(normalize(coalesce(q, ''), NFC)), '\s+') AS ws) x
  ),
  splits AS (
    SELECT normalize_text(array_to_string(ws[1:k], ' ')) AS a_norm,
           normalize_text(array_to_string(ws[k+1:n], ' ')) AS t_norm
    FROM w, generate_series(1, w.n - 1) AS k
    WHERE w.n BETWEEN 2 AND 8
    UNION
    SELECT normalize_text(array_to_string(ws[k+1:n], ' ')),
           normalize_text(array_to_string(ws[1:k], ' '))
    FROM w, generate_series(1, w.n - 1) AS k
    WHERE w.n BETWEEN 2 AND 8
  ),
  arts AS (
    SELECT DISTINCT sp.t_norm, x.artist_id
    FROM splits sp
    CROSS JOIN LATERAL (
      SELECT a.id AS artist_id FROM artists a
       WHERE normalize_text(a.name) = sp.a_norm
          OR normalize_text(a.name_native) = sp.a_norm
          OR normalize_text(a.name_phonetic_ko) = sp.a_norm
      UNION
      SELECT aa.artist_id FROM artist_aliases aa WHERE normalize_text(aa.alias) = sp.a_norm
      LIMIT 5
    ) x
    WHERE sp.a_norm <> '' AND sp.t_norm <> ''
  ),
  variants AS (
    SELECT ar.artist_id, v.name
    FROM (SELECT DISTINCT artist_id FROM arts) ar
    CROSS JOIN LATERAL (
      SELECT a.name FROM artists a WHERE a.id = ar.artist_id
      UNION SELECT a.name_native FROM artists a WHERE a.id = ar.artist_id
      UNION SELECT aa.alias FROM artist_aliases aa WHERE aa.artist_id = ar.artist_id
    ) v(name)
    WHERE v.name IS NOT NULL AND char_length(btrim(v.name)) >= 2
  ),
  cand AS (
    SELECT ar.artist_id, ar.t_norm, r.id, r.title, r.artist_display, r.primary_artist_id
    FROM arts ar
    CROSS JOIN LATERAL (
      -- Main-artist songs: that artist's own recordings (idx on
      -- primary_artist_id), then the title prefix -- tiny per artist.
      (SELECT r.id, r.title, r.artist_display, r.primary_artist_id
         FROM recordings r
        WHERE r.primary_artist_id = ar.artist_id
          AND normalize_text(r.title) ~>=~ ar.t_norm
          AND normalize_text(r.title) ~<~ (ar.t_norm || chr(1114111))
        LIMIT 200)
      UNION ALL
      -- Featured credits (e.g. E-Sens on 독): exact title only (btree), then
      -- the credit-text check in `hits`.
      (SELECT r.id, r.title, r.artist_display, r.primary_artist_id
         FROM recordings r
        WHERE normalize_text(r.title) = ar.t_norm
        LIMIT 500)
    ) r
  ),
  hits AS (
    SELECT c.id, c.title, c.artist_display,
           max(CASE WHEN normalize_text(c.title) = c.t_norm THEN 11000 ELSE 10200 END) AS s
    FROM cand c
    WHERE c.primary_artist_id = c.artist_id
       OR EXISTS (SELECT 1 FROM variants v
                   WHERE v.artist_id = c.artist_id
                     AND c.artist_display ILIKE '%' || v.name || '%')
    GROUP BY c.id, c.title, c.artist_display
  ),
  pop AS (
    SELECT h.id, max(coalesce(rg.prestige_score, 0)) AS prestige
    FROM hits h
    JOIN release_tracks rt ON rt.recording_id = h.id
    JOIN releases rel ON rel.id = rt.release_id
    JOIN release_groups rg ON rg.id = rel.release_group_id
    GROUP BY h.id
  )
  SELECT h.id, h.title, h.artist_display,
         (h.s + coalesce(p.prestige, 0) * 2)::double precision AS score
  FROM hits h
  LEFT JOIN pop p ON p.id = h.id
  ORDER BY 4 DESC, char_length(h.title), h.title
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_songs_title_artist(text, int) TO anon, authenticated;

COMMIT;
