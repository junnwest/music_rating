/**
 * Rebuild the HNSW index on release_groups.embedding over a DIRECT Postgres connection.
 *
 *   npx tsx --env-file=.env.local scripts/build-embedding-index.ts
 *   npx tsx --env-file=.env.local scripts/build-embedding-index.ts --drop-first
 *
 * WHY NOT db-exec.ts. That goes through the Supabase Management API, whose HTTP gateway returns
 * 524 at ~125 seconds. A short DDL survives that (the halfvec ALTER took 7.5min and committed
 * fine), but an 85-minute HNSW build over 402,448 vectors did NOT: the statement eventually
 * disappeared from pg_stat_activity having created nothing, and because the only signal available
 * through that path is "is it still in pg_stat_activity", absence looked like success. It wasn't —
 * the index simply did not exist afterwards. A direct connection has no gateway to time out.
 *
 * PROGRESS IS REPORTED, NOT INFERRED. pg_stat_progress_create_index gives phase and tuple counts,
 * so this prints real progress instead of leaving a silent hour to be guessed at.
 *
 * maintenance_work_mem is raised for the session: an HNSW build that does not fit in memory spills
 * and crawls, which is the most likely reason the first attempt never finished.
 */
import { Client } from 'pg';

const DROP_FIRST = process.argv.includes('--drop-first');
const INDEX = 'idx_release_groups_embedding_hnsw';
const url = process.env.DATABASE_URL;

async function main() {
  if (!url) { console.error('DATABASE_URL missing from environment'); process.exit(1); }

  // Separate connection for progress, so it is not blocked behind the builder.
  const builder = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const watcher = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await builder.connect();
  await watcher.connect();

  const existing = await builder.query(
    `select indisvalid from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname=$1`, [INDEX]);
  if (existing.rows.length && !DROP_FIRST) {
    console.log(`  ${INDEX} already exists (valid=${existing.rows[0].indisvalid}) — pass --drop-first to rebuild`);
    await builder.end(); await watcher.end(); return;
  }
  if (existing.rows.length && DROP_FIRST) {
    console.log(`  dropping existing ${INDEX}…`);
    await builder.query(`drop index if exists public.${INDEX}`);
  }

  await builder.query(`set statement_timeout = 0`);   // no limit; the connection is ours

  /* SERIAL BUILD, MODEST MEMORY — both settings are the fix for a real failure, not tuning.
     maintenance_work_mem='2GB' with parallel workers made the build request a 2 GB SHARED memory
     segment and die instantly: "could not resize shared memory segment to 2144367168 bytes: No
     space left on device". That is /dev/shm on the instance, not disk, and no amount of database
     free space helps. Almost certainly what killed the first 85-minute attempt as well — it just
     failed silently through the HTTP path instead of saying so.
     max_parallel_maintenance_workers=0 removes the shared segment entirely; the build is slower
     but uses ordinary backend memory. */
  const MEM = process.argv.find(a => a.startsWith('--mem='))?.split('=')[1] ?? '512MB';
  await builder.query(`set max_parallel_maintenance_workers = 0`);
  await builder.query(`set maintenance_work_mem = '${MEM}'`);
  const mem = await builder.query(`show maintenance_work_mem`);
  console.log(`  maintenance_work_mem = ${mem.rows[0].maintenance_work_mem}, parallel workers = 0 (serial)`);

  const t0 = Date.now();
  console.log(`  building ${INDEX} (halfvec_cosine_ops)…`);

  const build = builder.query(
    `create index ${INDEX} on public.release_groups using hnsw (embedding halfvec_cosine_ops)`);

  const timer = setInterval(async () => {
    try {
      const p = await watcher.query(
        `select phase, tuples_done, tuples_total, blocks_done, blocks_total
           from pg_stat_progress_create_index limit 1`);
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      if (!p.rows.length) { console.log(`    ${mins}m — no progress row (finishing or committing)`); return; }
      const r = p.rows[0];
      const done = Number(r.tuples_done || 0), total = Number(r.tuples_total || 0);
      const pct = total ? ` ${((done / total) * 100).toFixed(1)}%` : '';
      console.log(`    ${mins}m — ${r.phase}${pct} (${done}/${total} tuples)`);
    } catch { /* progress is best-effort */ }
  }, 60_000);

  try {
    await build;
    clearInterval(timer);
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    const chk = await builder.query(
      `select i.indisvalid as valid, pg_size_pretty(pg_relation_size(i.indexrelid)) as size
         from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname=$1`, [INDEX]);
    const row = chk.rows[0];
    console.log(`\n  BUILT in ${mins}m — valid=${row?.valid} size=${row?.size}`);
    const db = await builder.query(`select pg_size_pretty(pg_database_size(current_database())) as s`);
    console.log(`  database now ${db.rows[0].s}`);
  } catch (e) {
    clearInterval(timer);
    console.error(`\n  BUILD FAILED: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await builder.end().catch(() => {});
    await watcher.end().catch(() => {});
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
