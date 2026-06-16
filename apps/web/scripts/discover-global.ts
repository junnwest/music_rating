/**
 * Controlled Last.fm similar-artist discovery — GLOBAL, scoped.
 *
 * The original discover-lastfm-similar.ts fans out from EVERY artist in the DB.
 * That uncontrolled snowball is what over-grew Western electronic/hip-hop (now
 * ~25% of the catalog) while starving Japan/China/SE Asia. This variant only
 * fans out from artists that were seeded by build-global-queue (source matches
 * `wikipedia_<region>`), so Last.fm's similarity graph keeps us *inside* each
 * target culture (Thai → Thai, Mandopop → Mandopop) instead of drifting West.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/discover-global.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/discover-global.ts
 *   npx tsx --env-file=.env.local scripts/discover-global.ts --region=japan
 *   npx tsx --env-file=.env.local scripts/discover-global.ts --limit=200
 *
 * Resumable via state file. Requires LASTFM_API_KEY.
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const DRY_RUN   = process.argv.includes('--dry-run');
const REGION_ARG = process.argv.find(a => a.startsWith('--region='))?.split('=')[1] ?? null;
const LIMIT_ARG = process.argv.find(a => a.startsWith('--limit='));
const ARTIST_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1]) : 99999;
const DELAY_MS  = 250;
const MAX_SIMILAR = 10;  // tighter than the global discover (20) — keep growth controlled

const STATE_PATH = path.resolve('scripts/discover-global-state.json');

const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_KEY) { console.error('LASTFM_API_KEY not set. Add to .env.local.'); process.exit(1); }

const LEGIT_COMPOUND_ACTS = new Set([
  'hall & oates', 'simon & garfunkel', 'sly & the family stone',
  'earth, wind & fire', 'crosby, stills, nash & young', 'crosby, stills & nash',
  'toots & the maytals', 'eric b. & rakim', 'pete rock & c.l. smooth',
  'above & beyond', 'pig&dan', 'ampers&one', '15&', 'gd & top', 'h&d',
  'irene & seulgi', 'moonbin & sanha', 'super junior-d&e', 'jinjin & rocky',
  'kiha & the faces', 'richard & linda thompson',
]);

function isCollaborationArtist(name: string): boolean {
  if (LEGIT_COMPOUND_ACTS.has(name.toLowerCase())) return false;
  if (/\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i.test(name)) return true;
  if (/&/.test(name)) return true;
  if (/\s\+\s/.test(name)) return true;
  return false;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function getSimilarArtists(artistName: string, attempt = 0): Promise<{ name: string; mbid: string }[] | null> {
  await sleep(DELAY_MS);
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'artist.getSimilar');
  url.searchParams.set('artist', artistName);
  url.searchParams.set('limit', String(MAX_SIMILAR));
  url.searchParams.set('autocorrect', '1');
  url.searchParams.set('api_key', LASTFM_KEY!);
  url.searchParams.set('format', 'json');
  try {
    const res = await fetch(url.toString(), { headers: { 'User-Agent': 'sillajuku-discovery/1.0' } });
    if (res.status === 429) {
      const wait = Math.min(60000, 5000 * 2 ** attempt);
      process.stdout.write(`\n  [429] waiting ${wait / 1000}s… `);
      await sleep(wait);
      return attempt >= 5 ? null : getSimilarArtists(artistName, attempt + 1);
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    const artists = data.similarartists?.artist;
    if (!artists) return [];
    return Array.isArray(artists) ? artists : [artists];
  } catch { return null; }
}

interface State { processedNames: Set<string> }
function loadState(): State {
  if (fs.existsSync(STATE_PATH)) {
    const raw = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return { processedNames: new Set(raw.processedNames ?? []) };
  }
  return { processedNames: new Set() };
}
function saveState(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify({ processedNames: [...state.processedNames] }, null, 2));
}

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

// Pull every queue row whose source is a global-seed source, paginated.
async function fetchGlobalSeedNames(db: ReturnType<typeof getDB>): Promise<string[]> {
  const names = new Set<string>();
  let from = 0;
  const sourceFilter = REGION_ARG ? `wikipedia_${REGION_ARG}` : 'wikipedia_';
  while (true) {
    let q = db.from('artist_ingestion_queue').select('name, source');
    q = REGION_ARG ? q.eq('source', sourceFilter) : q.like('source', 'wikipedia_%');
    const { data, error } = await q.range(from, from + 999);
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    // exclude the Korea-only builder's plain 'wikipedia' source
    for (const r of data) if (r.source !== 'wikipedia') names.add(r.name);
    if (data.length < 1000) break;
    from += 1000;
  }
  return [...names];
}

async function main() {
  console.log(`\n  sillajuku GLOBAL similar-artist discovery${DRY_RUN ? ' [DRY RUN]' : ''}` +
    `${REGION_ARG ? ` [region=${REGION_ARG}]` : ''}\n`);

  const db    = getDB();
  const state = loadState();

  const seedNames = await fetchGlobalSeedNames(db);
  const todo = seedNames
    .filter(n => !state.processedNames.has(n.toLowerCase()))
    .slice(0, ARTIST_LIMIT);

  console.log(`  Global-seed artists : ${seedNames.length}`);
  console.log(`  Already processed   : ${seedNames.length - todo.length}`);
  console.log(`  To process          : ${todo.length}\n`);

  let totalQueued = 0, noMatch = 0;

  for (let i = 0; i < todo.length; i++) {
    const name = todo[i];
    process.stdout.write(`  [${i + 1}/${todo.length}] ${name.slice(0, 32).padEnd(32)} → `);

    const similar = await getSimilarArtists(name);
    if (!similar || similar.length === 0) {
      process.stdout.write('no results\n');
      noMatch++;
    } else {
      const toInsert = similar
        .slice(0, MAX_SIMILAR)
        .filter(s => !isCollaborationArtist(s.name))
        .map(s => ({ name: s.name, source: 'lastfm_global', source_id: s.mbid || null, status: 'pending' }));

      let queued = toInsert.length;
      if (!DRY_RUN) {
        const { error } = await db
          .from('artist_ingestion_queue')
          .upsert(toInsert, { onConflict: 'name,source', ignoreDuplicates: true });
        if (error) { process.stdout.write(`DB error: ${error.message}\n`); queued = 0; }
      }
      process.stdout.write(`+${queued} queued (of ${similar.length})\n`);
      totalQueued += queued;
    }

    state.processedNames.add(name.toLowerCase());
    if (!DRY_RUN && (i + 1) % 25 === 0) saveState(state);
  }

  if (!DRY_RUN) saveState(state);

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

  Next: npm run queue:ingest:albums
`);
}

main().catch(err => { console.error(err); process.exit(1); });
