/**
 * Supplementary genre enrichment via Last.fm — runs on ALL releases, not just
 * genre-less ones. Merges up to MAX_TAGS Last.fm tags into the existing genres
 * field, deduplicating. Leaves albums unchanged if Last.fm adds nothing new.
 *
 * Run AFTER backfill-genres-itunes.ts so iTunes tags are already the primary.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/enrich-genres-lastfm.ts
 *   npx tsx --env-file=.env.local scripts/enrich-genres-lastfm.ts --dry-run
 *
 * Resume: re-run — processed IDs are saved to state file.
 * Requires: LASTFM_API_KEY in .env.local
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN    = process.argv.includes('--dry-run');
const DELAY_MS   = 250;    // Last.fm free tier: ~5 req/s
const BATCH_SIZE = 500;
const MIN_COUNT  = 5;      // ignore tags with fewer than this many votes
const MAX_TAGS   = 3;      // max supplementary tags to add per album

const STATE_PATH = path.resolve('scripts/enrich-genres-lastfm-state.json');

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
  'j-rock':               'j-rock',
  'jrock':                'j-rock',
  'mandopop':             'mandopop',
  'cantopop':             'cantopop',
  'hip-hop':              'hip-hop',
  'hip hop':              'hip-hop',
  'rap':                  'hip-hop',
  'korean hip-hop':       'Korean hip-hop',
  'korean hip hop':       'Korean hip-hop',
  'korean rap':           'Korean hip-hop',
  'trap':                 'hip-hop',
  'r&b':                  'r&b',
  'rnb':                  'r&b',
  'rhythm and blues':     'r&b',
  'neo-soul':             'neo-soul',
  'soul':                 'soul',
  'funk':                 'funk',
  'electronic':           'electronic',
  'electronica':          'electronic',
  'edm':                  'electronic',
  'dance':                'electronic',
  'synth-pop':            'synthpop',
  'synthpop':             'synthpop',
  'synth pop':            'synthpop',
  'dream pop':            'dream pop',
  'shoegaze':             'shoegaze',
  'indie':                'indie',
  'indie pop':            'indie pop',
  'indie rock':           'indie rock',
  'korean indie':         'k-indie',
  'k-indie':              'k-indie',
  'alternative':          'alternative rock',
  'alternative rock':     'alternative rock',
  'alt':                  'alternative rock',
  'post-punk':            'post-punk',
  'post punk':            'post-punk',
  'punk rock':            'punk rock',
  'punk':                 'punk rock',
  'rock':                 'rock',
  'classic rock':         'rock',
  'hard rock':            'rock',
  'psychedelic rock':     'psychedelic rock',
  'psychedelic':          'psychedelic rock',
  'folk rock':            'folk rock',
  'pop':                  'pop',
  'art pop':              'art pop',
  'pop rock':             'pop rock',
  'ballad':               'ballad',
  'pop ballad':           'ballad',
  'classical':            'classical',
  'jazz':                 'jazz',
  'jazz rap':             'jazz rap',
  'bebop':                'jazz',
  'bossa nova':           'bossa nova',
  'blues':                'blues',
  'soundtrack':           'soundtrack',
  'ost':                  'soundtrack',
  'singer-songwriter':    'singer-songwriter',
  'singer songwriter':    'singer-songwriter',
  'folk':                 'folk',
  'acoustic':             'folk',
  'country':              'country',
  'reggae':               'reggae',
  'latin':                'latin',
  'afrobeat':             'afrobeat',
  'world':                'world',
  'metal':                'metal',
  'heavy metal':          'heavy metal',
  'gospel':               'gospel',
  'ambient':              'ambient',
  'new age':              'ambient',
  'lo-fi':                'lo-fi',
  'lofi':                 'lo-fi',
  'lo fi':                'lo-fi',
  'experimental':         'experimental',
  'noise':                'experimental',
  'avant-garde':          'experimental',
  'dub':                  'dub',
  'reggaeton':            'reggaeton',
};

function mapTag(tag: string): string | null {
  const lower = tag.toLowerCase().trim();
  if (GENRE_MAP[lower]) return GENRE_MAP[lower];
  for (const [key, val] of Object.entries(GENRE_MAP)) {
    if (lower.startsWith(key)) return val;
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function parseGenres(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(g => g.trim().toLowerCase()).filter(Boolean);
}

function mergeGenres(existing: string[], additions: string[]): string[] {
  const existingLower = new Set(existing.map(g => g.toLowerCase()));
  const merged = [...existing];
  for (const tag of additions) {
    if (!existingLower.has(tag.toLowerCase())) {
      merged.push(tag);
      existingLower.add(tag.toLowerCase());
    }
  }
  return merged;
}

// ── Last.fm API ───────────────────────────────────────────────────────────────

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
      headers: { 'User-Agent': 'sillajuku-genre-enrichment/1.0' },
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
    if (data.error) return null;

    const tags = data.toptags?.tag;
    if (!tags) return null;
    return Array.isArray(tags) ? tags : [tags];
  } catch {
    return null;
  }
}

async function getSupplementaryGenres(title: string, artist: string): Promise<string[]> {
  const tags = await lastfmGetTags(artist, title);
  if (!tags || tags.length === 0) return [];

  const mapped: string[] = [];
  for (const tag of tags) {
    if (tag.count < MIN_COUNT) continue;
    const genre = mapTag(tag.name);
    if (genre && !mapped.includes(genre)) mapped.push(genre);
    if (mapped.length >= MAX_TAGS) break;
  }
  return mapped;
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

// ── DB ────────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  sillajuku Last.fm genre enrichment (supplementary)${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`  Runs on ALL releases — merges up to ${MAX_TAGS} Last.fm tags into existing genres.\n`);

  const db    = getDB();
  const state = loadState();

  // Fetch ALL releases (not just missing genres)
  const all: { id: string; title: string; artist: string; genres: string | null }[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('releases')
      .select('id, title, artist, genres')
      .range(from, from + BATCH_SIZE - 1);
    if (error) { console.error('DB fetch error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  const todo = all.filter(r => !state.processedIds.has(r.id));
  const estMin = Math.ceil(todo.length * DELAY_MS / 60000);

  console.log(`  Total releases : ${all.length}`);
  console.log(`  Already done   : ${all.length - todo.length}`);
  console.log(`  Remaining      : ${todo.length}`);
  console.log(`  Est. time      : ~${estMin} minutes\n`);

  let enriched = 0, unchanged = 0, noMatch = 0;

  for (let i = 0; i < todo.length; i++) {
    const { id, title, artist, genres } = todo[i];
    const existing = parseGenres(genres);

    process.stdout.write(`  [${i + 1}/${todo.length}] ${artist.slice(0, 28).padEnd(28)} — ${title.slice(0, 32).padEnd(32)} `);

    const additions = await getSupplementaryGenres(title, artist);

    if (additions.length === 0) {
      process.stdout.write(`no tags\n`);
      noMatch++;
    } else {
      const merged = mergeGenres(existing, additions);
      const newTags = merged.filter(g => !existing.map(e => e.toLowerCase()).includes(g.toLowerCase()));

      if (newTags.length === 0) {
        process.stdout.write(`already covered (${existing.join(', ')})\n`);
        unchanged++;
      } else {
        const mergedStr = merged.join(',');
        process.stdout.write(`+[${newTags.join(', ')}] → ${mergedStr}\n`);
        if (!DRY_RUN) {
          const { error } = await db.from('releases').update({ genres: mergedStr }).eq('id', id);
          if (error) process.stdout.write(`  ! DB error: ${error.message}\n`);
        }
        enriched++;
      }
    }

    state.processedIds.add(id);
    if ((i + 1) % 50 === 0) saveState(state);
  }

  saveState(state);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Enriched (new tags added) : ${enriched}
  Already fully covered     : ${unchanged}
  No Last.fm match          : ${noMatch}
  State saved               : ${STATE_PATH}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
