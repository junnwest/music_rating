-- Rankings/Charts collective unlock gate.
--
-- Why: an empty Charts tab at launch looks broken. Rather than silently
-- filling it with bot data, the tab stays locked behind a single simple
-- user-facing gauge ("X / N ratings") per content type (albums, songs).
--
-- The gauge LOOKS like a plain volume counter on purpose — but volume alone
-- was proven unreliable during bot-seeding: at 8,057 album ratings (16x past
-- an earlier proposed threshold), only 19% of the Silla leaderboard's
-- prestige-eligible pool had been rated at all, because bot volume kept
-- landing on already-popular albums instead of spreading. A pure counter
-- can hit any N while the leaderboard stays sparse.
--
-- So the real unlock condition is two-part, but only the first part is ever
-- shown to users:
--   1. total rating events >= target (the number in the visible gauge)
--   2. prestige-pool albums with >=3 ratings >= coverage target (invisible —
--      matches get_silla_leaderboard's own Bayesian prior: 3 ratings is
--      where its formula starts reflecting real signal over the global mean)
--
-- Coverage target (350) is sized off the leaderboard's own display depth
-- (100 albums shown, see RankingsView's p_limit: 100 fetch) with headroom
-- for reshuffling, not an arbitrary fraction of the whole prestige pool.
--
-- Songs: no coverage condition yet. There's no song-side equivalent of the
-- prestige pool (no external critic scores for individual tracks) and no
-- real rating-distribution data to size one from (5 rows in track_ratings
-- as of this writing). Volume-only for now; revisit once song-seeding
-- produces real numbers, the same way the album number required real data
-- to get right instead of formula math alone.

CREATE OR REPLACE FUNCTION get_rankings_unlock_status()
RETURNS TABLE (
  album_events           int,
  album_events_target    int,
  album_prestige_covered int,
  album_prestige_target  int,
  album_unlocked         boolean,
  song_events            int,
  song_events_target     int,
  song_unlocked          boolean
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH album_events_cte AS (
    SELECT COUNT(*) AS n
    FROM ratings
    WHERE score IS NOT NULL OR elo_score IS NOT NULL
  ),
  album_prestige_covered_cte AS (
    -- Matches get_silla_leaderboard's own formula input exactly: plain
    -- `score` only (not elo_score) is what its Bayesian average reads, and
    -- only release_groups with a prestige_score can appear on that board.
    SELECT COUNT(*) AS n
    FROM (
      SELECT r.release_group_id
      FROM ratings r
      JOIN release_groups rg ON rg.id = r.release_group_id
      WHERE r.score IS NOT NULL AND rg.prestige_score IS NOT NULL
      GROUP BY r.release_group_id
      HAVING COUNT(*) >= 3
    ) covered
  ),
  song_events_cte AS (
    SELECT COUNT(*) AS n
    FROM track_ratings
    WHERE score IS NOT NULL OR elo_score IS NOT NULL
  )
  SELECT
    album_events_cte.n::int,
    10000,
    album_prestige_covered_cte.n::int,
    350,
    (album_events_cte.n >= 10000 AND album_prestige_covered_cte.n >= 350),
    song_events_cte.n::int,
    2500,
    (song_events_cte.n >= 2500)
  FROM album_events_cte, album_prestige_covered_cte, song_events_cte;
$$;

GRANT EXECUTE ON FUNCTION get_rankings_unlock_status() TO anon, authenticated, service_role;
