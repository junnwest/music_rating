-- Let the iOS app (user-session client, RLS-subject) log search misses. search_misses had
-- RLS enabled but NO policies → deny-all for authenticated/anon, so only the web's service-role
-- logSearchMiss could write. The demand signal that drives MB-gap recovery (Deezer fallback for
-- artists MB lacks) was therefore blind to the primary surface — the app.
--
-- This is telemetry (a query string + how many catalog results it got), not user-private data,
-- so an insert-only policy for authenticated/anon is fine. Reads stay service-role-only (the
-- pipeline reads via service role, which bypasses RLS) — no SELECT/UPDATE/DELETE policy added.
-- The abuse surface (spamming misses) is contained downstream: tryMisses only acts on a miss
-- that (a) has db_count = 0, (b) recurs >= MISS_MIN_DEMAND times, and (c) exact-matches a real
-- Deezer artist — so a junk insert can't cause a bad ingest.

CREATE POLICY search_misses_insert ON search_misses
  FOR INSERT TO authenticated, anon
  WITH CHECK (true);
