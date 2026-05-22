-- Widen seed_votes from int to numeric so fractional Silla scores (1/rank) can be stored
ALTER TABLE ranking_seed_entries
  ALTER COLUMN seed_votes TYPE numeric(10,4) USING seed_votes::numeric(10,4);
