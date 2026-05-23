/**
 * Verification script for the two 404 fixes:
 *  - Fix 1: /api/search persists Spotify rows to releases via saveBasicReleases
 *  - Fix 2: spotifyFetch checks a Redis circuit-breaker key and fails fast
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-404-fixes.ts
 * Requires: dev server running on http://localhost:3001
 */

import { createClient } from '@supabase/supabase-js';
import { Redis } from '@upstash/redis';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rurl = process.env.UPSTASH_REDIS_REST_URL;
const rtok = process.env.UPSTASH_REDIS_REST_TOKEN;
const BASE = process.env.VERIFY_BASE_URL ?? 'http://localhost:3001';

if (!url || !key) { console.error('Missing Supabase env vars'); process.exit(1); }
if (!rurl || !rtok) { console.error('Missing Upstash env vars'); process.exit(1); }

const db = createClient(url, key, { auth: { persistSession: false } });
const redis = new Redis({ url: rurl, token: rtok });
const CIRCUIT_KEY = 'spotify:rate-limited-until';

async function checkIds(ids: string[]) {
  if (ids.length === 0) return new Map<string, any>();
  const { data } = await db.from('releases').select('id, title, artist, cover_url, release_type, release_date').in('id', ids);
  return new Map((data ?? []).map(r => [r.id, r]));
}

async function clearCircuit() {
  await redis.del(CIRCUIT_KEY);
}

async function setCircuit(seconds: number) {
  const until = Date.now() + seconds * 1000;
  await redis.set(CIRCUIT_KEY, until, { ex: seconds });
  return until;
}

async function fix1_saveBasicReleasesOnSearch() {
  console.log('\n━━━ FIX 1: /api/search writes to releases ━━━\n');

  // Use a niche query likely to surface albums not yet in DB. Pick a small
  // K-indie artist with several releases.
  const query = 'BACK COUNTRY ROCK';
  console.log(`Query: "${query}"`);

  // Clear search cache for this query so the route actually hits Spotify
  // (otherwise it returns the cached body and never calls saveBasicReleases).
  const cacheKey = `search:albums:${query.toLowerCase()}:y=:m=`;
  await redis.del(cacheKey);
  console.log(`  Cleared Redis cache key: ${cacheKey}`);

  // Also clear the circuit breaker in case a prior 429 left it set
  await clearCircuit();

  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/search?query=${encodeURIComponent(query)}`);
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(`  ❌ search returned ${res.status} in ${ms}ms`);
    return false;
  }
  const body = await res.json() as { releases: Array<{ id: string; title: string; artist: string }> };
  console.log(`  ✓ /api/search returned ${body.releases.length} albums in ${ms}ms`);
  if (body.releases.length === 0) {
    console.log('  ⚠ No releases returned — pick a different query.');
    return false;
  }

  // List the first 5 results
  for (const r of body.releases.slice(0, 5)) {
    console.log(`     - [${r.id}] ${r.title} — ${r.artist}`);
  }

  // Brief pause to let the fire-and-forget upsert finish
  await new Promise(r => setTimeout(r, 1500));

  // Check the DB
  const ids = body.releases.map(r => r.id);
  const inDb = await checkIds(ids);
  const missing = ids.filter(id => !inDb.has(id));
  console.log(`\n  Of ${ids.length} returned albums, ${inDb.size} are in releases, ${missing.length} are missing.`);

  // Print a sample of what's now in the DB (to confirm fields are populated)
  const sample = ids.slice(0, 3).map(id => inDb.get(id)).filter(Boolean);
  for (const row of sample) {
    console.log(`     DB row: [${row.id}] title=${JSON.stringify(row.title)} cover=${row.cover_url ? 'yes' : 'NULL'} type=${row.release_type} date=${row.release_date}`);
  }

  return missing.length === 0;
}

async function fix2_circuitBreakerShortCircuits() {
  console.log('\n━━━ FIX 2: Circuit breaker short-circuits Spotify ━━━\n');

  // Step 1: pick a Spotify album ID that's NOT in DB (so the album page MUST
  // call Spotify if the circuit is closed). Look up a fresh Spotify search and
  // pick the first ID that isn't in our DB.
  const probeQuery = 'utterly obscure deep cut 2026';
  const cacheKey = `search:albums:${probeQuery.toLowerCase()}:y=:m=`;
  await redis.del(cacheKey);
  await clearCircuit();

  const probeRes = await fetch(`${BASE}/api/search?query=${encodeURIComponent(probeQuery)}`);
  if (!probeRes.ok) {
    console.log(`  ⚠ Probe search failed (${probeRes.status}). Cannot proceed.`);
    return false;
  }
  const probeBody = await probeRes.json() as { releases: Array<{ id: string }> };

  if (probeBody.releases.length === 0) {
    console.log('  ⚠ Probe search returned 0 results. Skipping fix-2 verification.');
    return false;
  }

  // Now that /api/search runs saveBasicReleases on those rows, they ARE in DB
  // — which means an album page load could just hit getBasicRelease and never
  // call Spotify, which doesn't actually exercise the breaker.
  //
  // To force the breaker path, we delete the row we just saved, set the
  // breaker, then load the album page. Without fix 2, this would call Spotify
  // (which would succeed since the limit isn't real), so the page would
  // render with full info. With fix 2, the breaker key intercepts and forces
  // getBasicRelease (which returns null since we just deleted the row), so
  // we should see a 404.
  //
  // Better test: just time the spotifyFetch path directly via a small
  // workspace. Instead, we'll load the album page with circuit OPEN and
  // confirm the request returns in well under 10s (no in-process wait).
  const probeId = probeBody.releases[0].id;
  console.log(`  Picked probe album ID: ${probeId}`);

  // Wait for the fire-and-forget saveBasicReleases from the probe search to settle
  await new Promise(r => setTimeout(r, 1500));

  // Delete the probe row from DB so the album page must fall through to
  // either Spotify (closed circuit) or null (open circuit + no row).
  const { error: delErr } = await db.from('releases').delete().eq('id', probeId);
  if (delErr) console.log(`  ⚠ Delete probe row warning: ${delErr.message}`);
  else console.log(`  Deleted probe row from DB to force the Spotify path`);

  // Also clear any cached spotify:album:* entry for this ID
  await redis.del(`spotify:album:${probeId}`);

  // ── Baseline: circuit CLOSED, album page loads via Spotify ──────────────
  await clearCircuit();
  console.log(`\n  Baseline (circuit closed): loading /album/${probeId} …`);
  const t1 = Date.now();
  const r1 = await fetch(`${BASE}/album/${probeId}`);
  const ms1 = Date.now() - t1;
  console.log(`     status ${r1.status} in ${ms1}ms`);

  // ── Open circuit and reload ─────────────────────────────────────────────
  // Also delete the row again so getBasicRelease will return null
  // (otherwise the page would render via the basic-row fallback, which is
  // still fast — but doesn't prove the breaker fired).
  await db.from('releases').delete().eq('id', probeId);
  await redis.del(`spotify:album:${probeId}`);

  const until = await setCircuit(120);
  console.log(`\n  Opened circuit (rate-limited-until set to ${new Date(until).toISOString()})`);
  console.log(`  Reloading /album/${probeId} …`);

  const t2 = Date.now();
  const r2 = await fetch(`${BASE}/album/${probeId}`);
  const ms2 = Date.now() - t2;
  console.log(`     status ${r2.status} in ${ms2}ms`);

  // The key signal: with circuit OPEN and no DB row, the page should return
  // 404 FAST (well under 10s) because spotifyFetch throws immediately instead
  // of hitting Spotify and waiting for retry.
  const passed = r2.status === 404 && ms2 < 5000;
  if (passed) {
    console.log(`\n  ✓ Circuit breaker fired: 404 in ${ms2}ms (< 5s threshold)`);
  } else if (r2.status !== 404) {
    console.log(`\n  Note: page returned ${r2.status} not 404 — could be Spotify call succeeded after the breaker check raced, or row reappeared`);
  } else {
    console.log(`\n  ⚠ Circuit breaker may not have fired: 404 took ${ms2}ms`);
  }

  // Cleanup
  await clearCircuit();
  return passed;
}

async function fix3_albumPageRendersBasicRow() {
  console.log('\n━━━ FIX 3: Album page renders with basic-row only ━━━\n');

  // After fix 1 ran, there are basic rows in the DB (no tracklist, no genres).
  // Pick one and load the album page; it should return 200 not 404.
  // Use the same query as fix 1 — those rows should still be there.
  const cacheKey = `search:albums:back country rock:y=:m=`;
  await redis.del(cacheKey);
  await clearCircuit();

  const sres = await fetch(`${BASE}/api/search?query=BACK%20COUNTRY%20ROCK`);
  const body = await sres.json() as { releases: Array<{ id: string }> };
  if (body.releases.length === 0) {
    console.log('  ⚠ No probe releases available. Skip.');
    return false;
  }

  // Wait for fire-and-forget upsert
  await new Promise(r => setTimeout(r, 1500));

  const probeId = body.releases[0].id;

  // Clear the spotify album cache so the page falls through to either
  // Spotify or getBasicRelease (not the Redis cache)
  await redis.del(`spotify:album:${probeId}`);

  // Open the circuit to force getBasicRelease path
  await setCircuit(120);

  const t0 = Date.now();
  const res = await fetch(`${BASE}/album/${probeId}`);
  const ms = Date.now() - t0;
  console.log(`  /album/${probeId} (circuit open, basic-row only): status ${res.status} in ${ms}ms`);

  if (res.status === 200) {
    // Check the HTML contains the artist name to confirm it actually rendered
    const html = await res.text();
    const hasTitle = /<h1/.test(html);
    console.log(`     HTML contains <h1>: ${hasTitle ? 'yes' : 'NO'} (size: ${html.length}b)`);
    await clearCircuit();
    return hasTitle && ms < 5000;
  }

  await clearCircuit();
  return false;
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  404-fix verification');
  console.log(`  Base URL: ${BASE}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const r1 = await fix1_saveBasicReleasesOnSearch();
  const r2 = await fix2_circuitBreakerShortCircuits();
  const r3 = await fix3_albumPageRendersBasicRow();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Fix 1 (search → DB writeback):       ${r1 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Fix 2 (circuit breaker fires):       ${r2 ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`  Fix 3 (basic-row page renders):      ${r3 ? '✓ PASS' : '✗ FAIL'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Cleanup: make sure circuit is closed before exiting
  await clearCircuit();
}

main().catch(err => { console.error(err); process.exit(1); });
