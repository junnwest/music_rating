/**
 * Generates persona-weighted ratings for the bot population (HANDOFF-WINDOWS.md item 4).
 *
 * RANKING-AWARE DESIGN (locked with the user 2026-07-05) — so the charts make sense afterward:
 *   • NOTABLE-ONLY universe: bots rate only the prestige canon (RGs with prestige_score) + all
 *     Korean/Japanese album-EPs (by artist origin). The obscure Western long-tail gets ZERO bot
 *     ratings, so it can never top a chart on a lucky rating. Notable albums accumulate real counts.
 *   • QUALITY-ANCHORED scores: each album has a latent quality q∈[0,1] — the real prestige_score
 *     where we have it, else a deterministic per-album value (stable across bots). Bot score =
 *     base(q) + persona harshness bias + noise. So acclaimed albums are rated consistently higher
 *     by everyone → they rise in top_rated (which is now Bayesian, migration 20260705000005);
 *     persona character (stan vs critic) is preserved as a bias + spread, not as random level.
 *   • Cover-only; status='Listened'; created_at backdated from signup→now (a natural ~15% land in
 *     the last 7 days, so `trending` populates too). Resumable/checkpointed per bot.
 *
 *   npx tsx --env-file=.env.local scripts/generate-bot-ratings.ts --dry-run --limit=8
 *   npx tsx --env-file=.env.local scripts/generate-bot-ratings.ts --limit=8   # pilot
 *   npx tsx --env-file=.env.local scripts/generate-bot-ratings.ts
 */
import { getDB } from './itunes-ingest-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { PERSONAS, type Persona } from './data/bot-personas';

const db = getDB();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
const ROSTER = `${__dirname}/bot-roster.json`;
const STATE = `${__dirname}/generate-bot-ratings-state.json`;

interface RosterEntry { user_id: string; username: string; persona: string; bucket: string; created_at: string }
interface RG { id: string; prestige_score: number | null; genres: string[] | null }

const personaByKey = new Map(PERSONAS.map(p => [p.key, p]));
const loadState = (): Set<string> => { try { return new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).done : []); } catch { return new Set(); } };
const saveState = (s: Set<string>) => writeFileSync(STATE, JSON.stringify({ done: [...s] }, null, 0));

// Seeded PRNG + gaussian → a bot's ratings are reproducible across resumes.
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rand: () => number, mean: number, sd: number) { const u = Math.max(1e-9, rand()), v = rand(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const halfStar = (x: number) => Math.min(5, Math.max(0.5, Math.round(x * 2) / 2));
function seedFrom(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// Deterministic latent quality for albums with no prestige signal (K/J): stable across all bots,
// skewed so most notable albums are "decent" (0.35–0.85) rather than uniform.
function latentQuality(id: string) { const u = seedFrom(id) / 4294967296; return 0.30 + 0.60 * (0.5 * u + 0.5 * u * u); }

async function pageAll<T>(build: (from: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from).order('id').range(from, from + 999);
    if (error) { console.error('  fetch error:', error.message); break; }
    if (!data?.length) break;
    out.push(...data); if (data.length < 1000) break;
  }
  return out;
}
async function artistIds(lang: string): Promise<string[]> {
  return (await pageAll<{ id: string }>((f) => db.from('artists').select('id').eq('native_language', lang))).map(r => r.id);
}
async function poolByArtist(ids: string[]): Promise<RG[]> {
  const out: RG[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...await pageAll<RG>((f) => db.from('release_groups').select('id, prestige_score, genres')
      .in('primary_artist_id', ids.slice(i, i + 100)).not('cover_url', 'is', null).in('release_group_type', ['album', 'ep'])));
  }
  return out;
}

const matchGenre = (r: RG, filters: string[]) => Array.isArray(r.genres) && r.genres.some(g => filters.some(f => g.toLowerCase().includes(f)));

async function main() {
  if (!existsSync(ROSTER)) { console.error('No bot-roster.json — run create-bots.ts first.'); process.exit(1); }
  const roster: RosterEntry[] = JSON.parse(readFileSync(ROSTER, 'utf8'));
  console.log(`\n  Bot ratings (notable-only, quality-anchored) — ${roster.length} bots${DRY ? '  [DRY RUN]' : ''}${LIMIT < Infinity ? `  [limit ${LIMIT}]` : ''}\n`);

  console.log('  building notable universe…');
  const koPool = await poolByArtist(await artistIds('ko'));
  const jaPool = await poolByArtist(await artistIds('ja'));
  const prestigePool = await pageAll<RG>((f) => db.from('release_groups').select('id, prestige_score, genres')
    .not('prestige_score', 'is', null).not('cover_url', 'is', null).in('release_group_type', ['album', 'ep']));
  console.log(`  pools: prestige=${prestigePool.length} ko=${koPool.length} ja=${jaPool.length}\n`);

  // Persona → its slice of the notable universe.
  function personaPool(p: Persona): RG[] {
    if (p.bucket === 'ko') { const sub = p.genreSubFilter ? koPool.filter(r => matchGenre(r, p.genreSubFilter!)) : []; return sub.length >= 40 ? sub : koPool; }
    if (p.bucket === 'ja') { const sub = p.genreSubFilter ? jaPool.filter(r => matchGenre(r, p.genreSubFilter!)) : []; return sub.length >= 40 ? sub : jaPool; }
    const g = prestigePool.filter(r => matchGenre(r, p.genreFilters!));  // western: acclaimed canon in-genre
    return g.length >= 30 ? g : prestigePool;
  }
  // Score an album for a persona: anchored to quality, shifted by persona harshness, plus noise.
  function scoreFor(p: Persona, r: RG, rand: () => number): number {
    const q = r.prestige_score != null ? r.prestige_score : latentQuality(r.id);
    const base = 2.3 + q * 2.2;                       // [2.3, 4.5]
    const bias = p.harshness.mean - 3.95;             // stan ≈ +0.45, critic ≈ −0.45
    return halfStar(base + bias + gauss(rand, 0, p.harshness.sd * 0.55));
  }

  const done = loadState();
  let processed = 0, inserted = 0;
  for (const bot of roster) {
    if (processed >= LIMIT) break;
    if (done.has(bot.user_id)) continue;
    const p = personaByKey.get(bot.persona); if (!p) continue;
    const pool = personaPool(p);
    if (!pool.length) { console.warn(`  ! ${bot.username}: empty pool (${p.key})`); done.add(bot.user_id); processed++; continue; }

    const rand = rng(seedFrom(bot.user_id));
    const target = Math.max(30, Math.min(140, Math.round(gauss(rand, 80, 18))));
    const picks = new Map<string, RG>();
    let guard = 0;
    while (picks.size < target && picks.size < pool.length && guard++ < target * 25) {
      const r = pool[Math.floor(rand() * pool.length)];
      if (!picks.has(r.id)) picks.set(r.id, r);
    }
    const start = new Date(bot.created_at).getTime(), span = Math.max(1, Date.now() - start);
    const rows = [...picks.values()].map(r => ({
      user_id: bot.user_id, release_group_id: r.id, score: scoreFor(p, r, rand),
      status: 'Listened', elo_games: 0,
      // Backdated signup→now, gently biased toward recent (rand^0.65) so the population reads as an
      // app gaining traction, not a uniform dump — and the feed/trending have fresh activity.
      created_at: new Date(start + span * Math.pow(rand(), 0.65)).toISOString(),
    }));

    if (DRY) {
      const dist = rows.reduce((m: Record<string, number>, r) => (m[r.score] = (m[r.score] ?? 0) + 1, m), {});
      const avg = (rows.reduce((s, r) => s + r.score, 0) / rows.length).toFixed(2);
      console.log(`  [${p.key}] ${bot.username}: ${rows.length} ratings, avg ${avg}, dist ${JSON.stringify(dist)}`);
    } else {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from('ratings').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,release_group_id', ignoreDuplicates: true });
        if (error) { console.warn(`  ! ${bot.username}: ${error.message}`); break; }
      }
      inserted += rows.length;
    }
    done.add(bot.user_id); processed++;
    if (processed % 10 === 0) { if (!DRY) saveState(done); console.log(`  … ${processed} bots, ~${inserted} ratings`); }
  }
  if (!DRY) saveState(done);
  console.log(`\n  DONE — ${processed} bots processed, ~${inserted} ratings ${DRY ? '(dry)' : 'inserted'}\n`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
