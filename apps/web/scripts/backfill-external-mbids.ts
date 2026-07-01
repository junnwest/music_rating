/**
 * Backfill external_scores.mb_release_group_id for prestige albums scored but never MB-matched
 * (the ~468 NULL-MBID rows — mostly Korean/Japanese classics the leaderboard can't show).
 *
 * Strategy: resolve-artist-then-BROWSE. Direct title+artist search fails on this data because
 * external_scores stores ROMANIZED names while MB credits in Hangul/Kanji, and titles carry edition
 * suffixes ("- The 1st Album", "(Deluxe)", "1집"). So instead: resolve each distinct artist name to
 * an MBID via the alias-aware resolver (bridges Nucksal→넉살, 들국화→들국화), browse that artist's
 * release-groups, and title-match the album within their (small) catalog.
 *
 * Guard (leaderboard quality): only a CONFIDENT, non-ambiguous artist resolution counts, and the
 * album title must match a single RG in that artist's catalog (exact-normalized, or one unique
 * suffix/substring match). Mis-resolves (Dean→Dean Martin) and not-in-MB albums are skipped.
 *
 * After a real run: `npm run seed:missing-from-external` then `npm run prestige:reconcile`.
 * Hits MusicBrainz (~1 req/s, resolve + browse per distinct artist) → run during a pipeline pause.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-external-mbids.ts --dry-run [--limit=N]
 *   npx tsx --env-file=.env.local scripts/backfill-external-mbids.ts
 */
import { getDB, resolveArtist } from './mb-ingest';
import { browseReleaseGroups } from './mb-client';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Region hint from the prestige source → the resolver disambiguates a romanized name (Black Skirt →
// 검정치마) far more confidently when it knows the country.
function regionOfSource(sources: Set<string>): string | null {
  const s = [...sources];
  if (s.some(x => x.startsWith('jp_'))) return 'JP';
  if (s.some(x => /^(kr_|kma|mama|golden_disc|weiv|izm|rhythmer|kha|sma|mma)/.test(x))) return 'KR';
  return null; // grammy / rs500 / pitchfork / brit / mercury → Western, no hint
}

async function main() {
  const db = getDB();

  // Page NULL-MBID rows; group album titles under each distinct artist name.
  const byArtist = new Map<string, Set<string>>();
  const artistSources = new Map<string, Set<string>>();
  const srcOf = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('external_scores')
      .select('album_title, artist, source').is('mb_release_group_id', null)
      .order('artist').range(from, from + 999);
    if (error) { console.error('fetch error:', error.message); break; }
    if (!data?.length) break;
    for (const r of data) {
      if (!byArtist.has(r.artist)) { byArtist.set(r.artist, new Set()); artistSources.set(r.artist, new Set()); }
      byArtist.get(r.artist)!.add(r.album_title);
      artistSources.get(r.artist)!.add(r.source);
      srcOf.set(`${r.artist}::${r.album_title}`, r.source);
    }
    if (data.length < 1000) break;
  }
  let artists = [...byArtist.keys()];
  if (artists.length > LIMIT) artists = artists.slice(0, LIMIT);
  const albumCount = artists.reduce((n, a) => n + byArtist.get(a)!.size, 0);
  console.log(`[ext-mbids] ${artists.length} distinct artists / ${albumCount} albums (resolve→browse)${DRY ? '  [DRY RUN]' : ''}\n`);

  let matched = 0, noArtist = 0, noAlbum = 0;
  const updates: { title: string; artist: string; mbid: string }[] = [];

  for (const artist of artists) {
    const albums = [...byArtist.get(artist)!];
    const region = regionOfSource(artistSources.get(artist)!);
    const r = await resolveArtist(artist, region);
    await sleep(200);
    if (!r.best || r.ambiguous || r.needsReview) {
      noArtist += albums.length;
      console.log(`  ✗ artist unresolved/ambiguous: ${artist}  (${albums.length} album${albums.length > 1 ? 's' : ''})`);
      continue;
    }
    const rgs = await browseReleaseGroups(r.best.id);
    await sleep(200);
    for (const title of albums) {
      const want = norm(title);
      // exact first, else a unique edition-suffix match within THIS artist's catalog. The substring
      // path requires the SHORTER title be ≥6 chars, or a short MB title like "BE" spuriously matches
      // inside a longer external one ("BE" ⊂ "The Most BEautiful Moment…").
      let hits = rgs.filter(g => norm(g.title) === want);
      if (!hits.length) hits = rgs.filter(g => {
        const t = norm(g.title);
        if (!t || !want) return false;
        const short = t.length <= want.length ? t : want;
        const long = t.length <= want.length ? want : t;
        return short.length >= 6 && long.includes(short);
      });
      const src = srcOf.get(`${artist}::${title}`) ?? '?';
      if (hits.length === 1) {
        matched++;
        updates.push({ title, artist, mbid: hits[0].id });
        console.log(`  ✓ [${src}] ${artist} — ${title}  →  ${r.best.name} · ${hits[0].title}`);
      } else {
        noAlbum++;
        console.log(`  ✗ [${src}] ${artist} — ${title}  →  ${r.best.name} [${rgs.length} RGs]${hits.length > 1 ? ' (ambiguous title)' : ' (album not in catalog)'}`);
      }
    }
  }

  console.log(`\n[ext-mbids] matched ${matched}, artist-unresolved ${noArtist}, album-not-found ${noAlbum}`);
  if (DRY) { console.log('  dry run — nothing written.'); return; }

  let written = 0;
  for (const u of updates) {
    const { error, count } = await db.from('external_scores')
      .update({ mb_release_group_id: u.mbid }, { count: 'exact' })
      .eq('album_title', u.title).eq('artist', u.artist).is('mb_release_group_id', null);
    if (error) { console.warn(`  ! ${u.artist} — ${u.title}: ${error.message}`); continue; }
    written += count ?? 0;
  }
  console.log(`[ext-mbids] wrote mb_release_group_id to ${written} external_scores row(s) across ${updates.length} albums.`);
  console.log('Next: npm run seed:missing-from-external  →  npm run prestige:reconcile');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
