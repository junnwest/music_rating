-- Quest-completion badge (2026-07-08): a colored flower badge a user claims once, permanently,
-- after finishing every personal "Getting Started" quest. The color is the user's own one-time
-- choice from a small curated palette -- enforced here, not just in the client, since a claimed
-- color is meant to be a permanent collectible, not something a buggy/malicious client can rewrite.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS badge_color text;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_badge_color_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_badge_color_check
  CHECK (badge_color IS NULL OR badge_color IN ('gold', 'coral', 'violet', 'mint', 'rose'));

-- Deliberately does NOT re-validate "did this user actually complete every quest" -- that
-- condition is computed client-side from several tables (ratings, follows, verified phone,
-- verified invites) already duplicated once in QuestChecklistViewModel; re-deriving it in SQL
-- here would be a second copy of that business logic for a low-stakes cosmetic feature. What
-- DOES need a hard server-side guarantee is permanence, since that's the one promise made to
-- the user ("this can't be changed once claimed") that a client-side check alone can't enforce.
CREATE OR REPLACE FUNCTION prevent_badge_color_change() RETURNS trigger AS $$
BEGIN
  IF OLD.badge_color IS NOT NULL AND NEW.badge_color IS DISTINCT FROM OLD.badge_color THEN
    RAISE EXCEPTION 'badge_color cannot be changed once claimed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_badge_color_change ON profiles;
CREATE TRIGGER trg_prevent_badge_color_change
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION prevent_badge_color_change();
