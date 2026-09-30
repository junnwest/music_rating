-- Songs can be the Top Match ("최적의 결과"), ranked by popularity (2026-09-30).
--
-- Searching "독" put Snoop Dogg in Top Match (search_artists scores a loose
-- cross-script similarity at ~1600) while four songs are titled exactly 독 --
-- including 독 by 프라이머리 / E-Sens -- and songs never competed for Top Match
-- at all. search_recordings_short also returned exact matches in arbitrary
-- (title-length) order, with no popularity signal.
--
-- search_recordings_short now returns a score on the same scale as
-- search_release_groups / search_artists: exact title 10000, prefix 500, plus
-- 2 x the best prestige_score among the release groups the recording appears
-- on (release_tracks -> releases -> release_groups; idx_release_tracks_recording).
-- The clients use it to put an exact song match into Top Match.
--
-- Return type changes, so the function is dropped and recreated (clients that
-- ignore the new column keep working).

BEGIN;

DROP FUNCTION IF EXISTS search_recordings_short(text, int);

CREATE FUNCTION search_recordings_short(q text, lim int DEFAULT 30)
RETURNS TABLE (id uuid, title text, artist_display text, score double precision)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn),
  hits AS (
    (SELECT r.id, 10000 AS s FROM recordings r, nq
      WHERE nq.qn <> '' AND normalize_text(r.title) = nq.qn LIMIT 150)
    UNION ALL
    (SELECT r.id, 500 FROM recordings r, nq
      WHERE nq.qn <> '' AND normalize_text(r.title) ~>=~ nq.qn
        AND normalize_text(r.title) ~<~ (nq.qn || chr(1114111))
      LIMIT 150)
  ),
  best AS (SELECT h.id, max(h.s) AS s FROM hits h GROUP BY h.id),
  pop AS (
    SELECT b.id, max(coalesce(rg.prestige_score, 0)) AS prestige
    FROM best b
    JOIN release_tracks rt ON rt.recording_id = b.id
    JOIN releases rel ON rel.id = rt.release_id
    JOIN release_groups rg ON rg.id = rel.release_group_id
    GROUP BY b.id
  )
  SELECT r.id, r.title, r.artist_display,
         (b.s + coalesce(p.prestige, 0) * 2)::double precision AS score
  FROM best b
  JOIN recordings r ON r.id = b.id
  LEFT JOIN pop p ON p.id = b.id
  ORDER BY 4 DESC, char_length(r.title), r.title
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_recordings_short(text, int) TO anon, authenticated;

COMMIT;
