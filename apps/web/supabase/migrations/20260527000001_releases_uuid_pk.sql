-- Migrate releases.id from Spotify text ID → owned UUID.
--
-- After this migration:
--   releases.id         uuid PRIMARY KEY  (our own identifier)
--   releases.spotify_id text UNIQUE       (Spotify source ID, nullable for iTunes-only)
--   releases.itunes_id  bigint UNIQUE     (already exists; iTunes source ID)
--   All release_id columns in dependent tables: text → uuid
--
-- Run in Supabase SQL editor — do NOT run via `supabase db push` since prior
-- migrations already applied against the live database.

BEGIN;

-- ── Step 1: Add spotify_id and copy existing Spotify IDs ────────────────────
ALTER TABLE releases ADD COLUMN spotify_id text;
UPDATE releases SET spotify_id = id;

-- ── Step 2: Generate a UUID for every existing row ──────────────────────────
ALTER TABLE releases ADD COLUMN new_id uuid DEFAULT gen_random_uuid();

-- ── Step 3: Drop ALL FK constraints referencing releases ────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tc.table_name, tc.constraint_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.referential_constraints AS rc
      ON tc.constraint_name = rc.constraint_name
         AND tc.constraint_schema = rc.constraint_schema
    JOIN information_schema.table_constraints AS tc2
      ON rc.unique_constraint_name = tc2.constraint_name
         AND rc.unique_constraint_schema = tc2.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc2.table_name = 'releases'
      AND tc.table_schema = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.table_name, r.constraint_name);
  END LOOP;
END $$;

-- ── Step 3b: Insert stub releases for any orphaned release_id values ─────────
-- Dependent tables may have release_id values that no longer exist in releases
-- (e.g. a rating on an album that was never cached, or was since evicted).
-- Without this step, the ALTER COLUMN ... TYPE uuid USING ... cast would fail.
-- We insert stubs so every release_id maps to a real row and gets a UUID.
INSERT INTO releases (id, spotify_id, title, artist, release_type)
SELECT DISTINCT ref.release_id, ref.release_id, 'Unknown', 'Unknown', 'Album'
FROM (
  SELECT release_id FROM ratings
  UNION
  SELECT release_id FROM reviews
  UNION
  SELECT release_id FROM rating_history
  UNION
  SELECT release_id FROM list_items
  UNION
  SELECT release_id FROM pinned_albums
  UNION
  SELECT release_id FROM ranking_votes
  UNION
  SELECT release_id FROM ranking_seed_entries
  UNION
  SELECT release_id FROM user_ranking_entries
  UNION
  SELECT release_id FROM curated_releases
) ref
WHERE NOT EXISTS (SELECT 1 FROM releases WHERE id = ref.release_id);

-- ── Step 4: Rewrite release_id values in all dependent tables ───────────────
UPDATE ratings
  SET release_id = r.new_id::text
  FROM releases r WHERE ratings.release_id = r.id;

UPDATE reviews
  SET release_id = r.new_id::text
  FROM releases r WHERE reviews.release_id = r.id;

UPDATE rating_history
  SET release_id = r.new_id::text
  FROM releases r WHERE rating_history.release_id = r.id;

UPDATE list_items
  SET release_id = r.new_id::text
  FROM releases r WHERE list_items.release_id = r.id;

UPDATE pinned_albums
  SET release_id = r.new_id::text
  FROM releases r WHERE pinned_albums.release_id = r.id;

UPDATE ranking_votes
  SET release_id = r.new_id::text
  FROM releases r WHERE ranking_votes.release_id = r.id;

UPDATE ranking_seed_entries
  SET release_id = r.new_id::text
  FROM releases r WHERE ranking_seed_entries.release_id = r.id;

UPDATE user_ranking_entries
  SET release_id = r.new_id::text
  FROM releases r WHERE user_ranking_entries.release_id = r.id;

UPDATE curated_releases
  SET release_id = r.new_id::text
  FROM releases r WHERE curated_releases.release_id = r.id;

-- ── Step 4b: Convert release_id columns from text → uuid ────────────────────
-- Every release_id is now a UUID string (from Step 4 above), so the cast is safe.
ALTER TABLE ratings              ALTER COLUMN release_id TYPE uuid USING release_id::uuid;
ALTER TABLE reviews              ALTER COLUMN release_id TYPE uuid USING release_id::uuid;
ALTER TABLE rating_history       ALTER COLUMN release_id TYPE uuid USING release_id::uuid;
ALTER TABLE list_items           ALTER COLUMN release_id TYPE uuid USING release_id::uuid;
ALTER TABLE pinned_albums        ALTER COLUMN release_id TYPE uuid USING release_id::uuid;
ALTER TABLE ranking_votes        ALTER COLUMN release_id TYPE uuid USING release_id::uuid;
ALTER TABLE ranking_seed_entries ALTER COLUMN release_id TYPE uuid USING release_id::uuid;
ALTER TABLE user_ranking_entries ALTER COLUMN release_id TYPE uuid USING release_id::uuid;
ALTER TABLE curated_releases     ALTER COLUMN release_id TYPE uuid USING release_id::uuid;

-- ── Step 5: Drop view that depends on releases.id, then swap primary key ────
-- The view references the `id` column; renaming it would make the view depend
-- on `_old_id`, blocking the DROP COLUMN later. We recreate it in Step 8b.
DROP VIEW IF EXISTS recommendable_releases;

ALTER TABLE releases DROP CONSTRAINT releases_pkey;
ALTER TABLE releases RENAME COLUMN id TO _old_id;
ALTER TABLE releases RENAME COLUMN new_id TO id;
ALTER TABLE releases ADD PRIMARY KEY (id);

-- ── Step 6: Unique index on spotify_id ──────────────────────────────────────
ALTER TABLE releases ADD CONSTRAINT releases_spotify_id_key UNIQUE (spotify_id);
CREATE INDEX idx_releases_spotify_id ON releases (spotify_id) WHERE spotify_id IS NOT NULL;

-- ── Step 7: Re-add FK constraints (uuid → uuid, now compatible) ─────────────
ALTER TABLE ratings
  ADD CONSTRAINT ratings_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;

ALTER TABLE list_items
  ADD CONSTRAINT list_items_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;

ALTER TABLE pinned_albums
  ADD CONSTRAINT pinned_albums_release_id_fkey
  FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE CASCADE;

-- ── Step 8: Drop the old id column (Spotify ID is now in spotify_id) ────────
ALTER TABLE releases DROP COLUMN _old_id;

-- ── Step 8b: Recreate view now that `id` is the UUID column ─────────────────
CREATE OR REPLACE VIEW recommendable_releases AS
  SELECT *
  FROM releases
  WHERE LOWER(release_type) IN ('album', 'ep')
    AND cover_url IS NOT NULL;

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM releases)                              AS total_releases,
  (SELECT COUNT(*) FROM releases WHERE spotify_id IS NOT NULL) AS with_spotify_id,
  (SELECT COUNT(*) FROM releases WHERE id IS NOT NULL)         AS with_uuid;

COMMIT;
