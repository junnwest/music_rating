-- ── Mixes ───────────────────────────────────────────────────────────────────
-- A "Mix" is a user-curated collection of releases.
-- Every user gets a default "Listen Later" mix on signup (via trigger below).
-- Users can also create unlimited custom mixes.

CREATE TABLE IF NOT EXISTS mixes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL CHECK (char_length(name) > 0),
  is_public  BOOLEAN     NOT NULL DEFAULT false,
  is_default BOOLEAN     NOT NULL DEFAULT false,  -- true only for "Listen Later"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mixes_one_default_per_user
  ON mixes (user_id) WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_mixes_user_id ON mixes(user_id);

-- ── Mix items ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS mix_items (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  mix_id     UUID        NOT NULL REFERENCES mixes(id)    ON DELETE CASCADE,
  release_id UUID        NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mix_id, release_id)
);

CREATE INDEX IF NOT EXISTS idx_mix_items_mix_id    ON mix_items(mix_id);
CREATE INDEX IF NOT EXISTS idx_mix_items_release_id ON mix_items(release_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE mixes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE mix_items  ENABLE ROW LEVEL SECURITY;

-- mixes: owner can do everything; others can only read public mixes
CREATE POLICY "users manage own mixes"
  ON mixes FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "public mixes are viewable"
  ON mixes FOR SELECT
  USING (is_public = true);

-- mix_items: access follows the parent mix's visibility
CREATE POLICY "users manage own mix items"
  ON mix_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM mixes
      WHERE mixes.id = mix_items.mix_id
        AND mixes.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM mixes
      WHERE mixes.id = mix_items.mix_id
        AND mixes.user_id = auth.uid()
    )
  );

CREATE POLICY "public mix items are viewable"
  ON mix_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM mixes
      WHERE mixes.id = mix_items.mix_id
        AND mixes.is_public = true
    )
  );

-- ── Trigger: auto-create "Listen Later" for new users ───────────────────────

CREATE OR REPLACE FUNCTION _create_default_mix()
RETURNS TRIGGER LANGUAGE PLPGSQL SECURITY DEFINER AS $$
BEGIN
  INSERT INTO mixes (user_id, name, is_public, is_default)
  VALUES (NEW.id, 'Listen Later', false, true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_default_mix ON profiles;
CREATE TRIGGER trg_create_default_mix
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION _create_default_mix();

-- ── Backfill: create "Listen Later" for all existing users ──────────────────

INSERT INTO mixes (user_id, name, is_public, is_default)
SELECT id, 'Listen Later', false, true
FROM profiles
WHERE id NOT IN (SELECT user_id FROM mixes WHERE is_default = true)
ON CONFLICT DO NOTHING;
