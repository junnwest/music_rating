/**
 * derive-display-genres.ts — the Phase-3 DISPLAY CUTOVER (GENRE_TAXONOMY.md §4):
 * re-derive every album's displayed `release_groups.genres` from its per-source
 * `release_genres` rows via lib/genres/display.ts (merge → spellings → + tail), and
 * retire `legacy` rows on albums MusicBrainz already covers.
 *
 * After this one-off pass, the per-source writer keeps genres[] in sync live (any album
 * whose source rows change is re-derived), so this only needs re-running after a merge-
 * model or taxonomy change.
 *
 * Safety: run `supabase/migrations/20260923000001_release_groups_genres_backup.sql`
 * first (snapshot of every pre-cutover genres[]; restore statement in that file).
 * Albums with no release_genres rows are never touched; an album is written only if
 * its array actually changes; unresolvable tail tags are kept.
 *
 *   npx tsx --env-file=.env.local scripts/derive-display-genres.ts --dry-run --limit=20000
 *   npx tsx --env-file=.env.local scripts/derive-display-genres.ts
 *   npx tsx --env-file=.env.local scripts/derive-display-genres.ts --after=<uuid>   # resume
 *
 * Afterwards re-sync the chart primary (it only re-syncs on rating changes):
 *   db-exec.ts --sql "UPDATE rg_primary_genre pg SET primary_genre = _compute_primary_genre(rg.genres)
 *                     FROM release_groups rg WHERE rg.id = pg.release_group_id"
 */
import { createClient } from '@supabase/supabase-js';
import { syncDisplayGenres, type SyncDisplayResult } from '../lib/genres/display';
import { pgRetry } from '../lib/genres/pgRetry';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const DRY = process.argv.includes('--dry-run');
const arg = (name: string) => process.argv.find((x) => x.startsWith(`--${name}=`))?.split('=')[1];
const LIMIT = parseInt(arg('limit') ?? '0', 10);
const AFTER = arg('after');
const PAGE = 1000;
const SAMPLES = 15;

async function main() {
  console.log(`derive-display-genres ${DRY ? '(DRY RUN)' : ''}${AFTER ? ` after ${AFTER}` : ''}`);
  const total: SyncDisplayResult = { checked: 0, updated: 0, legacyRetired: 0, samples: [] };
  let scanned = 0;
  let after = AFTER;

  for (let page = 0; ; page++) {
    const data = (await pgRetry('release_groups page', () => {
      let q = db.from('release_groups').select('id, title, genres').order('id', { ascending: true }).limit(PAGE);
      if (after) q = q.gt('id', after);
      return q;
    })) as { id: string; title: string; genres: (string | null)[] | null }[] | null;
    if (!data?.length) break;

    const current = new Map(data.map((r) => [r.id as string, r.genres as (string | null)[] | null]));
    const r = await syncDisplayGenres(
      db,
      data.map((d) => d.id as string),
      { dryRun: DRY, current, sampleLimit: Math.max(0, SAMPLES - total.samples.length) },
    );
    const titles = new Map(data.map((d) => [d.id as string, d.title as string]));
    for (const s of r.samples) total.samples.push({ ...s, id: `${titles.get(s.id)} (${s.id})` });
    total.checked += r.checked;
    total.updated += r.updated;
    total.legacyRetired += r.legacyRetired;
    scanned += data.length;
    after = data[data.length - 1].id as string;

    if (page % 10 === 0) {
      console.log(
        `  scanned ${scanned} · with rows ${total.checked} · ${DRY ? 'would change' : 'changed'} ${total.updated}` +
          ` · legacy retired ${total.legacyRetired} · resume --after=${after}`,
      );
    }
    if (data.length < PAGE || (LIMIT && scanned >= LIMIT)) break;
  }

  console.log('\nSample changes:');
  for (const s of total.samples) {
    console.log(`  ${s.id}\n    before: ${JSON.stringify(s.before)}\n    after:  ${JSON.stringify(s.after)}`);
  }
  const pct = total.checked ? ((total.updated / total.checked) * 100).toFixed(1) : '0';
  console.log(
    `\ndone: scanned ${scanned} albums · ${total.checked} with release_genres rows · ` +
      `${total.updated} (${pct}%) ${DRY ? 'would change' : 'changed'} · legacy rows retired ${total.legacyRetired}`,
  );
  if (DRY) console.log('DRY RUN — no writes.');
  else console.log('NEXT: re-sync rg_primary_genre (statement in this file header).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
