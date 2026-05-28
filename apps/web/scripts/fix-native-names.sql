-- Fix incorrect name_native / native_language values from Phase 1 errors.
-- Run in Supabase SQL editor before re-running backfill:native:releases.

-- ── Korean artists with wrong name_native ─────────────────────────────────────

-- Phase 1 captured a single-syllable Wikipedia redirect instead of the full name
UPDATE artists SET name_native = '유재하'  WHERE name = 'Yoo Jae Ha';

-- Phase 1 stored name with a space; iTunes KR indexes them without one
UPDATE artists SET name_native = '실리카겔' WHERE name = 'Silica Gel';

-- ── Japanese artists misclassified as Korean ──────────────────────────────────
-- Phase 1 picked Korean Wikipedia langlinks for these artists.
-- Switching to ja + Japanese name lets Phase 2 search iTunes JP
-- and find albums with actual Japanese-script titles.

UPDATE artists SET name_native = 'フィッシュマンズ', native_language = 'ja' WHERE name = 'Fishmans';
UPDATE artists SET name_native = 'スーパーカー',     native_language = 'ja' WHERE name = 'Supercar';
UPDATE artists SET name_native = 'ヌジャベス',       native_language = 'ja' WHERE name = 'Nujabes';
UPDATE artists SET name_native = 'コーネリアス',     native_language = 'ja' WHERE name = 'Cornelius';
UPDATE artists SET name_native = '細野晴臣',         native_language = 'ja' WHERE name = 'Haruomi Hosono';
UPDATE artists SET name_native = '大貫妙子',         native_language = 'ja' WHERE name = 'Taeko Onuki';
UPDATE artists SET name_native = '山下達郎',         native_language = 'ja' WHERE name = 'Tatsuro Yamashita';
UPDATE artists SET name_native = '鈴木茂',           native_language = 'ja' WHERE name = 'Shigeru Suzuki';
UPDATE artists SET name_native = 'くるり',           native_language = 'ja' WHERE name = 'Quruli';
UPDATE artists SET name_native = 'ナンバーガール',   native_language = 'ja' WHERE name = 'Number Girl';
UPDATE artists SET name_native = '宇多田ヒカル',     native_language = 'ja' WHERE name = 'Hikaru Utada';

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT name, name_native, native_language
FROM artists
WHERE name IN (
  'Yoo Jae Ha', 'Silica Gel',
  'Fishmans', 'Supercar', 'Nujabes', 'Cornelius',
  'Haruomi Hosono', 'Taeko Onuki', 'Tatsuro Yamashita', 'Shigeru Suzuki',
  'Quruli', 'Number Girl', 'Hikaru Utada'
)
ORDER BY native_language, name;
