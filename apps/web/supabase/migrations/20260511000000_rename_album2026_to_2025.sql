-- Rename the "Best Album of 2026" ranking category to "Best Album of 2025"
UPDATE ranking_categories
SET
  slug        = 'album-2025',
  title       = 'Best Album of 2025',
  year        = 2025
WHERE slug = 'album-2026';
