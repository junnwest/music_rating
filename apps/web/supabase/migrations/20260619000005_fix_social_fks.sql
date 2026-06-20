-- Fix: retarget user_id FKs from auth.users → profiles on social tables
--
-- Why: PostgREST only introspects the public schema. FKs pointing to
-- auth.users are invisible to it, so embedded joins like
-- profiles(username, display_name) silently return null, making comments
-- and likes appear empty even after a successful insert.
-- Same fix pattern as 20260522000001_user_fks_to_profiles.sql.

-- Safety: remove orphaned rows that lack a profile (should be none in practice)
DELETE FROM rating_likes    WHERE user_id NOT IN (SELECT id FROM profiles);
DELETE FROM rating_comments WHERE user_id NOT IN (SELECT id FROM profiles);

-- rating_likes
ALTER TABLE rating_likes
  DROP CONSTRAINT IF EXISTS rating_likes_user_id_fkey,
  ADD  CONSTRAINT rating_likes_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- rating_comments
ALTER TABLE rating_comments
  DROP CONSTRAINT IF EXISTS rating_comments_user_id_fkey,
  ADD  CONSTRAINT rating_comments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- Note: saved_releases is handled by 000003 (table doesn't exist yet, created fresh with correct FK)
