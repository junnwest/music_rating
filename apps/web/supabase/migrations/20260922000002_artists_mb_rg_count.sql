-- artists.mb_rg_count — what MusicBrainz last told us this artist's release-group total was.
--
-- THE PROBLEM. The freshness lane re-polls artists whose next_check_at has passed to find new
-- releases, and it does that by running a FULL ingestArtist(): every release group, every release,
-- every recording, for an artist that has usually released nothing since last time. That is the
-- most expensive possible way to ask "is there anything new?". It is also what made the ingest
-- watchdog fire mid-re-poll on Erik Satie (267 release groups) on 2026-08-18 -- the watchdog times
-- MB calls, and the long DB-write phase of a big artist makes none, so the lane restarted every
-- ~11 minutes with zero progress.
--
-- The cost shows: ~24,000 artists are overdue, roughly 170 days of backlog, because each re-poll
-- competes with new-artist ingest for the same 1 req/sec MusicBrainz budget.
--
-- THE CHEAP QUESTION. MusicBrainz returns `release-group-count` on any browse response, so
-- /release-group?artist=X&limit=1 answers the total in ONE request. Comparing that against the
-- count from the previous poll tells us whether a full re-ingest is worth doing.
--
-- WHY NOT COMPARE AGAINST OUR OWN ROW COUNT. Because they are deliberately different numbers: the
-- official-edition gate added 2026-09-22 skips release groups with no Official release, so our
-- count is legitimately lower than MusicBrainz's and always would be. Comparing ours to theirs
-- would report "new releases" on every single poll forever. Storing THEIR previous answer and
-- comparing it to THEIR current answer is immune to whatever we choose to filter.
--
-- KNOWN LIMIT: a poll where one release group was added and another removed leaves the count
-- unchanged and is skipped. That is an accepted trade for turning an N-request re-poll into a
-- 1-request one; the pipeline forces a full re-ingest anyway when it has never recorded a count
-- for the artist, so this can only ever skip a re-poll, never a first ingest.
--
-- NULL means "never recorded" and must force a full re-ingest, not be treated as zero.

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS mb_rg_count integer;

COMMENT ON COLUMN public.artists.mb_rg_count IS
  'MusicBrainz release-group-count as of the last successful poll. NULL = never recorded, which forces a full re-ingest. Compared against MusicBrainz''s current count, never against our own row count, which is filtered differently.';
