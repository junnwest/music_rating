-- Moved 2026-09-30 from the root supabase/migrations/ (renumbered 000000 -> 000002;
-- that prefix was taken twice here). Already applied; filename only.

-- Unicode-normalize search matching, so Korean typed as decomposed jamo finds composed text.
--
-- THE BUG. Hangul has two encodings: one precomposed syllable (킁, 3 bytes) or its three jamo
-- (ㅋ+ㅡ+ㅇ, 9 bytes). They render identically and compare unequal. normalize_text() lowercased and
-- stripped punctuation but never normalized Unicode, so every search compared raw bytes:
--
--   search_release_groups('킁' NFC) -> 1 row      (Keung / native_title 킁)
--   search_release_groups('킁' NFD) -> 0 rows
--
-- Reported as "searching 킁 returns nothing" while "Keung" worked -- ASCII has no composition
-- ambiguity. It was never a data or caching fault: the row, the RPC and the page were all correct.
-- macOS and iOS hand over NFD by default, so this silently broke EVERY Korean query from those
-- clients, not just this album.
--
-- WHY NO REINDEX. 14 indexes are built on normalize_text(...), including a UNIQUE one on
-- genre_query_aliases. Redefining an IMMUTABLE function leaves those indexes holding values
-- computed by the OLD definition, which would quietly return wrong results. Measured first:
-- of 754,106 release_groups only 18 titles were non-NFC, artists were 100% NFC (name,
-- name_native, name_phonetic_ko all 0), and artist_aliases had 1. Those 19 rows are normalized
-- BELOW, before the function changes -- after which normalize_text() returns byte-identical
-- output for every stored value, so no index entry changes and no REINDEX is needed. Doing it in
-- the other order would have required REINDEX CONCURRENTLY on GIN trigram indexes over 754k rows.

-- 1. Normalize the 19 stored values that are not already NFC.
update release_groups set title = normalize(title, NFC)
 where title is distinct from normalize(title, NFC);

update release_groups set native_title = normalize(native_title, NFC)
 where native_title is distinct from normalize(native_title, NFC);

-- artist_aliases carries a UNIQUE (artist_id, alias). The one non-NFC alias here normalizes onto a
-- row that ALREADY exists for that artist ("Étre Supreme"), so the update alone fails with 23505 --
-- the duplicate had survived only because the two Unicode forms compared unequal. Drop the
-- decomposed copy where its composed twin is already present, then normalize whatever is left.
delete from artist_aliases a
 where a.alias is distinct from normalize(a.alias, NFC)
   and exists (
     select 1 from artist_aliases b
      where b.artist_id = a.artist_id
        and b.alias = normalize(a.alias, NFC)
   );

update artist_aliases set alias = normalize(alias, NFC)
 where alias is distinct from normalize(alias, NFC);

-- 2. Now the function. normalize(..., NFC) runs before lowercasing: composition is independent of
--    case, and doing it first means the punctuation strip sees a stable form. normalize() is
--    IMMUTABLE, so the function keeps its IMMUTABLE PARALLEL SAFE markings and stays indexable.
create or replace function public.normalize_text(t text)
returns text
language sql
immutable parallel safe
as $function$
  select regexp_replace(lower(normalize(coalesce(t, ''), NFC)), '[[:space:][:punct:]]+', '', 'g');
$function$;
