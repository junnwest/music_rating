/**
 * Catalog coverage / match-rate verification harness.  READ-ONLY.
 *
 *   npx tsx --env-file=.env.local scripts/verify-coverage.ts [--source itunes|spotify]
 *                                                            [--limit N] [--albums M] [--json path]
 *
 * WHY: when a user connects Spotify or Apple Music, the app pulls their top
 * artists + recently-played albums (name strings) and must MATCH each one to a
 * row in our own catalog. This script measures how well that matching works, by
 * pulling a ground-truth discography for each test artist from the SAME external
 * platform users' data comes from (iTunes by default — no auth, no shared-prod
 * credential risk; Spotify optional) and running each item through a faithful
 * re-implementation of the app's real resolution path:
 *
 *   - artists  → resolveArtist():  search_artists RPC + name/native overlap gate
 *   - albums   → fetchRelease():   exact ilike-title on release_groups + artist
 *                                  overlap, then fuzzy search_release_groups + gate
 *
 * Ground truth is iTunes/Spotify, NEVER MusicBrainz — the point is to verify our
 * catalog against what the platforms users actually connect from believe exists.
 *
 * Headline metric is the ALBUM+EP match rate (what the album-centric taste/
 * discovery flow actually surfaces). Singles are reported separately because the
 * fuzzy search_release_groups RPC hardcodes release_group_type IN ('album','ep'),
 * so singles can only ever match via the exact-title step — a known, documented
 * gap, not news, so we don't let it drown the headline number.
 *
 * Every album/EP MISS is classified so the output is actionable:
 *   - catalog-gap : the resolved artist genuinely has no matching release in our
 *                   DB  → feeds the pipeline expansion (seed the artist by MBID).
 *   - match-bug   : the release IS in our DB under the artist but our matcher
 *                   didn't find it (title/native drift) → feeds the data fixes.
 *
 * Nothing here writes to the catalog. It only SELECTs and calls the read RPCs.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { COVERAGE_TESTSET, type TestArtist } from './data/coverage-testset';
import { searchArtist as itunesSearchArtist, fetchDiscography as itunesDiscography, ItunesBlockedError } from './itunes-client';

// ── config ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function arg(flag: string, def?: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const SOURCE = (arg('--source', 'itunes') as 'itunes' | 'spotify');
const ARTIST_LIMIT = parseInt(arg('--limit', String(COVERAGE_TESTSET.length))!, 10);
const ALBUMS_PER_ARTIST = parseInt(arg('--albums', '18')!, 10); // cap discography size per artist to bound runtime
const JSON_OUT = arg('--json', 'scripts/output/coverage-report.json')!;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

type RelType = 'single' | 'ep' | 'album';

// ── the app's matching primitives, faithfully re-implemented ───────────────
// Bidirectional case-insensitive substring overlap — the exact confidence gate
// used in iOS SearchView.swift (fetchRelease artist gate + resolveArtist name gate).
function overlap(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = a.toLowerCase().trim(), y = b.toLowerCase().trim();
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

// Loose normalized comparison for miss-classification only (NOT a match gate) —
// mirrors the spirit of the DB's normalize_text(): lowercase, strip punctuation/
// space, keep CJK. Used to decide "is this album actually in the catalog under a
// slightly different string?" when the real matcher missed it.
function normLoose(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// iTunes appends release-type suffixes its collectionName that our stored title
// (and clean Spotify/Apple album data) doesn't carry: "TTFU - Single",
// "foo - EP", K-pop "MY WORLD - The 3rd Mini Album". Strip them so the exact-
// title match is fair. (Same shape as itunes-client.ts albumKey() pre-norm.)
function stripItunesSuffix(title: string): string {
  return (title ?? '')
    .replace(/\s*[-–—]\s*the\s+\d+(st|nd|rd|th)\s+(full[- ]?length\s+|mini\s+|single\s+)?(album|ep|mixtape|lp)\b.*$/i, '')
    .replace(/\s*[-–—]\s*(ep|single|lp|mixtape|mini album|album)\s*$/i, '')
    .trim();
}
// iTunes trackCount → our release_group_type buckets (matches lib/itunes.ts).
function relType(trackCount?: number): RelType {
  if (!trackCount) return 'album';
  return trackCount <= 3 ? 'single' : trackCount <= 6 ? 'ep' : 'album';
}

interface ArtistRow { id: string; name: string; name_native: string | null; aliases: string[] | null; }
interface RgRow { id: string; title: string; artist_display: string; native_title: string | null; release_group_type: string; primary_artist_id: string | null; }

// resolveArtist(): search_artists RPC (lim 3) + name/native/ALIAS overlap gate.
// The alias arm is the romanization-aware fix: for a native-named artist (혁오)
// the query ("Hyukoh") overlaps the returned "HYUKOH" alias even though it can't
// overlap the Hangul canonical name.
async function resolveArtist(name: string): Promise<ArtistRow | null> {
  const { data, error } = await db.rpc('search_artists', { q: name, lim: 3 });
  if (error) { console.error(`  ! search_artists("${name}"): ${error.message}`); return null; }
  const rows = (data ?? []) as ArtistRow[];
  return rows.find(r => overlap(r.name, name) || overlap(r.name_native, name) || (r.aliases ?? []).some(a => overlap(a, name))) ?? null;
}

// fetchRelease(): step 1 unrestricted exact ilike-title, step 2 fuzzy RPC. An
// album is accepted when its artist_display overlaps the external artist name
// OR — the romanization-aware fix — its primary_artist_id matches the already-
// resolved artist (so a native artist_display like "혁오" still matches an
// external "Hyukoh" once we've resolved the artist by alias).
async function fetchRelease(title: string, artist: string, artistId?: string | null): Promise<RgRow | null> {
  const accept = (r: RgRow) => overlap(r.artist_display, artist) || (!!artistId && r.primary_artist_id === artistId);
  // Step 1 — direct table match, NO release_group_type filter (the compilation/single rescue).
  const exact = await db
    .from('release_groups')
    .select('id, title, artist_display, native_title, release_group_type, primary_artist_id')
    .ilike('title', title)
    .limit(5);
  if (!exact.error && exact.data) {
    const hit = (exact.data as RgRow[]).find(accept);
    if (hit) return hit;
  }
  // Step 2 — fuzzy RPC fallback + the same gate (album/ep only, by RPC design).
  const { data, error } = await db.rpc('search_release_groups', { q: title, lim: 10 });
  if (error) { console.error(`  ! search_release_groups("${title}"): ${error.message}`); return null; }
  return (data as RgRow[] ?? []).find(accept) ?? null;
}

// For a missed album: is it actually in the catalog under the resolved artist,
// just not found by the matcher? Pull the artist's release groups and loose-compare.
async function albumExistsUnderArtist(artistId: string, title: string): Promise<RgRow | null> {
  const { data, error } = await db.rpc('get_artist_release_groups', { p_artist_id: artistId, lim: 200 });
  if (error || !data) return null;
  const nt = normLoose(title);
  if (!nt) return null;
  return (data as RgRow[]).find(r => {
    const a = normLoose(r.title), b = normLoose(r.native_title ?? '');
    return a === nt || b === nt || (!!a && (a.includes(nt) || nt.includes(a))) || (!!b && (b.includes(nt) || nt.includes(b)));
  }) ?? null;
}

// The MB MBID for a resolved artist (drives pipeline seeding of catalog gaps).
async function artistMbid(artistId: string): Promise<string | null> {
  const { data } = await db.from('artist_external_ids').select('external_id').eq('artist_id', artistId).eq('source', 'musicbrainz').maybeSingle();
  return (data as { external_id: string } | null)?.external_id ?? null;
}

// ── ground-truth fetch ──────────────────────────────────────────────────────
interface GtAlbum { title: string; raw: string; type: RelType; }
async function groundTruth(name: string): Promise<{ resolved: boolean; extName?: string; albums: GtAlbum[] }> {
  if (SOURCE === 'itunes') {
    const a = await itunesSearchArtist(name);
    if (!a) return { resolved: false, albums: [] };
    const disc = await itunesDiscography(a.artistId);
    const albums = disc
      .sort((x, y) => (y.releaseDate ?? '').localeCompare(x.releaseDate ?? ''))
      .slice(0, ALBUMS_PER_ARTIST)
      .map(d => ({ title: stripItunesSuffix(d.collectionName), raw: d.collectionName, type: relType(d.trackCount) }));
    return { resolved: true, extName: a.artistName, albums };
  }
  // Spotify path — lazy import so the shared-prod-credential module only loads if asked.
  const { resolveArtistId, searchAlbumsByArtistId } = await import('../lib/spotify');
  const { assertSpotifyCircuitClosed } = await import('./spotify-circuit');
  await assertSpotifyCircuitClosed();
  const id = await resolveArtistId(name);
  if (!id) return { resolved: false, albums: [] };
  const albums = (await searchAlbumsByArtistId(id, name)).slice(0, ALBUMS_PER_ARTIST).map((al: any) => {
    const t = (al.releaseType ?? '').toLowerCase();
    return { title: al.title, raw: al.title, type: (t === 'single' ? 'single' : t === 'ep' ? 'ep' : 'album') as RelType };
  });
  return { resolved: true, albums };
}

// ── run ─────────────────────────────────────────────────────────────────────
interface AlbumResult { title: string; raw: string; type: RelType; matched: boolean; missKind?: 'catalog-gap' | 'match-bug'; foundAs?: string; }
interface ArtistResult {
  name: string; scene: string; note?: string;
  gtResolved: boolean;               // did the external platform know this artist?
  catalogResolved: boolean;          // did OUR resolveArtist find them?
  catalogArtistId?: string; mbid?: string | null;
  albums: AlbumResult[];
}

async function runArtist(t: TestArtist): Promise<ArtistResult> {
  const res: ArtistResult = { name: t.name, scene: t.scene, note: t.note, gtResolved: false, catalogResolved: false, albums: [] };
  const gt = await groundTruth(t.name);
  res.gtResolved = gt.resolved;

  const cat = await resolveArtist(t.name);
  res.catalogResolved = !!cat;
  if (cat) { res.catalogArtistId = cat.id; res.mbid = await artistMbid(cat.id); }

  for (const alb of gt.albums) {
    const hit = await fetchRelease(alb.title, gt.extName ?? t.name, cat?.id);
    if (hit) { res.albums.push({ ...alb, matched: true }); continue; }
    // classify the miss
    let missKind: 'catalog-gap' | 'match-bug' = 'catalog-gap';
    let foundAs: string | undefined;
    if (cat) {
      const under = await albumExistsUnderArtist(cat.id, alb.title);
      if (under) { missKind = 'match-bug'; foundAs = under.native_title ? `${under.title} / ${under.native_title} [${under.release_group_type}]` : `${under.title} [${under.release_group_type}]`; }
    }
    res.albums.push({ ...alb, matched: false, missKind, foundAs });
  }
  return res;
}

function pct(n: number, d: number): string { return d === 0 ? '  n/a' : `${(100 * n / d).toFixed(1)}%`; }

async function main() {
  console.log(`\n  sillajuku coverage verification — ground truth: ${SOURCE.toUpperCase()} (never MusicBrainz)`);
  console.log(`  test set: ${Math.min(ARTIST_LIMIT, COVERAGE_TESTSET.length)} artists, up to ${ALBUMS_PER_ARTIST} albums each\n`);

  const results: ArtistResult[] = [];
  const set = COVERAGE_TESTSET.slice(0, ARTIST_LIMIT);
  for (let i = 0; i < set.length; i++) {
    const t = set[i];
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${set.length}] ${t.name.padEnd(26)} `);
    try {
      const r = await runArtist(t);
      results.push(r);
      const ae = r.albums.filter(a => a.type !== 'single');
      const tag = !r.gtResolved ? 'ext-miss (not on ' + SOURCE + ')' : !r.catalogResolved ? 'ARTIST MISS' : `${ae.filter(a => a.matched).length}/${ae.length} alb+ep`;
      console.log(`${r.catalogResolved || !r.gtResolved ? 'ok ' : '✗  '}${tag}`);
    } catch (e) {
      if (e instanceof ItunesBlockedError) { console.log('iTunes IP-blocked — stopping early, partial report follows'); break; }
      console.log(`error: ${(e as Error).message}`);
    }
  }

  // ── aggregate (album+EP headline; singles separate) ──
  const gtResolved = results.filter(r => r.gtResolved);
  const artistMatched = gtResolved.filter(r => r.catalogResolved);
  const albEp = artistMatched.flatMap(r => r.albums.filter(a => a.type !== 'single'));
  const singles = artistMatched.flatMap(r => r.albums.filter(a => a.type === 'single'));
  const albEpMatched = albEp.filter(a => a.matched).length;
  const singlesMatched = singles.filter(a => a.matched).length;
  const albEpMisses = albEp.filter(a => !a.matched);
  const catalogGaps = albEpMisses.filter(m => m.missKind === 'catalog-gap').length;
  const matchBugs = albEpMisses.filter(m => m.missKind === 'match-bug').length;

  console.log('\n  ── SUMMARY ─────────────────────────────────────────────');
  console.log(`  Artists in test set:              ${results.length}`);
  console.log(`  Found on ${SOURCE} (ground truth):    ${gtResolved.length}  (${pct(gtResolved.length, results.length)})`);
  console.log(`  Resolved in OUR catalog:          ${artistMatched.length}  (${pct(artistMatched.length, gtResolved.length)} of ground-truth artists)`);
  console.log(`  ►Album+EP match rate:             ${albEpMatched}/${albEp.length}  (${pct(albEpMatched, albEp.length)})   ← headline`);
  console.log(`     of ${albEpMisses.length} alb+ep misses:  ${catalogGaps} catalog-gap (need ingest) · ${matchBugs} match-bug (in catalog, matcher missed)`);
  console.log(`   Singles match rate:              ${singlesMatched}/${singles.length}  (${pct(singlesMatched, singles.length)})   (RPC excludes singles by design — expected low)`);

  // ── by scene (album+ep) ──
  console.log('\n  By scene (artist-resolve · album+EP match):');
  const scenes = [...new Set(results.map(r => r.scene))];
  for (const s of scenes) {
    const rs = results.filter(r => r.scene === s && r.gtResolved);
    const am = rs.filter(r => r.catalogResolved);
    const ae = am.flatMap(r => r.albums.filter(a => a.type !== 'single'));
    const mm = ae.filter(a => a.matched).length;
    console.log(`    ${s.padEnd(18)} ${am.length}/${rs.length} artists  ·  ${pct(mm, ae.length)} alb+ep (${mm}/${ae.length})`);
  }

  // ── artist misses (unresolved in our catalog despite existing on the platform) ──
  const artistMisses = gtResolved.filter(r => !r.catalogResolved);
  if (artistMisses.length) {
    console.log('\n  ARTIST MISSES (on platform, not resolvable in our catalog):');
    for (const r of artistMisses) console.log(`    ✗ ${r.name.padEnd(26)} [${r.scene}]${r.note ? '  — ' + r.note : ''}`);
  }
  // ── ext-misses (not even on the ground-truth platform under this name) ──
  const extMisses = results.filter(r => !r.gtResolved);
  if (extMisses.length) {
    console.log(`\n  NOT ON ${SOURCE.toUpperCase()} under the test name (excluded from rates; try --source spotify):`);
    for (const r of extMisses) console.log(`    · ${r.name} [${r.scene}]`);
  }

  // ── match-bugs: alb+ep in catalog but matcher failed (highest-value, feeds data fixes) ──
  const bugRows = artistMatched.flatMap(r => r.albums.filter(a => !a.matched && a.missKind === 'match-bug' && a.type !== 'single').map(a => ({ artist: r.name, title: a.raw, type: a.type, foundAs: a.foundAs })));
  if (bugRows.length) {
    console.log('\n  MATCH-BUGS (album/EP IS in catalog but the matcher missed it — title/native drift):');
    for (const m of bugRows.slice(0, 40)) console.log(`    ~ ${m.artist} — "${m.title}"  →  catalog: ${m.foundAs}`);
    if (bugRows.length > 40) console.log(`    … and ${bugRows.length - 40} more (see JSON)`);
  }

  // ── full JSON report ──
  try { mkdirSync(JSON_OUT.replace(/[/\\][^/\\]+$/, ''), { recursive: true }); } catch { /* dir may exist */ }
  const report = {
    source: SOURCE, generatedFrom: 'verify-coverage.ts',
    summary: {
      artists: results.length, groundTruthResolved: gtResolved.length, catalogResolved: artistMatched.length,
      albEpMatchRate: albEp.length ? +(albEpMatched / albEp.length).toFixed(4) : null,
      albEpTotal: albEp.length, albEpMatched, singlesTotal: singles.length, singlesMatched, catalogGaps, matchBugs,
    },
    artistMisses: artistMisses.map(r => ({ name: r.name, scene: r.scene, note: r.note })),
    extMisses: extMisses.map(r => ({ name: r.name, scene: r.scene })),
    matchBugs: bugRows,
    catalogGapArtists: artistMatched
      .map(r => ({ name: r.name, mbid: r.mbid, gaps: r.albums.filter(a => !a.matched && a.missKind === 'catalog-gap' && a.type !== 'single').map(a => a.raw) }))
      .filter(r => r.gaps.length),
    perArtist: results,
  };
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.log(`\n  Full report → ${JSON_OUT}`);
  console.log('  (catalogGapArtists carries MBIDs — seed these to expand the dataset toward what users actually listen to.)\n');
}

main().catch(e => { console.error(e); process.exit(1); });
