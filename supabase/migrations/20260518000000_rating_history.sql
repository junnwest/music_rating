-- Track when a score was last changed
ALTER TABLE ratings ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Preserve revision trail
CREATE TABLE rating_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  release_id text NOT NULL,
  score numeric(3,1) NOT NULL,
  recorded_at timestamptz DEFAULT now()
);
ALTER TABLE rating_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rating_history_select" ON rating_history FOR SELECT USING (true);

-- On every score change, snapshot the new value into history
CREATE OR REPLACE FUNCTION record_rating_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.score IS DISTINCT FROM NEW.score THEN
    INSERT INTO rating_history (user_id, release_id, score)
    VALUES (NEW.user_id, NEW.release_id, NEW.score);
    NEW.updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ratings_history_trigger
BEFORE UPDATE ON ratings
FOR EACH ROW EXECUTE FUNCTION record_rating_change();
