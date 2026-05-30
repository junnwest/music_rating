/**
 * Checks that every artist in the DB has a complete iTunes discography.
 *
 * For each artist with itunes_artist_id:
 *   1. Fetches their iTunes discography (non-single releases, noise-filtered)
 *   2. Checks which itunes_ids are absent from our releases table
 *   3. If any missing: re-queues the artist in artist_ingestion_queue (pending)
 *      so queue:ingest fills the gaps (dedup is handled by itunes_id conflict)
 *
 * Resumable — state saved every 20 artists to check-artist-completeness-state.json.
 *
 * Run:
 *   npm run check:completeness
 *   npm run check:completeness -- --dry-run
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const DRY_RUN   = process.argv.includes('--dry-run');
const DELAY_MS  = 650;
const ITUNES_BASE = 'https://itunes.apple.com';
const STATE_FILE  = path.join(__dirname, 'check-artist-completeness-state.json');

// Same noise filter as ingest-itunes-queue.ts
const NOISE_RE = /\b(sped[- ]up|slowed|instrumental|karaoke|off[- ]vocal|mr\.?|inst\.?)\b/i;

// ── iTunes API ────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function itunesGet(url: string, attempt = 0): Promise<any> {
  await sleep(DELAY_MS);
  const res = await fetch(url, { headers: { 'User-Agent': 'sillajuku-completeness-check/1.0' } });
  if (res.status === 429 || res.status === 403) {
    const wait = Math.min(120000, 10000 * 2 ** attempt);
    process.stdout.write(`\n  [${res.status}] iTunes blocked — waiting ${wait / 1000}s… `);
    await sleep(wait);
    if (attempt >= 5) return null;
    return itunesGet(url, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json();
}

interface ItunesAlbum {
  collectionId: number;
  collectionName: string;
  trackCount: number;
}

async function fetchDiscography(artistId: number): Promise<ItunesAlbum[]> {
  const url = `${ITUNES_BASE}/lookup?id=${artistId}&entity=album&limit=200`;
  const data = await itunesGet(url);
  if (!data) return [];
  return (data.results ?? [])
    .filter((r: any) =>
      r.wrapperType === 'collection' &&
      r.collectionType === 'Album' &&
      !NOISE_RE.test(r.collectionName) &&
      (r.trackCount ?? 0) > 3,
    )
    .map((r: any) => ({
      collectionId:   r.collectionId,
      collectionName: r.collectionName,
      trackCount:     r.trackCount,
    }));
}

// ── DB ────────────────────────────────────────────────────────────────────────

function getDB() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key);
}

type DB = ReturnType<typeof getDB>;

async function getAllArtists(db: DB) {
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('artists')
      .select('id, name, itunes_artist_id, name_native')
      .not('itunes_artist_id', 'is', null)
      .order('name')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function getExistingItunesIds(db: DB, itunesIds: number[]): Promise<Set<string>> {
  const { data } = await db
    .from('releases')
    .select('itunes_id')
    .in('itunes_id', itunesIds);
  return new Set((data ?? []).map((r: any) => String(r.itunes_id)));
}

async function requeueArtist(db: DB, artist: any) {
  // Check if already in queue (by itunes_artist_id)
  const { data: existing } = await db
    .from('artist_ingestion_queue')
    .select('id')
    .eq('itunes_artist_id', artist.itunes_artist_id)
    .maybeSingle();

  if (existing) {
    await db.from('artist_ingestion_queue')
      .update({ status: 'pending', error: null, processed_at: null })
      .eq('id', existing.id);
  } else {
    await db.from('artist_ingestion_queue').insert({
      name:             artist.name,
      name_native:      artist.name_native ?? null,
      itunes_artist_id: artist.itunes_artist_id,
      source:           'completeness_check',
      status:           'pending',
    });
  }
}

// ── State ─────────────────────────────────────────────────────────────────────

interface State { checkedArtistIds: string[] }

function loadState(): State {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return { checkedArtistIds: [] };
}

function saveState(ids: Set<string>) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ checkedArtistIds: Array.from(ids) }, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  sillajuku artist completeness check${DRY_RUN ? ' [DRY RUN]' : ''}\n`);

  const db = getDB();
  const state = loadState();
  const checkedIds = new Set(state.checkedArtistIds);

  const allArtists = await getAllArtists(db);
  const remaining  = allArtists.filter(a => !checkedIds.has(a.id));

  console.log(`  Total artists   : ${allArtists.length}`);
  console.log(`  Already checked : ${checkedIds.size}`);
  console.log(`  To check        : ${remaining.length}\n`);

  let complete = 0, incomplete = 0, noAlbums = 0, totalMissing = 0;

  for (let i = 0; i < remaining.length; i++) {
    const artist = remaining[i];
    process.stdout.write(`  [${i + 1}/${remaining.length}] ${artist.name.padEnd(40)} `);

    const albums = await fetchDiscography(artist.itunes_artist_id);

    if (albums.length === 0) {
      process.stdout.write(`— no albums on iTunes\n`);
      noAlbums++;
      checkedIds.add(artist.id);
      if (i % 20 === 0) saveState(checkedIds);
      continue;
    }

    const itunesIds     = albums.map(a => a.collectionId);
    const existingIds   = await getExistingItunesIds(db, itunesIds);
    const missingCount  = itunesIds.filter(id => !existingIds.has(String(id))).length;

    if (missingCount === 0) {
      process.stdout.write(`✓ ${albums.length} complete\n`);
      complete++;
    } else {
      const verb = DRY_RUN ? 'would re-queue' : 're-queued';
      process.stdout.write(`⚠ ${existingIds.size}/${albums.length} — missing ${missingCount} → ${verb}\n`);
      incomplete++;
      totalMissing += missingCount;

      if (!DRY_RUN) await requeueArtist(db, artist);
    }

    checkedIds.add(artist.id);
    if (i % 20 === 0) saveState(checkedIds);
  }

  saveState(checkedIds);

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Complete artists    : ${complete}
  Incomplete artists  : ${incomplete}
  No albums on iTunes : ${noAlbums}
  Total missing       : ${totalMissing} releases
${incomplete > 0 ? `\n  Run npm run queue:ingest to fill the gaps.\n` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
}

main().catch(err => { console.error(err); process.exit(1); });
