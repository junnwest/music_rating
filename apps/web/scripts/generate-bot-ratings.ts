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
interface RG { id: string; prestige_score: number | null; genres: string[] | null; primary_artist_id?: string }

const personaByKey = new Map(PERSONAS.map(p => [p.key, p]));
const loadState = (): Set<string> => { try { return new Set(existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')).done : []); } catch { return new Set(); } };
const saveState = (s: Set<string>) => writeFileSync(STATE, JSON.stringify({ done: [...s] }, null, 0));

// Seeded PRNG + gaussian → a bot's ratings are reproducible across resumes.
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rand: () => number, mean: number, sd: number) { const u = Math.max(1e-9, rand()), v = rand(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const decScore = (x: number) => Math.min(5, Math.max(1, Math.round(x * 10) / 10)); // 0.1 granularity, not half-stars
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
    out.push(...await pageAll<RG>((f) => db.from('release_groups').select('id, prestige_score, genres, primary_artist_id')
      .in('primary_artist_id', ids.slice(i, i + 100)).not('cover_url', 'is', null).in('release_group_type', ['album', 'ep'])));
  }
  return out;
}

const matchGenre = (r: RG, filters: string[]) => Array.isArray(r.genres) && r.genres.some(g => filters.some(f => g.toLowerCase().includes(f)));

async function main() {
  if (!existsSync(ROSTER)) { console.error('No bot-roster.json — run create-bots.ts first.'); process.exit(1); }
  const roster: RosterEntry[] = JSON.parse(readFileSync(ROSTER, 'utf8'));
  console.log(`\n  Bot ratings (notable-only, quality-anchored) — ${roster.length} bots${DRY ? '  [DRY RUN]' : ''}${LIMIT < Infinity ? `  [limit ${LIMIT}]` : ''}\n`);

  console.log('  building content pools…');
  const koIds = new Set(await artistIds('ko'));
  const jaIds = new Set(await artistIds('ja'));
  const koPool = await poolByArtist([...koIds]);
  const jaPool = await poolByArtist([...jaIds]);
  // BROAD western pool: all non-K/J album/EP with a cover + genres — prestige AND the underground
  // long-tail (the balanced-coverage requirement). Weighting keeps prestige prominent; the tail adds
  // discovery. Exclude K/J primary artists (they belong to the ko/ja pools).
  const westRaw = await pageAll<RG & { primary_artist_id: string }>((f) => db.from('release_groups')
    .select('id, prestige_score, genres, primary_artist_id')
    .not('cover_url', 'is', null).not('genres', 'is', null).in('release_group_type', ['album', 'ep']));
  const westPool: RG[] = westRaw.filter(r => !koIds.has((r as any).primary_artist_id) && !jaIds.has((r as any).primary_artist_id));
  // Korean/Japanese artists who have ANY commercial-prestige album = idol/commercial acts. Their
  // WHOLE catalog (incl. non-prestige EPs) is down-weighted for anti-commercial personas — otherwise
  // prolific idols dominate by album count even after per-album prestige penalties.
  const commercialArtists = new Set<string>();
  for (const r of [...koPool, ...jaPool]) if (r.prestige_score != null && r.primary_artist_id) commercialArtists.add(r.primary_artist_id);
  console.log(`  pools: west=${westPool.length} ko=${koPool.length} ja=${jaPool.length} | commercial K/J artists=${commercialArtists.size}\n`);

  // Persona → its slice of the pools.
  function personaPool(p: Persona): RG[] {
    if (p.bucket === 'ko') { const sub = p.genreSubFilter ? koPool.filter(r => matchGenre(r, p.genreSubFilter!)) : []; return sub.length >= 40 ? sub : koPool; }
    if (p.bucket === 'ja') { const sub = p.genreSubFilter ? jaPool.filter(r => matchGenre(r, p.genreSubFilter!)) : []; return sub.length >= 40 ? sub : jaPool; }
    const g = westPool.filter(r => matchGenre(r, p.genreFilters!));       // western: full genre catalog (prestige + tail)
    return g.length >= 50 ? g : westPool;
  }
  // Effective quality for a (persona, album). Western prestige = critical acclaim (good for all).
  // Korean/Japanese prestige = COMMERCIAL chart success: mainstream personas embrace it, but
  // anti-commercial personas ignore it (use latent quality) so they don't pile onto BTS/EXO.
  const qFor = (p: Persona, r: RG) => {
    if (p.bucket === 'western' || p.mainstream) return r.prestige_score != null ? r.prestige_score : latentQuality(r.id);
    return latentQuality(r.id); // anti-commercial K/J persona → ignore commercial prestige
  };
  // TWO-TIER BALANCED sampler (memoized). Each pick is either the PRESTIGE tier (recognizable/
  // acclaimed, weighted by prestige) or the DISCOVERY tier (the whole pool, weighted by latent
  // quality → underground long-tail). `prestigeShare` sets the mix per bucket:
  //   • Western  0.55 — prestige = critical acclaim (RS500/Pitchfork), which this audience likes.
  //   • K/J      0.18 — Korean/Japanese prestige = commercial chart success → keep it a minority.
  //   • mainstream (kpop-stan) 0.70 — embraces the commercial hits.
  // So prestige "somewhat holds" (leads charts) while ~half+ of the feed is discovery.
  const prestigeShare = (p: Persona) => p.mainstream ? 0.70 : p.bucket === 'western' ? 0.55 : 0.18;
  type WT = { pool: RG[]; pres: RG[]; presCum: number[]; presTot: number; fullCum: number[]; fullTot: number };
  const weighted = new Map<string, WT>();
  function weightedFor(p: Persona): WT {
    let w = weighted.get(p.key);
    if (!w) {
      const pool = personaPool(p);
      const pres = pool.filter(r => r.prestige_score != null);
      const presCum: number[] = []; let ps = 0;
      for (const r of pres) { ps += Math.pow(0.2 + (r.prestige_score || 0), 1.5); presCum.push(ps); }
      const fullCum: number[] = []; let fs = 0;
      const acKJ = (p.bucket === 'ko' || p.bucket === 'ja') && !p.mainstream;
      for (const r of pool) {
        let lw = Math.pow(0.2 + latentQuality(r.id), 1.4);
        // anti-commercial: down-weight the WHOLE catalog of any commercial/idol artist (not just their hits)
        if (acKJ && (r.prestige_score != null || (r.primary_artist_id && commercialArtists.has(r.primary_artist_id)))) lw *= 0.2;
        fullCum.push(fs += lw);
      }
      w = { pool, pres, presCum, presTot: ps, fullCum, fullTot: fs };
      weighted.set(p.key, w);
    }
    return w;
  }
  const bsearch = (cum: number[], x: number) => { let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return lo; };
  function wpick(p: Persona, w: WT, rand: () => number): RG {
    if (w.pres.length && rand() < prestigeShare(p)) return w.pres[bsearch(w.presCum, rand() * w.presTot)];
    return w.pool[bsearch(w.fullCum, rand() * w.fullTot)];
  }
  // Score an album for a persona: anchored to quality, shifted by persona harshness, plus noise.
  function scoreFor(p: Persona, r: RG, rand: () => number): number {
    const q = qFor(p, r);                             // acclaim (W/mainstream) or latent (anti-commercial K/J)
    const base = 2.3 + q * 2.2;                       // [2.3, 4.5]
    const bias = p.harshness.mean - 3.95;             // stan ≈ +0.35, critic ≈ −0.55
    return decScore(base + bias + gauss(rand, 0, p.harshness.sd * 0.55));
  }

  const done = loadState();
  let processed = 0, inserted = 0;
  for (const bot of roster) {
    if (processed >= LIMIT) break;
    if (done.has(bot.user_id)) continue;
    const p = personaByKey.get(bot.persona); if (!p) continue;
    const w = weightedFor(p);
    if (!w.pool.length) { console.warn(`  ! ${bot.username}: empty pool (${p.key})`); done.add(bot.user_id); processed++; continue; }

    const rand = rng(seedFrom(bot.user_id));
    const target = Math.max(30, Math.min(140, Math.round(gauss(rand, 80, 18))));
    const picks = new Map<string, RG>();
    let guard = 0;
    while (picks.size < target && picks.size < w.pool.length && guard++ < target * 25) {
      const r = wpick(p, w, rand);         // two-tier: prestige (recognizable) + discovery (underground)
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
