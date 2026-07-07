-- Raise the Rankings/Charts unlock gate targets.
--
-- Why: the 20260706000000 targets (10,000 events / 350 prestige-covered) were
-- both blown past overnight (10,252 / 747) by continuous bot-seeding running
-- at a steady ~24 ratings/hr, 24/7 -- not a one-time crossing. The prestige
-- coverage fix landed the same night (213->747, out of a 1,589-album pool),
-- so both numbers jumped together. A gauge sized for "enough data to not
-- look empty" is not the same thing as "ready to show the public" -- until
-- launch is scheduled, re-lock with headroom sized off the actual observed
-- ingest rate rather than re-picking another number that gets crossed again
-- in days.
--
-- New targets, sized for ~2-3 months of runway at the current ~24/hr steady
-- rate (~575/day):
--   events:   10,000 -> 50,000  (~40k headroom -> ~70 days at current pace)
--   prestige: 350    -> 1,500   (out of a 1,589-album total pool -- deliberately
--             near-saturation so continued low-coverage-first bot seeding can't
--             casually clear it either)
-- Revisit before this is exhausted, or replace with an explicit launch-date
-- flag if bot-seeding pace picks up again.

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
    50000,
    album_prestige_covered_cte.n::int,
    1500,
    (album_events_cte.n >= 50000 AND album_prestige_covered_cte.n >= 1500),
    song_events_cte.n::int,
    2500,
    (song_events_cte.n >= 2500)
  FROM album_events_cte, album_prestige_covered_cte, song_events_cte;
$$;

GRANT EXECUTE ON FUNCTION get_rankings_unlock_status() TO anon, authenticated, service_role;
