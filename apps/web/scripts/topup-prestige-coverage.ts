/**
 * Coverage-first prestige top-up (Windows action item flagged by the 2026-07-06 Mac handoff).
 *
 * The Charts unlock gate (get_rankings_unlock_status, migration 20260706000000) requires BOTH
 * 10,000 album rating events AND 350 prestige-pool albums with ≥3 ratings. The initial bot seeding
 * concentrated on the ~380-album critic canon, so the broader prestige pool (1,589 albums) was
 * under-covered (213/350). External reviews all flagged the real fix as seeding ORDER: rate the
 * zero/low-coverage prestige albums first instead of re-rating already-popular ones.
 *
 * This script does exactly that — walks prestige albums coverage-first (0-rated first), tops each to
 * a small target (3–6 ratings) with quality-anchored scores from origin-matched bots, until the gate
 * is cleared with headroom. Idempotent (skips (bot, album) pairs that already exist), seeded,
 * backdated, dry-runnable.
 *
 *   npx tsx --env-file=.env.local scripts/topup-prestige-coverage.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/topup-prestige-coverage.ts
 */
import { getDB } from './itunes-ingest-core';
import { readFileSync, existsSync } from 'fs';
import { PERSONAS } from './data/bot-personas';
import { reviewFor } from './data/bot-reviews';

const db = getDB();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const ROSTER = `${__dirname}/bot-roster.json`;

// targets (with headroom over the gate's 10,000 / 350)
const EVENTS_TARGET = 10250;
const COVERAGE_TARGET = 400;

interface RosterEntry { user_id: string; username: string; persona: string; bucket: string; created_at: string }
const personaByKey = new Map(PERSONAS.map(p => [p.key, p]));

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r: () => number, m: number, sd: number) { const u = Math.max(1e-9, r()), v = r(); return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const decScore = (x: number) => Math.min(5, Math.max(1, Math.round(x * 10) / 10));

async function pageAll<T>(build: (from: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from).range(from, from + 999);
    if (error) { console.error('  fetch error:', error.message); break; }
    if (!data?.length) break;
    out.push(...data); if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  if (!existsSync(ROSTER)) { console.error('No bot-roster.json'); process.exit(1); }
  const roster: RosterEntry[] = JSON.parse(readFileSync(ROSTER, 'utf8'));
  const botById = new Map(roster.map(b => [b.user_id, b]));
  const botsByBucket: Record<string, RosterEntry[]> = { ko: [], ja: [], western: [] };
  for (const b of roster) (botsByBucket[b.bucket] ?? botsByBucket.western).push(b);
  console.log(`\n  Prestige coverage top-up — ${roster.length} bots${DRY ? '  [DRY RUN]' : ''}\n`);

  // prestige pool
  const prestige = await pageAll<{ id: string; prestige_score: number; primary_artist_id: string }>((f) =>
    db.from('release_groups').select('id, prestige_score, primary_artist_id').not('prestige_score', 'is', null).not('cover_url', 'is', null));
  console.log(`  prestige albums (with cover): ${prestige.length}`);

  // artist origin (bucket) for the prestige albums — for origin-matched raters
  const artistIds = [...new Set(prestige.map(r => r.primary_artist_id).filter(Boolean))];
  const lang = new Map<string, string>();
  for (let i = 0; i < artistIds.length; i += 200) {
    const { data } = await db.from('artists').select('id, native_language').in('id', artistIds.slice(i, i + 200));
    for (const a of (data ?? []) as any[]) lang.set(a.id, a.native_language);
  }
  const bucketOf = (r: { primary_artist_id: string }) => { const l = lang.get(r.primary_artist_id); return l === 'ko' ? 'ko' : l === 'ja' ? 'ja' : 'western'; };

  // current per-album score-rating counts + existing (user, rg) pairs
  const ratings = await pageAll<{ user_id: string; release_group_id: string; score: number | null }>((f) =>
    db.from('ratings').select('user_id, release_group_id, score'));
  const scoreCount = new Map<string, number>();       // score-not-null count per rg (coverage metric)
  const ratedPair = new Set<string>();                // user|rg (any rating)
  let events = 0;
  for (const r of ratings) {
    if (r.score != null) scoreCount.set(r.release_group_id, (scoreCount.get(r.release_group_id) ?? 0) + 1);
    if (r.score != null) events++;
    ratedPair.add(r.user_id + '|' + r.release_group_id);
  }
  const covered0 = prestige.filter(r => (scoreCount.get(r.id) ?? 0) >= 3).length;
  console.log(`  start: events=${events}, prestige covered(≥3)=${covered0}`);
  console.log(`  targets: events≥${EVENTS_TARGET}, coverage≥${COVERAGE_TARGET}\n`);

  // coverage-first order: fewest current ratings first, then highest prestige
  const order = [...prestige].sort((a, b) =>
    (scoreCount.get(a.id) ?? 0) - (scoreCount.get(b.id) ?? 0) || (b.prestige_score - a.prestige_score));

  const rand = rng(20260706);
  let covered = covered0, addedEvents = 0, addedRows = 0, touched = 0;
  const rows: any[] = [];
  for (const rg of order) {
    if (events + addedEvents >= EVENTS_TARGET && covered >= COVERAGE_TARGET) break;
    const cur = scoreCount.get(rg.id) ?? 0;
    const desired = Math.min(6, Math.max(3, Math.round(gauss(rand, 4, 1))));
    if (cur >= desired) continue;
    const bucket = bucketOf(rg);
    const pool = botsByBucket[bucket].length >= 4 ? botsByBucket[bucket] : roster;
    let need = desired - cur, guard = 0;
    const q = rg.prestige_score;                       // acclaim anchor (prestige = critical acclaim)
    while (need > 0 && guard++ < pool.length * 2) {
      const bot = pool[Math.floor(rand() * pool.length)];
      const key = bot.user_id + '|' + rg.id;
      if (ratedPair.has(key)) continue;
      ratedPair.add(key);
      const p = personaByKey.get(bot.persona)!;
      const sc = decScore(2.6 + q * 2.0 + (p.harshness.mean - 3.95) + gauss(rand, 0, p.harshness.sd * 0.5));
      const start = new Date(bot.created_at).getTime(), span = Math.max(1, Date.now() - start);
      rows.push({
        user_id: bot.user_id, release_group_id: rg.id, score: sc,
        review_text: reviewFor(p, sc, rand), status: 'Listened',
        created_at: new Date(start + span * Math.pow(rand(), 0.6)).toISOString(),
      });
      need--; addedEvents++; addedRows++;
    }
    const newCount = cur + (desired - cur - need);
    if (cur < 3 && newCount >= 3) covered++;
    touched++;
  }

  console.log(`  planned: +${addedRows} ratings across ${touched} prestige albums`);
  console.log(`  → events ${events} → ${events + addedEvents}   coverage ${covered0} → ${covered}`);
  if (DRY) { console.log('\n  [DRY RUN] nothing written\n'); return; }

  console.log('\n  writing…');
  let ok = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('ratings').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,release_group_id', ignoreDuplicates: true });
    if (error) { console.warn(`  ! ${error.message}`); break; }
    ok += rows.slice(i, i + 500).length;
  }
  console.log(`  inserted ~${ok} ratings\n  DONE\n`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
