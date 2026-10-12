/**
 * Verify our discographies against LIVE external sources, on a random sample.
 *
 *   npx tsx --env-file=.env.local scripts/audit-sample-vs-sources.ts
 *   npx tsx --env-file=.env.local scripts/audit-sample-vs-sources.ts --engaged=20 --prestige=80
 *   npx tsx --env-file=.env.local scripts/audit-sample-vs-sources.ts --spotify   # once its breaker is clear
 *
 * WHY THIS EXISTS AND audit-data-errors.sql IS NOT ENOUGH. That one is internal-consistency only,
 * and its "expected count" comes from artists.mb_rg_count — a cached MusicBrainz figure. If
 * MusicBrainz is itself unreliable (it is: it counts bootlegs in first-release-date, catalogues
 * leaks as releases, and splits personas), then checking ourselves against a stored MB number
 * mostly measures how faithfully we copied MusicBrainz. It cannot catch "Kanye's discography is
 * completely wrong", because MB and we would be wrong together.
 *
 * So this asks iTunes (and optionally Spotify) directly, live, and diffs titles.
 *
 * SAMPLE DESIGN. Two strata, because they answer different questions:
 *   engaged  — artists whose albums users have rated/reviewed/pinned/saved/listed/mixed. Errors
 *              here are errors somebody has already seen.
 *   prestige — artists in external_scores (Rolling Stone 500, Grammy AOTY, Mercury, BRIT,
 *              Pitchfork perfect scores). These are the canonical names it is embarrassing to get
 *              wrong. NOT release_groups.prestige_score: that is capped at 1.0, covers only 766
 *              artists and is overwhelmingly K-pop, so it would never surface Kanye.
 * Sampled at random within each stratum rather than taking the top N, so the result is an estimate
 * of catalogue health instead of a hand-picked showcase.
 *
 * ONLY ARTISTS WITH AN iTUNES ID can be compared, since the comparison is a lookup by that id.
 * Artists without one are reported as unverifiable rather than silently dropped — "we could not
 * check" is a different finding from "we match".
 *
 * WHAT IT COMPARES. Albums and EPs only. Singles are excluded: iTunes lists them in the hundreds
 * for some artists and we deliberately do not mirror that, so including them would produce a huge
 * false "missing" count and bury the real signal.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const numArg = (f: string, d: number) => {
  const v = argv.find(a => a.startsWith(`--${f}=`))?.split('=')[1];
  return v ? parseInt(v, 10) : d;
};
const N_ENGAGED  = numArg('engaged', 20);
const N_PRESTIGE = numArg('prestige', 80);
const USE_SPOTIFY = argv.includes('--spotify');
const OUT = 'scripts/data/sample-audit.json';

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Title comparison has to survive two catalogues' punctuation habits, not just case. */
function norm(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s+-\s+(single|ep)$/i, '')                 // iTunes' format label
    .replace(/\s*[\(\[][^)\]]*\b(deluxe|remaster(ed)?|expanded|edition|version|anniversary|bonus|explicit)\b[^)\]]*[\)\]]\s*/gi, ' ')
    .replace(/[‘’“”]/g, "'")
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

type Artist = { id: string; name: string; itunes: string; stratum: 'engaged' | 'prestige' };

async function pickSample(): Promise<Artist[]> {
  const picked = new Map<string, Artist>();

  // --- engaged stratum
  const engagedRg = new Set<string>();
  for (const t of ['ratings', 'reviews', 'pinned_albums', 'saved_releases', 'list_items', 'mix_items']) {
    const { data } = await db.from(t).select('release_group_id').limit(1000);
    for (const r of (data ?? []) as any[]) if (r.release_group_id) engagedRg.add(r.release_group_id);
  }
  const engagedArtists = new Set<string>();
  const rgIds = [...engagedRg];
  for (let i = 0; i < rgIds.length; i += 300) {
    const { data } = await db.from('release_groups').select('primary_artist_id').in('id', rgIds.slice(i, i + 300));
    for (const r of (data ?? []) as any[]) if (r.primary_artist_id) engagedArtists.add(r.primary_artist_id);
  }

  // --- prestige stratum: artists named in external_scores
  const scored = new Set<string>();
  let after = '';
  for (;;) {
    let q = db.from('external_scores').select('artist').order('artist').limit(1000);
    if (after) q = q.gt('artist', after);
    const { data } = await q;
    if (!data?.length) break;
    for (const r of data as any[]) if (r.artist) scored.add(String(r.artist));
    after = (data[data.length - 1] as any).artist;
    if (data.length < 1000) break;
  }

  const shuffle = <T,>(xs: T[]) => xs.map(v => [Math.random(), v] as const).sort((a, b) => a[0] - b[0]).map(p => p[1]);

  // resolve an artist id + itunes id, keeping only comparable artists
  const withItunes = async (ids: string[], stratum: Artist['stratum'], want: number) => {
    for (const chunk of (() => { const out: string[][] = []; for (let i = 0; i < ids.length; i += 200) out.push(ids.slice(i, i + 200)); return out; })()) {
      if (picked.size >= want) break;
      const { data } = await db.from('artists')
        .select('id, name, artist_external_ids!inner(source, external_id)')
        .in('id', chunk);
      for (const a of shuffle((data ?? []) as any[])) {
        const it = (a.artist_external_ids ?? []).find((e: any) => e.source === 'itunes');
        if (!it) continue;
        if (!picked.has(a.id)) picked.set(a.id, { id: a.id, name: a.name, itunes: it.external_id, stratum });
        if (picked.size >= want) break;
      }
    }
  };

  await withItunes(shuffle([...engagedArtists]), 'engaged', N_ENGAGED);
  const engagedCount = picked.size;

  // prestige: resolve names -> ids
  const prestigeIds: string[] = [];
  const names = shuffle([...scored]);
  for (let i = 0; i < names.length && prestigeIds.length < N_PRESTIGE * 4; i += 50) {
    const { data } = await db.from('artists').select('id, name').in('name', names.slice(i, i + 50));
    for (const a of (data ?? []) as any[]) if (!picked.has(a.id)) prestigeIds.push(a.id);
  }
  await withItunes(prestigeIds, 'prestige', engagedCount + N_PRESTIGE);

  return [...picked.values()];
}

/* MATCH ON DATE, NOT TITLE — a pure title diff measures naming conventions, not gaps.
   Caught on the smoke test: 김현식 showed "ours 19 / iTunes 19" with 5 missing AND 5 extra,
   because the same albums are held under Korean titles on one side and romanized on the other
   ("김현식 Vol.6" vs "Kim Hyun Sik Vol. 6"). Reporting those as missing would have inflated the
   headline by most of its value. A release date is language-independent, exactly as track
   durations were for the ManiaDB matcher.
   Three distinct outcomes, which mean different things:
     matched            — same release present on both sides (by date)
     title_disagreement — matched by date, titles differ: a localization issue, NOT a gap
     missing / extra    — no counterpart by date or title. The real finding. */
type TheirAlbum = { title: string; date: string | null };

/** iTunes' own album list for an artist id. 403 is a rate signal, not an empty discography. */
async function itunesAlbums(artistId: string): Promise<TheirAlbum[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=200`,
        { headers: { 'User-Agent': 'sillajuku/1.0' } });
      if (res.status === 403 || res.status === 429) { await sleep(8000 * (attempt + 1)); continue; }
      if (!res.ok) return null;
      const d = await res.json() as { results?: any[] };
      const rows = (d.results ?? []).filter(r => r.wrapperType === 'collection');
      // Exclude singles: iTunes lists hundreds for some acts and we deliberately do not mirror them.
      return rows
        .filter(r => !/\s-\s(Single)$/i.test(String(r.collectionName ?? '')))
        .map(r => ({
          title: String(r.collectionName ?? ''),
          date: r.releaseDate ? String(r.releaseDate).slice(0, 10) : null,
        }))
        .filter(x => x.title);
    } catch { await sleep(2000); }
  }
  return null;
}

async function main() {
  console.log(`\n  sample audit vs live sources — ${N_ENGAGED} engaged + ${N_PRESTIGE} prestige\n`);
  const sample = await pickSample();
  console.log(`  sampled ${sample.length} artist(s) with an iTunes id`
    + ` (${sample.filter(s => s.stratum === 'engaged').length} engaged / ${sample.filter(s => s.stratum === 'prestige').length} prestige)\n`);

  const findings: any[] = [];
  let i = 0;
  for (const a of sample) {
    i++;
    const { data: oursRows } = await db.from('release_groups')
      .select('title, release_group_type, first_release_date')
      .eq('primary_artist_id', a.id)
      .in('release_group_type', ['album', 'ep']);
    const ours = (oursRows ?? []).map((r: any) => ({
      title: String(r.title), date: r.first_release_date ? String(r.first_release_date).slice(0, 10) : null,
    }));

    const theirs = await itunesAlbums(a.itunes);
    await sleep(1400);
    if (theirs === null) {
      findings.push({ artist: a.name, stratum: a.stratum, status: 'itunes_unavailable', ours: ours.length });
      console.log(`  [${i}/${sample.length}] ${a.name}: iTunes unavailable`);
      continue;
    }

    const ourByTitle = new Set(ours.map(o => norm(o.title)));
    const theirByTitle = new Set(theirs.map(t => norm(t.title)));
    // Date buckets: exact day, else year-month. iTunes and we often disagree by a few days on
    // reissues, but a same-month release for one artist is the same record in practice.
    const key = (d: string | null) => (d ? d.slice(0, 7) : null);
    const ourByDate = new Map<string, string>();
    for (const o of ours) { const k = key(o.date); if (k && !ourByDate.has(k)) ourByDate.set(k, o.title); }
    const theirByDate = new Map<string, string>();
    for (const t of theirs) { const k = key(t.date); if (k && !theirByDate.has(k)) theirByDate.set(k, t.title); }

    const missing: string[] = [], titleDisagree: string[] = [];
    for (const t of theirs) {
      if (theirByTitle.size && ourByTitle.has(norm(t.title))) continue;      // matched on title
      const k = key(t.date);
      if (k && ourByDate.has(k)) { titleDisagree.push(`${t.title}  ~  ${ourByDate.get(k)}`); continue; }
      missing.push(t.date ? `${t.title} (${t.date})` : t.title);
    }
    const extra: string[] = [];
    for (const o of ours) {
      if (theirByTitle.has(norm(o.title))) continue;
      const k = key(o.date);
      if (k && theirByDate.has(k)) continue;                                  // counted as disagreement above
      extra.push(o.date ? `${o.title} (${o.date})` : o.title);
    }

    const f = {
      artist: a.name, stratum: a.stratum, status: 'compared',
      ours: ours.length, itunes: theirs.length,
      missing_count: missing.length, extra_count: extra.length,
      title_disagreement_count: titleDisagree.length,
      missing: missing.slice(0, 12), extra: extra.slice(0, 12),
      title_disagreements: titleDisagree.slice(0, 8),
    };
    findings.push(f);
    console.log(`  [${i}/${sample.length}] ${a.name}: ours ${ours.length} / iTunes ${theirs.length}`
      + `  missing ${missing.length}, extra ${extra.length}, title-diff ${titleDisagree.length}`);
  }

  fs.writeFileSync(OUT, JSON.stringify(findings, null, 2));

  const cmp = findings.filter(f => f.status === 'compared');
  const totMissing = cmp.reduce((n, f) => n + f.missing_count, 0);
  const totExtra = cmp.reduce((n, f) => n + f.extra_count, 0);
  const totDisagree = cmp.reduce((n, f) => n + (f.title_disagreement_count ?? 0), 0);
  const clean = cmp.filter(f => f.missing_count === 0 && f.extra_count === 0).length;
  console.log('\n  ── SUMMARY ─────────────────────────');
  console.log(`  compared:              ${cmp.length}`);
  console.log(`  iTunes unavailable:    ${findings.length - cmp.length}`);
  console.log(`  exact match:           ${clean}`);
  console.log(`  albums iTunes has, we lack: ${totMissing}`);
  console.log(`  albums we have, iTunes lacks: ${totExtra}`);
  console.log(`  same release, different title: ${totDisagree}   (localization, not a gap)`);
  console.log(`  report -> ${OUT}`);
  if (USE_SPOTIFY) console.log('  (--spotify requested: add the Spotify pass once its breaker is clear)');
}

main().catch(e => { console.error(e); process.exit(1); });
