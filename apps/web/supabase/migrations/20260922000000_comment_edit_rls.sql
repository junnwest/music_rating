-- Adds UPDATE RLS policies for the three comment tables (rating_comments,
-- track_rating_comments, mix_share_comments), none of which had one --
-- SELECT/INSERT/DELETE already existed for each (own-row DELETE, in
-- particular, already covers a "delete my comment" feature with no
-- migration needed), but a user could never edit their own comment's
-- content, since there was nothing granting UPDATE at all. New policies
-- only, matching the shape/wrapped-auth-call convention every other
-- own-row policy in this file family already uses (see
-- 20260708000001_rls_auth_initplan_fix.sql's own header comment for why
-- `(select auth.uid())`, not a bare `auth.uid()`, is the correct form).
--
-- `WITH CHECK` repeats the same `user_id` ownership check as `USING` --
-- without it, Postgres would allow the update to *change* `user_id` away
-- from the current user (or, on a row `USING` had already let through, to
-- something else entirely) as long as the row matched at read time; `WITH
-- CHECK` is what's actually enforced against the row's new values.

CREATE POLICY "users can edit own comments"
  ON rating_comments FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "users can edit own track comments"
  ON track_rating_comments FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "users can edit own mix share comments"
  ON mix_share_comments FOR UPDATE
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);
