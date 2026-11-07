/**
 * Fill MusicBrainz release groups that have no release row at all.
 *
 * WHY THEY EXIST. audit-data-errors.sql reports them as release_group_without_releases (3,345 on
 * 2026-10-12, 2,992 of them MusicBrainz-sourced). They are not false albums: Hackney Diamonds, The
 * Rising and La Bamba are among them. ingestArtist lists an artist's editions with one capped
 * browse, and for a prolific artist a group's editions can all fall past the cap; such a group is
 * deliberately KEPT rather than dropped, which leaves a shell with no release, no tracks and nothing
 * to rate. 70 artists hold 3,204 of them (Handel 311, Stravinsky 167, Ella Fitzgerald 150).
 *
 * WHY NOTHING ELSE REPAIRS THEM. Re-polling the artist truncates identically. The gapfill lane only
 * fills tracks onto an existing canonical release, and these have none. So this asks MusicBrainz for
 * each group's editions directly, which cannot be truncated by the artist's size.
 *
 * WHAT IT WILL NOT DO. Delete or merge anything. Three answers are reported and recorded in the
 * report file so later runs do not ask again: MusicBrainz has no editions for the group, it has only
 * unofficial ones, or its editions already hang off ANOTHER row of ours (held_elsewhere, with that
 * row's id) because MusicBrainz moved them after we ingested. The last is a duplicate to merge, not
 * a gap to fill. What to do with any of those shells is a separate decision.
 *
 * THIS IS A MUSICBRAINZ LANE: one request per group at ~1 req/s. Never run it beside the pipeline.
 * It refuses to start while a pipeline MusicBrainz lane has a fresh heartbeat (--force overrides).
 *
 * REPORT-ONLY unless --write.
 *
 *   npx tsx --env-file=.env.local scripts/repair-empty-release-groups.ts --limit=20
 *   npx tsx --env-file=.env.local scripts/repair-empty-release-groups.ts --write
 *   npx tsx --env-file=.env.local scripts/repair-empty-release-groups.ts --write --retry   # re-ask recorded misses
 */
import * as fs from 'node:fs';
import { getDB, repairReleaseGroupEditions, type RepairOutcome } from './mb-ingest';

const arg = (f: string) => process.argv.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const WRITE = process.argv.includes('--write');
const FORCE = process.argv.includes('--force');
const RETRY = process.argv.includes('--retry');
const LIMIT = Number(arg('--limit') ?? 0);
const OUT = arg('--out') ?? 'scripts/data/repair-empty-release-groups.json';

type Group = { id: string; mbid: string; title: string; artist_display: string | null; type: string | null; primary_artist_id: string };
type Miss = { id: string; mbid: string; artist: string | null; title: string; outcome: RepairOutcome; editions: number; heldBy?: string };

async function query<T>(sql: string): Promise<T[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL required');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`query failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

async function main() {
  const db = getDB();

  if (!FORCE) {
    const { data: lanes } = await db.from('pipeline_lanes').select('lane, last_active').in('lane', ['ingest', 'freshness']);
    const fresh = ((lanes ?? []) as any[]).filter(l => l.last_active && Date.now() - new Date(l.last_active).getTime() < 180_000);
    if (fresh.length) {
      console.error(`\n  The pipeline looks alive (${fresh.map(l => l.lane).join(', ')} beat within 3 min).`);
      console.error('  Two MusicBrainz lanes at once get both throttled. Stop the pipeline first, or pass --force.\n');
      process.exit(1);
    }
  }

  // Misses recorded by an earlier run: MusicBrainz already answered for these.
  const known: Miss[] = !RETRY && fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')).misses ?? []) : [];
  const skip = new Set(known.map(m => m.id));

  // Best-known first, so an interrupted run has repaired the records people look for.
  const all = await query<Group>(`
    select rg.id, rg.mb_release_group_id mbid, rg.title, rg.artist_display, rg.release_group_type type, rg.primary_artist_id
      from release_groups rg
     where rg.source = 'musicbrainz' and rg.mb_release_group_id is not null and rg.primary_artist_id is not null
       and not exists (select 1 from releases r where r.release_group_id = rg.id)
     order by rg.prestige_score desc nulls last, rg.created_at`);
  const todo = all.filter(g => !skip.has(g.id)).slice(0, LIMIT > 0 ? LIMIT : undefined);
  console.log(`\n[repair-empty-rgs] ${all.length} MusicBrainz group(s) without a release; ${all.length - all.filter(g => !skip.has(g.id)).length} already answered; this run ${todo.length}${WRITE ? '  *** WRITE ***' : '  (report only)'}\n`);

  const counts: Record<string, number> = {};
  const misses: Miss[] = [...known];
  const save = () => fs.writeFileSync(OUT, JSON.stringify({ updated: new Date().toISOString(), counts, misses }, null, 1));
  let errorStreak = 0, tracks = 0;
  for (let i = 0; i < todo.length; i++) {
    const g = todo[i];
    const label = `[${i + 1}/${todo.length}] ${(g.artist_display ?? '').slice(0, 28)} — ${g.title.slice(0, 40)}`;
    try {
      const r = await repairReleaseGroupEditions(db, {
        id: g.id, mbid: g.mbid, title: g.title, artistDisplay: g.artist_display, type: g.type, primaryArtistId: g.primary_artist_id,
      }, WRITE);
      errorStreak = 0;
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
      tracks += r.tracks;
      console.log(`  ${label}: ${r.outcome} (${r.editions} edition(s)${r.tracks ? `, ${r.tracks} track(s)` : ''})${r.heldBy ? ` -> ${r.heldBy}` : ''}`);
      // Only a complete answer is recorded. A truncated listing proves nothing, and "would fill"
      // is not an outcome — recording either would make the next run skip work it still owes.
      if (r.outcome === 'no_editions' || r.outcome === 'no_official' || r.outcome === 'held_elsewhere') {
        misses.push({ id: g.id, mbid: g.mbid, artist: g.artist_display, title: g.title, outcome: r.outcome, editions: r.editions, ...(r.heldBy ? { heldBy: r.heldBy } : {}) });
      }
    } catch (e) {
      counts.error = (counts.error ?? 0) + 1;
      console.log(`  ${label}: ERROR ${(e as Error).message.slice(0, 120)}`);
      // MusicBrainz down or throttling is not an answer about any one group; stop rather than
      // burn through the list recording nothing.
      if (++errorStreak >= 5) { console.log('\n  5 errors in a row — stopping; re-run later.'); break; }
    }
    if ((i + 1) % 25 === 0) save();
  }
  save();

  console.log(`\n  ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') || 'nothing to do'}${tracks ? ` · ${tracks} track(s)` : ''}`);
  if (WRITE) {
    const left = await query<{ n: string }>(`select count(*)::text n from release_groups rg
      where rg.source = 'musicbrainz' and not exists (select 1 from releases r where r.release_group_id = rg.id)`);
    console.log(`  MusicBrainz groups still without a release: ${left[0]?.n}`);
  } else console.log('  report only — re-run with --write to fill');
  console.log(`  report -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
