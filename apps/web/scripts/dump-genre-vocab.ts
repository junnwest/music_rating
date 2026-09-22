/**
 * Phase 0 (genre taxonomy rebuild) — dump the catalog's genre-tag vocabulary
 * with per-tag support, sorted by support desc, so the taxonomy in
 * apps/web/lib/genres/taxonomy.ts can be authored against real data instead of
 * guesses. See GENRE_TAXONOMY.md §4 Phase 0.
 *
 * Source of truth for vocab + support is the bundled embedding artifact
 * (genreVocab() / genreSupport() over lib/taste/genre-embeddings.json): its
 * `support` is per-album co-occurrence count from the same build that powers
 * similarity, i.e. exactly the "how much real support does this tag have"
 * signal we want to prune the MusicBrainz spine against. No DB call needed.
 *
 * Run (from apps/web/):
 *   npx tsx scripts/dump-genre-vocab.ts            # ranked table + summary to stdout
 *   npx tsx scripts/dump-genre-vocab.ts --top=150  # limit the printed table
 *   npx tsx scripts/dump-genre-vocab.ts --write     # also write ../../GENRE_VOCAB_DUMP.tsv (full vocab)
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { genreSupport, genreVocab } from '../lib/taste/embeddings';

function argVal(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function main() {
  const rows = genreVocab()
    .map((tag) => ({ tag, support: genreSupport(tag) }))
    .sort((a, b) => b.support - a.support || a.tag.localeCompare(b.tag));

  const total = rows.reduce((s, r) => s + r.support, 0);
  const nonZero = rows.filter((r) => r.support > 0).length;

  console.log('\n🎵  Catalog genre-tag vocabulary (embedding-artifact support)\n');
  console.log(`Distinct tags:        ${rows.length}`);
  console.log(`Tags with support>0:  ${nonZero}`);
  console.log(`Total support units:  ${total}\n`);

  // How many tags cover 50/80/90/95% of all support — sizes the "author the
  // head, fold the long tail" boundary the Phase 0 checklist calls for (~150).
  const marks = [0.5, 0.8, 0.9, 0.95, 0.99];
  let cum = 0;
  const covered = new Map<number, number>();
  rows.forEach((r, i) => {
    cum += r.support;
    for (const m of marks) {
      if (!covered.has(m) && cum / total >= m) covered.set(m, i + 1);
    }
  });
  console.log('Head size needed to cover N% of support:');
  for (const m of marks) {
    console.log(`  ${(m * 100).toString().padStart(3)}%  →  top ${String(covered.get(m) ?? rows.length).padStart(4)} tags`);
  }
  console.log('');

  const top = Number(argVal('top') ?? 200);
  console.log(`Top ${Math.min(top, rows.length)} tags by support (rank  tag  support  cum%):`);
  let running = 0;
  rows.slice(0, top).forEach((r, i) => {
    running += r.support;
    const cumPct = total === 0 ? '  0.0%' : `${((running / total) * 100).toFixed(1).padStart(5)}%`;
    console.log(
      `  ${String(i + 1).padStart(4)}  ${r.tag.padEnd(32)} ${String(r.support).padStart(7)}  ${cumPct}`,
    );
  });
  console.log('');

  if (hasFlag('write')) {
    // Repo root is two levels up from apps/web/scripts.
    const out = resolve(process.cwd(), '..', '..', 'GENRE_VOCAB_DUMP.tsv');
    const tsv = ['rank\ttag\tsupport', ...rows.map((r, i) => `${i + 1}\t${r.tag}\t${r.support}`)].join('\n') + '\n';
    writeFileSync(out, tsv, 'utf8');
    console.log(`Wrote full vocab (${rows.length} rows) → ${out}\n`);
  }
}

main();
