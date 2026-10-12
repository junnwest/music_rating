-- ════════════════════════════════════════════════════════════════════════════
-- Catalogue error audit. One query, no external API calls.
-- Run via: npx tsx --env-file=.env.local scripts/db-exec.ts \
--            scripts/audit-data-errors.sql --out=scripts/data/audit-report.json
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE HEADLINE CHECK is "we expect 5 releases and have 7", and it is free:
-- artists.mb_rg_count already holds MusicBrainz's own release-group count.
--
-- COMPARE LIKE FOR LIKE -- the first version of this did not, and every number it
-- produced was wrong. mb_rg_count is written from a fetch filtered to
-- type=album|ep|single (mb-client.ts:381), so it EXCLUDES compilations and
-- soundtracks. Comparing it against our count of all types "found" Elvis Presley
-- at 645 vs 88 and The Beatles at 336 vs 98 -- pure artefact, since most of those
-- are compilations MusicBrainz never counted. Our side is therefore restricted to
-- the same three types.
--
-- OTHER CORRECTIONS forced by reading the first run's examples rather than its
-- totals (each of these was a false positive, and the totals looked plausible):
--   * duplicate_same_title claimed 18,976 by keying on artist+title alone. Roberto
--     Carlos released 37 different self-titled albums; Édith Piaf's "La Vie en
--     rose" exists on 25 distinct releases. Reissues and same-named albums are not
--     duplicates. Now requires the same TYPE and the same DATE, which is also what
--     correctly excludes Springsteen's "Born in the U.S.A." album/EP/single trio.
--   * artist_with_no_releases claimed 14,364 by counting primary credits only.
--     The BBC Scottish Symphony Orchestra has 219 MB release groups and is a
--     CREDITED artist on ours, never the primary. Now counts both paths.
--   * implausible_release_date flagged Edison Symphony Orchestra cylinders from
--     1898 as impossible. They are real -- recorded music predates 1900 -- so the
--     floor moved to 1880.
--   * native_title_same_as_title claimed 40,927, listing Japanese albums whose
--     title IS its native form (トータス松本 — ブランコ). That is correct data.
--     Only a LATIN title copied into native_title is a no-op.
--
-- Severity is about whether a user would see it, not how odd it looks in SQL.

with our_counts as (
  -- Same three types MusicBrainz counted, so the comparison means something.
  select primary_artist_id as aid, count(*) as n
  from release_groups
  where primary_artist_id is not null
    and lower(coalesce(release_group_type, '')) in ('album', 'ep', 'single')
  group by 1
),
disco as (
  select a.id, a.name, a.mb_rg_count as mb, coalesce(oc.n, 0) as ours, a.ingest_state
  from artists a
  left join our_counts oc on oc.aid = a.id
  where a.mb_rg_count is not null and a.mb_rg_count > 0
),
-- credited OR primary: an orchestra is almost never the primary artist
credited as (
  select artist_id as aid from release_group_artists group by 1
),
any_counts as (
  -- every release group an artist is on, by either path, restricted to MB's three types
  select c.aid, count(distinct c.rgid) as n from (
    select primary_artist_id as aid, id as rgid from release_groups
    where primary_artist_id is not null
      and lower(coalesce(release_group_type, '')) in ('album', 'ep', 'single')
    union all
    select rga.artist_id as aid, rg.id as rgid
    from release_group_artists rga
    join release_groups rg on rg.id = rga.release_group_id
    where lower(coalesce(rg.release_group_type, '')) in ('album', 'ep', 'single')
  ) c group by c.aid
),
disco2 as (
  select d.id, d.name, d.mb, d.ingest_state, coalesce(ac.n, 0) as ours_any
  from disco d left join any_counts ac on ac.aid = d.id
),
over_count as (
  select 'discography_over_count' as check, 'high' as severity, count(*) as n,
         coalesce((select json_agg(x) from (
           select name, mb, ours from disco d2
           where d2.ours > d2.mb + 2 and d2.ours > d2.mb * 1.5
           order by (d2.ours - d2.mb) desc limit 6) x), '[]'::json) as examples
  from disco where ours > mb + 2 and ours > mb * 1.5
),
under_count as (
  /* tracks_done is the finished state (70,402 artists); 'resolved' means resolved but not yet
     ingested, so counting it measures the queue, not an error.

     TWO EXCLUSIONS, both of which the first version got wrong and both of which produced
     confident nonsense:
       * mb_rg_count >= 800 is MAX_INGEST_RGS (mb-ingest.ts:63) -- the pipeline REFUSES artists
         above it on purpose. 15 artists sit at exactly 800, and reporting "Philharmonia
         Orchestra: MB 800, ours 13" as a defect is reporting a deliberate policy.
       * counting primary credits only. An orchestra or a featured artist is credited, never
         primary, so their real total lives in release_group_artists. */
  select 'discography_under_count' as check, 'medium' as severity, count(*) as n,
         coalesce((select json_agg(x) from (
           select name, mb, ours_any as ours from disco2 d2
           where d2.ingest_state = 'tracks_done' and d2.mb < 800
             and d2.ours_any < d2.mb * 0.5 and d2.mb > 4
           order by (d2.mb - d2.ours_any) desc limit 6) x), '[]'::json) as examples
  from disco2
  where ingest_state = 'tracks_done' and mb < 800 and ours_any < mb * 0.5 and mb > 4
),
dup_strict as (
  -- same artist, same title, same TYPE, same DATE: a duplicate by any reading
  select 'duplicate_same_title_type_date' as check, 'high' as severity, count(*) as n,
         coalesce((select json_agg(x) from (
           select artist_display, title, release_group_type as ty,
                  first_release_date::text as dt, cnt
           from (
             select min(rg.artist_display) as artist_display, min(rg.title) as title,
                    rg.release_group_type, rg.first_release_date, count(*) as cnt
             from release_groups rg
             where rg.first_release_date is not null
             group by rg.primary_artist_id, lower(rg.title), rg.release_group_type, rg.first_release_date
             having count(*) > 1) q
           order by cnt desc limit 6) x), '[]'::json) as examples
  from (select 1 from release_groups rg
        where rg.first_release_date is not null
        group by rg.primary_artist_id, lower(rg.title), rg.release_group_type, rg.first_release_date
        having count(*) > 1) s
),
same_mbid as (
  select 'duplicate_same_mb_id' as check, 'high' as severity, count(*) as n,
         '[]'::json as examples
  from (select 1 from release_groups where mb_release_group_id is not null
        group by mb_release_group_id having count(*) > 1) s
),
no_releases as (
  select 'release_group_without_releases' as check, 'medium' as severity, count(*) as n,
         coalesce((select json_agg(x) from (
           select rg.artist_display, rg.title from release_groups rg
           where not exists (select 1 from releases r where r.release_group_id = rg.id)
           order by rg.prestige_score desc nulls last limit 6) x), '[]'::json) as examples
  from release_groups rg
  where not exists (select 1 from releases r where r.release_group_id = rg.id)
),
no_tracks as (
  select 'release_without_tracks' as check, 'medium' as severity, count(*) as n,
         '[]'::json as examples
  from releases r
  where not exists (select 1 from release_tracks rt where rt.release_id = r.id)
),
bad_dates as (
  -- 1880 floor: recorded music predates 1900, so 1898 cylinders are real data.
  select 'implausible_release_date' as check, 'high' as severity, count(*) as n,
         coalesce((select json_agg(x) from (
           select artist_display, title, first_release_date::text as dt
           from release_groups
           where first_release_date > (current_date + interval '18 months')
              or first_release_date < date '1880-01-01'
           order by first_release_date desc limit 6) x), '[]'::json) as examples
  from release_groups
  where first_release_date > (current_date + interval '18 months')
     or first_release_date < date '1880-01-01'
),
native_noop as (
  -- Only a LATIN title copied into native_title is meaningless. A Japanese or
  -- Korean title equalling its native form is correct.
  select 'native_title_pointless_copy' as check, 'low' as severity, count(*) as n,
         coalesce((select json_agg(x) from (
           select artist_display, title from release_groups
           where native_title is not null and native_title = title
             and title !~ '[가-힣]' and title !~ '[ぁ-んァ-ン]' and title !~ '[一-鿿]' and title !~ '[・ー]'
           limit 6) x), '[]'::json) as examples
  from release_groups
  where native_title is not null and native_title = title
    and title !~ '[가-힣]' and title !~ '[ぁ-んァ-ン]' and title !~ '[一-鿿]' and title !~ '[・ー]'
),
empty_artist as (
  select 'artist_with_no_releases' as check, 'high' as severity, count(*) as n,
         coalesce((select json_agg(x) from (
           select d2.name, d2.mb from disco d2
           where d2.ours = 0 and d2.id not in (select aid from credited)
           order by d2.mb desc limit 6) x), '[]'::json) as examples
  from disco d
  where d.ours = 0 and d.id not in (select aid from credited)
),
orphan_primary as (
  select 'release_group_orphan_artist' as check, 'high' as severity, count(*) as n,
         '[]'::json as examples
  from release_groups rg
  where rg.primary_artist_id is not null
    and not exists (select 1 from artists a where a.id = rg.primary_artist_id)
)
select * from over_count
union all select * from under_count
union all select * from dup_strict
union all select * from same_mbid
union all select * from no_releases
union all select * from no_tracks
union all select * from bad_dates
union all select * from native_noop
union all select * from empty_artist
union all select * from orphan_primary;
