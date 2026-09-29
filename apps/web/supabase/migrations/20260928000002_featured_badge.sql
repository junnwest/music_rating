-- Which one badge a user shows next to their @handle on posts (2026-09-28).
-- Posts show a single badge so handles never get squeezed onto two lines;
-- the profile header still shows every badge the user owns.
--
-- NULL = automatic: the clients pick the first owned badge in the order
-- verified > founding > quest. A stored value the user no longer owns also
-- falls back to automatic, so no ownership check is needed here.
--
-- Owners already update their own profiles row, and the guard triggers only
-- block badge_color / founding_number / is_verified, so no policy change.
--
-- APPLY BEFORE shipping the iOS build / web deploy that selects it.

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS featured_badge text
  CHECK (featured_badge IS NULL OR featured_badge IN ('verified', 'founding', 'quest'));

COMMENT ON COLUMN profiles.featured_badge IS
  'Badge shown beside the @handle on posts: verified | founding | quest. NULL = automatic (first owned in that order).';

COMMIT;
