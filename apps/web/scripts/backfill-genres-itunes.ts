/**
 * Genre backfill via iTunes Search API — no Spotify, no rate limits.
 *
 * For every release with a missing or empty genres field, searches iTunes
 * by title + artist, takes the best match's primaryGenreName, maps it
 * through the internal genre taxonomy, and writes it back.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-genres-itunes.ts
 *   npx tsx --env-file=.env.local scripts/backfill-genres-itunes.ts --dry-run
 *
 * Resume: re-run the same command — processed IDs are saved to state file.
 * Throughput: ~2,000 releases/hour at 600ms/request with 429 retry backoff.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN    = process.argv.includes('--dry-run');
const DELAY_MS   = 600;
const BATCH_SIZE = 500;   // fetch from DB in pages
const MIN_SCORE  = 0.55;  // minimum title+artist similarity to accept a match

const STATE_PATH = path.resolve('scripts/backfill-genres-itunes-state.json');

// ── Genre map (iTunes primaryGenreName → internal tag) ────────────────────────

const GENRE_MAP: Record<string, string> = {
  'K-Pop':                'k-pop',
  'Korean Pop':           'k-pop',
  'Korean':               'k-pop',
  'J-Pop':                'j-pop',
  'Asian Pop':            'k-pop',
  'Mandopop':             'mandopop',
  'Cantopop/HK-Pop':     'cantopop',
  'Hip-Hop/Rap':          'hip-hop',
  'Hip Hop/Rap':          'hip-hop',
  'R&B/Soul':             'r&b',
  'Electronic':           'electronic',
  'Dance':                'electronic',
  'Indie Pop':            'indie',
  'Alternative':          'alternative',
  'Rock':                 'rock',
  'Pop':                  'pop',
  'Classical':            'classical',
  'Jazz':                 'jazz',
  'Soundtrack':           'soundtrack',
  'Ballad':               'ballad',
  'Singer/Songwriter':    'singer-songwriter',
  'Folk':                 'folk',
  'Country':              'country',
  'Blues':                'blues',
  'Reggae':               'reggae',
  'Latin':                'latin',
  'Afrobeat':             'afrobeat',
  'World':                'world',
  'Metal':                'metal',
  'Punk':                 'punk',
  'Funk':                 'funk',
  'Soul':                 'r&b',
  'Gospel':               'gospel',
  'New Age':              'ambient',
  'Ambient':              'ambient',
  'Lo-Fi':                'lo-fi',
};

function mapGenre(itunesGenre: string): string {
  return GENRE_MAP[itunesGenre] ?? itunesGenre.toLowerCase().replace(/\//g, '-');
}

// ── Normalization + matching ──────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`'"'""]/g, '')
    .replace(/[^\w\s가-힣ぁ-ゟ゠-ヿ一-鿿]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardWords(a: string, b: string): number {
  const wa = new Set(normalize(a).split(' ').filter(w => w.length > 1));
  const wb = new Set(normalize(b).split(' ').filter(w => w.length > 1));
  if (wa.size === 0 || wb.size === 0) return 0;
  const intersection = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return intersection / union;
}

function matchScore(
  qTitle: string, rTitle: string,
  qArtist: string, rArtist: string,
): number {
  const titleScore  = jaccardWords(qTitle, rTitle);
  const artistScore = jaccardWords(qArtist, rArtist);
  if (artistScore < 0.2) return 0;  // wrong artist → reject regardless of title
  return titleScore * 0.7 + artistScore * 0.3;
}

// ── iTunes API ────────────────────────────────────────────────────────────────

const ITUNES_BASE = 'https://itunes.apple.com';

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function itunesSearch(term: string, attempt = 0): Promise<any[] | null> {
  await sleep(DELAY_MS);
  const url = `${ITUNES_BASE}/search?term=${encodeURIComponent(term)}&entity=album&limit=5`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-genre-backfill/1.0' } });
    if (res.status === 429 || res.status === 403) {
      const wait = Math.min(120000, 10000 * 2 ** attempt);
      process.stdout.write(`\n  [${res.status}] waiting ${wait / 1000}s… `);
      await sleep(wait);
      if (attempt >= 5) return null;
      return itunesSearch(term, attempt + 1);
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data.results ?? [];
  } catch {
    return null;
  }
}

async function findGenre(title: string, artist: string): Promise<string | null> {
  const results = await itunesSearch(`${title} ${artist}`);
  if (!results || results.length === 0) return null;

  // Score each result; pick the best
  const scored = results
    .map(r => ({
      genre: r.primaryGenreName as string,
      score: matchScore(title, r.collectionName, artist, r.artistName),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (best.score < MIN_SCORE) return null;
  return mapGenre(best.genre);
}

// ── State ─────────────────────────────────────────────────────────────────────

interface State { processedIds: Set<string> }

function loadState(): State {
  if (fs.existsSync(STATE_PATH)) {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return { processedIds: new Set(raw.processedIds ?? []) };
  }
  return { processedIds: new Set() };
}

function saveState(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ processedIds: [...state.processedIds] }, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

async function main() {
  console.log(`\n  sillajuku iTunes genre backfill${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const db    = getDB();
  const state = loadState();

  // Fetch all releases missing genre in batches
  const missing: { id: string; title: string; artist: string }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('releases')
      .select('id, title, artist')
      .or('genres.is.null,genres.eq.')
      .range(from, from + BATCH_SIZE - 1);
    if (error) { console.error('DB fetch error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    missing.push(...data);
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  const todo = missing.filter(r => !state.processedIds.has(r.id));
  console.log(`  Missing genre : ${missing.length} releases`);
  console.log(`  Already done  : ${missing.length - todo.length}`);
  console.log(`  Remaining     : ${todo.length}`);
  console.log(`  Est. time     : ~${Math.ceil(todo.length * DELAY_MS / 60000)} minutes\n`);

  let found = 0, notFound = 0;

  for (let i = 0; i < todo.length; i++) {
    const { id, title, artist } = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${artist} — ${title} … `);

    const genre = await findGenre(title, artist);

    if (!genre) {
      process.stdout.write('no match\n');
      notFound++;
    } else {
      process.stdout.write(`${genre}\n`);
      if (!DRY_RUN) {
        const { error } = await db.from('releases').update({ genres: genre }).eq('id', id);
        if (error) {
          process.stdout.write(`  ! DB error: ${error.message}\n`);
        }
      }
      found++;
    }

    state.processedIds.add(id);
    if ((i + 1) % 50 === 0) saveState(state);
  }

  saveState(state);

  const pct = todo.length > 0 ? Math.round(found / todo.length * 100) : 0;
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Found genre    : ${found} releases (${pct}% match rate)
  No iTunes match: ${notFound} releases
  State saved    : ${STATE_PATH}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
