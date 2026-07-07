// Run SQL against the hosted Supabase project via the Management API.
// Fills the "no DB URL on this machine" gap — lets a session apply a migration
// file (or ad hoc SQL) without the dashboard SQL editor.
//
//   npx tsx --env-file=.env.local scripts/db-exec.ts supabase/migrations/20260706000016_*.sql
//   npx tsx --env-file=.env.local scripts/db-exec.ts --sql "select count(*) from ratings"
//
// Requires SUPABASE_ACCESS_TOKEN (personal access token, sbp_…) in .env.local.
// The project ref is derived from NEXT_PUBLIC_SUPABASE_URL.
import { readFileSync } from 'node:fs';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN missing from environment (.env.local)');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ref = url?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
if (!ref) {
  console.error('Could not derive project ref from NEXT_PUBLIC_SUPABASE_URL');
  process.exit(1);
}

const args = process.argv.slice(2);
let sql: string;
let label: string;
if (args[0] === '--sql') {
  sql = args.slice(1).join(' ');
  label = 'inline sql';
} else if (args[0]) {
  sql = readFileSync(args[0], 'utf8');
  label = args[0];
} else {
  console.error('Usage: db-exec.ts <migration.sql> | --sql "statement"');
  process.exit(1);
}

async function main() {
  const started = Date.now();
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const ms = Date.now() - started;
  const body = await res.text();
  if (!res.ok) {
    console.error(`FAILED ${label} (HTTP ${res.status}, ${ms}ms):\n${body}`);
    process.exit(1);
  }
  console.log(`ok ${label} (${ms}ms)`);
  // Query results (empty array for DDL) — print compactly for SELECTs.
  if (body && body !== '[]') console.log(body.slice(0, 2000));
}

main();
