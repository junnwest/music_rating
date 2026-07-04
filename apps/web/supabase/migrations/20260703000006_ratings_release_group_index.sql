-- Fix: get_charts_most_rated intermittent HTTP 500 (statement timeout), flagged by
-- Sentry during iOS testing a while back. Investigated while picking this up as a
-- follow-up task.
--
-- Root cause: the schema renovation (20260624000001 §8/§10) dropped
-- ratings.release_id / track_ratings.release_id (and their indexes) and replaced
-- them with release_group_id / recording_id — but never created new indexes on the
-- replacement columns. The only indexes touching these tables are the UNIQUE
-- constraints on (user_id, release_group_id) / (user_id, recording_id), which are
-- useless for a query that joins/groups on release_group_id or recording_id alone
-- without also filtering by user_id — a composite index can only be used efficiently
-- via its leading column(s).
--
-- Every chart/leaderboard RPC joins `ratings` on `release_group_id` with no
-- supporting index (get_charts_top_rated, get_charts_most_rated, get_charts_trending,
-- get_charts_trending_for_genres, get_charts_hidden_gems, get_charts_controversial,
-- get_silla_leaderboard, get_user_genre_standings), and the song-chart RPCs group
-- `track_ratings` by `recording_id` with the same gap. Whether this forces a slow
-- nested-loop plan depends on the query planner's row estimates, which is exactly
-- why it manifested as "intermittent" rather than a deterministic failure — as
-- `ratings` grows, the planner is more likely to pick (or be forced into) a plan
-- that needs this index, and the anon role's statement_timeout catches it.
--
-- Fix: add the missing indexes. This is additive (no query result changes) and
-- should benefit every RPC above, not just get_charts_most_rated.

CREATE INDEX IF NOT EXISTS idx_ratings_release_group_id
  ON ratings (release_group_id);

CREATE INDEX IF NOT EXISTS idx_track_ratings_recording_id
  ON track_ratings (recording_id);
