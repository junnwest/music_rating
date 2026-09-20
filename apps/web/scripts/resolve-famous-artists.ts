/**
 * One-time / periodic bootstrap: resolves FAMOUS_ARTISTS_SEED names to confirmed
 * MusicBrainz artist MBIDs and upserts them into ig_famous_artists.
 *
 * "Skip rather than guess" — same discipline as resolve-artist-wikipedia.ts. A name
 * only auto-resolves when exactly one MB candidate exact-matches it (name or alias,
 * case-insensitive); anything ambiguous (multiple same-named artists, or no exact
 * match at all) is reported and left for manual resolution rather than risking the
 * wrong artist's MBID silently feeding the whole detection pipeline downstream.
 *
 *   npx tsx --env-file=.env.local scripts/resolve-famous-artists.ts            # REPORT ONLY
 *   npx tsx --env-file=.env.local scripts/resolve-famous-artists.ts --write    # WRITES
 *
 * Re-runnable: already-resolved seed names (present in ig_famous_artists by name)
 * are skipped every run, so adding new names to the seed file and re-running only
 * processes the new ones.
 */
import { getDB } from './itunes-ingest-core';
import { searchArtists } from './mb-client';
import { FAMOUS_ARTISTS_SEED } from './famous-artists-seed';

function norm(s: string): string { return s.toLowerCase().trim(); }

async function main() {
  const WRITE = process.argv.includes('--write');
  const db = getDB();

  const { data: existing, error } = await db.from('ig_famous_artists').select('name');
  if (error) throw new Error(error.message);
  const already = new Set((existing ?? []).map((r: any) => norm(r.name)));

  const todo = FAMOUS_ARTISTS_SEED.filter((s) => !already.has(norm(s.name)));
  console.log(`${WRITE ? 'WRITING' : 'REPORT-ONLY'} — ${todo.length} unresolved of ${FAMOUS_ARTISTS_SEED.length} seed name(s)\n`);

  let resolved = 0, ambiguous = 0, notFound = 0;
  for (const seed of todo) {
    const candidates = await searchArtists(seed.name, 8);
    const exact = candidates.filter((c) => norm(c.name) === norm(seed.name) || c.aliases.some((a) => norm(a) === norm(seed.name)));

    if (exact.length === 0) {
      notFound++;
      console.log(`  NOT FOUND: "${seed.name}" — no exact MB match (${candidates.length} fuzzy candidates)`);
      continue;
    }
    if (exact.length > 1) {
      ambiguous++;
      console.log(`  AMBIGUOUS: "${seed.name}" — ${exact.length} exact matches, skipping:`);
      for (const c of exact) console.log(`    ${c.id}  ${c.name}  (${c.type ?? '?'}, ${c.country ?? c.area ?? '?'})  ${c.disambiguation ?? ''}`);
      continue;
    }

    const hit = exact[0];
    resolved++;
    console.log(`  resolved: "${seed.name}" → ${hit.id} (${hit.country ?? hit.area ?? seed.country ?? '?'})`);
    if (WRITE) {
      const { error: upErr } = await db.from('ig_famous_artists').upsert(
        { name: seed.name, mbid: hit.id, country: hit.country ?? seed.country ?? null },
        { onConflict: 'mbid' },
      );
      if (upErr) console.log(`    WRITE FAILED: ${upErr.message}`);
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`resolved ${resolved} · ambiguous ${ambiguous} (needs manual pick) · not found ${notFound}`);
  if (!WRITE && resolved) console.log(`Re-run with --write to upsert the resolved ones.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
