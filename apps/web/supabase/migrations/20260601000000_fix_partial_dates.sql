-- Pad any remaining partial release_date values to full YYYY-MM-DD.
-- normalize-releases.ts already fixed Spotify-sourced rows; this catches
-- any iTunes-sourced rows where only a year was stored.
UPDATE releases
SET release_date = release_date || '-01-01'
WHERE release_date ~ '^\d{4}$';

UPDATE releases
SET release_date = release_date || '-01'
WHERE release_date ~ '^\d{4}-\d{2}$';
