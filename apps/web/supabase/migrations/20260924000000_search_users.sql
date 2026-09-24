-- New "Users" search category (search sillajuku profiles by username/display
-- name, alongside the existing Artists/Albums/Songs categories on both web
-- and iOS). Same shape/score scale as search_artists (20260923000000): exact
-- match = 10000, prefix match ~400-500, trigram similarity * 1000 -- kept
-- comparable to the other search RPCs even though this session's plan
-- deliberately keeps Users OUT of the cross-category "Top Match" comparison
-- (a strong username match shouldn't outrank a real artist/album match for
-- that slot) -- comparable scoring is still worth having for its own
-- internal ORDER BY, and in case that decision is revisited later.
--
-- Bot accounts (profiles.is_bot) are deprioritized via a score penalty, not
-- excluded with a WHERE clause -- matching every other bot-handling
-- convention already in this app (Discovery's Trending weights real ratings
-- 20x a bot's, 20260706000005's get_suggested_users orders is_bot ASC,
-- 20260706000003's rankings bot-decay splits rather than hides). The -5000
-- penalty is sized so a bot can still surface on an otherwise-empty/weak
-- match, but never outranks a same-strength real account.
--
-- No DROP FUNCTION IF EXISTS needed -- this is a brand-new function name,
-- not a signature change to an existing one (that requirement, established
-- by 20260706000017/20260710000001/20260923000000, only applies when a
-- RETURNS TABLE shape changes on an already-existing function).
--
-- Plain LANGUAGE sql STABLE, not SECURITY DEFINER: profiles_select is
-- already `USING (true)` (confirmed still true as of this migration --
-- 20260706000012's own header comment documents visibility was never
-- actually enforced by RLS anywhere), so an invoker-rights function already
-- has full read access, exactly like search_artists against the open
-- `artists` table.

CREATE OR REPLACE FUNCTION search_users(q text, lim int DEFAULT 10)
RETURNS TABLE (
  id           uuid,
  username     text,
  display_name text,
  avatar_url   text,
  is_verified  boolean,
  is_bot       boolean,
  score        double precision
)
LANGUAGE sql STABLE AS $$
  WITH nq AS (SELECT normalize_text(q) AS qn, lower(btrim(q)) AS ql)
  SELECT p.id, p.username, p.display_name, p.avatar_url, p.is_verified, p.is_bot,
         (
            CASE WHEN normalize_text(p.username) = nq.qn
                   OR normalize_text(coalesce(p.display_name, '')) = nq.qn THEN 10000 ELSE 0 END
          + CASE WHEN normalize_text(p.username) LIKE nq.qn || '%' THEN 500
                 WHEN normalize_text(coalesce(p.display_name, '')) LIKE nq.qn || '%' THEN 400 ELSE 0 END
          + GREATEST(
              word_similarity(nq.ql, lower(p.username)),
              coalesce(word_similarity(nq.ql, lower(p.display_name)), 0)
            ) * 1000
          - CASE WHEN p.is_bot THEN 5000 ELSE 0 END
         ) AS score
  FROM profiles p, nq
  WHERE nq.qn <> ''
    AND (
         normalize_text(p.username) LIKE '%' || nq.qn || '%'
      OR normalize_text(coalesce(p.display_name, '')) LIKE '%' || nq.qn || '%'
      OR nq.ql <% lower(p.username)
    )
  ORDER BY score DESC
  LIMIT lim;
$$;

GRANT EXECUTE ON FUNCTION search_users(text, int) TO anon, authenticated, service_role;
