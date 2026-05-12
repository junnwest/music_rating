-- Replace global linear seed formula with exponential decay: seed_votes = 0.99^(rank-1)
-- rank 1 = 1.0, rank 2 = 0.99, rank 100 = 0.366, rank 500 = 0.007
-- Never reaches 0 — works for any category size.
UPDATE ranking_seed_entries rse
SET seed_votes = sub.new_votes
FROM (
  SELECT
    release_id,
    category_id,
    ROUND(
      POWER(0.99, ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY seed_votes DESC) - 1),
      4
    ) AS new_votes
  FROM ranking_seed_entries
) sub
WHERE rse.release_id = sub.release_id
  AND rse.category_id = sub.category_id;
