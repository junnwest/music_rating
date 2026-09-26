/**
 * Phase 0 (genre taxonomy rebuild) — pull the MusicBrainz genre vocabulary and
 * cross-reference it against our catalog vocab (GENRE_VOCAB_DUMP.tsv) so we know,
 * per catalog tag, whether it is a *canonical MB genre* (safe spine node / alias
 * anchor) or a *free-text folksonomy tag* we must hand-map. See GENRE_TAXONOMY.md §4.
 *
 * NOTE ON "tree": MB's `/genre/all` is a FLAT controlled vocabulary — the MB
 * genre hierarchy is not exposed via the API. So the DAG's parent edges are
 * hand-authored (RYM structure as reference); MB gives us canonical names +
 * which of our tags are official genres. This script reports that split.
 *
 * Run (from apps/web/):
 *   npx tsx scripts/dump-mb-genre-tree.ts             # fetch + cross-ref summary
 *   npx tsx scripts/dump-mb-genre-tree.ts --unmapped  # also list top catalog tags with NO MB genre
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { USER_AGENT } from './mb-client';

const REPO_ROOT = resolve(process.cwd(), '..', '..');
const VOCAB_TSV = resolve(REPO_ROOT, 'GENRE_VOCAB_DUMP.tsv');
const MB_CACHE = resolve(REPO_ROOT, 'MB_GENRES.txt'); // gitignored working data

const norm = (g: string) =>
  g.toLowerCase().replace(/-/g, ' ').replace(/&/g, ' and ').replace(/\s+/g, ' ').trim();

async function fetchMbGenres(): Promise<string[]> {
  const url = 'https://musicbrainz.org/ws/2/genre/all?fmt=txt';
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`MB genre fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const genres = text.split('\n').map((l) => l.trim()).filter(Boolean);
  writeFileSync(MB_CACHE, genres.join('\n') + '\n', 'utf8');
  return genres;
}

function readVocab(): Array<{ rank: number; tag: string; support: number }> {
  const lines = readFileSync(VOCAB_TSV, 'utf8').split('\n').filter(Boolean);
  return lines.slice(1).map((l) => {
    const [rank, tag, support] = l.split('\t');
    return { rank: Number(rank), tag, support: Number(support) };
  });
}

async function main() {
  console.log('\n🎵  MusicBrainz genre vocab × catalog vocab cross-reference\n');

  const mb = await fetchMbGenres();
  const mbNorm = new Set(mb.map(norm));
  console.log(`MB canonical genres:  ${mb.length}  (cached → MB_GENRES.txt)`);

  const vocab = readVocab();
  console.log(`Catalog tags:         ${vocab.length}\n`);

  const inMb = vocab.filter((v) => mbNorm.has(norm(v.tag)));
  const notInMb = vocab.filter((v) => !mbNorm.has(norm(v.tag)));
  const supTotal = vocab.reduce((s, v) => s + v.support, 0);
  const supInMb = inMb.reduce((s, v) => s + v.support, 0);

  const pct = (n: number, d: number) => (d === 0 ? '0%' : `${((n / d) * 100).toFixed(1)}%`);
  console.log(`Catalog tags that ARE MB genres:  ${inMb.length}  (${pct(inMb.length, vocab.length)} of tags, ${pct(supInMb, supTotal)} of support)`);
  console.log(`Catalog tags NOT in MB (hand-map): ${notInMb.length}  (${pct(notInMb.length, vocab.length)} of tags, ${pct(supTotal - supInMb, supTotal)} of support)\n`);

  // Focus: the head we hand-author (top 150). How many need hand-mapping?
  const head = vocab.slice(0, 150);
  const headNotInMb = head.filter((v) => !mbNorm.has(norm(v.tag)));
  console.log(`Of the top 150 tags, ${headNotInMb.length} are NOT MB genres and need hand-mapping/aliasing:`);
  for (const v of headNotInMb) {
    console.log(`  #${String(v.rank).padStart(3)}  ${v.tag.padEnd(28)} support ${v.support}`);
  }
  console.log('');

  if (process.argv.includes('--unmapped')) {
    console.log('Top 60 catalog tags with NO MB genre (full head+tail):');
    for (const v of notInMb.slice(0, 60)) {
      console.log(`  #${String(v.rank).padStart(4)}  ${v.tag.padEnd(28)} support ${v.support}`);
    }
    console.log('');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
