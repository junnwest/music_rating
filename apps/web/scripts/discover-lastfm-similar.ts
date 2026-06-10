/**
 * Last.fm similar artist discovery — fans out from DB artists to find new ones.
 *
 * For every artist in the DB, calls Last.fm artist.getSimilar and adds any
 * undiscovered similar artists to artist_ingestion_queue (status = 'pending').
 * This is the replacement for the broken Spotify expand:related.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/discover-lastfm-similar.ts
 *   npx tsx --env-file=.env.local scripts/discover-lastfm-similar.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/discover-lastfm-similar.ts --limit=100
 *
 * Resumable via state file — already-processed artists are skipped.
 * Requires: LASTFM_API_KEY in .env.local
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN   = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const ARTIST_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : 9999;
const DELAY_MS  = 250;   // Last.fm free tier: ~5 req/s
const MAX_SIMILAR = 20;  // how many similar artists to add per DB artist

const STATE_PATH = path.resolve('scripts/discover-lastfm-similar-state.json');

const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_KEY) {
  console.error('LASTFM_API_KEY is not set. Add it to .env.local.');
  process.exit(1);
}

// Legitimate acts whose name contains & but are real single entities, not collabs.
const LEGIT_COMPOUND_ACTS = new Set([
  // Classic rock / pop / soul bands
  'hall & oates', 'simon & garfunkel', 'sly & the family stone',
  'earth, wind & fire', 'crosby, stills, nash & young', 'crosby, stills & nash',
  'toots & the maytals', 'all natural lemon & lime flavors',
  // Hip-hop duos
  'eric b. & rakim', 'pete rock & c.l. smooth',
  // Electronic groups
  'above & beyond', 'pig&dan',
  // K-pop groups / sub-units with & in official name
  'ampers&one', '15&', 'gd & top', 'h&d',
  'irene & seulgi', 'red velvet – irene & seulgi', 'red velvet - irene & seulgi',
  'moonbin & sanha', 'super junior-d&e', 'jinjin & rocky',
  'longguo & shihyun', 'soohyun & hoon',
  // Korean bands with & in name
  'kiha & the faces', 'shin jung hyun & yup juns',
  // Folk duos
  'richard & linda thompson',
]);

// Returns true for collaboration entries like "Coldplay & BTS", "Drake feat. 21 Savage".
// These are Last.fm collaboration nodes, not real standalone artist entities.
// Comma is intentionally NOT used as a separator — too many false positives
// (Tyler, The Creator / Black Country, New Road / Car, The Garden).
function isCollaborationArtist(name: string): boolean {
  if (LEGIT_COMPOUND_ACTS.has(name.toLowerCase())) return false;
  // feat. / ft. / featuring → always a feature credit
  if (/\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i.test(name)) return true;
  // Any & → collab unless whitelisted above
  if (/&/.test(name)) return true;
  // " + " separator → collab (rare in band names, common in collab credits)
  if (/\s\+\s/.test(name)) return true;
  return false;
}

// ── Last.fm API ───────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function getSimilarArtists(
  artistName: string,
  attempt = 0,
): Promise<{ name: string; mbid: string; match: string }[] | null> {
  await sleep(DELAY_MS);
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'artist.getSimilar');
  url.searchParams.set('artist', artistName);
  url.searchParams.set('limit', String(MAX_SIMILAR));
  url.searchParams.set('autocorrect', '1');
  url.searchParams.set('api_key', LASTFM_KEY!);
  url.searchParams.set('format', 'json');

  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'sillajuku-discovery/1.0' },
    });

    if (res.status === 429) {
      const wait = Math.min(60000, 5000 * 2 ** attempt);
      process.stdout.write(`\n  [429] waiting ${wait / 1000}s… `);
      await sleep(wait);
      if (attempt >= 5) return null;
      return getSimilarArtists(artistName, attempt + 1);
    }

    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;

    const artists = data.similarartists?.artist;
    if (!artists) return [];
    return Array.isArray(artists) ? artists : [artists];
  } catch {
    return null;
  }
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
  console.log(`\n  sillajuku Last.fm similar artist discovery${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const db    = getDB();
  const state = loadState();

  // Fetch all artists from DB
  const { data: artists, error } = await db
    .from('artists')
    .select('id, name')
    .order('name');

  if (error) { console.error('DB fetch error:', error.message); process.exit(1); }
  if (!artists || artists.length === 0) {
    console.log('  No artists in DB yet.');
    return;
  }

  const todo = artists
    .filter(a => !state.processedIds.has(a.id))
    .slice(0, ARTIST_LIMIT);

  console.log(`  DB artists    : ${artists.length}`);
  console.log(`  Already done  : ${artists.length - todo.length}`);
  console.log(`  To process    : ${todo.length}\n`);

  let totalQueued = 0, totalAlreadyKnown = 0, noMatch = 0;

  for (let i = 0; i < todo.length; i++) {
    const artist = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${artist.name.padEnd(35)} → `);

    const similar = await getSimilarArtists(artist.name);

    if (!similar || similar.length === 0) {
      process.stdout.write('no results\n');
      noMatch++;
    } else {
      let queued = 0;
      const toInsert = similar
        .slice(0, MAX_SIMILAR)
        .filter(s => !isCollaborationArtist(s.name))
        .map(s => ({
          name:      s.name,
          source:    'lastfm_similar',
          source_id: s.mbid || null,
          status:    'pending',
        }));

      if (!DRY_RUN) {
        const { error: upsertErr } = await db
          .from('artist_ingestion_queue')
          .upsert(toInsert, { onConflict: 'name,source', ignoreDuplicates: true });

        if (upsertErr) {
          process.stdout.write(`DB error: ${upsertErr.message}\n`);
        } else {
          queued = toInsert.length;
        }
      } else {
        queued = toInsert.length;
      }

      process.stdout.write(`+${queued} queued (of ${similar.length} similar)\n`);
      totalQueued += queued;
    }

    state.processedIds.add(artist.id);
    if ((i + 1) % 25 === 0) saveState(state);
  }

  saveState(state);

  const { count } = await db
    .from('artist_ingestion_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Similar artists queued : ${totalQueued}
  No Last.fm match       : ${noMatch}
  Total queue pending    : ${count ?? '?'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Next: npm run queue:ingest
`);
}

main().catch(err => { console.error(err); process.exit(1); });
