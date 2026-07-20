-- get_artist_release_groups was taking ~0.8s warm / ~1.8s cold for a dozen
-- rows: `WHERE rg.primary_artist_id = $1 OR EXISTS (...)` can't use
-- idx_release_groups_artist through the OR, so Postgres scanned all ~413k
-- release_groups and probed release_group_artists per row. Rewritten as a
-- UNION of two independently index-driven branches (idx_release_groups_artist
-- + idx_rga_artist); UNION dedupes, so the old DISTINCT ON goes too.
--
-- Also fixes the ordering: the old DISTINCT ON form had to ORDER BY rg.id
-- first, so results came back id-ordered; now they're newest-first, matching
-- the artist page's default sort and the no-artist-id ilike fallback path.
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
  SELECT u.id, u.title, u.artist_display, u.cover_url,
         u.native_title, u.release_group_type, u.first_release_date
  FROM (
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
           rg.native_title, rg.release_group_type, rg.first_release_date::text
    FROM release_groups rg
    WHERE rg.primary_artist_id = p_artist_id
    UNION
    SELECT rg.id, rg.title, rg.artist_display, rg.cover_url,
           rg.native_title, rg.release_group_type, rg.first_release_date::text
    FROM release_groups rg
    JOIN release_group_artists rga ON rga.release_group_id = rg.id
    WHERE rga.artist_id = p_artist_id
  ) u
  ORDER BY u.first_release_date DESC NULLS LAST
  LIMIT lim;
$$;
