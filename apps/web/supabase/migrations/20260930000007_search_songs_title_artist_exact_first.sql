-- search_songs_title_artist: title-prefix hits no longer outrank exact
-- matches (2026-09-30). After 20260930000006, "love you" returned "You Are
-- Something - Love" (artist Love + title prefix "you") at 10200 -- above a
-- plain exact song-title match (10000), so it would take Top Match from a real
-- "Love You". Now: exact title, or exact once "(feat. ...)" credits are
-- stripped -> 11000; any other prefix -> 9000. Everything else as 20260930000006.

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
           -- Exact title -- also once "(feat. ...)"-style credits are removed,
           -- so "Seethru (feat. Gaeko & Zion.T)" is exact for "seethru primary"
           -- -- scores 11000 (Top Match). Any other title-prefix hit ("You Are
           -- Something" for "love you") is 9000: listed, but below a plain
           -- exact song-title match (10000), so it can't take Top Match.
           max(CASE WHEN normalize_text(c.title) = c.t_norm
                      OR normalize_text(regexp_replace(c.title,
                           '\s*[(\[]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)[^)\]]*[)\]]', '', 'gi')) = c.t_norm
                    THEN 11000 ELSE 9000 END) AS s
    FROM cand c
    WHERE c.primary_artist_id = c.artist_id
       -- One of the credited names equals a name/alias of the artist -- not a
       -- substring ("Love" must not match "Jennifer Love Hewitt"). Credits are
       -- split on , & + / and feat. / featuring / ft. / with / x / of, so
       -- "프라이머리, E-Sens of 슈프림팀" -> 프라이머리 | E-Sens | 슈프림팀.
       -- ("and" is not a separator: "Florence and the Machine".)
       OR EXISTS (
            SELECT 1
            FROM regexp_split_to_table(
                   c.artist_display,
                   '\s*(?:,|&|\+|/|\s(?:feat\.?|featuring|ft\.?|with|x|of)\s)\s*', 'i') AS seg(name)
            JOIN variants v ON v.artist_id = c.artist_id
                           AND normalize_text(seg.name) = normalize_text(v.name)
            WHERE btrim(seg.name) <> '')
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
