-- Replace the "just raise the target" gauge fix (20260706000001) with a
-- weighted counter: keep the 10,000 target, but make bot ratings count for
-- progressively less as real (non-bot) ratings accumulate.
--
-- Why: raising the raw target only bought time until the next bot batch
-- crossed it again. Instead, change what the gauge COUNTS: bot-authored
-- ratings (profiles.is_bot) are capped and Bayesian-damped by real_n, so:
--   - Pre-launch (real_n≈0, current: 18 real / 10,234 bot): gauge reads
--     ≈2,991 -- ~3,000, >99% of it bot-attributed. Matches the requested
--     "~3k/10k, >90% bot" launch-day picture without hiding the counter.
--   - As real users rate post-launch, bot contribution decays toward 0
--     (K=2000 damping -- same C/(C+n) idiom as this file's other Bayesian
--     formulas). By real_n≈9,480 the gauge reaches 10,000 with bot
--     contribution down to ≈520 (~5%, under the "<10% at 10k" target).
--   - Bot contribution is also hard-capped at 3,000 "ratings' worth" no
--     matter how large the underlying bot pool grows, so continued bot
--     seeding can no longer move this gauge on its own.
--
-- Signature unchanged from 20260706000001 -- CREATE OR REPLACE, no DROP
-- needed. album_prestige_target reverts to 350 (its original, leaderboard-
-- display-depth-derived value) -- the earlier 1,500 was purely a symptom of
-- the raw-count approach this replaces, not a considered target on its own.
-- Coverage itself stays a plain count (not bot-weighted) -- that condition
-- guards leaderboard breadth, a different concern than this gauge's honesty.

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
  WITH real_events AS (
    SELECT COUNT(*) AS n
    FROM ratings r
    JOIN profiles p ON p.id = r.user_id
    WHERE COALESCE(p.is_bot, false) = false
      AND (r.score IS NOT NULL OR r.elo_score IS NOT NULL)
  ),
  bot_events AS (
    SELECT COUNT(*) AS n
    FROM ratings r
    JOIN profiles p ON p.id = r.user_id
    WHERE p.is_bot = true
      AND (r.score IS NOT NULL OR r.elo_score IS NOT NULL)
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
  ),
  weighted AS (
    SELECT
      re.n AS real_n,
      LEAST(be.n::float8, 3000) * (2000.0 / (2000.0 + re.n)) AS bot_contribution
    FROM real_events re, bot_events be
  )
  SELECT
    ROUND(w.real_n + w.bot_contribution)::int,
    10000,
    apc.n::int,
    350,
    ((w.real_n + w.bot_contribution) >= 10000 AND apc.n >= 350),
    se.n::int,
    2500,
    (se.n >= 2500)
  FROM weighted w, album_prestige_covered_cte apc, song_events_cte se;
$$;

GRANT EXECUTE ON FUNCTION get_rankings_unlock_status() TO anon, authenticated, service_role;
