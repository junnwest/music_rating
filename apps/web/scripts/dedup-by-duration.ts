/**
 * Collapse duplicate release groups that no TITLE can match: the same album held twice under a
 * translated or romanized name.
 *
 * WHY TITLES CANNOT DO THIS. Reported as "almost all Giriboy albums have 2 versions, one English one
 * Korean". The pairs are 별책 / "appendix", 성인식 / "Sexual Perceptions" (translations) and 술자리 /
 * "Sooljalee", 하이에나 / "Hyena" (romanizations). Nothing is shared to key on, so dedup-same-title-rgs
 * cannot see them and never will. Every cheaper signal was tried against real pairs first, and each
 * one is broken by at least one of them:
 *
 *   same date          9Cut 2020-12-23  vs  9컷 2021-05-10      4.5 months apart
 *   +/-7-day window    호구 vs Hogu                             27 days
 *   same source        하이에나 / Hyena OST Pt.4                  BOTH are iTunes rows
 *   same type          Fatal Album II   album (iTunes) / ep (MB)
 *   same track count   Mechanical Album 7  vs  기계적인 앨범 21
 *   ISRC               28% coverage overall and ZERO on iTunes rows — absent on the side that needs it
 *
 * TRACK DURATION is what is left, and it is language-independent. Validated before building:
 * appendix and 별책 agree to the second (205,211,237,309), and 9Cut's durations are a subset of 9컷's
 * within 1s despite the 4.5-month gap.
 *
 * WHY THIS IS NOT THE INGEST-TIME FIX. The obvious root fix — have mb-ingest adopt an existing row
 * instead of inserting a twin — was written, measured, and reverted. Matching on artist + title + a
 * 31-day window would have fired on 10,019 pairs of which only 240 share content: it merges an album
 * into its own same-named lead single ("Sexplosion!" album/13 vs single/4, same day) and distinct
 * classical performances ("Symphony No. 7" album/4 vs album/4). Durations are the only trustworthy
 * evidence and they do not exist yet when the group row is written, so the decision point and the
 * evidence are structurally in the wrong order. Detection therefore happens here, after tracks land.
 *
 * WHAT IS EXCLUDED, AND WHY NONE OF IT IS OPTIONAL:
 *   - compilations: a greatest-hits and another compilation legitimately share recordings, so their
 *     signatures match while the releases are distinct. 1,122 of 2,971 signature sets involve one.
 *   - any set containing a rated row: a user's rating is the one thing here that cannot be rebuilt.
 *   - sets with fewer than MIN_TRACKS durations: three short tracks collide by chance.
 *
 * SURVIVOR CHOICE prefers the LATIN-titled row first, then follows dedup-same-title-rgs: most
 * editions, then most tracks, then earliest date, then lowest id for a stable re-run. Latin wins
 * because the loser's Korean title survives in native_title, while an English title dropped with its
 * row has nowhere to go - there is no latin_title column. Merging 별책 into "appendix" without that
 * step would destroy the only Korean spelling held, which is what Korean search matches on.
 *
 * REPORT-ONLY unless --apply.
 *
 *   npx tsx --env-file=.env.local scripts/dedup-by-duration.ts
 *   npx tsx --env-file=.env.local scripts/dedup-by-duration.ts --mixed-script-only
 *   npx tsx --env-file=.env.local scripts/dedup-by-duration.ts --mixed-script-only --limit=25 --apply
 */
import * as fs from 'node:fs';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const APPLY = process.argv.includes('--apply');
const MIXED_ONLY = process.argv.includes('--mixed-script-only');
const MIN_TRACKS = Number(arg('--min-tracks') ?? 3);
const OUT = arg('--out') ?? 'scripts/data/dedup-by-duration.json';
// Applies in reviewed batches rather than all at once: 512 deletions against production is not a
// thing to do in one unattended shot, and the sets are independent so a partial run is consistent.
const LIMIT = Number(arg('--limit') ?? 0);
// Seconds of per-track disagreement tolerated. 0 restores the old exact-hash behaviour.
const TOLERANCE = Number(arg('--tolerance') ?? 1);
// Days apart two releases may be when only the TOLERANCE made them match.
const DATE_WINDOW = Number(arg('--date-window') ?? 45);
/* --ids a,b[,c] merges a SPECIFIC, already-verified set, skipping detection entirely. Detection by
   duration is evidence; a human confirming "these two are the same record" is better evidence, and a
   reported duplicate should not have to satisfy a heuristic to get fixed. The merge still runs every
   guard below - rating migration, the cascade refusal, native_title preservation, survivor choice. */
const ONLY_IDS = (arg('--ids') ?? '').split(',').map(x => x.trim()).filter(Boolean);
const withinDays = (a: string | null, b: string | null, days: number): boolean => {
  if (!a || !b) return false;                       // an unknown date corroborates nothing
  const ta = Date.parse(a), tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= days * 86400000;
};

interface Row {
  id: string; title: string; native_title: string | null; type: string; date: string | null;
  artist: string; artist_id: string; source: string; editions: number; tracks: number;
  ratings: number; sig: string; secs: number[];
}

// True when a title carries non-Latin script (Hangul, Kana, CJK, Cyrillic). Written as a code-point
// test rather than a regex character class so no invisible escape characters live in the source.
// Words that mark a release as a distinct edition rather than the same record under another name.
// Language variants are distinct releases that share a backing track exactly - a Tamil dub of a Hindi
// soundtrack has identical durations by construction, and a duration match says nothing about them.
const EDITION = ['tamil', 'hindi', 'telugu', 'malayalam', 'kannada', 'japanese', 'korean', 'mandarin',
  'cantonese', 'english ver', 'japanese ver', 'korean ver', 'chinese ver',
  'acoustic', 'live', 'remix', 'remaster', 'remastered', 'deluxe', 'instrumental',
  'karaoke', 'demo', 'edit', 'version', 'ver.', 'mix', 'reissue', 'anniversary', 'expanded',
  'unplugged', 'inst.', '에디션', '리마스터', '라이브'];

const isNonLatin = (s: string): boolean =>
  [...(s ?? '')].some((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp > 0x24f && !(cp >= 0x2000 && cp <= 0x206f);
  });

async function query<T>(sql: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function main() {
  if (ONLY_IDS.length >= 2) return mergeSpecific(ONLY_IDS);
  /* PAIRING HAPPENS IN SQL, clustering in code.
     The comparison is per-track with a tolerance, which a hash cannot express - E SENS's 저금통 and its
     iTunes twin Moneybox share twelve of thirteen durations exactly and differ on the thirteenth by ONE
     second (127 vs 126), so their hashes differ and the pair survived every previous run. Measured
     across the catalogue, +/-1s finds 1,274 pairs exact matching cannot see.
     It is done in SQL rather than by shipping the duration arrays here: bucketing by (artist, track
     count) and returning every array produced a 105MB response that could not even be parsed. Only the
     matching PAIRS come back. */
  const pairSql = `
    with d as (
      select rg.id, rg.primary_artist_id pid,
             count(rec.duration_ms) n, count(*) total,
             array_agg((rec.duration_ms / 1000) order by (rec.duration_ms / 1000)) secs
        from release_groups rg
        join releases r on r.release_group_id = rg.id
        join release_tracks rt on rt.release_id = r.id
        join recordings rec on rec.id = rt.recording_id
       group by 1, 2
    ),
    -- EVERY track must be timed (n = total): a row whose durations are mostly missing collapses to a
    -- short vector and can collide with a genuinely shorter release.
    e as (select * from d where n >= ${MIN_TRACKS} and n = total)
    select a.id ida, b.id idb,
           (a.secs = b.secs) exact
      from e a
      join e b on b.pid = a.pid and b.id > a.id and array_length(b.secs, 1) = array_length(a.secs, 1)
     where not exists (
       select 1 from generate_subscripts(a.secs, 1) i where abs(a.secs[i] - b.secs[i]) > ${TOLERANCE}
     )`;
  const pairs = await query<{ ida: string; idb: string; exact: boolean }>(pairSql);
  if (!pairs.length) { console.log('\n[dedup-duration] no candidate pairs'); return; }

  const candidateIds = [...new Set(pairs.flatMap(p => [p.ida, p.idb]))];
  const rows: Row[] = [];
  for (let i = 0; i < candidateIds.length; i += 500) {
    const batch = candidateIds.slice(i, i + 500).map(x => `'${x}'`).join(',');
    rows.push(...await query<Row>(`
      select rg.id, rg.title, rg.native_title, rg.release_group_type type, rg.first_release_date::text date,
             rg.source, rg.primary_artist_id artist_id, a.name artist, '' sig,
             (select count(*) from releases r2 where r2.release_group_id = rg.id) editions,
             (select count(*) from release_tracks rt2 join releases r3 on r3.id = rt2.release_id
               where r3.release_group_id = rg.id) tracks,
             (select count(*) from ratings t where t.release_group_id = rg.id) ratings
        from release_groups rg join artists a on a.id = rg.primary_artist_id
       where rg.id in (${batch})`));
  }
  const byId = new Map(rows.map(r => [r.id, r]));

  /* WEAKER DURATION EVIDENCE DEMANDS STRONGER DATE EVIDENCE. An exact match is strong enough to pair
     releases months apart - 9Cut 2020-12-23 and 9컷 2021-05-10 are one record. A pair that needed the
     tolerance is not: three-track singles land within a second of each other by chance, and a first
     run paired メロン記念日's アンフォゲッタブル (2007-03-28) with a different single from 2008-03-19. */
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const id of candidateIds) parent.set(id, id);
  for (const p of pairs) {
    if (!byId.has(p.ida) || !byId.has(p.idb)) continue;
    if (!p.exact && !withinDays(byId.get(p.ida)!.date, byId.get(p.idb)!.date, DATE_WINDOW)) continue;
    const ra = find(p.ida), rb = find(p.idb);
    if (ra !== rb) parent.set(ra, rb);
  }
  const sets = new Map<string, Row[]>();
  for (const id of candidateIds) {
    if (!byId.has(id)) continue;
    const root = find(id);
    if (!sets.has(root)) sets.set(root, []);
    sets.get(root)!.push(byId.get(id)!);
  }

  const skipped = { compilation: 0, rated: 0, singleton: 0, sameScript: 0, edition: 0 };
  const plans: { keep: Row; drop: Row[] }[] = [];
  for (const group of sets.values()) {
    if (group.length < 2) { skipped.singleton++; continue; }
    if (group.some(r => r.type === 'compilation')) { skipped.compilation++; continue; }
    // Rated sets are MERGED now, not skipped. Skipping them was self-defeating: it meant the tool
    // refused to touch precisely the duplicates a user had interacted with, which are the only ones
    // anybody ever notices on their own profile. The ratings are moved to the survivor below.
    /* AN EDITION IS NOT A DUPLICATE. A duration signature cannot tell "Tales of the Eternal Kingdom"
       from "Tales of the Eternal Kingdom (acoustic edit)" — an alternate take can run to the same
       seconds as the original, and a remaster almost always does. Those are distinct releases a
       listener may well want to rate separately, so if one title in a set carries an edition marker
       its siblings do not, the set is left alone. Caught in review of a 1,716-row apply, where this
       pair would have destroyed the acoustic edit. */
    const editions = group.map(r => EDITION.filter(w => (r.title ?? '').toLowerCase().includes(w)).join('|'));
    if (new Set(editions).size > 1) { skipped.edition++; continue; }
    if (MIXED_ONLY) {
      const titles = group.map(r => r.title ?? '');
      const nonLatin = titles.filter(t => isNonLatin(t)).length;
      // EXACTLY one Latin title and one non-Latin one. A signature can gather more than a true
      // pair: Giriboy's "Lonely 4Songs" and its Korean twin "외롬적인 4곡" arrived with a third row,
      // "기계적인 앨범", a different album sharing those four durations. Two rows in two scripts is
      // the shape this mode is for; anything larger is a coincidence or a chain, and merging it
      // would destroy a distinct release.
      if (group.length !== 2 || nonLatin !== 1) {
        skipped.sameScript++;
        continue;
      }
    }
    const ranked = [...group].sort((a, b) =>
      Number(isNonLatin(a.title ?? '')) - Number(isNonLatin(b.title ?? ''))
      || Number(b.editions) - Number(a.editions)
      || Number(b.tracks) - Number(a.tracks)
      || String(a.date ?? '9999').localeCompare(String(b.date ?? '9999'))
      || a.id.localeCompare(b.id));
    plans.push({ keep: ranked[0], drop: ranked.slice(1) });
  }

  if (LIMIT > 0) plans.splice(LIMIT);
  const dropCount = plans.reduce((n, p) => n + p.drop.length, 0);
  console.log(`\n[dedup-duration] ${plans.length} set(s), ${dropCount} row(s) to remove${APPLY ? '  *** APPLY ***' : '  (report only)'}`);
  console.log(`  skipped: ${skipped.compilation} compilation, ${skipped.edition} edition-variant, ${skipped.sameScript} same-script${MIXED_ONLY ? ' (--mixed-script-only)' : ''}`);
  const ratedSets = plans.filter(p => [p.keep, ...p.drop].some(r => Number(r.ratings) > 0));
  if (ratedSets.length) console.log(`  ${ratedSets.length} set(s) carry ratings — merged, keeping each user's latest`);
  fs.writeFileSync(OUT, JSON.stringify(plans, null, 1));

  console.log('\nsample:');
  for (const p of plans.slice(0, 12)) {
    console.log(`  ${p.keep.artist} - KEEP "${p.keep.title}" [${p.keep.source}/${p.keep.type}/tr${p.keep.tracks}/${p.keep.date}]`);
    for (const d of p.drop) console.log(`     drop "${d.title}" [${d.source}/${d.type}/tr${d.tracks}/${d.date}]`);
  }

  if (!APPLY) {
    console.log(`\n  report -> ${OUT}`);
    console.log('  report only - re-run with --apply to merge');
    return;
  }

  await applyPlans(plans);
}


/** The write half, shared by the swept path and by an explicit --ids merge. */
async function applyPlans(plans: { keep: Row; drop: Row[] }[]) {
  let titlesKept = 0;
  let deleted = 0;
  // Progress is printed as it goes: each survivor needs its own round-trip, so ~500 sets means
  // ~10 minutes of silence otherwise, which reads exactly like a hang and invites a Ctrl+C
  // mid-apply.
  console.log(`
  applying ${plans.length} set(s)...`);
  let seen = 0;
  for (const p of plans) {
    if (++seen % 25 === 0) console.log(`    ${seen}/${plans.length} titles checked (${titlesKept} preserved)`);
    // Preserve a non-Latin loser title as the survivor's native_title before it is deleted.
    if (!p.keep.native_title) {
      const donor = p.drop.find(d => d.title && isNonLatin(d.title));
      if (donor) {
        const esc = donor.title.replace(/'/g, "''");
        await query(`update release_groups set native_title = '${esc}'
                      where id = '${p.keep.id}' and native_title is null`);
        titlesKept++;
      }
    }
  }
  const ids = plans.flatMap(p => p.drop.map(d => d.id));

  /* EVERY FOREIGN KEY INTO release_groups IS ON DELETE CASCADE — ratings, reviews, mix_items,
     mix_song_items, list_items, pinned_albums, saved_releases, ranking_votes, pairwise_comparisons.
     So removing a duplicate row does not merely remove a duplicate: it silently takes whatever a user
     attached to it. Two consequences, and neither is optional.

     Ratings are MIGRATED. Each user's latest rating wins (they carry review_text, and
     (user_id, release_group_id) is unique, so the older row is removed before the newer one is
     re-pointed at the survivor).

     Everything else is a REFUSAL rather than a migration. There is none of it in the catalogue today,
     and guessing how to fold someone's mix or list into another release is worse than stopping. If a
     row being removed ever carries one, the run aborts and names the table instead of quietly taking
     it along. */
  const quoted = ids.map(x => `'${x}'`).join(',');
  if (ids.length) {
    const guard = await query<{ table_name: string; n: string }>(`
      select 'reviews' table_name, count(*)::text n from reviews where release_group_id in (${quoted})
      union all select 'mix_items', count(*)::text from mix_items where release_group_id in (${quoted})
      union all select 'mix_song_items', count(*)::text from mix_song_items where release_group_id in (${quoted})
      union all select 'list_items', count(*)::text from list_items where release_group_id in (${quoted})
      union all select 'pinned_albums', count(*)::text from pinned_albums where release_group_id in (${quoted})
      union all select 'saved_releases', count(*)::text from saved_releases where release_group_id in (${quoted})
      union all select 'ranking_votes', count(*)::text from ranking_votes where release_group_id in (${quoted})
      /* TRACK RATINGS HIDE ONE LEVEL DOWN, and that is how a real rating was lost. The guards above all
         name tables keyed on release_group_id, which is where this stopped looking - but track_ratings
         is keyed on RECORDING. Deleting a release group cascades release_groups -> releases ->
         release_tracks, which strips a recording of its last link without touching the recording row,
         so a song someone rated survives as an orphan with no release and therefore no cover. Reported
         as "makkeoli banger lost its cover": the rating was intact, the song simply had nothing to
         hang on any more. Counted here through the same two hops the cascade takes. */
      union all select 'track_ratings (orphaned)', count(*)::text from track_ratings tr
        where exists (select 1 from release_tracks rt join releases r on r.id = rt.release_id
                       where rt.recording_id = tr.recording_id and r.release_group_id in (${quoted}))
          and not exists (select 1 from release_tracks rt2 join releases r2 on r2.id = rt2.release_id
                           where rt2.recording_id = tr.recording_id and r2.release_group_id not in (${quoted}))
      union all select 'mix_song_items (orphaned)', count(*)::text from mix_song_items m
        where exists (select 1 from release_tracks rt join releases r on r.id = rt.release_id
                       where rt.recording_id = m.recording_id and r.release_group_id in (${quoted}))
          and not exists (select 1 from release_tracks rt2 join releases r2 on r2.id = rt2.release_id
                           where rt2.recording_id = m.recording_id and r2.release_group_id not in (${quoted}))`);
    const blocking = guard.filter(g => Number(g.n) > 0);
    if (blocking.length) {
      console.error('\n  ABORTED — rows being removed carry user data this tool will not merge:');
      for (const b of blocking) console.error(`    ${b.table_name}: ${b.n} row(s)`);
      console.error('  Move those by hand, then re-run.');
      process.exit(1);
    }
  }

  let migrated = 0;
  for (const p of plans) {
    if (![p.keep, ...p.drop].some(r => Number(r.ratings) > 0)) continue;
    const all = [p.keep, ...p.drop].map(r => `'${r.id}'`).join(',');
    const dropIds = p.drop.map(d => `'${d.id}'`).join(',');
    // Keep one rating per user across the whole set: the most recently touched one.
    await query(`with ranked as (
        select id, row_number() over (partition by user_id
          order by greatest(coalesce(updated_at, created_at), created_at) desc, id desc) rn
        from ratings where release_group_id in (${all}))
      delete from ratings where id in (select id from ranked where rn > 1)`);
    const moved = await query<{ id: string }>(`update ratings set release_group_id = '${p.keep.id}'
      where release_group_id in (${dropIds}) returning id`);
    migrated += moved.length;
  }
  if (migrated) console.log(`  migrated ${migrated} rating(s) onto survivors`);

  console.log(`  deleting ${ids.length} duplicate row(s)...`);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100).map(x => `'${x}'`).join(',');
    await query(`delete from release_groups where id in (${batch})`);
    deleted += ids.slice(i, i + 100).length;
    console.log(`    deleted ${deleted}/${ids.length}`);
  }
  console.log(`\n  native_title preserved on ${titlesKept} survivor(s)`);
  console.log(`  DELETED ${deleted} release group(s)`);
}

/**
 * Merge an explicitly listed set. Used for duplicates a person reported and confirmed, which should
 * not have to satisfy a duration heuristic to get fixed — several real pairs do not: E SENS's 이방인
 * (15 tracks) and its iTunes twin The Stranger (13) describe one album with different track data.
 *
 * Every protection the swept path has still applies. The survivor is chosen by the same ranking, a
 * non-Latin loser title is preserved as native_title, ratings are migrated keeping each user's latest,
 * and the run aborts rather than let a cascade take a review, mix, list, pin or save.
 */
async function mergeSpecific(ids: string[]) {
  const quoted = ids.map(x => `'${x}'`).join(',');
  const rows = await query<Row>(`
    select rg.id, rg.title, rg.native_title, rg.release_group_type type, rg.first_release_date::text date,
           rg.source, rg.primary_artist_id artist_id, a.name artist, '' sig,
           (select count(*) from releases r2 where r2.release_group_id = rg.id) editions,
           (select count(*) from release_tracks rt2 join releases r3 on r3.id = rt2.release_id
             where r3.release_group_id = rg.id) tracks,
           (select count(*) from ratings t where t.release_group_id = rg.id) ratings
      from release_groups rg join artists a on a.id = rg.primary_artist_id
     where rg.id in (${quoted})`);
  if (rows.length < 2) { console.error(`  only ${rows.length} of ${ids.length} id(s) exist — nothing to merge`); process.exit(1); }
  const artists = new Set(rows.map(r => r.artist_id));
  if (artists.size > 1) { console.error('  ABORTED — these release groups belong to different artists'); process.exit(1); }

  const ranked = [...rows].sort((a, b) =>
    Number(isNonLatin(a.title ?? '')) - Number(isNonLatin(b.title ?? ''))
    || Number(b.editions) - Number(a.editions)
    || Number(b.tracks) - Number(a.tracks)
    || String(a.date ?? '9999').localeCompare(String(b.date ?? '9999'))
    || a.id.localeCompare(b.id));
  const plan = { keep: ranked[0], drop: ranked.slice(1) };
  console.log(`
[dedup-duration] explicit merge${APPLY ? '  *** APPLY ***' : '  (report only)'}`);
  console.log(`  KEEP "${plan.keep.title}" [${plan.keep.source}/${plan.keep.type}/tr${plan.keep.tracks}/${plan.keep.date}] ratings ${plan.keep.ratings}`);
  for (const d of plan.drop) console.log(`     drop "${d.title}" [${d.source}/${d.type}/tr${d.tracks}/${d.date}] ratings ${d.ratings}`);
  if (!APPLY) { console.log('\n  (report only — re-run with --apply)'); return; }
  await applyPlans([plan]);
}

main().catch((e) => { console.error(e); process.exit(1); });
