/**
 * Backfill the `tracks` table from `releases.tracklist` (JSONB).
 *
 * Songs become first-class rows (stable UUIDs) so they can have pages, ratings,
 * search, and leaderboards. See SONGS_PLAN.md. Apply migration
 * 20260618000000_tracks_table.sql first.
 *
 * Source shape: releases.tracklist = { position, title, durationMs, artists }[].
 * ~107k releases have tracklists → ~1M+ track rows, so this is a long run —
 * intended to be left running (e.g., overnight). Resumable + idempotent:
 *   - keyset pagination over releases by id, progress saved to a state file
 *   - upsert on (release_id, position) with ignoreDuplicates, so re-runs are safe
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-tracks.ts
 *   npx tsx --env-file=.env.local scripts/backfill-tracks.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-tracks.ts --limit=500   # cap releases processed
 *   npx tsx --env-file=.env.local scripts/backfill-tracks.ts --reset       # start from the beginning
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const DRY = process.argv.includes('--dry-run');
const RESET = process.argv.includes('--reset');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

const PAGE = 500;        // releases fetched per query
const INSERT_CHUNK = 1000; // track rows per insert
const STATE_PATH = path.resolve('scripts/backfill-tracks-state.json');

interface State { lastId: string; releases: number; tracks: number; }
function loadState(): State {
  if (RESET) return { lastId: '', releases: 0, tracks: 0 };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { lastId: '', releases: 0, tracks: 0 }; }
}
function saveState(s: State) { fs.writeFileSync(STATE_PATH, JSON.stringify(s)); }

interface TItem { position: number; title: string; durationMs: number | null; artists: string; }

function rowsFor(releaseId: string, tracklist: unknown): { release_id: string; position: number; title: string; duration_ms: number | null; artists: string | null }[] {
  if (!Array.isArray(tracklist)) return [];
  const byPos = new Map<number, TItem>();
  for (const t of tracklist as TItem[]) {
    if (!t || typeof t.position !== 'number' || !t.title) continue;
    if (!byPos.has(t.position)) byPos.set(t.position, t); // dedupe positions (keep first)
  }
  return [...byPos.values()].map((t) => ({
    release_id: releaseId,
    position: t.position,
    title: String(t.title).slice(0, 500),
    duration_ms: typeof t.durationMs === 'number' ? t.durationMs : null,
    artists: t.artists ? String(t.artists).slice(0, 500) : null,
  }));
}

async function main() {
  const state = loadState();
  let { lastId, releases: releasesDone, tracks: tracksDone } = state;
  console.log(`\n  backfill-tracks${DRY ? ' [DRY RUN]' : ''}${RESET ? ' [RESET]' : ''}  (resuming after id="${lastId}")`);

  while (releasesDone < LIMIT) {
    let q = db.from('releases').select('id, tracklist').not('tracklist', 'is', null)
      .order('id', { ascending: true }).limit(PAGE);
    if (lastId) q = q.gt('id', lastId);
    const { data, error } = await q;
    if (error) { console.error('\n  fetch error:', error.message); break; }
    if (!data || data.length === 0) break;

    let pending: ReturnType<typeof rowsFor> = [];
    for (const rel of data) {
      pending.push(...rowsFor(rel.id, rel.tracklist));
      lastId = rel.id;
      releasesDone++;
      if (releasesDone >= LIMIT) break;
    }

    if (!DRY && pending.length > 0) {
      for (let i = 0; i < pending.length; i += INSERT_CHUNK) {
        const chunk = pending.slice(i, i + INSERT_CHUNK);
        const { error: e } = await db.from('tracks').upsert(chunk, { onConflict: 'release_id,position', ignoreDuplicates: true });
        if (e) { console.error('\n  insert error:', e.message); process.exit(1); }
      }
    }
    tracksDone += pending.length;
    if (!DRY) saveState({ lastId, releases: releasesDone, tracks: tracksDone });
    process.stdout.write(`\r  releases ${releasesDone}  ·  track rows ~${tracksDone}        `);
  }

  console.log(`\n  Done. releases processed: ${releasesDone} · track rows: ~${tracksDone}${DRY ? ' [DRY — nothing written]' : ''}\n`);
}

main();
