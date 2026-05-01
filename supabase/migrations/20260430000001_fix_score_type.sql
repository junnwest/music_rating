-- Fix ratings.score to support half-star values (0.5 … 5.0)
-- Any scores stored in the old 1-10 scale are converted to 0.5-5 by dividing by 2

UPDATE ratings SET score = score / 2.0 WHERE score > 5;

ALTER TABLE ratings
  ALTER COLUMN score TYPE numeric(3,1) USING score::numeric(3,1);

ALTER TABLE ratings
  DROP CONSTRAINT IF EXISTS ratings_score_check;

ALTER TABLE ratings
  ADD CONSTRAINT ratings_score_check CHECK (score BETWEEN 0.5 AND 5.0);
