-- Stores the user's preferred recommendation adventurousness (0 = conservative, 100 = adventurous).
-- Used by /api/recommendations to proportion in-taste / adjacent / discovery slots.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS recommendation_adventurousness smallint NOT NULL DEFAULT 50
    CHECK (recommendation_adventurousness BETWEEN 0 AND 100);
