/**
 * Seed a SPECIFIC artist from Deezer — for artists that don't exist in MusicBrainz
 * (our primary source), which has incomplete coverage of very-niche / new underground
 * acts. The main pipeline can only ingest MB artists, so this is the on-demand escape
 * hatch (System Seoul, lov3rboi, …). Reuses the "clean by construction" Deezer ingest
 * from mb-deezer-fallback (only the target artist gets a row; ISRC kept for later MB
 * upgrade; exact-name / token-set match — no blind top-result).
 *
 *   npx tsx --env-file=.env.local scripts/seed-deezer-artist.ts --name "System Seoul"            # dry-run
 *   npx tsx --env-file=.env.local scripts/seed-deezer-artist.ts --name "System Seoul" --country KR --write
 */
import { getDB } from './itunes-ingest-core';
import { searchArtists } from './deezer-client';
import { pickArtist, ingestDeezerArtist } from './mb-deezer-fallback';

const arg = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined; };
const NAME = arg('--name');
const COUNTRY = arg('--country') ?? null;
const WRITE = process.argv.includes('--write');

async function main() {
  if (!NAME) { console.error('  usage: --name "Artist Name" [--country KR] [--write]'); process.exit(1); }
  const db = getDB();
  console.log(`\n  seed-deezer-artist ${WRITE ? '[WRITE]' : '[dry-run]'} — "${NAME}"${COUNTRY ? ` [${COUNTRY}]` : ''}\n`);

  const cands = await searchArtists(NAME, 8);
  const hit = pickArtist(cands, NAME);
  if (!hit) {
    console.log(`  ✗ no confident Deezer match for "${NAME}" (candidates: ${cands.map(c => `${c.name}(${c.nbFan})`).join(', ') || 'none'})`);
    console.log('    (requires an exact-name or same-token match — missing beats wrong.)\n');
    process.exit(1);
  }
  console.log(`  ✓ Deezer ${hit.id} "${hit.name}" — ${hit.nbFan} fans, ${hit.nbAlbum} albums`);

  if (!WRITE) { console.log('\n  [dry-run] no writes — re-run with --write to ingest.\n'); return; }
  const groups = await ingestDeezerArtist(db, hit, COUNTRY);
  if (groups < 0) {
    console.log(`\n  already in catalog under another source (MusicBrainz) — skipped to avoid a duplicate.\n`);
  } else {
    console.log(`\n  ingested ${groups} release group(s) from Deezer (source='deezer', ISRC kept for later MB upgrade).\n`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
