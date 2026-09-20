/**
 * Thin orchestrator for the Instagram "out now" pipeline — chains four steps:
 * detect (MB sweep, --ingest) -> sync newly-detected artists into the REAL
 * rating catalog -> cover art (for the poster) -> poster PNG.
 * No caption step — the user writes captions by hand when posting.
 *
 * The catalog-sync step runs in its default incremental mode (only artists
 * with a fresh, unsynced detection get re-ingested) — see
 * sync-ig-artists-to-catalog.ts. The one-time full backfill (--all, every
 * watchlist artist regardless of detection history) is run separately, not
 * as part of this routine chain.
 *
 * Each step is also independently runnable (see their own file headers) for
 * debugging a single stage. This just runs all four back to back on a schedule
 * (e.g. a Windows Task Scheduler job every 1-2 hours) so review is just checking
 * scripts/output/ig-out-now/ afterward.
 *
 *   npx tsx --env-file=.env.local scripts/run-ig-pipeline.ts
 */
import { spawnSync } from 'node:child_process';

const STEPS = [
  ['discover-ig-newreleases.ts', ['--ingest']],
  ['sync-ig-artists-to-catalog.ts', []],
  ['fetch-ig-cover.ts', []],
  ['render-ig-poster.ts', []],
] as const;

function run(script: string, args: readonly string[]): boolean {
  console.log(`\n─── ${script} ${args.join(' ')} ───`);
  const res = spawnSync('npx', ['tsx', `scripts/${script}`, ...args], { stdio: 'inherit', shell: true });
  if (res.status !== 0) { console.error(`✗ ${script} exited ${res.status}`); return false; }
  return true;
}

for (const [script, args] of STEPS) {
  if (!run(script, args)) { console.error('\nPipeline stopped early — fix the error above and re-run.'); process.exit(1); }
}
console.log('\n=== ig pipeline run complete — check scripts/output/ig-out-now/ ===');
