/**
 * Backs up the user-generated tables — the data VISION.md itself calls "the real
 * asset" — to a timestamped JSON file under backups/ (gitignored). Supabase's own
 * automatic backups cover disaster recovery at the infra level, but there's been no
 * verified restore process and no off-platform copy; this is that off-platform copy.
 *
 * Deliberately scoped to user-generated content, not the music catalog (artists,
 * release_groups, releases, recordings, tracks, etc.) — the catalog is re-derivable
 * from MusicBrainz/the ingest pipeline and would make this dump enormous (hundreds
 * of thousands of rows) for no real DR benefit; catalog rows aren't the irreplaceable
 * part. Also excludes spotify_connections — that's live OAuth access/refresh tokens,
 * not content, and copying credentials into a backup file is a needless exposure for
 * data that isn't part of "the real asset" anyway.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/backup-db.ts
 *
 * Restore is manual by design (this isn't a one-command restore tool) — inspect the
 * JSON and re-insert via the Supabase client or SQL editor as the situation requires.
 */

import { getDB } from './itunes-ingest-core';
import * as fs from 'fs';
import * as path from 'path';

const PAGE_SIZE = 1000;

// Table → a column (or composite-key leading column) to order by for stable
// pagination. Most tables have a uuid `id` primary key; a few key on something
// else instead, so this can't just be a flat list with a hardcoded 'id'.
const TABLES: Record<string, string> = {
  profiles: 'id',
  ratings: 'id',
  rating_history: 'id',
  reviews: 'id',
  comment_likes: 'id',
  follows: 'follower_id',
  blocked_users: 'blocker_id',
  reports: 'id',
  contact_submissions: 'id',
  lists: 'id',
  list_items: 'id',
  mixes: 'id',
  mix_items: 'id',
  pinned_albums: 'id',
  ranking_votes: 'id',
  user_rankings: 'id',
  user_ranking_entries: 'id',
  pairwise_comparisons: 'id',
  track_pairwise_comparisons: 'id',
  track_ratings: 'id',
};

async function main() {
  const db = getDB();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '..', 'backups');
  fs.mkdirSync(outDir, { recursive: true });

  const snapshot: Record<string, unknown[]> = {};

  for (const [table, orderCol] of Object.entries(TABLES)) {
    process.stdout.write(`Backing up ${table}... `);
    const rows: unknown[] = [];
    let offset = 0;
    for (;;) {
      const { data, error } = await db
        .from(table)
        .select('*')
        .order(orderCol, { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        console.log(`ERROR: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    snapshot[table] = rows;
    console.log(`${rows.length} rows`);
  }

  const outPath = path.join(outDir, `backup-${timestamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main();
