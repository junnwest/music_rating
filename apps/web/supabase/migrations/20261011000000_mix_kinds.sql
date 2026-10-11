-- ════════════════════════════════════════════════════════════════════════════
-- Mixes are typed: an album Mix or a song Mix.  2026-10-11
-- ════════════════════════════════════════════════════════════════════════════
--
-- Albums come first in this app; a Mix now holds one kind of thing. The type
-- is chosen when the Mix is created and can never change. Album Mixes hold
-- `mix_items`, song Mixes hold `mix_song_items`. The default "Listen Later" Mix
-- is always an album Mix. Album-Mix share posts sit with album ratings on the
-- profile; song-Mix posts show in the feed and on the Mix tab only (client
-- side).
--
-- Live data at the time of writing: 28 Mixes (25 Listen Later, 5 album-only,
-- 22 empty, 0 song-only) and ONE with both, 믹스엔믹스마스터 (2 albums + 1 song).
-- Decided: it becomes an album Mix and its song is dropped. A song-only custom
-- Mix (none today) would become a song Mix.
--
-- Enforced in the DB (triggers), so an old app build that tries to put a song
-- into an album Mix gets an error instead of a mixed Mix.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- Drift guard (live functions have been edited in place before): both functions
-- below are rewritten from their repo definitions (20260706000015,
-- 20260722000000). Abort rather than overwrite a body this hasn't seen.
DO $guard$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_mix_covers(uuid[], int)'::regprocedure)
     IS DISTINCT FROM '50223d084baf10c34fabc067c1851607' THEN
    RAISE EXCEPTION 'get_mix_covers differs from 20260706000015 -- not overwriting';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_profile_mixes(uuid)'::regprocedure)
     IS DISTINCT FROM 'f126eee3f0c4b7dcf8ff105a57585b47' THEN
    RAISE EXCEPTION 'get_profile_mixes differs from 20260722000000 -- not overwriting';
  END IF;
END $guard$;

ALTER TABLE mixes ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'album';
ALTER TABLE mixes DROP CONSTRAINT IF EXISTS mixes_kind_check;
ALTER TABLE mixes ADD CONSTRAINT mixes_kind_check CHECK (kind IN ('album', 'song'));

UPDATE mixes m SET kind = 'song'
WHERE NOT m.is_default
  AND EXISTS (SELECT 1 FROM mix_song_items si WHERE si.mix_id = m.id)
  AND NOT EXISTS (SELECT 1 FROM mix_items ai WHERE ai.mix_id = m.id);

-- Every other Mix is an album Mix; songs in them go (1 row today).
DELETE FROM mix_song_items si USING mixes m WHERE m.id = si.mix_id AND m.kind = 'album';

ALTER TABLE mixes DROP CONSTRAINT IF EXISTS mixes_default_is_album;
ALTER TABLE mixes ADD CONSTRAINT mixes_default_is_album CHECK (NOT is_default OR kind = 'album');

-- The type is fixed at creation.
CREATE OR REPLACE FUNCTION _mix_kind_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind THEN
    RAISE EXCEPTION 'a Mix''s type can''t be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mix_kind_immutable ON mixes;
CREATE TRIGGER trg_mix_kind_immutable
  BEFORE UPDATE OF kind ON mixes
  FOR EACH ROW EXECUTE FUNCTION _mix_kind_immutable();

-- Items must match their Mix. SECURITY DEFINER so the lookup doesn't depend
-- on the caller seeing the Mix row (RLS already decides who may insert).
CREATE OR REPLACE FUNCTION _mix_item_kind_check()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mix_kind text;
BEGIN
  SELECT kind INTO mix_kind FROM mixes WHERE id = NEW.mix_id;
  IF mix_kind IS DISTINCT FROM TG_ARGV[0] THEN
    RAISE EXCEPTION 'this Mix holds %s only', coalesce(mix_kind, '?') USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mix_items_kind ON mix_items;
CREATE TRIGGER trg_mix_items_kind
  BEFORE INSERT OR UPDATE OF mix_id ON mix_items
  FOR EACH ROW EXECUTE FUNCTION _mix_item_kind_check('album');

DROP TRIGGER IF EXISTS trg_mix_song_items_kind ON mix_song_items;
CREATE TRIGGER trg_mix_song_items_kind
  BEFORE INSERT OR UPDATE OF mix_id ON mix_song_items
  FOR EACH ROW EXECUTE FUNCTION _mix_item_kind_check('song');

-- Covers: song Mixes take theirs from the album each song was saved from.
-- Same signature and shape; one row per (mix, album), newest first.
CREATE OR REPLACE FUNCTION get_mix_covers(p_mix_ids uuid[], p_limit int DEFAULT 10)
RETURNS TABLE (mix_id uuid, release_group_id uuid, cover_url text)
LANGUAGE sql STABLE AS $$
  SELECT mix_id, release_group_id, cover_url FROM (
    SELECT x.mix_id, x.release_group_id, rg.cover_url,
           row_number() OVER (PARTITION BY x.mix_id ORDER BY x.created_at DESC) AS rn
    FROM (
      SELECT mi.mix_id, mi.release_group_id, mi.created_at FROM mix_items mi
      WHERE mi.mix_id = ANY(p_mix_ids)
      UNION ALL
      -- Parenthesised: an ORDER BY after a UNION member otherwise applies to
      -- the whole union, where `si` isn't in scope.
      (SELECT DISTINCT ON (si.mix_id, si.release_group_id) si.mix_id, si.release_group_id, si.created_at
       FROM mix_song_items si
       WHERE si.mix_id = ANY(p_mix_ids)
       ORDER BY si.mix_id, si.release_group_id, si.created_at DESC)
    ) x
    JOIN release_groups rg ON rg.id = x.release_group_id
  ) sub
  WHERE rn <= p_limit;
$$;
GRANT EXECUTE ON FUNCTION get_mix_covers(uuid[], int) TO anon, authenticated;

-- get_profile_mixes: + `kind`, so other people's Mixes show their type.
-- Adding a returned column changes the signature: drop and recreate.
DROP FUNCTION IF EXISTS get_profile_mixes(uuid);
CREATE FUNCTION get_profile_mixes(p_user_id uuid)
RETURNS TABLE(id uuid, user_id uuid, name text, description text, is_public boolean,
              is_default boolean, created_at timestamptz, item_count bigint, kind text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT _sj_can_view(pr.id, auth.uid(), COALESCE(pr.library_visibility, pr.profile_visibility))
  INTO v_allowed FROM profiles pr WHERE pr.id = p_user_id;

  IF NOT COALESCE(v_allowed, false) THEN RETURN; END IF;

  RETURN QUERY
    SELECT m.id, m.user_id, m.name, m.description, m.is_public, m.is_default, m.created_at,
           COALESCE(mi.cnt, 0) + COALESCE(msi.cnt, 0) AS item_count, m.kind
    FROM mixes m
    LEFT JOIN (
      SELECT mix_id, COUNT(*) AS cnt FROM mix_items GROUP BY mix_id
    ) mi ON mi.mix_id = m.id
    LEFT JOIN (
      SELECT mix_id, COUNT(*) AS cnt FROM mix_song_items GROUP BY mix_id
    ) msi ON msi.mix_id = m.id
    WHERE m.user_id = p_user_id AND m.is_public = true
    ORDER BY m.is_default DESC, m.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION get_profile_mixes(uuid) TO anon, authenticated;

COMMIT;
