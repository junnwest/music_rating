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
import { reviewFor } from './data/bot-reviews';

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
  console.log(`  pools: west=${westPool.length} ko=${koPool.length} ja=${jaPool.length} | commercial K/J artists=${commercialArtists.size}`);

  // SHARED CANON — a small, per-bucket focal set drawn from the CRITICAL external scores (the honest
  // critic signal, already ranked by critic breadth). Every bot rates a high fraction of its bucket's
  // canon → many bots converge on the same albums → album pages / charts show real depth instead of
  // one rating apiece. Western is capped so it stays concentrated rather than smeared across 1000+.
  async function criticCanon(scope: string, cap: number): Promise<Set<string>> {
    const { data, error } = await db.rpc('get_critics_picks', { p_limit: cap, p_scope: scope });
    if (error) { console.warn(`  ! canon ${scope}: ${error.message}`); return new Set(); }
    return new Set((data ?? []).map((d: any) => d.release_id as string));
  }
  const canonIds: Record<'ko' | 'ja' | 'western', Set<string>> = {
    ko: await criticCanon('korean', 150),
    ja: await criticCanon('japanese', 60),
    western: await criticCanon('western', 280),
  };
  console.log(`  canon: ko=${canonIds.ko.size} ja=${canonIds.ja.size} western=${canonIds.western.size}\n`);

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
  // Per-persona weighting (memoized). `pres` = the prestige tier (used to top up a thin canon);
  // `fullCum` = the whole pool weighted by latent quality (the discovery tail draws from this,
  // with any commercial/idol K/J catalog down-weighted for anti-commercial personas).
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
  // Score an album for a persona: anchored to quality, shifted by persona harshness, plus noise.
  function scoreFor(p: Persona, r: RG, rand: () => number): number {
    const q = qFor(p, r);                             // acclaim (W/mainstream) or latent (anti-commercial K/J)
    const base = 2.3 + q * 2.2;                       // [2.3, 4.5]
    const bias = p.harshness.mean - 3.95;             // stan ≈ +0.35, critic ≈ −0.55
    return decScore(base + bias + gauss(rand, 0, p.harshness.sd * 0.55));
  }
  // The persona's slice of the shared canon (canon ∩ its pool). If that intersection is thin (niche
  // genre), supplement with the pool's own prestige tier — still a set shared by all bots of the
  // persona (w is memoized per key), so overlap is preserved.
  function personaCanon(p: Persona, w: WT): RG[] {
    const ids = canonIds[p.bucket];
    let c = w.pool.filter(r => ids.has(r.id));
    if (c.length < 25) c = c.concat(w.pres.slice(0, 60).filter(r => !ids.has(r.id)));
    return c;
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
    const picks = new Map<string, RG>();
    // 1) CANON CORE — include each canon album with high prob → many bots hit the SAME albums (depth).
    const canon = personaCanon(p, w);
    const canonInclude = 0.55 + 0.25 * rand();               // 55–80% of the shared canon, per bot
    for (const r of canon) if (rand() < canonInclude) picks.set(r.id, r);
    // 2) DISCOVERY TAIL — individual flavor from the broad pool (latent-quality weighted → underground).
    const tail = Math.max(15, Math.round(gauss(rand, 26, 8)));
    const tailTarget = picks.size + tail;
    let guard = 0;
    while (picks.size < tailTarget && picks.size < w.pool.length && guard++ < tail * 30) {
      const r = w.pool[bsearch(w.fullCum, rand() * w.fullTot)];
      if (!picks.has(r.id)) picks.set(r.id, r);
    }
    const start = new Date(bot.created_at).getTime(), span = Math.max(1, Date.now() - start);
    const rows = [...picks.values()].map(r => {
      const sc = scoreFor(p, r, rand);
      return {
        user_id: bot.user_id, release_group_id: r.id, score: sc,
        review_text: reviewFor(p, sc, rand),           // language-matched to persona bucket; usually null
        status: 'Listened', elo_games: 0,
        // Backdated signup→now, gently biased toward recent (rand^0.65) so the population reads as an
        // app gaining traction, not a uniform dump — and the feed/trending have fresh activity.
        created_at: new Date(start + span * Math.pow(rand(), 0.65)).toISOString(),
      };
    });
    // Don't let one bot post the exact same review line twice (reads bot-like) — null the repeats.
    const seenRev = new Set<string>();
    for (const r of rows) {
      if (!r.review_text) continue;
      if (seenRev.has(r.review_text)) r.review_text = null;
      else seenRev.add(r.review_text);
    }

    if (DRY) {
      const dist = rows.reduce((m: Record<string, number>, r) => (m[r.score] = (m[r.score] ?? 0) + 1, m), {});
      const avg = (rows.reduce((s, r) => s + r.score, 0) / rows.length).toFixed(2);
      const revs = rows.filter(r => r.review_text);
      console.log(`  [${p.key}] ${bot.username}: ${rows.length} ratings (canon ${canon.length}), avg ${avg}, ${revs.length} reviews`);
      for (const r of revs.slice(0, 2)) console.log(`        “${r.review_text}”  (${r.score})`);
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
