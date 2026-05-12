-- Rescale seed_votes from 1/rank (harmonic) to linear: (N - rank + 1) / N
-- The current ordering by seed_votes DESC already reflects the original ranks,
-- so ROW_NUMBER() over that ordering gives us the correct rank per category.
UPDATE ranking_seed_entries rse
SET seed_votes = sub.new_votes
FROM (
  SELECT
    release_id,
    category_id,
    ROUND(
      (COUNT(*) OVER (PARTITION BY category_id) - ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY seed_votes DESC) + 1.0)
      / COUNT(*) OVER (PARTITION BY category_id),
      4
    ) AS new_votes
  FROM ranking_seed_entries
) sub
WHERE rse.release_id = sub.release_id
  AND rse.category_id = sub.category_id;
