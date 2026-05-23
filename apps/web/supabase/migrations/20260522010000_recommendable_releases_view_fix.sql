-- Re-applies the recommendable_releases view with case-insensitive release_type
-- matching. The previous migration (20260522000000) was edited in-place after
-- being applied once, so Supabase considered it "done" and the LOWER() fix
-- never reached production. This migration forces the corrected definition.
CREATE OR REPLACE VIEW recommendable_releases AS
  SELECT *
  FROM releases
  WHERE LOWER(release_type) IN ('album', 'ep')
    AND cover_url IS NOT NULL;
