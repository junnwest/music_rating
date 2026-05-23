/**
 * Focused verification of the Spotify circuit breaker.
 *
 * Why a separate file from verify-404-fixes.ts: the album page has
 * `export const revalidate = 60`, so Next.js Server-Component HTML is cached
 * for 60s. Driving the breaker via the album page can be misleading — a fast
 * 200 might just be a cached HTML response that never ran the data path.
 *
 * /api/search is a pure route handler with no page-level cache. On a unique
 * query, it bypasses the Upstash search cache too, and calls spotifyFetch
 * directly. That's the cleanest way to observe the breaker.
 *
 * Test plan:
 *   1. Clear breaker. Issue a unique-query search. Should return 200 quickly
 *      via Spotify. Baseline latency.
 *   2. Open the breaker via Redis (TTL 120s). Issue a *different* unique
 *      query (so Redis search cache misses). Should return 500 in << 1s
 *      because spotifyFetch throws SpotifyCircuitOpenError immediately
 *      instead of waiting on a 429.
 *   3. Clear breaker. Cleanup.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-circuit-breaker.ts
 */

import { Redis } from '@upstash/redis';

const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3001';
const rurl = process.env.UPSTASH_REDIS_REST_URL;
const rtok = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!rurl || !rtok) { console.error('Missing Upstash env vars'); process.exit(1); }

const redis = new Redis({ url: rurl, token: rtok });
const CIRCUIT_KEY = 'spotify:rate-limited-until';

async function clearBreaker() {
  await redis.del(CIRCUIT_KEY);
}

async function openBreaker(seconds: number) {
  const until = Date.now() + seconds * 1000;
  await redis.set(CIRCUIT_KEY, until, { ex: seconds });
  return until;
}

async function clearSearchCache(query: string) {
  const k = `search:albums:${query.toLowerCase()}:y=:m=`;
  await redis.del(k);
}

async function timedSearch(query: string) {
  await clearSearchCache(query);
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/search?query=${encodeURIComponent(query)}`);
  const ms = Date.now() - t0;
  const body = await res.text();
  return { status: res.status, ms, body: body.slice(0, 200) };
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Circuit-breaker verification');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Use a timestamp in the query to guarantee uniqueness across runs
  const stamp = Date.now();
  const q1 = `verify-baseline-${stamp}`;
  const q2 = `verify-breaker-${stamp + 1}`;

  await clearBreaker();

  // ── Step 1: baseline (circuit closed) ───────────────────────────────────
  console.log('Step 1: closed circuit, unique query → Spotify call');
  const r1 = await timedSearch(q1);
  console.log(`  status=${r1.status}  time=${r1.ms}ms`);
  console.log(`  body: ${r1.body}\n`);

  // ── Step 2: open circuit, different unique query ────────────────────────
  const until = await openBreaker(120);
  console.log(`Step 2: opened circuit (until ${new Date(until).toISOString()})`);
  console.log(`        unique query → spotifyFetch must short-circuit`);
  const r2 = await timedSearch(q2);
  console.log(`  status=${r2.status}  time=${r2.ms}ms`);
  console.log(`  body: ${r2.body}\n`);

  // ── Verdict ──────────────────────────────────────────────────────────────
  // Expected with breaker working:
  //   - r2.status === 500 (search route catches the throw and returns error)
  //   - r2.ms is very fast (<1000ms — basically just a Redis ping + throw)
  //   - r2.body should contain "circuit" or the SpotifyCircuitOpenError message
  const fastEnough = r2.ms < 1500;
  const errored    = r2.status === 500;
  const mentionsCircuit = /circuit|rate-limited|SpotifyCircuit/i.test(r2.body);
  const passed = fastEnough && errored && mentionsCircuit;

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Fast (<1500ms):              ${fastEnough ? '✓' : '✗'}  (${r2.ms}ms)`);
  console.log(`  Status 500 (route caught):   ${errored ? '✓' : '✗'}  (got ${r2.status})`);
  console.log(`  Error mentions circuit:      ${mentionsCircuit ? '✓' : '✗'}`);
  console.log(`  Verdict:                     ${passed ? '✓ PASS' : '✗ FAIL'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await clearBreaker();
}

main().catch(err => { console.error(err); process.exit(1); });
