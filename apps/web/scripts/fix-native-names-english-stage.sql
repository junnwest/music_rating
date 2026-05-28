-- Manual native name corrections for artists with English-only stage names.
-- Phase 1 (Wikipedia langlinks) cannot find Korean-script names for these
-- because their Wikipedia articles use the Latin stage name as the title.
--
-- Safe to re-run: WHERE name_native IS NULL guard prevents overwriting
-- any names that were correctly set by Phase 1.
--
-- Run in Supabase SQL editor, then run:
--   npm run backfill:native:releases   (to propagate to releases table)
--   npm run backfill:embeddings        (to re-embed releases with new native names)

-- ── Artists ───────────────────────────────────────────────────────────────────

UPDATE artists SET name_native = '아이유',           native_language = 'ko' WHERE name = 'IU'                    AND name_native IS NULL;
UPDATE artists SET name_native = '아이브',           native_language = 'ko' WHERE name = 'IVE'                   AND name_native IS NULL;
UPDATE artists SET name_native = '뉴진스',           native_language = 'ko' WHERE name = 'NewJeans'              AND name_native IS NULL;
UPDATE artists SET name_native = '에스파',           native_language = 'ko' WHERE name = 'aespa'                 AND name_native IS NULL;
UPDATE artists SET name_native = '르세라핌',         native_language = 'ko' WHERE name = 'LE SSERAFIM'           AND name_native IS NULL;
UPDATE artists SET name_native = '투모로우바이투게더', native_language = 'ko' WHERE name = 'TOMORROW X TOGETHER'  AND name_native IS NULL;
UPDATE artists SET name_native = '레드벨벳',         native_language = 'ko' WHERE name = 'Red Velvet'            AND name_native IS NULL;
UPDATE artists SET name_native = '청하',             native_language = 'ko' WHERE name = 'CHUNG HA'              AND name_native IS NULL;
UPDATE artists SET name_native = '투애니원',         native_language = 'ko' WHERE name = '2NE1'                  AND name_native IS NULL;
UPDATE artists SET name_native = '엔믹스',           native_language = 'ko' WHERE name = 'NMIXX'                 AND name_native IS NULL;
UPDATE artists SET name_native = '블랙핑크',         native_language = 'ko' WHERE name = 'BLACKPINK'             AND name_native IS NULL;
UPDATE artists SET name_native = '엑소',             native_language = 'ko' WHERE name = 'EXO'                   AND name_native IS NULL;
UPDATE artists SET name_native = '트와이스',         native_language = 'ko' WHERE name = 'TWICE'                 AND name_native IS NULL;
UPDATE artists SET name_native = '스트레이 키즈',    native_language = 'ko' WHERE name = 'Stray Kids'            AND name_native IS NULL;
UPDATE artists SET name_native = '있지',             native_language = 'ko' WHERE name = 'ITZY'                  AND name_native IS NULL;
UPDATE artists SET name_native = '(여자)아이들',     native_language = 'ko' WHERE name = '(G)I-DLE'              AND name_native IS NULL;
UPDATE artists SET name_native = '몬스타엑스',       native_language = 'ko' WHERE name = 'MONSTA X'              AND name_native IS NULL;
UPDATE artists SET name_native = '갓세븐',           native_language = 'ko' WHERE name = 'GOT7'                  AND name_native IS NULL;
UPDATE artists SET name_native = '샤이니',           native_language = 'ko' WHERE name = 'SHINee'                AND name_native IS NULL;
UPDATE artists SET name_native = '에프엑스',         native_language = 'ko' WHERE name = 'f(x)'                  AND name_native IS NULL;
UPDATE artists SET name_native = '씨스타',           native_language = 'ko' WHERE name = 'SISTAR'                AND name_native IS NULL;
UPDATE artists SET name_native = '인피니트',         native_language = 'ko' WHERE name = 'INFINITE'              AND name_native IS NULL;
UPDATE artists SET name_native = '카라',             native_language = 'ko' WHERE name = 'KARA'                  AND name_native IS NULL;
UPDATE artists SET name_native = '제이홉',           native_language = 'ko' WHERE name = 'j-hope'                AND name_native IS NULL;
UPDATE artists SET name_native = '엔씨티',           native_language = 'ko' WHERE name = 'NCT'                   AND name_native IS NULL;
UPDATE artists SET name_native = '엔씨티 127',       native_language = 'ko' WHERE name = 'NCT 127'               AND name_native IS NULL;
UPDATE artists SET name_native = '엔씨티 드림',      native_language = 'ko' WHERE name = 'NCT Dream'             AND name_native IS NULL;
UPDATE artists SET name_native = '엔씨티 유',        native_language = 'ko' WHERE name = 'NCT U'                 AND name_native IS NULL;
UPDATE artists SET name_native = '티아라',           native_language = 'ko' WHERE name = 'T-ARA'                 AND name_native IS NULL;
UPDATE artists SET name_native = '원더걸스',         native_language = 'ko' WHERE name = 'Wonder Girls'          AND name_native IS NULL;
UPDATE artists SET name_native = '미쓰에이',         native_language = 'ko' WHERE name = 'miss A'                AND name_native IS NULL;
UPDATE artists SET name_native = '포미닛',           native_language = 'ko' WHERE name = '4MINUTE'               AND name_native IS NULL;
UPDATE artists SET name_native = '애프터스쿨',       native_language = 'ko' WHERE name = 'After School'          AND name_native IS NULL;
UPDATE artists SET name_native = '빅스',             native_language = 'ko' WHERE name = 'VIXX'                  AND name_native IS NULL;
UPDATE artists SET name_native = '비원에이포',       native_language = 'ko' WHERE name = 'B1A4'                  AND name_native IS NULL;
UPDATE artists SET name_native = '틴탑',             native_language = 'ko' WHERE name = 'Teen Top'              AND name_native IS NULL;
UPDATE artists SET name_native = '블락비',           native_language = 'ko' WHERE name = 'Block B'               AND name_native IS NULL;
UPDATE artists SET name_native = '하이라이트',       native_language = 'ko' WHERE name = 'Highlight'             AND name_native IS NULL;
UPDATE artists SET name_native = '에이오에이',       native_language = 'ko' WHERE name = 'AOA'                   AND name_native IS NULL;
UPDATE artists SET name_native = '슈퍼주니어',       native_language = 'ko' WHERE name = 'Super Junior'          AND name_native IS NULL;
UPDATE artists SET name_native = '위너',             native_language = 'ko' WHERE name = 'WINNER'                AND name_native IS NULL;
UPDATE artists SET name_native = '아이콘',           native_language = 'ko' WHERE name = 'iKON'                  AND name_native IS NULL;
UPDATE artists SET name_native = '세븐틴',           native_language = 'ko' WHERE name = 'SEVENTEEN'             AND name_native IS NULL;
UPDATE artists SET name_native = '엔하이픈',         native_language = 'ko' WHERE name = 'ENHYPEN'               AND name_native IS NULL;
UPDATE artists SET name_native = '투피엠',           native_language = 'ko' WHERE name = '2PM'                   AND name_native IS NULL;
UPDATE artists SET name_native = '투에이엠',         native_language = 'ko' WHERE name = '2AM'                   AND name_native IS NULL;
UPDATE artists SET name_native = '비투비',           native_language = 'ko' WHERE name = 'BTOB'                  AND name_native IS NULL;
UPDATE artists SET name_native = '갓이오티',         native_language = 'ko' WHERE name = 'GOT the beat'          AND name_native IS NULL;
UPDATE artists SET name_native = '케이블랙',         native_language = 'ko' WHERE name = 'CL'                    AND name_native IS NULL;
UPDATE artists SET name_native = '솔로몬',           native_language = 'ko' WHERE name = 'SoloMon'               AND name_native IS NULL;

-- ── Releases (direct update — faster than re-running Phase 2) ────────────────

UPDATE releases SET artist_native = '아이유',           native_language = 'ko' WHERE artist = 'IU'                   AND artist_native IS NULL;
UPDATE releases SET artist_native = '아이브',           native_language = 'ko' WHERE artist = 'IVE'                  AND artist_native IS NULL;
UPDATE releases SET artist_native = '뉴진스',           native_language = 'ko' WHERE artist = 'NewJeans'             AND artist_native IS NULL;
UPDATE releases SET artist_native = '에스파',           native_language = 'ko' WHERE artist = 'aespa'                AND artist_native IS NULL;
UPDATE releases SET artist_native = '르세라핌',         native_language = 'ko' WHERE artist = 'LE SSERAFIM'          AND artist_native IS NULL;
UPDATE releases SET artist_native = '투모로우바이투게더', native_language = 'ko' WHERE artist = 'TOMORROW X TOGETHER' AND artist_native IS NULL;
UPDATE releases SET artist_native = '레드벨벳',         native_language = 'ko' WHERE artist = 'Red Velvet'           AND artist_native IS NULL;
UPDATE releases SET artist_native = '청하',             native_language = 'ko' WHERE artist = 'CHUNG HA'             AND artist_native IS NULL;
UPDATE releases SET artist_native = '투애니원',         native_language = 'ko' WHERE artist = '2NE1'                 AND artist_native IS NULL;
UPDATE releases SET artist_native = '엔믹스',           native_language = 'ko' WHERE artist = 'NMIXX'                AND artist_native IS NULL;
UPDATE releases SET artist_native = '블랙핑크',         native_language = 'ko' WHERE artist = 'BLACKPINK'            AND artist_native IS NULL;
UPDATE releases SET artist_native = '엑소',             native_language = 'ko' WHERE artist = 'EXO'                  AND artist_native IS NULL;
UPDATE releases SET artist_native = '트와이스',         native_language = 'ko' WHERE artist = 'TWICE'                AND artist_native IS NULL;
UPDATE releases SET artist_native = '스트레이 키즈',    native_language = 'ko' WHERE artist = 'Stray Kids'           AND artist_native IS NULL;
UPDATE releases SET artist_native = '있지',             native_language = 'ko' WHERE artist = 'ITZY'                 AND artist_native IS NULL;
UPDATE releases SET artist_native = '(여자)아이들',     native_language = 'ko' WHERE artist = '(G)I-DLE'             AND artist_native IS NULL;
UPDATE releases SET artist_native = '몬스타엑스',       native_language = 'ko' WHERE artist = 'MONSTA X'             AND artist_native IS NULL;
UPDATE releases SET artist_native = '갓세븐',           native_language = 'ko' WHERE artist = 'GOT7'                 AND artist_native IS NULL;
UPDATE releases SET artist_native = '샤이니',           native_language = 'ko' WHERE artist = 'SHINee'               AND artist_native IS NULL;
UPDATE releases SET artist_native = '에프엑스',         native_language = 'ko' WHERE artist = 'f(x)'                 AND artist_native IS NULL;
UPDATE releases SET artist_native = '씨스타',           native_language = 'ko' WHERE artist = 'SISTAR'               AND artist_native IS NULL;
UPDATE releases SET artist_native = '인피니트',         native_language = 'ko' WHERE artist = 'INFINITE'             AND artist_native IS NULL;
UPDATE releases SET artist_native = '카라',             native_language = 'ko' WHERE artist = 'KARA'                 AND artist_native IS NULL;
UPDATE releases SET artist_native = '제이홉',           native_language = 'ko' WHERE artist = 'j-hope'               AND artist_native IS NULL;
UPDATE releases SET artist_native = '엔씨티',           native_language = 'ko' WHERE artist = 'NCT'                  AND artist_native IS NULL;
UPDATE releases SET artist_native = '엔씨티 127',       native_language = 'ko' WHERE artist = 'NCT 127'              AND artist_native IS NULL;
UPDATE releases SET artist_native = '엔씨티 드림',      native_language = 'ko' WHERE artist = 'NCT Dream'            AND artist_native IS NULL;
UPDATE releases SET artist_native = '엔씨티 유',        native_language = 'ko' WHERE artist = 'NCT U'                AND artist_native IS NULL;
UPDATE releases SET artist_native = '티아라',           native_language = 'ko' WHERE artist = 'T-ARA'                AND artist_native IS NULL;
UPDATE releases SET artist_native = '원더걸스',         native_language = 'ko' WHERE artist = 'Wonder Girls'         AND artist_native IS NULL;
UPDATE releases SET artist_native = '미쓰에이',         native_language = 'ko' WHERE artist = 'miss A'               AND artist_native IS NULL;
UPDATE releases SET artist_native = '포미닛',           native_language = 'ko' WHERE artist = '4MINUTE'              AND artist_native IS NULL;
UPDATE releases SET artist_native = '애프터스쿨',       native_language = 'ko' WHERE artist = 'After School'         AND artist_native IS NULL;
UPDATE releases SET artist_native = '빅스',             native_language = 'ko' WHERE artist = 'VIXX'                 AND artist_native IS NULL;
UPDATE releases SET artist_native = '비원에이포',       native_language = 'ko' WHERE artist = 'B1A4'                 AND artist_native IS NULL;
UPDATE releases SET artist_native = '틴탑',             native_language = 'ko' WHERE artist = 'Teen Top'             AND artist_native IS NULL;
UPDATE releases SET artist_native = '블락비',           native_language = 'ko' WHERE artist = 'Block B'              AND artist_native IS NULL;
UPDATE releases SET artist_native = '하이라이트',       native_language = 'ko' WHERE artist = 'Highlight'            AND artist_native IS NULL;
UPDATE releases SET artist_native = '에이오에이',       native_language = 'ko' WHERE artist = 'AOA'                  AND artist_native IS NULL;
UPDATE releases SET artist_native = '슈퍼주니어',       native_language = 'ko' WHERE artist = 'Super Junior'         AND artist_native IS NULL;
UPDATE releases SET artist_native = '위너',             native_language = 'ko' WHERE artist = 'WINNER'               AND artist_native IS NULL;
UPDATE releases SET artist_native = '아이콘',           native_language = 'ko' WHERE artist = 'iKON'                 AND artist_native IS NULL;
UPDATE releases SET artist_native = '세븐틴',           native_language = 'ko' WHERE artist = 'SEVENTEEN'            AND artist_native IS NULL;
UPDATE releases SET artist_native = '엔하이픈',         native_language = 'ko' WHERE artist = 'ENHYPEN'              AND artist_native IS NULL;
UPDATE releases SET artist_native = '투피엠',           native_language = 'ko' WHERE artist = '2PM'                  AND artist_native IS NULL;
UPDATE releases SET artist_native = '투에이엠',         native_language = 'ko' WHERE artist = '2AM'                  AND artist_native IS NULL;
UPDATE releases SET artist_native = '비투비',           native_language = 'ko' WHERE artist = 'BTOB'                 AND artist_native IS NULL;

-- ── Verify ────────────────────────────────────────────────────────────────────
SELECT name, name_native, native_language
FROM artists
WHERE name IN (
  'IU','IVE','NewJeans','aespa','LE SSERAFIM','TOMORROW X TOGETHER',
  'Red Velvet','CHUNG HA','2NE1','NMIXX','BLACKPINK','EXO','TWICE',
  'Stray Kids','ITZY','(G)I-DLE','MONSTA X','GOT7','SHINee','f(x)',
  'SISTAR','INFINITE','KARA','j-hope','NCT','NCT 127','NCT Dream',
  'NCT U','T-ARA','Wonder Girls','miss A','4MINUTE','After School',
  'VIXX','B1A4','Teen Top','Block B','Highlight','AOA','Super Junior',
  'WINNER','iKON','SEVENTEEN','ENHYPEN','2PM','2AM','BTOB'
)
ORDER BY name;
