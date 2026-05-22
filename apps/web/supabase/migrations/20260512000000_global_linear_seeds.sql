-- Apply a single global seed formula across all ranking categories:
--   seed_votes = max(0.0001, (101 - rank) / 100)
-- rank is derived from the current seed_votes ordering (DESC) within each category.
-- Result: rank 1 = 1.0, rank 2 = 0.99, rank 100 = 0.01, rank 101+ = 0.0001 for every category.
UPDATE ranking_seed_entries rse
SET seed_votes = sub.new_votes
FROM (
  SELECT
    release_id,
    category_id,
    GREATEST(0.0001, ROUND(
      (101.0 - ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY seed_votes DESC)) / 100.0,
      4
    )) AS new_votes
  FROM ranking_seed_entries
) sub
WHERE rse.release_id = sub.release_id
  AND rse.category_id = sub.category_id;
