-- Bot-vs-real-user interaction boundary, enforced at the DB layer.
--
-- Why here and not RLS/app code: every bot-generation script (create-bots.ts,
-- generate-bot-ratings.ts, and the new generate-bot-follows.ts/generate-bot-
-- social.ts) runs via SUPABASE_SERVICE_ROLE_KEY (scripts/itunes-ingest-core.ts's
-- getDB()), which bypasses RLS entirely. An RLS policy would be silently
-- useless against these scripts. A trigger is the one layer service-role
-- writes still pass through -- so it's the actual backstop, not the app-level
-- "filter your targets" discipline in the generator scripts (which stays the
-- primary mechanism; this is what catches it if that discipline has a bug).
--
-- Rule: if the acting user (follower/liker/commenter) is a bot AND the target
-- being acted on belongs to a real (non-bot) user, block it. Real users are
-- completely unaffected -- this only fires when the ACTOR is a bot, and only
-- on INSERT (a real user unfollowing/unliking a bot is a DELETE, untouched).
--
-- One function, attached to all four tables, since each table's "who owns the
-- target" join differs (comment_likes targets `reviews`, not `rating_comments`,
-- despite the name).

CREATE OR REPLACE FUNCTION block_bot_actions_on_real_users()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor_is_bot   boolean;
  target_is_bot  boolean;
BEGIN
  IF TG_TABLE_NAME = 'follows' THEN
    SELECT is_bot INTO actor_is_bot  FROM profiles WHERE id = NEW.follower_id;
    SELECT is_bot INTO target_is_bot FROM profiles WHERE id = NEW.following_id;
  ELSIF TG_TABLE_NAME = 'rating_likes' OR TG_TABLE_NAME = 'rating_comments' THEN
    SELECT is_bot INTO actor_is_bot FROM profiles WHERE id = NEW.user_id;
    SELECT p.is_bot INTO target_is_bot
      FROM ratings r JOIN profiles p ON p.id = r.user_id
      WHERE r.id = NEW.rating_id;
  ELSIF TG_TABLE_NAME = 'comment_likes' THEN
    SELECT is_bot INTO actor_is_bot FROM profiles WHERE id = NEW.user_id;
    SELECT p.is_bot INTO target_is_bot
      FROM reviews rv JOIN profiles p ON p.id = rv.user_id
      WHERE rv.id = NEW.comment_id;
  ELSE
    RETURN NEW; -- attached to an unexpected table; don't block unrelated writes
  END IF;

  IF COALESCE(actor_is_bot, false) = true AND COALESCE(target_is_bot, false) = false THEN
    RAISE EXCEPTION 'bot-authored % blocked: bots may not act on real users'' content', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS block_bot_follows_on_real       ON follows;
DROP TRIGGER IF EXISTS block_bot_rating_likes_on_real   ON rating_likes;
DROP TRIGGER IF EXISTS block_bot_rating_comments_on_real ON rating_comments;
DROP TRIGGER IF EXISTS block_bot_comment_likes_on_real  ON comment_likes;

CREATE TRIGGER block_bot_follows_on_real
BEFORE INSERT ON follows
FOR EACH ROW EXECUTE FUNCTION block_bot_actions_on_real_users();

CREATE TRIGGER block_bot_rating_likes_on_real
BEFORE INSERT ON rating_likes
FOR EACH ROW EXECUTE FUNCTION block_bot_actions_on_real_users();

CREATE TRIGGER block_bot_rating_comments_on_real
BEFORE INSERT ON rating_comments
FOR EACH ROW EXECUTE FUNCTION block_bot_actions_on_real_users();

CREATE TRIGGER block_bot_comment_likes_on_real
BEFORE INSERT ON comment_likes
FOR EACH ROW EXECUTE FUNCTION block_bot_actions_on_real_users();
