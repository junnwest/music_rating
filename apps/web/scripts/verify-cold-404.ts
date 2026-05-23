/**
 * Probe: with circuit OPEN and a fresh album ID never seen by this dev server
 * (so Next.js ISR cannot serve a cached page), load /album/[id] and confirm
 * it returns 404 quickly. This is the worst-case the user reported.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-cold-404.ts
 */

import { Redis } from '@upstash/redis';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3001';
const rurl = process.env.UPSTASH_REDIS_REST_URL;
const rtok = process.env.UPSTASH_REDIS_REST_TOKEN;
const surl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const skey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!rurl || !rtok || !surl || !skey) { console.error('Missing env vars'); process.exit(1); }

const redis = new Redis({ url: rurl, token: rtok });
const db = createClient(surl, skey, { auth: { persistSession: false } });
const CIRCUIT_KEY = 'spotify:rate-limited-until';

async function main() {
  // Use a UUID-shaped ID that definitely doesn't exist anywhere
  const fakeId = `verify-cold-${Date.now()}`;

  // Ensure no DB row, no Redis spotify:album cache
  await db.from('releases').delete().eq('id', fakeId);
  await redis.del(`spotify:album:${fakeId}`);
  await redis.del(CIRCUIT_KEY);

  // ── Step 1: closed circuit. Spotify would 404 on this fake ID, so the
  // page should also 404. Time how long it takes.
  console.log('Step 1: closed circuit, fake ID → page must 404 via Spotify (not in DB)');
  const t1 = Date.now();
  const r1 = await fetch(`${BASE}/album/${fakeId}`);
  const ms1 = Date.now() - t1;
  console.log(`   status=${r1.status} time=${ms1}ms`);

  // ── Step 2: open circuit, *different* fresh ID (avoid ISR cache).
  const fakeId2 = `verify-cold-${Date.now() + 1}`;
  await redis.del(`spotify:album:${fakeId2}`);
  await db.from('releases').delete().eq('id', fakeId2);
  await redis.set(CIRCUIT_KEY, Date.now() + 120 * 1000, { ex: 120 });

  console.log('\nStep 2: OPEN circuit, fresh fake ID → must 404 fast (breaker fires)');
  const t2 = Date.now();
  const r2 = await fetch(`${BASE}/album/${fakeId2}`);
  const ms2 = Date.now() - t2;
  console.log(`   status=${r2.status} time=${ms2}ms`);

  await redis.del(CIRCUIT_KEY);

  // Verdict
  const closedOk = r1.status === 404;
  const openOk   = r2.status === 404 && ms2 < 2000;
  const fasterByBreaker = ms2 < ms1; // breaker should make it faster than baseline

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Closed-circuit cold 404:   ${closedOk ? '✓' : '✗'}  status=${r1.status}, ${ms1}ms`);
  console.log(`  Open-circuit fast 404:     ${openOk ? '✓' : '✗'}  status=${r2.status}, ${ms2}ms`);
  console.log(`  Breaker faster than spotify path: ${fasterByBreaker ? '✓' : '✗'}  (${ms2}ms < ${ms1}ms)`);
  console.log(`  Verdict:                   ${closedOk && openOk ? '✓ PASS' : '✗ FAIL'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main().catch(err => { console.error(err); process.exit(1); });
