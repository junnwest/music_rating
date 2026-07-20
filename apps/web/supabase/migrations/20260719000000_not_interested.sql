-- "Not interested" — an explicit negative signal for the recommender.
--
-- Until now the only feedback a user could give a recommended album was to rate it, which means
-- the candidate sources (Quick Add, Home explore) had no way to learn that something is simply
-- unwanted: an album the user has no intention of hearing keeps coming back forever because
-- `NOT EXISTS (… ratings …)` is the only exclusion. This adds the missing signal.
--
-- Shape mirrors the other per-user/per-release signal tables (mix_items, ratings): a composite
-- primary key on (user_id, release_group_id) so marking twice is a no-op upsert, and the
-- wrapped-auth-call RLS pattern (20260708000001) from the start. Deliberately private —
-- SELECT is limited to the owner, since "things I don't want" is not social data.

CREATE TABLE IF NOT EXISTS not_interested (
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  release_group_id uuid NOT NULL REFERENCES release_groups(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, release_group_id)
);

-- The hot path is "everything this user dismissed", which the PK's leading column already
-- serves. The reverse lookup (who dismissed this album) is only for future aggregate signals.
CREATE INDEX IF NOT EXISTS idx_not_interested_release_group_id
  ON not_interested(release_group_id);

ALTER TABLE not_interested ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own not_interested"
  ON not_interested FOR ALL
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

-- ── Quick Add: exclude dismissed albums at the source ────────────────────────────────────────
-- Same body as 20260717000000 (prestige ordering preserved) plus a second NOT EXISTS. Signature
-- and columns are unchanged, so no client change is required for the exclusion to take effect.
CREATE OR REPLACE FUNCTION get_quick_add_candidates(
  p_user_id      uuid,
  p_artist_names text[],
  p_lim          int DEFAULT 20,
  p_offset       int DEFAULT 0
)
RETURNS TABLE (
  id                 uuid,
  title              text,
  artist_display     text,
  cover_url          text,
  native_title       text,
  release_group_type text,
  first_release_date text
)
LANGUAGE sql STABLE AS $$
  SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text
  FROM release_groups rg
  WHERE rg.artist_display = ANY(p_artist_names)
    AND rg.release_group_type IN ('album', 'ep')
    AND rg.cover_url IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ratings r
      WHERE r.user_id = p_user_id AND r.release_group_id = rg.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM not_interested ni
      WHERE ni.user_id = p_user_id AND ni.release_group_id = rg.id
    )
  ORDER BY array_position(p_artist_names, rg.artist_display),
           rg.prestige_score DESC NULLS LAST,
           rg.first_release_date DESC
  LIMIT p_lim
  OFFSET p_offset;
$$;
