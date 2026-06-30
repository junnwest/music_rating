-- Work Item A — multi-artist credits for release groups (fixes #2 collab albums + #3 Kanye/Ye split).
--
-- A release_group has a single primary_artist_id, so a collab album ("4 the Youth" = JUSTHIS &
-- Paloalto) could only ever live on one artist's page, and the app derived artist identity from the
-- free-text artist_display (so "Kanye West" and "Ye" — different credit strings for the same artist
-- row — showed as two artists). This adds an ordered credit join table + RPCs so each credited
-- artist is a real, clickable row and a collab album appears on every credited artist's page.

CREATE TABLE IF NOT EXISTS release_group_artists (
  release_group_id uuid    NOT NULL REFERENCES release_groups(id) ON DELETE CASCADE,
  artist_id        uuid    NOT NULL REFERENCES artists(id)        ON DELETE CASCADE,
  position         int     NOT NULL,                 -- credit order; 0 = primary
  credited_as      text    NOT NULL,                 -- per-credit display name ("Kanye West", "Paloalto")
  join_phrase      text    NOT NULL DEFAULT '',      -- separator after this credit (" & ", " feat. ", "")
  PRIMARY KEY (release_group_id, position)
);
CREATE INDEX IF NOT EXISTS idx_rga_artist ON release_group_artists (artist_id);

ALTER TABLE release_group_artists ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "release_group_artists read" ON release_group_artists;
CREATE POLICY "release_group_artists read" ON release_group_artists FOR SELECT USING (true);

-- ── get_artist_release_groups: a collab album shows up under EVERY credited artist ──
-- Single-artist groups need no join row (matched via primary_artist_id), so only multi-credit
-- groups have to be backfilled. Same column shape as search_release_groups (iOS Release decode).
CREATE OR REPLACE FUNCTION get_artist_release_groups(p_artist_id uuid, lim int DEFAULT 60)
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
  SELECT DISTINCT ON (rg.id)
         rg.id, rg.title, rg.artist_display, rg.cover_url,
         rg.native_title, rg.release_group_type, rg.first_release_date::text
  FROM release_groups rg
  WHERE rg.primary_artist_id = p_artist_id
     OR EXISTS (
          SELECT 1 FROM release_group_artists rga
          WHERE rga.release_group_id = rg.id AND rga.artist_id = p_artist_id
        )
  ORDER BY rg.id, rg.first_release_date DESC NULLS LAST
  LIMIT lim;
$$;

-- ── get_release_group_credits: ordered clickable chips for the album page ──
-- Returns the join rows when present; otherwise synthesizes a single primary credit from
-- primary_artist_id + artist_display, so even un-backfilled / single-artist albums get one
-- id-linked chip (no string parsing on the client).
CREATE OR REPLACE FUNCTION get_release_group_credits(p_release_group_id uuid)
RETURNS TABLE (
  artist_id   uuid,
  credited_as text,
  join_phrase text,
  "position"  int   -- quoted: position is a reserved keyword in a RETURNS TABLE column list
)
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN QUERY
    SELECT rga.artist_id, rga.credited_as, rga.join_phrase, rga.position
    FROM release_group_artists rga
    WHERE rga.release_group_id = p_release_group_id
    ORDER BY rga.position;
  IF NOT FOUND THEN
    RETURN QUERY
      SELECT rg.primary_artist_id, rg.artist_display, ''::text, 0
      FROM release_groups rg
      WHERE rg.id = p_release_group_id AND rg.primary_artist_id IS NOT NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_artist_release_groups(uuid, int)   TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_release_group_credits(uuid)        TO anon, authenticated, service_role;
