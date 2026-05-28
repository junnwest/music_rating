-- Cleanup: clear name_native / native_language from non-Asian artists.
-- Phase 1 stored Korean/Japanese transliterations for Western artists because
-- Wikipedia has transliterated articles for virtually every famous artist.
-- This script removes those false entries and keeps only genuine Asian artists.
--
-- Run in Supabase SQL editor (Dashboard → SQL Editor → New query).

-- ── 1. Artists: clear everyone NOT in the confirmed-Asian keep list ────────────

UPDATE artists
SET name_native = NULL, native_language = NULL
WHERE native_language IS NOT NULL
  AND name NOT IN (
    -- Korean
    '3rd Line Butterfly',
    'ADOY',
    'Aseul',
    'Asian Glow',
    'Balming Tiger',
    'Beenzino',
    'BewhY',
    'Big Mama',
    'BIGBANG',
    'BILL STAX',
    'BoA',
    'BTS',
    'C JAMM',
    'CADEJO',
    'CHEETAH',
    'Crash',
    'Crush',
    'DAESUNG',
    'DAWN 던',
    'DEEPFLOW',
    'Drunken Tiger',
    'Dynamicduo',
    'E SENS',
    'Epik High',
    'G-DRAGON',
    'Garion',
    'Gemini',
    'Girls'' Generation',
    'GroovyRoom',
    'hathaw9y',
    'HYUKOH',
    'IDIOTAPE',
    'Illionaire Records',
    'Jang Pill Soon',
    'JANNABI',
    'JAURIM',
    'Jay Park',
    'Jazzyfact',
    'Jimin',
    'Jooyoung',
    'jung jaeil',
    'Jung Yong Hwa',
    'JUSTHIS',
    'Khundi Panda',
    'Kiha & The Faces',
    'Lang Lee',
    'Lee Juck',
    'Lee Seung Chul',
    'Leellamarz',
    'Leessang',
    'Lena Park',
    'Meaningful Stone',
    'MeloMance',
    'Mid-Air Thief',
    'MIRANI',
    'Nucksal',
    'offonoff',
    'OHHYUK',
    'Owen',
    'Paloalto',
    'Parannoul',
    'Peggy Gou',
    'PEPPERTONES',
    'Samuel Seo',
    'Sanchez',
    'SeeU',
    'Seo Taiji and Boys',
    'Sik-K',
    'Silica Gel',
    'Slom',
    'sokodomo',
    'Stella Jang',
    'sunwoojunga',
    'Swervy',
    'Swings',
    'TAEYANG',
    'TAEYEON',
    'The Barberettes',
    'The Black Skirts',
    'The One',
    'Verbal Jint',
    'WOODZ',
    'YANGHONGWON',
    'Yerin Baek',
    'Yoo Jae Ha',
    'Yoon Sang',
    'Younha',
    'youra',
    'Zion.T',
    -- Japanese
    'Cornelius',
    'Fishmans',
    'Haruomi Hosono',
    'Hikaru Utada',
    'Nujabes',
    'Number Girl',
    'Quruli',
    'Shigeru Suzuki',
    'Supercar',
    'Taeko Onuki',
    'Tatsuro Yamashita',
    -- Taiwanese / Chinese
    'Enno Cheng',
    'Georgia Ku',
    'Karencici',
    'Manno',
    '落日飛車 Sunset Rollercoaster'
  );

-- ── 2. Releases: clear rows where title_native has no actual non-Latin script ──
-- Phase 2 fell back to the English title when iTunes didn't have a localized title,
-- storing e.g. title_native = 'MONKEY HOTEL', native_language = 'ko'.
-- That's not a native title — it's just the English title with a language tag.
-- Keep only releases where title_native actually contains CJK / Hangul / Kana.

UPDATE releases
SET title_native = NULL, artist_native = NULL, native_language = NULL
WHERE title_native IS NOT NULL
  AND title_native !~ '[가-힣ᄀ-ᇿ一-鿿぀-ヿ]';

-- ── Verify ────────────────────────────────────────────────────────────────────

-- After running, check remaining counts:
SELECT native_language, COUNT(*) FROM artists WHERE native_language IS NOT NULL GROUP BY native_language ORDER BY 2 DESC;
SELECT COUNT(*) AS releases_with_native_title FROM releases WHERE title_native IS NOT NULL;
