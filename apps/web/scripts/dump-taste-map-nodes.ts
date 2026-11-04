/**
 * Read-only: Taste map Phase 0 coverage spike (TASTE_MAP_PLAN.md). Loads a user's
 * MapUserInput through lib/tasteMap/load.ts and prints what the map would be
 * built from: rated albums, artists, catalog albums, feature coverage (genres /
 * jina embedding / genre_evidence / similar artists) and the largest catalogs.
 *
 *   npx tsx --env-file=.env.local scripts/dump-taste-map-nodes.ts --user=<username> [--out=<path.json>] [--no-embeddings] [--top=15]
 */
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadMapUserInput, type LoadStats } from '../lib/tasteMap/load';
import type { MapAlbumInput } from '../lib/tasteMap/types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const USER = arg('user');
const OUT = arg('out');
const TOP = Number(arg('top') ?? 15);
const NO_EMBED = process.argv.includes('--no-embeddings');
if (!USER) {
  console.error('--user=<username> is required');
  process.exit(1);
}

const pct = (n: number, d: number) => (d === 0 ? '  n/a' : `${((100 * n) / d).toFixed(1).padStart(5)}%`);
const hasEvidence = (ev: unknown) => !!ev && typeof ev === 'object' && Object.keys(ev as object).length > 0;

async function main() {
  const { data: prof, error } = await db.from('profiles').select('id, username').eq('username', USER).maybeSingle();
  if (error) throw error;
  if (!prof) {
    console.error(`no profile with username ${USER}`);
    process.exit(1);
  }

  let stats: LoadStats | null = null;
  const input = await loadMapUserInput(db, prof.id, { embeddings: !NO_EMBED, onStats: (s) => (stats = s) });
  const s = stats as unknown as LoadStats;

  const all: MapAlbumInput[] = input.artists.flatMap((a) => a.albums);
  const rated = all.filter((a) => a.rated);
  const scored = rated.filter((a) => a.score != null);
  const cov = (xs: MapAlbumInput[]) => ({
    genres: xs.filter((a) => a.genres.length > 0).length,
    embed: xs.filter((a) => a.embedding != null).length,
    year: xs.filter((a) => a.year != null).length,
    both: xs.filter((a) => a.genres.length > 0 && a.embedding != null).length,
    neither: xs.filter((a) => a.genres.length === 0 && a.embedding == null).length,
  });
  const cAll = cov(all);
  const cRated = cov(rated);
  const dims = new Set(all.filter((a) => a.embedding).map((a) => a.embedding!.length));

  const nArtists = input.artists.length;
  const withEv = input.artists.filter((a) => hasEvidence(a.genreEvidence)).length;
  const withSim = input.artists.filter((a) => a.similar.some((x) => x.items.length > 0)).length;
  const bySource = (src: string) => input.artists.filter((a) => a.similar.some((x) => x.source === src && x.items.length > 0)).length;
  // An artist with no album genres, no embedding on any album, and no evidence has nothing but the era block.
  const featureless = input.artists.filter(
    (a) => !hasEvidence(a.genreEvidence) && a.albums.every((x) => x.genres.length === 0 && x.embedding == null),
  );

  console.log(`\n════ ${input.username} (${input.userId}) — loaded in ${(s.ms / 1000).toFixed(1)}s ════`);
  console.log(`ratings rows           ${s.ratings}`);
  console.log(`rated albums           ${rated.length} (${scored.length} scored, ${s.ratedWithoutArtist} skipped: no primary artist)`);
  console.log(`artists                ${nArtists}${s.skippedArtists.length ? ` (catalog not expanded for ${s.skippedArtists.length}: Various Artists)` : ''}`);
  console.log(`catalog albums         ${all.length} (${(all.length / Math.max(1, nArtists)).toFixed(1)} per artist; non-single, bootlegs dropped)`);
  if (s.truncatedChunks) console.log(`  ⚠ ${s.truncatedChunks} artist chunk(s) hit the page cap — some catalog albums missing`);
  console.log(`\nAlbum coverage              all albums        rated albums`);
  console.log(`  with genres            ${String(cAll.genres).padStart(6)} ${pct(cAll.genres, all.length)}    ${String(cRated.genres).padStart(5)} ${pct(cRated.genres, rated.length)}`);
  console.log(`  with jina embedding    ${String(cAll.embed).padStart(6)} ${pct(cAll.embed, all.length)}    ${String(cRated.embed).padStart(5)} ${pct(cRated.embed, rated.length)}${NO_EMBED ? '  (--no-embeddings)' : ''}`);
  console.log(`  genres AND embedding   ${String(cAll.both).padStart(6)} ${pct(cAll.both, all.length)}    ${String(cRated.both).padStart(5)} ${pct(cRated.both, rated.length)}`);
  console.log(`  neither                ${String(cAll.neither).padStart(6)} ${pct(cAll.neither, all.length)}    ${String(cRated.neither).padStart(5)} ${pct(cRated.neither, rated.length)}`);
  console.log(`  with year              ${String(cAll.year).padStart(6)} ${pct(cAll.year, all.length)}    ${String(cRated.year).padStart(5)} ${pct(cRated.year, rated.length)}`);
  if (dims.size) console.log(`  embedding dims         ${[...dims].join(', ')}`);
  console.log(`\nArtist coverage`);
  console.log(`  with genre_evidence    ${String(withEv).padStart(6)} ${pct(withEv, nArtists)}`);
  console.log(
    `  with similar artists   ${String(withSim).padStart(6)} ${pct(withSim, nArtists)}${s.similarTableMissing ? '  (artist_similar table not applied yet)' : `  lastfm ${bySource('lastfm')}, listenbrainz ${bySource('listenbrainz')}`}`,
  );
  console.log(`  no tag/text data       ${String(featureless.length).padStart(6)} ${pct(featureless.length, nArtists)}${featureless.length ? `  e.g. ${featureless.slice(0, 8).map((a) => a.name).join(', ')}` : ''}`);

  const ratedPer = input.artists.map((a) => a.albums.filter((x) => x.rated).length);
  const hist = new Map<number, number>();
  for (const n of ratedPer) hist.set(Math.min(n, 5), (hist.get(Math.min(n, 5)) ?? 0) + 1);
  console.log(`\nRated albums per artist: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k === 5 ? '5+' : k}:${v}`).join('  ')}`);

  console.log(`\nLargest catalogs (top ${TOP}):`);
  for (const a of [...input.artists].sort((x, y) => y.albums.length - x.albums.length).slice(0, TOP)) {
    const r = a.albums.filter((x) => x.rated).length;
    const years = a.albums.map((x) => x.year).filter((y): y is number => y != null);
    const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : '—';
    const c = cov(a.albums);
    console.log(
      `  ${a.name.slice(0, 30).padEnd(30)} ${String(a.albums.length).padStart(4)} albums, ${String(r).padStart(2)} rated, ${span.padEnd(9)} genres ${pct(c.genres, a.albums.length)} embed ${pct(c.embed, a.albums.length)}`,
    );
  }

  if (OUT) {
    const json = JSON.stringify(input);
    writeFileSync(OUT, json);
    console.log(`\nwrote ${OUT} (${(json.length / 1e6).toFixed(1)} MB)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
