-- Fixes Supabase's "Auth RLS Initialization Plan" performance warning across
-- every affected policy in `public` (found via a full audit of all
-- CREATE POLICY statements in this migration history, cross-checked against
-- the linter's exact detection rule). Every RLS policy that calls
-- auth.uid()/auth.role() directly gets that call re-evaluated ONCE PER ROW
-- by Postgres, because a bare function call can't be hoisted into an
-- InitPlan the way a scalar subquery can. Wrapping it as `(select auth.uid())`
-- makes Postgres evaluate it once per query and reuse the cached value --
-- same logical result, no behavior change, just correct cost.
--
-- Every change below is ALTER POLICY (not DROP+CREATE): preserves policy
-- grants/ordering and there's no window where the policy doesn't exist.
--
-- IMPORTANT for whoever applies this: for any policy that was originally
-- `FOR ALL`/`FOR UPDATE` with ONLY a USING clause and no explicit WITH CHECK,
-- Postgres copies USING into WITH CHECK at creation time -- omitting WITH
-- CHECK from the matching ALTER POLICY here would leave that copy stale
-- (still calling the unwrapped auth function). Every such case below
-- explicitly re-states WITH CHECK too, not just USING, for exactly that
-- reason -- don't "simplify" these by dropping the WITH CHECK clause.
--
-- NOT addressed here (flagged, needs separate judgment calls):
--   1. Six tables have an overlapping `FOR ALL` (owner) + separate `FOR SELECT`
--      (public/broader) permissive policy pair -- mixes, mix_items, mix_likes,
--      mix_shares, mix_share_likes, rating_likes. Postgres evaluates BOTH
--      permissive policies per row (doubling the cost even after this fix),
--      but they're not redundant -- each expresses a different visibility
--      rule ("owner sees own" OR "everyone sees public/authenticated-read"),
--      so merging them requires care to not change who can see what. Left
--      alone here; worth a dedicated pass.
--   2. `daily_answers`/`daily_questions` are defined TWICE across the two
--      migration directories (supabase/migrations/20260531000001 vs.
--      apps/web/.../20260610000000) with different policy names. This
--      migration assumes apps/web's names (daily_answers_select_own etc.)
--      are what's actually live -- if that's wrong, the relevant ALTER
--      POLICY statements below will fail loudly (policy not found) rather
--      than silently no-op, which is the safer failure mode. Verify with
--      `select * from pg_policies where tablename in ('daily_questions',
--      'daily_answers')` first if unsure.
--   3. `list_item_tracks` has no migration at all under apps/web (only in
--      the top-level supabase/migrations dir) -- fixed here anyway since
--      ALTER POLICY targets the live table regardless of which local
--      directory tracks it, but its source-of-truth location is a separate
--      open question.
--   4. storage.objects avatar policies (different schema, same anti-pattern)
--      -- see the very end of this file, split out as an optional block.
--   5. IMPORTANT -- `ratings` likely has MORE live policies than the 4 fixed
--      below. A Supabase advisor export seen this session named policies
--      "Allow authenticated users to select/insert/update/delete their
--      ratings" on `ratings` -- those names do not appear in ANY migration
--      file in either directory (grepped both, zero hits), so they're live
--      but untracked, probably created via the SQL editor directly. If they
--      still exist, `ratings` has ~7 overlapping policies, not the 4 this
--      migration touches, and this migration does NOT fix those untracked
--      ones (their exact USING/WITH CHECK text isn't available to write a
--      safe fix for). Before/after applying this, run:
--        select policyname, cmd, qual, with_check from pg_policies where tablename = 'ratings';
--      If the untracked ones are superseded by ratings_select/insert/update/
--      delete below, just DROP POLICY the untracked ones -- consolidates
--      AND closes the auth-wrap gap in one move, no need to reconstruct
--      their clause text. Worth spot-checking other high-traffic tables the
--      same way in case this isn't unique to `ratings`.

BEGIN;

-- ── ratings ──────────────────────────────────────────────────────────────
ALTER POLICY ratings_insert ON ratings WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY ratings_update ON ratings
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY ratings_delete ON ratings USING ((select auth.uid()) = user_id);

-- ── reviews ──────────────────────────────────────────────────────────────
ALTER POLICY reviews_insert ON reviews WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY reviews_delete ON reviews USING ((select auth.uid()) = user_id);

-- ── lists ────────────────────────────────────────────────────────────────
ALTER POLICY lists_insert ON lists WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY lists_delete ON lists USING ((select auth.uid()) = user_id);
ALTER POLICY lists_update ON lists
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── list_items ───────────────────────────────────────────────────────────
ALTER POLICY list_items_insert ON list_items
  WITH CHECK ((select auth.uid()) = (SELECT user_id FROM lists WHERE id = list_id));
ALTER POLICY list_items_delete ON list_items
  USING ((select auth.uid()) = (SELECT user_id FROM lists WHERE id = list_id));

-- ── list_item_tracks (see note 3 above re: source directory) ───────────────
-- Verified directly against supabase/migrations/20260601000002_list_item_tracks.sql
-- -- this one joins list_items -> lists (not a direct lists.id lookup like
-- list_items' own policies above), so its clause shape is different.
-- Live policy names are lit_insert/lit_delete (not list_item_tracks_*) --
-- verified against pg_policies 2026-07-10; clause shape matches below.
ALTER POLICY lit_insert ON list_item_tracks
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM list_items li
      JOIN lists l ON l.id = li.list_id
      WHERE li.id = list_item_id AND l.user_id = (select auth.uid())
    )
  );
ALTER POLICY lit_delete ON list_item_tracks
  USING (
    EXISTS (
      SELECT 1 FROM list_items li
      JOIN lists l ON l.id = li.list_id
      WHERE li.id = list_item_id AND l.user_id = (select auth.uid())
    )
  );

-- ── pinned_albums ────────────────────────────────────────────────────────
ALTER POLICY pinned_insert ON pinned_albums WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY pinned_delete ON pinned_albums USING ((select auth.uid()) = user_id);

-- ── ranking_votes ────────────────────────────────────────────────────────
ALTER POLICY ranking_votes_insert ON ranking_votes WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY ranking_votes_delete ON ranking_votes USING ((select auth.uid()) = user_id);

-- ── profiles ─────────────────────────────────────────────────────────────
ALTER POLICY profiles_insert ON profiles WITH CHECK ((select auth.uid()) = id);
ALTER POLICY profiles_update ON profiles
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

-- ── follows ──────────────────────────────────────────────────────────────
ALTER POLICY follows_insert ON follows WITH CHECK ((select auth.uid()) = follower_id);
ALTER POLICY follows_delete ON follows USING ((select auth.uid()) = follower_id);

-- ── user_rankings ────────────────────────────────────────────────────────
ALTER POLICY user_rankings_select ON user_rankings USING ((select auth.uid()) = user_id);
ALTER POLICY user_rankings_insert ON user_rankings WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY user_rankings_update ON user_rankings
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY user_rankings_delete ON user_rankings USING ((select auth.uid()) = user_id);

-- ── user_ranking_entries ─────────────────────────────────────────────────
ALTER POLICY user_ranking_entries_select ON user_ranking_entries
  USING (EXISTS (SELECT 1 FROM user_rankings ur WHERE ur.id = ranking_id AND ur.user_id = (select auth.uid())));
ALTER POLICY user_ranking_entries_insert ON user_ranking_entries
  WITH CHECK (EXISTS (SELECT 1 FROM user_rankings ur WHERE ur.id = ranking_id AND ur.user_id = (select auth.uid())));
ALTER POLICY user_ranking_entries_delete ON user_ranking_entries
  USING (EXISTS (SELECT 1 FROM user_rankings ur WHERE ur.id = ranking_id AND ur.user_id = (select auth.uid())));

-- ── comment_likes ────────────────────────────────────────────────────────
ALTER POLICY comment_likes_insert ON comment_likes WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY comment_likes_delete ON comment_likes USING ((select auth.uid()) = user_id);

-- ── track_ratings ────────────────────────────────────────────────────────
ALTER POLICY track_ratings_insert ON track_ratings WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY track_ratings_update ON track_ratings
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY track_ratings_delete ON track_ratings USING ((select auth.uid()) = user_id);

-- ── spotify_connections ──────────────────────────────────────────────────
ALTER POLICY spotify_conn_select ON spotify_connections USING ((select auth.uid()) = user_id);
ALTER POLICY spotify_conn_insert ON spotify_connections WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY spotify_conn_update ON spotify_connections
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY spotify_conn_delete ON spotify_connections USING ((select auth.uid()) = user_id);

-- ── daily_answers (apps/web naming -- see note 2 above) ─────────────────────
ALTER POLICY daily_answers_select_own ON daily_answers USING ((select auth.uid()) = user_id);
ALTER POLICY daily_answers_insert_own ON daily_answers WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY daily_answers_update_own ON daily_answers
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY daily_answers_delete_own ON daily_answers USING ((select auth.uid()) = user_id);

-- ── pairwise_comparisons / track_pairwise_comparisons ───────────────────────
-- FOR ALL, originally USING-only -- WITH CHECK must be restated explicitly
-- too (see header note) or it keeps the stale unwrapped copy forever.
ALTER POLICY "Users manage own comparisons" ON pairwise_comparisons
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "Users manage own song comparisons" ON track_pairwise_comparisons
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── rating_likes / rating_comments ───────────────────────────────────────
ALTER POLICY "authenticated users can view likes" ON rating_likes
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY "users manage own likes" ON rating_likes
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "authenticated users can view comments" ON rating_comments
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY "users can post comments" ON rating_comments
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "users can delete own comments" ON rating_comments
  USING ((select auth.uid()) = user_id);

-- ── saved_releases ───────────────────────────────────────────────────────
ALTER POLICY "users manage own saved releases" ON saved_releases
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── notifications ────────────────────────────────────────────────────────
ALTER POLICY "users read own notifications" ON notifications
  USING ((select auth.uid()) = user_id);

-- ── mixes / mix_items ────────────────────────────────────────────────────
ALTER POLICY "users manage own mixes" ON mixes
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "users manage own mix items" ON mix_items
  USING (EXISTS (SELECT 1 FROM mixes WHERE mixes.id = mix_items.mix_id AND mixes.user_id = (select auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM mixes WHERE mixes.id = mix_items.mix_id AND mixes.user_id = (select auth.uid())));

-- ── mix_likes / mix_shares / mix_share_likes / mix_share_comments ────────
ALTER POLICY "authenticated users can view mix likes" ON mix_likes
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY "users manage own mix likes" ON mix_likes
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM mixes
      WHERE mixes.id = mix_likes.mix_id
        AND (mixes.is_public = true OR mixes.user_id = (select auth.uid()))
    )
  );
ALTER POLICY "authenticated users can view mix shares" ON mix_shares
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY "users manage own mix shares" ON mix_shares
  USING ((select auth.uid()) = user_id)
  WITH CHECK (
    (select auth.uid()) = user_id
    AND EXISTS (SELECT 1 FROM mixes WHERE mixes.id = mix_shares.mix_id AND mixes.is_public = true)
  );
ALTER POLICY "authenticated users can view mix share likes" ON mix_share_likes
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY "users manage own mix share likes" ON mix_share_likes
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "authenticated users can view mix share comments" ON mix_share_comments
  USING ((select auth.role()) = 'authenticated');
ALTER POLICY "users can post mix share comments" ON mix_share_comments
  WITH CHECK ((select auth.uid()) = user_id);
ALTER POLICY "users can delete own mix share comments" ON mix_share_comments
  USING ((select auth.uid()) = user_id);

-- ── reports / blocked_users ──────────────────────────────────────────────
-- Live policy name is "users can report" (not reports_insert) -- verified
-- against pg_policies 2026-07-10; clause targets reporter_id as below.
ALTER POLICY "users can report" ON reports WITH CHECK ((select auth.uid()) = reporter_id);
ALTER POLICY blocked_users_select ON blocked_users USING ((select auth.uid()) = blocker_id);
ALTER POLICY blocked_users_insert ON blocked_users WITH CHECK ((select auth.uid()) = blocker_id);
ALTER POLICY blocked_users_delete ON blocked_users USING ((select auth.uid()) = blocker_id);

-- ── referrals ────────────────────────────────────────────────────────────
ALTER POLICY "users view own referrals" ON referrals USING ((select auth.uid()) = referrer_id);

COMMIT;

-- ── OPTIONAL: storage.objects avatar policies (different schema, same fix) ─
-- Split out of the transaction above since it's a different schema and
-- flagged separately -- apply only if you also want this one, it's the
-- same class of issue but wasn't in the original `public`-schema advisor
-- scope this migration was written to close.
--
-- BEGIN;
-- ALTER POLICY "users can upload their own avatar" ON storage.objects
--   WITH CHECK ((storage.foldername(name))[1]::uuid = (select auth.uid()));
-- ALTER POLICY "users can update their own avatar" ON storage.objects
--   USING ((storage.foldername(name))[1]::uuid = (select auth.uid()))
--   WITH CHECK ((storage.foldername(name))[1]::uuid = (select auth.uid()));
-- ALTER POLICY "users can delete their own avatar" ON storage.objects
--   USING ((storage.foldername(name))[1]::uuid = (select auth.uid()));
-- COMMIT;
