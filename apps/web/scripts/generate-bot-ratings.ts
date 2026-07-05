/**
 * Generates persona-weighted ratings for the bot population (HANDOFF-WINDOWS.md item 4).
 *
 * For each bot: sample ~80 albums from its persona's content pool (× prestige affinity), score each
 * from the persona's harshness curve, and insert into `ratings` with status='Listened' and an
 * explicit BACKDATED created_at spread across weeks (service role can set created_at directly, unlike
 * the app). Resumable/checkpointed per bot.
 *
 * Content pools (per the catalog-composition finding — origin for K/J, genre tags for Western):
 *   • ko / ja  → release_groups whose primary artist is native_language ko/ja (reliable), cover set.
 *   • western  → release_groups whose genres[] match the persona's genre-tag substrings, cover set.
 *   • prestige → RGs with prestige_score (canon), used per-pick with probability = prestigeAffinity.
 * Only albums WITH a cover are sampled, so bot-rated cards never render broken.
 *
 *   npx tsx --env-file=.env.local scripts/generate-bot-ratings.ts --dry-run --limit=5
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

// Seeded PRNG + gaussian, so a bot's ratings are reproducible across resumes.
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(rand: () => number, mean: number, sd: number) { const u = Math.max(1e-9, rand()), v = rand(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const halfStar = (x: number) => Math.min(5, Math.max(0.5, Math.round(x * 2) / 2));
function seedFrom(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

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

async function artistIdsByLang(lang: string): Promise<Set<string>> {
  const rows = await pageAll<{ id: string }>((from) => db.from('artists').select('id').eq('native_language', lang));
  return new Set(rows.map(r => r.id));
}

async function main() {
  if (!existsSync(ROSTER)) { console.error('No bot-roster.json — run create-bots.ts first.'); process.exit(1); }
  const roster: RosterEntry[] = JSON.parse(readFileSync(ROSTER, 'utf8'));
  console.log(`\n  Bot ratings — ${roster.length} bots${DRY ? '  [DRY RUN]' : ''}${LIMIT < Infinity ? `  [limit ${LIMIT}]` : ''}\n`);

  // ── Build content pools once ──
  console.log('  building content pools…');
  const [koIds, jaIds] = [await artistIdsByLang('ko'), await artistIdsByLang('ja')];
  const koArr = [...koIds], jaArr = [...jaIds];
  const poolByArtist = async (ids: string[]): Promise<RG[]> => {
    const out: RG[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const rows = await pageAll<RG>((from) => db.from('release_groups').select('id, prestige_score, genres')
        .in('primary_artist_id', slice).not('cover_url', 'is', null).in('release_group_type', ['album', 'ep']));
      out.push(...rows);
    }
    return out;
  };
  const koPool = await poolByArtist(koArr);
  const jaPool = await poolByArtist(jaArr);
  // Western pool: album/EP with cover + genres; filtered per-persona in JS by genre-tag substring.
  const westPool = await pageAll<RG & { primary_artist_id: string }>((from) => db.from('release_groups')
    .select('id, prestige_score, genres, primary_artist_id')
    .not('cover_url', 'is', null).not('genres', 'is', null).in('release_group_type', ['album', 'ep']));
  const westOnly = westPool.filter(r => !koIds.has((r as any).primary_artist_id) && !jaIds.has((r as any).primary_artist_id));
  const prestigePool = (rgs: RG[]) => rgs.filter(r => r.prestige_score != null);
  console.log(`  pools: ko=${koPool.length} ja=${jaPool.length} west=${westOnly.length} (prestige-in-west=${prestigePool(westOnly).length})\n`);

  const matchGenre = (r: RG, filters: string[]) => Array.isArray(r.genres) && r.genres.some(g => filters.some(f => g.toLowerCase().includes(f)));
  function personaPool(p: Persona): RG[] {
    if (p.bucket === 'ko') { const sub = p.genreSubFilter ? koPool.filter(r => matchGenre(r, p.genreSubFilter!)) : []; return sub.length >= 60 ? sub : koPool; }
    if (p.bucket === 'ja') { const sub = p.genreSubFilter ? jaPool.filter(r => matchGenre(r, p.genreSubFilter!)) : []; return sub.length >= 60 ? sub : jaPool; }
    return westOnly.filter(r => matchGenre(r, p.genreFilters!));
  }

  const done = loadState();
  let processed = 0, inserted = 0;
  for (const bot of roster) {
    if (processed >= LIMIT) break;
    if (done.has(bot.user_id)) continue;
    const p = personaByKey.get(bot.persona); if (!p) continue;
    const pool = personaPool(p), pres = prestigePool(pool);
    if (!pool.length) { console.warn(`  ! ${bot.username}: empty pool (${p.key})`); done.add(bot.user_id); processed++; continue; }

    const rand = rng(seedFrom(bot.user_id));
    const nRatings = Math.round(gauss(rand, 80, 18));
    const target = Math.max(30, Math.min(140, nRatings));
    const picks = new Set<string>();
    let guard = 0;
    while (picks.size < target && guard++ < target * 20) {
      const usePres = pres.length > 5 && rand() < p.prestigeAffinity;
      const src = usePres ? pres : pool;
      picks.add(src[Math.floor(rand() * src.length)].id);
    }
    // Ratings backdated between the bot's signup and ~now, spread (not one burst).
    const start = new Date(bot.created_at).getTime();
    const span = Math.max(1, Date.now() - start);
    const rows = [...picks].map(rgId => ({
      user_id: bot.user_id, release_group_id: rgId,
      score: halfStar(gauss(rand, p.harshness.mean, p.harshness.sd)),
      status: 'Listened', elo_games: 0,
      created_at: new Date(start + rand() * span).toISOString(),
    }));

    if (DRY) {
      const dist = rows.reduce((m: Record<string, number>, r) => (m[r.score] = (m[r.score] ?? 0) + 1, m), {});
      console.log(`  [${p.key}] ${bot.username}: ${rows.length} ratings, score dist ${JSON.stringify(dist)}`);
    } else {
      // insert in chunks; ignore unique (user,rg) conflicts so a partial prior run is safe
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
