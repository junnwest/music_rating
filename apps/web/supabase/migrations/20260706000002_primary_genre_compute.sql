-- Server-side primary_genre compute + resumable batched backfill (2026-07-06).
--
-- The PostgREST backfill (scripts/backfill-primary-genre.ts) does ~5,000 tiny 50-row UPDATE
-- round-trips, which crawl and stall under Supabase Micro's drained disk-IO burst budget (measured
-- 216 -> 70 -> 0 rows/min). A bulk server-side UPDATE writes the same rows with a fraction of the
-- per-row transaction/WAL overhead, so it completes in one budget window where the grind can't.
--
-- This encodes the SAME scene-first precedence as the script, as an IMMUTABLE SQL function, plus a
-- procedure that fills primary_genre in COMMITTED batches — resumable (re-CALL continues; already-set
-- rows are skipped), and progress persists even if a batch times out.
--
-- HOW TO RUN (once the IO budget has refilled — e.g. after the daily reset):
--     CALL backfill_primary_genre_proc();            -- default 20k/batch
--     CALL backfill_primary_genre_proc(5000);        -- smaller batches if a batch still times out

CREATE OR REPLACE FUNCTION _compute_primary_genre(p_genres text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH g AS (
    SELECT lower(regexp_replace(regexp_replace(replace(x, '&', ' and '), '-', ' ', 'g'), '\s+', ' ', 'g')) AS n
    FROM unnest(coalesce(p_genres, '{}'::text[])) AS x
  ),
  fam(ord, store, subs) AS (
    VALUES
      (1,  'korean hip hop', ARRAY['korean hip hop','k rap','korean rap']),
      (2,  'korean r&b',     ARRAY['korean r and b','k r and b','korean rnb']),
      (3,  'korean indie',   ARRAY['korean indie','k indie']),
      (4,  'korean folk',    ARRAY['korean folk','k folk']),
      (5,  'korean ballad',  ARRAY['korean ballad','k ballad']),
      (6,  'k-pop',          ARRAY['k pop','korean pop']),
      (7,  'city pop',       ARRAY['city pop']),
      (8,  'j-rock',         ARRAY['j rock','japanese rock','visual kei']),
      (9,  'j-pop',          ARRAY['j pop','japanese pop']),
      (10, 'shoegaze',       ARRAY['shoegaze','dream pop']),
      (11, 'math rock',      ARRAY['math rock']),
      (12, 'post-rock',      ARRAY['post rock']),
      (13, 'indie rock',     ARRAY['indie rock']),
      (14, 'indie pop',      ARRAY['indie pop','bedroom pop']),
      (15, 'alternative',    ARRAY['alternative','alt rock']),
      (16, 'metal',          ARRAY['metal']),
      (17, 'punk',           ARRAY['punk']),
      (18, 'classic rock',   ARRAY['classic rock','hard rock','psychedelic rock','prog rock','progressive rock']),
      (19, 'jazz',           ARRAY['jazz']),
      (20, 'funk',           ARRAY['funk','disco']),
      (21, 'r&b',            ARRAY['r and b','rnb','neo soul','soul']),
      (22, 'hip hop',        ARRAY['hip hop','rap','trap']),
      (23, 'electronic',     ARRAY['electronic','house','techno','edm','idm','electro','synth pop','synthpop']),
      (24, 'ambient',        ARRAY['ambient','lo fi','lofi']),
      (25, 'folk',           ARRAY['folk','singer songwriter','americana']),
      (26, 'classical',      ARRAY['classical','orchestral','baroque']),
      (27, 'country',        ARRAY['country']),
      (28, 'bossa nova',     ARRAY['bossa nova']),
      (29, 'afrobeat',       ARRAY['afrobeat']),
      (30, 'rock',           ARRAY['rock']),
      (31, 'pop',            ARRAY['pop'])
  )
  -- highest-precedence family whose any substring appears in any (normalized) genre; else the raw 1st tag
  SELECT COALESCE(
    (SELECT f.store FROM fam f
       WHERE EXISTS (SELECT 1 FROM g CROSS JOIN unnest(f.subs) AS sub WHERE g.n LIKE '%' || sub || '%')
       ORDER BY f.ord LIMIT 1),
    p_genres[1]
  );
$$;

CREATE OR REPLACE PROCEDURE backfill_primary_genre_proc(p_batch int DEFAULT 20000)
LANGUAGE plpgsql AS $$
DECLARE n int; total int := 0;
BEGIN
  LOOP
    UPDATE release_groups SET primary_genre = _compute_primary_genre(genres)
    WHERE id IN (
      SELECT id FROM release_groups
      WHERE primary_genre IS NULL AND genres IS NOT NULL
      LIMIT p_batch
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
    COMMIT;                                   -- persist each batch → resumable, timeout-tolerant
    RAISE NOTICE 'primary_genre backfilled: +% (running total %)', n, total;
    EXIT WHEN n = 0;
  END LOOP;
END;
$$;
