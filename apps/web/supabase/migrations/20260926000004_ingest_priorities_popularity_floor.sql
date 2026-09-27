-- FRESHNESS tiering: break the circularity that made a missing album permanent.
--
-- THE BUG. recompute_ingest_priorities (migration 20260626000004) derives an artist's re-poll
-- cadence from the newest release WE HOLD. That is self-reinforcing in the worst direction: if we
-- are missing an artist's recent albums, the newest release we hold is old, so the artist is demoted
-- to a slower tier, so it is re-polled less often, so the missing albums are never discovered. The
-- signal used to decide how urgently to look for new releases was the very thing that was missing.
--
-- Observed live 2026-09-26, and reported from the app as albums simply absent:
--   Metallica     popularity 95, newest held 2016 -> dormant (90d) -- 72 Seasons (2023) absent
--   Bob Dylan     popularity 87, newest held 2020 -> dormant (90d) -- Rough and Rowdy Ways absent
--   Depeche Mode  popularity 89, newest held 2017 -> dormant (90d) -- Memento Mori (2023) absent
-- while 2,262 artists nobody has heard of sat in `hot` because their newest held release was recent.
-- dormant is also last in FRESHNESS_TIERS' fall-through order, so with 16,481 `known` artists due at
-- any moment a dormant artist is not merely slow, it is never reached at all.
--
-- THE FIX: a floor from artists.popularity, which is an EXTERNAL signal (Deezer fan counts) and so
-- cannot be starved by a gap in our own data. The recency/engagement tier is still computed exactly
-- as before; the floor only ever raises it.
--
-- WHY RANK AND NOT A THRESHOLD. A cutoff like `popularity >= 80` binds the daily re-poll budget to
-- the shape of a distribution we do not control -- pick wrong and the hot tier is either empty or
-- tens of thousands of artists, each re-poll costing several MusicBrainz requests against a 1 req/sec
-- limit shared with the ingest lane. Ranking fixes the population per tier by construction:
--   top 300      -> hot    (1d)  =  300 re-polls/day
--   next 2,700   -> active (7d)  ~= 386/day
--   next 17,000  -> known  (30d) ~= 567/day
-- about 1,250 re-polls/day in total, which fits. Artists with no popularity value yet are unranked
-- and keep their recency-derived tier, so this degrades to the old behaviour rather than to nothing
-- while the Deezer backfill is still filling the column in.
CREATE OR REPLACE FUNCTION recompute_ingest_priorities()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE n integer;
BEGIN
  WITH stats AS (
    SELECT a.id, a.popularity,
           (SELECT max(rg.first_release_date)
              FROM release_groups rg WHERE rg.primary_artist_id = a.id) AS latest,
           EXISTS (SELECT 1 FROM ratings rt
                     JOIN release_groups rg2 ON rg2.id = rt.release_group_id
                    WHERE rg2.primary_artist_id = a.id) AS rated
    FROM artists a
    WHERE a.ingest_state = 'tracks_done'
  ),
  -- Rank only artists that HAVE a popularity value, so nulls do not consume the top slots.
  ranked AS (
    SELECT id, row_number() OVER (ORDER BY popularity DESC, id) AS rnk
      FROM stats WHERE popularity IS NOT NULL
  ),
  tiered AS (
    SELECT s.id,
      GREATEST(
        -- release recency + engagement, unchanged from 20260626000004
        CASE
          WHEN s.latest IS NULL THEN 2
          WHEN s.latest >= (now() - interval '3 months')::date  THEN 4
          WHEN s.latest >= (now() - interval '18 months')::date THEN (CASE WHEN s.rated THEN 4 ELSE 3 END)
          WHEN s.latest >= (now() - interval '6 years')::date   THEN (CASE WHEN s.rated THEN 3 ELSE 2 END)
          ELSE (CASE WHEN s.rated THEN 2 ELSE 1 END)
        END,
        -- popularity floor by rank; unranked artists contribute nothing
        CASE
          WHEN r.rnk IS NULL     THEN 0
          WHEN r.rnk <=    300   THEN 4
          WHEN r.rnk <=  3000    THEN 3
          WHEN r.rnk <= 20000    THEN 2
          ELSE 0
        END
      ) AS lvl
    FROM stats s LEFT JOIN ranked r ON r.id = s.id
  )
  UPDATE artists a SET
    ingest_priority = CASE t.lvl WHEN 4 THEN 'hot' WHEN 3 THEN 'active' WHEN 2 THEN 'known' ELSE 'dormant' END,
    next_check_at = coalesce(a.last_ingested_at, now()) + (
      CASE t.lvl WHEN 4 THEN interval '1 day'  WHEN 3 THEN interval '7 days'
                 WHEN 2 THEN interval '30 days' ELSE interval '90 days' END)
  FROM tiered t
  WHERE a.id = t.id
    AND a.ingest_priority IS DISTINCT FROM
        (CASE t.lvl WHEN 4 THEN 'hot' WHEN 3 THEN 'active' WHEN 2 THEN 'known' ELSE 'dormant' END);

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
