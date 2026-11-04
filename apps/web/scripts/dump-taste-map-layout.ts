/**
 * Read-only: build one user's taste map exactly as GET /api/taste/map does
 * (lib/tasteMap/payload.ts, without storing the layout) and print every node's
 * top-3 neighbours with their "why", plus the groups. --out writes the payload
 * JSON (the same shape the viewer renders).
 *
 *   npx tsx --env-file=.env.local scripts/dump-taste-map-layout.ts --user=<username> [--out=payload.json] [--weights=era:0.5,graph:1.5]
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { buildTasteMapPayload } from '../lib/tasteMap/payload';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const USER = arg('user');
const OUT = arg('out');
const WEIGHTS = arg('weights')
  ? Object.fromEntries(arg('weights')!.split(',').map((kv) => [kv.split(':')[0], Number(kv.split(':')[1])]))
  : undefined;
if (!USER) {
  console.error('--user=<username> is required');
  process.exit(1);
}

(async () => {
  const { data: profile, error } = await db.from('profiles').select('id').eq('username', USER).maybeSingle();
  if (error || !profile) throw new Error(`no profile for ${USER}: ${error?.message ?? 'not found'}`);
  const t0 = Date.now();
  const result = await buildTasteMapPayload(db, profile.id, { blockWeights: WEIGHTS });
  if (result.kind === 'too-few') {
    console.log(`${USER}: ${result.have} rated albums, needs ${result.needed}`);
    return;
  }
  const { payload } = result;
  console.log(`${USER}: ${payload.nodes.length} nodes · ${payload.groups.length} groups · ${payload.trails.length} era trails · ${Date.now() - t0}ms`);
  for (const g of payload.groups) {
    const members = payload.nodes.filter((n) => (n.groups[g.id] ?? 0) > 0).length;
    console.log(`  group ${g.name}: ${members} nodes`);
  }
  const byKey = new Map(payload.nodes.map((n) => [n.key, n]));
  const name = (k: string) => {
    const n = byKey.get(k);
    return n ? `${n.label}${n.eraLabel ? ` (${n.eraLabel})` : ''}` : k;
  };
  for (const n of payload.nodes) {
    const nb = (payload.neighbors[n.key] ?? []).slice(0, 3).map(
      (x) => `${name(x.key)} ${x.sim.toFixed(2)} [${x.why.slice(0, 2).map((w) => `${w.label} ${Math.round(w.share * 100)}%`).join(', ')}]`,
    );
    console.log(`${name(n.key)}: ${nb.join(' | ')}`);
  }
  if (OUT) {
    writeFileSync(OUT, JSON.stringify(payload));
    console.log(`payload → ${OUT}`);
  }
})();
