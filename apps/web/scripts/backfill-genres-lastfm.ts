/**
 * Genre backfill via Last.fm — secondary fallback after iTunes pass.
 *
 * For every release still missing genre data, calls Last.fm album.gettoptags,
 * picks the top tag by count, maps it through the internal genre taxonomy,
 * and writes it back.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backfill-genres-lastfm.ts
 *   npx tsx --env-file=.env.local scripts/backfill-genres-lastfm.ts --dry-run
 *
 * Resume: re-run the same command — processed IDs are saved to state file.
 * Requires: LASTFM_API_KEY in environment.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN    = process.argv.includes('--dry-run');
const DELAY_MS   = 250;   // Last.fm allows ~5 req/s on free tier
const BATCH_SIZE = 500;
const MIN_COUNT  = 5;     // ignore tags with fewer than this many votes

const STATE_PATH = path.resolve('scripts/backfill-genres-lastfm-state.json');

const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_KEY) {
  console.error('LASTFM_API_KEY is not set. Add it to .env.local.');
  process.exit(1);
}

// ── Genre map (Last.fm tag → internal tag) ────────────────────────────────────

const GENRE_MAP: Record<string, string> = {
  'k-pop':                'k-pop',
  'korean pop':           'k-pop',
  'korean':               'k-pop',
  'kpop':                 'k-pop',
  'j-pop':                'j-pop',
  'jpop':                 'j-pop',
  'mandopop':             'mandopop',
  'cantopop':             'cantopop',
  'hip-hop':              'hip-hop',
  'hip hop':              'hip-hop',
  'rap':                  'hip-hop',
  'korean hip-hop':       'hip-hop',
  'korean hip hop':       'hip-hop',
  'korean rap':           'hip-hop',
  'trap':                 'hip-hop',
  'r&b':                  'r&b',
  'rnb':                  'r&b',
  'soul':                 'r&b',
  'electronic':           'electronic',
  'electronica':          'electronic',
  'edm':                  'electronic',
  'dance':                'electronic',
  'indie':                'indie',
  'indie pop':            'indie',
  'indie rock':           'indie',
  'korean indie':         'indie',
  'alternative':          'alternative',
  'alt':                  'alternative',
  'rock':                 'rock',
  'pop':                  'pop',
  'pop ballad':           'ballad',
  'ballad':               'ballad',
  'classical':            'classical',
  'jazz':                 'jazz',
  'soundtrack':           'soundtrack',
  'ost':                  'soundtrack',
  'singer-songwriter':    'singer-songwriter',
  'singer songwriter':    'singer-songwriter',
  'folk':                 'folk',
  'country':              'country',
  'blues':                'blues',
  'reggae':               'reggae',
  'latin':                'latin',
  'afrobeat':             'afrobeat',
  'world':                'world',
  'metal':                'metal',
  'punk':                 'punk',
  'funk':                 'funk',
  'gospel':               'gospel',
  'ambient':              'ambient',
  'new age':              'ambient',
  'lo-fi':                'lo-fi',
  'lofi':                 'lo-fi',
  'lo fi':                'lo-fi',
};

function mapTag(tag: string): string | null {
  const lower = tag.toLowerCase().trim();
  if (GENRE_MAP[lower]) return GENRE_MAP[lower];
  // Partial prefix matches for common compound tags
  for (const [key, val] of Object.entries(GENRE_MAP)) {
    if (lower.startsWith(key) || lower.includes(key)) return val;
  }
  return null;
}

// ── Last.fm API ───────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function lastfmGetTags(
  artist: string,
  album: string,
  attempt = 0,
): Promise<{ name: string; count: number }[] | null> {
  await sleep(DELAY_MS);
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'album.gettoptags');
  url.searchParams.set('artist', artist);
  url.searchParams.set('album', album);
  url.searchParams.set('api_key', LASTFM_KEY!);
  url.searchParams.set('format', 'json');
  url.searchParams.set('autocorrect', '1');

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'sillajuku-genre-backfill/1.0' },
    });

    if (res.status === 429) {
      const wait = Math.min(60000, 5000 * 2 ** attempt);
      process.stdout.write(`\n  [429] waiting ${wait / 1000}s… `);
      await sleep(wait);
      if (attempt >= 5) return null;
      return lastfmGetTags(artist, album, attempt + 1);
    }

    if (!res.ok) return null;

    const data = await res.json();
    if (data.error) return null;  // e.g. error 6 = album not found

    const tags = data.toptags?.tag;
    if (!tags) return null;
    return Array.isArray(tags) ? tags : [tags];
  } catch {
    return null;
  }
}

async function findGenre(title: string, artist: string): Promise<string | null> {
  const tags = await lastfmGetTags(artist, title);
  if (!tags || tags.length === 0) return null;

  // Walk tags in order (sorted by count desc by Last.fm), pick first mappable one
  for (const tag of tags) {
    if (tag.count < MIN_COUNT) continue;
    const mapped = mapTag(tag.name);
    if (mapped) return mapped;
  }
  return null;
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
  fs.writeFileSync(
    STATE_PATH,
    JSON.stringify({ processedIds: [...state.processedIds] }, null, 2),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

async function main() {
  console.log(`\n  sillajuku Last.fm genre backfill${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const db    = getDB();
  const state = loadState();

  // Fetch all releases still missing genre in batches
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
  No Last.fm match: ${notFound} releases
  State saved    : ${STATE_PATH}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
