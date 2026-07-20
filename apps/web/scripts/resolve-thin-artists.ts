/**
 * DRY-RUN reporter for the "thin/empty MB artist" residual (e.g. 아카네 리제 / Akane Lize — MB knows
 * it only as a guest feature, so we ingested 0 releases, yet it has a real streaming discography).
 *
 * The backfill lane can't touch these: its identity gate needs ≥2 owned releases to confirm which
 * streaming artist is ours, and these have 0–1. This reporter tests a SAFER identity signal —
 * ANCHOR CORROBORATION — and only *reports* what it would resolve (writes nothing):
 *
 *   1. ANCHORS = the artist's FULL MB footprint (browseReleaseGroups incl. the feature credits the
 *      composition filter drops). For 아카네 리제 that's {"Hit on Shot"}. No anchors → can't
 *      corroborate → NONE (a truly-empty MB artist stays untouched — missing > wrong).
 *   2. iTunes SONG search by the artist's native name returns the tracks they're actually on (solo +
 *      features). If one of those track titles matches a DISTINCTIVE anchor, that's concrete
 *      corroboration this is our artist — not a name guess. (Akane Lize IS on iTunes's "Hit on Shot".)
 *   3. The SOLO iTunes artistId is read from the same results (the id credited on solo-looking tracks,
 *      e.g. "Akane Lize — Festa!"), and its album count is what we'd stand to gain.
 *   4. GENERIC-NAME GUARD: a short single-token native name (민수) is collision-prone, so it needs ≥2
 *      corroborated anchors; a distinctive multi-token name (아카네 리제) needs ≥1. This is what keeps
 *      generic names (Minsu) classified REVIEW/NONE instead of auto-CONFIRM.
 *
 * Classification: CONFIRM (enough distinctive anchors corroborated + a solo id with albums) /
 * REVIEW (candidate found but corroboration too weak — needs a human) / NONE (nothing to go on).
 *
 *   npx tsx --env-file=.env.local scripts/resolve-thin-artists.ts --artist="아카네 리제"
 *   npx tsx --env-file=.env.local scripts/resolve-thin-artists.ts --sample=25
 */
import * as fs from 'fs';
import * as path from 'path';
import { getDB } from './itunes-ingest-core';
import { backfillKey } from './discover-itunes-backfill';
import { browseReleaseGroups } from './mb-client';

const ITUNES = 'https://itunes.apple.com';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function itunesGet(url: string, attempt = 0): Promise<any> {
  await sleep(900 + Math.floor(Math.random() * 400));
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'sillajuku-thin-resolve/1.0' } });
    if (r.status === 403 || r.status === 429) {
      if (attempt >= 4) return null;
      await sleep(Math.min(60000, 8000 * 2 ** attempt));
      return itunesGet(url, attempt + 1);
    }
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const norm = (s: string) => (s ?? '').toLowerCase().replace(/[''`"]/g, '').replace(/[^\w\s가-힣぀-ゟ゠-ヿ一-鿿]/gu, ' ').replace(/\s+/g, ' ').trim();
// A "clean single credit" = no collaboration markers. We can't name-match (iTunes romanizes "Akane
// Lize" while we store Hangul "아카네 리제"), so instead we require the clean-credit solo artist to be
// UNIQUE among the native-name search results — for a distinctive name that's our artist; for a
// generic name many clean credits appear → not unique → we abstain (safe).
const isSoloCredit = (artistName: string) =>
  !/\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|&|,| x | X |\bwith\b|\bvs\.?\b|\bx\b/i.test(artistName ?? '');
// A distinctive anchor is unlikely to collide by chance: ≥2 tokens or ≥6 chars, and not a bare number.
const isDistinctiveAnchor = (key: string) => !!key && !/^\d+$/.test(key) && (key.split(' ').length >= 2 || key.length >= 6);
// Generic given-name guard: a short single-token CJK name (민수, 지훈) is collision-prone.
const isGenericName = (nativeName: string) => {
  const n = (nativeName ?? '').trim();
  const cjk = (n.match(/[가-힣぀-ゟ゠-ヿ一-鿿]/g) ?? []).length;
  return n.split(/\s+/).length === 1 && cjk > 0 && cjk <= 2;
};

interface ThinArtist { id: string; name: string; name_native: string | null; mbid: string }
type Verdict = 'CONFIRM' | 'REVIEW' | 'NONE';
interface Result {
  name: string; native: string | null; ownedGroups: number; anchors: number;
  matchedAnchors: string[]; soloArtistId: number | null; soloName: string | null; soloAlbums: number; soloCount: number;
  generic: boolean; verdict: Verdict; note: string;
}

async function resolveOne(a: ThinArtist, ownedGroups: number): Promise<Result> {
  const native = a.name_native ?? (/[가-힣]/.test(a.name) ? a.name : null);
  const base: Result = { name: a.name, native, ownedGroups, anchors: 0, matchedAnchors: [], soloArtistId: null, soloName: null, soloAlbums: 0, soloCount: 0, generic: native ? isGenericName(native) : false, verdict: 'NONE', note: '' };

  // 1. MB footprint anchors (incl. features).
  const rgs = await browseReleaseGroups(a.mbid);
  const anchorKeys = [...new Set(rgs.map(r => backfillKey(r.title)).filter(isDistinctiveAnchor))];
  base.anchors = anchorKeys.length;
  if (anchorKeys.length === 0) { base.note = 'no distinctive MB anchors (truly empty/generic titles) — nothing to corroborate'; return base; }
  if (!native) { base.note = 'no native name to search streaming by'; return base; }

  // 2. iTunes song search by native name → tracks the artist is on (solo + features).
  const data = await itunesGet(`${ITUNES}/search?term=${encodeURIComponent(native)}&entity=song&limit=25&country=KR`);
  const songs: any[] = (data?.results ?? []).filter((r: any) => r.wrapperType === 'track' && r.kind === 'song');
  if (!songs.length) { base.note = 'artist not found via iTunes song search'; return base; }

  // 3. corroborate: which distinctive anchors show up as track titles? Record the credit strings on
  // those anchor tracks — the artist is named inside them (e.g. "Airi Kanna & Akane Lize").
  const matched = new Set<string>();
  const anchorCredits: string[] = [];
  for (const s of songs) {
    const k = backfillKey(s.trackName ?? '');
    if (anchorKeys.includes(k)) { matched.add(k); anchorCredits.push(norm(s.artistName ?? '')); }
  }
  base.matchedAnchors = [...matched];

  // 4. solo artistId = a clean-single-credit artist whose (romanized) name is CONTAINED in one of the
  // anchor credits — i.e. the same person named on the distinctive release MB records for them. This
  // ties identity to the anchor (not a bare name match), so noise clean-credits are excluded.
  const soloVotes = new Map<number, { name: string; n: number }>();
  for (const s of songs) {
    if (!isSoloCredit(s.artistName ?? '')) continue;
    const toks = norm(s.artistName ?? '').split(' ').filter(Boolean);
    const linked = toks.length > 0 && anchorCredits.some(ac => toks.every(t => ac.split(' ').includes(t)));
    if (!linked) continue;
    const v = soloVotes.get(s.artistId) ?? { name: s.artistName, n: 0 }; v.n++; soloVotes.set(s.artistId, v);
  }
  base.soloCount = soloVotes.size;
  const solo = [...soloVotes.entries()].sort((x, y) => y[1].n - x[1].n)[0];
  if (solo) {
    base.soloArtistId = solo[0]; base.soloName = solo[1].name;
    const disc = await itunesGet(`${ITUNES}/lookup?id=${solo[0]}&entity=album&limit=50&country=KR`);
    base.soloAlbums = (disc?.results ?? []).filter((r: any) => r.wrapperType === 'collection' && r.collectionType === 'Album').length;
  }

  // 5. verdict: distinctive-anchor corroboration ≥ need AND a UNIQUE solo id with albums.
  const need = base.generic ? 2 : 1;
  const soloUnique = base.soloCount === 1;
  if (matched.size >= need && soloUnique && base.soloArtistId && base.soloAlbums > 0) {
    base.verdict = 'CONFIRM'; base.note = `${matched.size} distinctive anchor(s) corroborated (need ${need}); unique solo id ${base.soloArtistId} has ${base.soloAlbums} albums`;
  } else if (base.soloArtistId || matched.size > 0) {
    base.verdict = 'REVIEW'; base.note = `weak: anchors ${matched.size}/${need}, clean-solo-ids ${base.soloCount} (need 1), solo=${base.soloArtistId ?? 'none'}(${base.soloAlbums}alb)${base.generic ? ' [generic name]' : ''}`;
  } else {
    base.note = 'no anchor corroboration and no clean solo credit found';
  }
  return base;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
  const ARTIST = arg('--artist') ?? null;
  const SAMPLE = arg('--sample') ? parseInt(arg('--sample')!, 10) : 20;
  const COUNTRY = arg('--country') ?? 'KR';
  const db = getDB();

  // Thin candidates: KR, tracks_done, MB-linked, with ≤1 owned release-group.
  let artists: ThinArtist[] = [];
  if (ARTIST) {
    const { data } = await db.from('artists').select('id, name, name_native').ilike('name', ARTIST).limit(3);
    for (const r of data ?? []) {
      const { data: ext } = await db.from('artist_external_ids').select('external_id').eq('artist_id', r.id).eq('source', 'musicbrainz').maybeSingle();
      if (ext?.external_id) artists.push({ ...r, mbid: ext.external_id } as ThinArtist);
    }
  } else {
    const { data } = await db.from('artists').select('id, name, name_native').eq('country', COUNTRY).eq('ingest_state', 'tracks_done').order('id').limit(SAMPLE * 25);
    for (const r of data ?? []) {
      if (artists.length >= SAMPLE) break;
      const { count } = await db.from('release_groups').select('*', { count: 'exact', head: true }).eq('primary_artist_id', r.id);
      if ((count ?? 0) > 1) continue; // thin only
      const { data: ext } = await db.from('artist_external_ids').select('external_id').eq('artist_id', r.id).eq('source', 'musicbrainz').maybeSingle();
      if (ext?.external_id) artists.push({ ...(r as any), mbid: ext.external_id, ownedGroups: count } as any);
    }
  }
  if (!artists.length) { console.log('No thin MB-linked artists matched.'); return; }

  console.log(`DRY-RUN thin-artist resolution — ${artists.length} artist(s)\n`);
  const rows: Result[] = [];
  for (const a of artists) {
    const owned = (a as any).ownedGroups ?? 0;
    const r = await resolveOne(a, owned);
    rows.push(r);
    const tag = { CONFIRM: '✅ CONFIRM', REVIEW: '⚠ REVIEW ', NONE: '·  none  ' }[r.verdict];
    console.log(`  ${tag}  ${r.name.padEnd(20)} (${r.native ?? '—'})  anchors=${r.anchors} matched=${r.matchedAnchors.length} solo=${r.soloArtistId ?? '—'}(${r.soloAlbums}alb)  — ${r.note}`);
  }
  const c = rows.filter(r => r.verdict === 'CONFIRM'), rv = rows.filter(r => r.verdict === 'REVIEW');
  console.log(`\n=== SUMMARY === CONFIRM ${c.length} · REVIEW ${rv.length} · NONE ${rows.length - c.length - rv.length}`);
  if (c.length) { console.log('\nCONFIRM detail (would ingest solo discography under our artist):'); for (const r of c) console.log(`  ${r.name} → iTunes ${r.soloArtistId} "${r.soloName}" (${r.soloAlbums} albums); anchors: ${r.matchedAnchors.join(', ')}`); }
  const outDir = path.resolve('scripts/output'); fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `thin-artists-${rows.length}.json`);
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 2));
  console.log(`\nJSON → ${outFile}`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
