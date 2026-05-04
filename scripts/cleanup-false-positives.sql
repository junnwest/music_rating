-- False positive cleanup — run in Supabase SQL editor
-- Generated after ingest-state.json sanity check (2026-05-03)
--
-- Each block is a separate DELETE with a comment explaining why it is wrong.
-- Review before running. None of these IDs correspond to legitimate catalog entries.

-- 1. "Abbey Road" by "The Beatles Complete On Ukulele"
--    Matched for: The Beatles|Abbey Road
--    Correct album is a separate row upserted by seed:prestige.
DELETE FROM releases WHERE id = '5gRj0X8Bl2dKidoC428AoB';

-- 2. "Revolver" by "The Beatles Complete On Ukulele"
--    Matched for: The Beatles|Revolver
DELETE FROM releases WHERE id = '4nQ5UtCV2XCnOZ9nHCufVs';

-- 3. Widespread Panic – self-titled (American jam band)
--    Matched for: Panic|Panic (Korean band 패닉)
DELETE FROM releases WHERE id = '6saL4k96Bv5MFsvG61x11Q';

-- 4. "Loveless" by artist named "Loveless" (not My Bloody Valentine)
--    Matched for: My Bloody Valentine|Loveless
DELETE FROM releases WHERE id = '6oICQlFFse7v0qbnPo2L7l';

-- 5. Victor Fantastic Orchestra compilation (山下達郎/竹内まりや作品集)
--    Matched for: Tatsuro Yamashita|FOR YOU
DELETE FROM releases WHERE id = '1qWA39v5KzquKUCWqRAoiH';

-- 6. Yorushika – "春泥棒" (completely different Japanese artist)
--    Matched for: Haru Nemuri|Haru to Shura
DELETE FROM releases WHERE id = '4YKJk4juMZQr2sDnKzDlBz';

-- 7. "이산 시간" by 멀리 이동하려면
--    Matched for THREE entries: Sanulrim|What Already?, Han Dae Soo|Long Long Road,
--    Kiha & The Faces|Living Without Possession
DELETE FROM releases WHERE id = '0RYGlnCiNeJRN3xzIjdm4Q';

-- 8. "아홉가지기분" by 네스티요나
--    Matched for TWO entries: Deli Spice|Deli Spice, Lee Sora|Vol. 6 Nunsseopdal
DELETE FROM releases WHERE id = '5ooEdlSXdzcTXLTHMg6QMO';

-- 9. "유아해피송" by 엘키즈
--    Matched for: THORNAPPLE|Abnormal Climate
DELETE FROM releases WHERE id = '3qZHy4M9znhKoMg0qmAXVM';

-- 10. "좋아좋아" by 일기예보
--     Matched for: Leenalchi|Sugungga
DELETE FROM releases WHERE id = '6rwqrHdQ9S9FXl1W6dtpsb';

-- NOTE: "6L9IGYuMWrWUMIVm3KFjUw" (김광석 다시 부르기 I by Kim Kwang Seok) is NOT deleted.
-- It is a legitimate entry that seed:prestige correctly seeded for Kim Kwang-seok|다시 부르기.
-- The ingest false-positives for Kim Min Ki and Kim Oki have been reset to not_found.
