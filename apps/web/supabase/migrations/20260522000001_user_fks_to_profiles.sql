-- Migrate all user_id foreign keys from auth.users → profiles
--
-- Why: PostgREST only introspects the public schema. FKs pointing to
-- auth.users (auth schema) are invisible to PostgREST, so embedded joins
-- like profiles!fkey(*) silently return null. Pointing to profiles(id)
-- keeps the same UUIDs and the same cascade semantics (profiles itself
-- already cascades from auth.users), while making the relationship
-- visible to PostgREST.

-- ── Safety: remove any orphaned rows that lack a profile ────────────────
-- In normal operation these should not exist, but the constraint will
-- fail if they do.
DELETE FROM comment_likes  WHERE user_id      NOT IN (SELECT id FROM profiles);
DELETE FROM ranking_votes  WHERE user_id      NOT IN (SELECT id FROM profiles);
DELETE FROM user_rankings  WHERE user_id      NOT IN (SELECT id FROM profiles);
DELETE FROM reviews        WHERE user_id      NOT IN (SELECT id FROM profiles);
DELETE FROM ratings        WHERE user_id      NOT IN (SELECT id FROM profiles);
DELETE FROM lists          WHERE user_id      NOT IN (SELECT id FROM profiles);
DELETE FROM pinned_albums  WHERE user_id      NOT IN (SELECT id FROM profiles);
DELETE FROM follows
  WHERE follower_id  NOT IN (SELECT id FROM profiles)
     OR following_id NOT IN (SELECT id FROM profiles);

-- ── Retarget FKs ────────────────────────────────────────────────────────

ALTER TABLE ratings
  DROP CONSTRAINT IF EXISTS ratings_user_id_fkey,
  ADD  CONSTRAINT ratings_user_id_fkey        FOREIGN KEY (user_id)      REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE reviews
  DROP CONSTRAINT IF EXISTS reviews_user_id_fkey,
  ADD  CONSTRAINT reviews_user_id_fkey        FOREIGN KEY (user_id)      REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE lists
  DROP CONSTRAINT IF EXISTS lists_user_id_fkey,
  ADD  CONSTRAINT lists_user_id_fkey          FOREIGN KEY (user_id)      REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE pinned_albums
  DROP CONSTRAINT IF EXISTS pinned_albums_user_id_fkey,
  ADD  CONSTRAINT pinned_albums_user_id_fkey  FOREIGN KEY (user_id)      REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE ranking_votes
  DROP CONSTRAINT IF EXISTS ranking_votes_user_id_fkey,
  ADD  CONSTRAINT ranking_votes_user_id_fkey  FOREIGN KEY (user_id)      REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE user_rankings
  DROP CONSTRAINT IF EXISTS user_rankings_user_id_fkey,
  ADD  CONSTRAINT user_rankings_user_id_fkey  FOREIGN KEY (user_id)      REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE comment_likes
  DROP CONSTRAINT IF EXISTS comment_likes_user_id_fkey,
  ADD  CONSTRAINT comment_likes_user_id_fkey  FOREIGN KEY (user_id)      REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE follows
  DROP CONSTRAINT IF EXISTS follows_follower_id_fkey,
  ADD  CONSTRAINT follows_follower_id_fkey    FOREIGN KEY (follower_id)  REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE follows
  DROP CONSTRAINT IF EXISTS follows_following_id_fkey,
  ADD  CONSTRAINT follows_following_id_fkey   FOREIGN KEY (following_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ── Fix missing release FK on pinned_albums ─────────────────────────────
-- release_id had no FK to releases, so PostgREST join silently returned
-- null (causing essentials to appear empty on mobile).
ALTER TABLE pinned_albums
  DROP CONSTRAINT IF EXISTS pinned_albums_release_id_fkey,
  ADD  CONSTRAINT pinned_albums_release_id_fkey FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;
