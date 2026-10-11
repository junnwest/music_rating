-- ════════════════════════════════════════════════════════════════════════════
-- name_native holds the Korean form whenever we know it.  2026-10-11
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE INVARIANT. `artists.name` is the primary display name (often romanized);
-- `artists.name_native` is the same artist's name in their native script. The
-- app's displayName() picks ONE of the two -- native when the UI is Korean and
-- the value is predominantly Hangul, otherwise name -- so the two are never
-- rendered together.
--
-- THE VIOLATION. When a source's primary name is ALREADY Hangul and it exposes
-- no separate native alias, both ingest paths derived name_native independently
-- and stored null. 검정치마 was held as name='검정치마', name_native=null. A null
-- there does not mean "this artist has no Korean name" -- it means "we do not
-- know it" -- so the row lies about itself, and everything keyed on name_native
-- skips the artist:
--   * backfill-native-names-from-aliases.ts cannot touch it: its guard is
--     "the stored name is NOT Hangul", so these rows are permanently skipped
--     while also never being fixed.
--   * a lookup by name_native misses the artist entirely (this is how a
--     검정치마 duplicate check initially returned zero rows).
--
-- 279 KR artists were in this state. Fixed at the source in the same commit
-- (itunes-ingest-core.ts and mb-ingest.ts now fall back to the name itself when
-- it is Hangul); this backfills the rows already written.
--
-- SAFE AND IDEMPOTENT: only fills NULLs, only when `name` is actually Hangul,
-- and sets name_native to a value the UI would already have displayed. Not
-- restricted to country='KR' -- a Hangul name is a Hangul name regardless of
-- how the country field happens to be set.
-- ════════════════════════════════════════════════════════════════════════════

update artists
   set name_native = name
 where name_native is null
   and name ~ '[가-힣]';

do $$
declare remaining int;
begin
  select count(*) into remaining
    from artists where name_native is null and name ~ '[가-힣]';
  raise notice 'name_native invariant: % Hangul-named artist(s) still null (expected 0)', remaining;
end $$;
