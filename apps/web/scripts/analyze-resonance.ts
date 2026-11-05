/**
 * Read-only: first measurement of "resonance" (RESONANCE_PLAN.md).
 *
 * Resonance(user, album) = z(user's score) − E[z | the user's own taste model, the crowd]
 *
 *   z            score standardized per user (mean / sd of that user's scores)
 *   self model   leave-one-out kNN over the user's OTHER rated albums, in three
 *                representations: jina-v3 text embedding (release_groups.embedding),
 *                genre co-occurrence centroid (lib/taste/embeddings albumCentroid),
 *                and same-artist prior. Shrunk toward 0 (= the user's mean).
 *   crowd        mean z of other raters of the same album (shrunk by n/(n+2))
 *
 * Prints: per-predictor LOO skill (is there any "expected" signal to subtract?),
 * a test-retest noise floor from rating_history, robustness of the top lists
 * across predictor variants, behavioural correlates (reviewed / re-rated), and
 * the top positive / negative resonance albums for the --users accounts.
 *
 * Never writes. Secrets come from env only.
 *
 *   npx tsx --env-file=.env.local scripts/analyze-resonance.ts [--users=zero,junnwest,one] [--k=7] [--top=10] [--min-pool=15]
 */
import { createClient } from '@supabase/supabase-js';
import { albumCentroid, cosine } from '../lib/taste/embeddings';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const USERS = (arg('users') ?? 'zero,junnwest,one').split(',').map((s) => s.trim()).filter(Boolean);
const K = Number(arg('k') ?? 7);
const TOP = Number(arg('top') ?? 10);
const MIN_POOL = Number(arg('min-pool') ?? 15); // users with ≥ this many ratings enter the pooled stats
const SD_FLOOR = 0.3; // score points; stops a user who rates everything 4.0 from exploding z
const SHRINK = 1.0; // kNN prior weight toward the user's mean (in similarity units)

// ── types ────────────────────────────────────────────────────────────────────
interface RatingRow {
  user_id: string;
  release_group_id: string;
  score: number | string | null;
  created_at: string;
  updated_at: string | null;
  review_text: string | null;
  note: string | null;
}
interface RgRow {
  id: string;
  title: string;
  artist_display: string | null;
  primary_artist_id: string | null;
  first_release_date: string | null;
  genres: string[] | null;
  prestige_score: number | null;
}
interface Item {
  rg: string;
  score: number;
  z: number;
  createdAt: string;
  reviewed: boolean;
  reRates: number; // rating_history rows beyond the first
  artist: string | null;
  jina: number[] | null;
  genre: number[] | null;
  prestige: number | null;
  crowdZ: number | null;
  crowdN: number;
  pred: Record<Pred, number>;
}
type Pred = 'mean' | 'artist' | 'jina' | 'jinaXA' | 'genre' | 'genreXA' | 'soundXA' | 'self' | 'full' | 'rec';
const PREDS: Pred[] = ['mean', 'artist', 'jina', 'jinaXA', 'genre', 'genreXA', 'soundXA', 'self', 'full', 'rec'];

// ── io ───────────────────────────────────────────────────────────────────────
async function retry<T>(label: string, fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  let last = '';
  for (let i = 0; i < 4; i++) {
    const { data, error } = await fn();
    if (!error) return data as T;
    last = error.message;
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw new Error(`${label}: ${last}`);
}

async function pageAll<T>(label: string, build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = await retry<T[]>(label, () => build(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function parseVector(v: unknown): number[] | null {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v !== 'string') return null;
  try {
    const arr = JSON.parse(v) as unknown;
    return Array.isArray(arr) ? arr.map(Number) : null;
  } catch {
    return null;
  }
}

function unit(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

// ── stats ────────────────────────────────────────────────────────────────────
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let t = i; t <= j; t++) r[idx[t][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    dbb += (b[i] - mb) ** 2;
  }
  return da === 0 || dbb === 0 ? NaN : num / Math.sqrt(da * dbb);
}
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));
const fmt = (x: number, d = 2) => (Number.isFinite(x) ? (x >= 0 ? ' ' : '') + x.toFixed(d) : '  n/a');

/** Shrunk similarity-weighted kNN over `pool` (z-values), toward 0 = user mean. */
function knn(target: number[] | null, pool: { v: number[] | null; z: number }[], k: number): number {
  if (!target) return 0;
  const sims = pool.filter((p) => p.v).map((p) => ({ s: cosine(target, p.v!), z: p.z }));
  sims.sort((a, b) => b.s - a.s);
  let num = 0;
  let den = SHRINK;
  for (const { s, z } of sims.slice(0, k)) {
    const w = Math.max(0, s);
    num += w * z;
    den += w;
  }
  return num / den;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const profiles = await retry<{ id: string; username: string }[]>('profiles', () =>
    db.from('profiles').select('id, username').in('username', USERS),
  );
  const nameOf = new Map(profiles.map((p) => [p.id, p.username]));
  for (const u of USERS) if (![...nameOf.values()].includes(u)) console.warn(`(no profile named ${u})`);

  const ratings = (
    await pageAll<RatingRow>('ratings', (f, t) =>
      db.from('ratings').select('user_id, release_group_id, score, created_at, updated_at, review_text, note').order('id').range(f, t),
    )
  ).filter((r) => r.score != null && r.release_group_id);

  const history = await pageAll<{ user_id: string; release_group_id: string; score: number | string; recorded_at: string }>('rating_history', (f, t) =>
    db.from('rating_history').select('user_id, release_group_id, score, recorded_at').order('id').range(f, t),
  );

  // Per-user z-scoring.
  const byUser = new Map<string, RatingRow[]>();
  for (const r of ratings) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id)!.push(r);
  }
  const uStat = new Map<string, { m: number; s: number }>();
  for (const [u, rs] of byUser) {
    const xs = rs.map((r) => Number(r.score));
    uStat.set(u, { m: mean(xs), s: Math.max(SD_FLOOR, sd(xs)) });
  }
  const zOf = (u: string, score: number) => (score - uStat.get(u)!.m) / uStat.get(u)!.s;

  // Crowd: other raters' z by album.
  const crowd = new Map<string, { user: string; z: number }[]>();
  for (const r of ratings) {
    if (!crowd.has(r.release_group_id)) crowd.set(r.release_group_id, []);
    crowd.get(r.release_group_id)!.push({ user: r.user_id, z: zOf(r.user_id, Number(r.score)) });
  }

  // Release-group metadata + embeddings for every rated album (≈ a few hundred).
  const rgIds = [...new Set(ratings.map((r) => r.release_group_id))];
  const rgs = new Map<string, RgRow>();
  const jina = new Map<string, number[]>();
  for (const ch of chunks(rgIds, 100)) {
    const rows = await retry<RgRow[]>('release_groups', () =>
      db.from('release_groups').select('id, title, artist_display, primary_artist_id, first_release_date, genres, prestige_score').in('id', ch),
    );
    for (const r of rows) rgs.set(r.id, r);
  }
  for (const ch of chunks(rgIds, 25)) {
    const rows = await retry<{ id: string; embedding: unknown }[]>('embeddings', () =>
      db.from('release_groups').select('id, embedding').in('id', ch).not('embedding', 'is', null),
    );
    for (const r of rows) {
      const v = parseVector(r.embedding);
      if (v) jina.set(r.id, unit(v));
    }
  }

  // History: re-rate counts + test-retest spread.
  const histBy = new Map<string, number[]>();
  for (const h of history) {
    const k = `${h.user_id}|${h.release_group_id}`;
    if (!histBy.has(k)) histBy.set(k, []);
    histBy.get(k)!.push(Number(h.score));
  }

  // Build items per user (only users with enough ratings for a self model).
  const items = new Map<string, Item[]>();
  const soundGate = new Map<string, boolean>();
  for (const [u, rs] of byUser) {
    const base: Item[] = rs.map((r) => {
      const rg = rgs.get(r.release_group_id);
      const others = (crowd.get(r.release_group_id) ?? []).filter((c) => c.user !== u);
      const h = histBy.get(`${u}|${r.release_group_id}`) ?? [];
      return {
        rg: r.release_group_id,
        score: Number(r.score),
        z: zOf(u, Number(r.score)),
        createdAt: r.created_at,
        reviewed: !!(r.review_text?.trim() || r.note?.trim()),
        reRates: Math.max(0, h.length - 1),
        artist: rg?.primary_artist_id ?? null,
        jina: jina.get(r.release_group_id) ?? null,
        genre: albumCentroid(rg?.genres ?? null),
        prestige: rg?.prestige_score ?? null,
        crowdZ: others.length ? mean(others.map((o) => o.z)) : null,
        crowdN: others.length,
        pred: { mean: 0, artist: 0, jina: 0, jinaXA: 0, genre: 0, genreXA: 0, soundXA: 0, self: 0, full: 0, rec: 0 },
      };
    });
    // Leave-one-out predictions.
    for (const it of base) {
      const rest = base.filter((x) => x !== it);
      const sameArtist = rest.filter((x) => x.artist && x.artist === it.artist);
      const pArtist = sameArtist.length ? (mean(sameArtist.map((x) => x.z)) * sameArtist.length) / (sameArtist.length + 1) : 0;
      const pJina = knn(it.jina, rest.map((x) => ({ v: x.jina, z: x.z })), K);
      const otherArtists = rest.filter((x) => !(x.artist && x.artist === it.artist));
      const pJinaXA = knn(it.jina, otherArtists.map((x) => ({ v: x.jina, z: x.z })), K);
      const pGenre = knn(it.genre, rest.map((x) => ({ v: x.genre, z: x.z })), K);
      const pGenreXA = knn(it.genre, otherArtists.map((x) => ({ v: x.genre, z: x.z })), K);
      const xa = [it.jina ? pJinaXA : null, it.genre ? pGenreXA : null].filter((x): x is number => x != null);
      const pSoundXA = xa.length ? mean(xa) : 0;
      // Self model, fixed a priori (no per-user selection): mean of the available representations.
      const parts = [it.jina ? pJina : null, it.genre ? pGenre : null, sameArtist.length ? pArtist : null].filter((x): x is number => x != null);
      const pSelf = parts.length ? mean(parts) : 0;
      const wc = it.crowdN / (it.crowdN + 2);
      const pFull = it.crowdZ != null ? (pSelf + wc * it.crowdZ) / (1 + wc) : pSelf;
      it.pred = { mean: 0, artist: pArtist, jina: pJina, jinaXA: pJinaXA, genre: pGenre, genreXA: pGenreXA, soundXA: pSoundXA, self: pSelf, full: pFull, rec: 0 };
    }
    // RECOMMENDED definition (RESONANCE_PLAN.md D1): expectation = cross-artist sound kNN, used only
    // if it has held-out skill for this user (bootstrap 5% bound > 0), plus the shrunk crowd mean.
    // Same-artist prior is deliberately NOT subtracted: artist loyalty is resonance, not expectation.
    const gate = base.length >= MIN_POOL && skillCI(base, 'soundXA')[0] > 0;
    soundGate.set(u, gate);
    for (const it of base) {
      const wc = it.crowdZ != null ? it.crowdN / (it.crowdN + 2) : 0;
      it.pred.rec = ((gate ? it.pred.soundXA : 0) + wc * (it.crowdZ ?? 0)) / (1 + wc);
    }
    items.set(u, base);
  }

  // ── 1. dataset ─────────────────────────────────────────────────────────────
  const albumsRated = crowd.size;
  const multi = [...crowd.values()].filter((c) => c.length >= 2).length;
  console.log(`\n════ Resonance analysis (read-only) — k=${K}, sd floor ${SD_FLOOR}, shrink ${SHRINK} ════`);
  console.log(`scored ratings ${ratings.length} by ${byUser.size} users on ${albumsRated} albums; albums with ≥2 raters: ${multi}`);
  console.log(`rated albums with jina embedding ${[...rgIds].filter((id) => jina.has(id)).length}/${rgIds.length}, with genre centroid ${rgIds.filter((id) => albumCentroid(rgs.get(id)?.genres ?? null)).length}/${rgIds.length}, with prestige_score ${rgIds.filter((id) => rgs.get(id)?.prestige_score != null).length}/${rgIds.length}`);
  console.log(`rating_history rows ${history.length}; (user, album) pairs with ≥2 history rows (re-rated): ${[...histBy.values()].filter((h) => h.length >= 2).length}`);

  // ── 2. predictor skill ─────────────────────────────────────────────────────
  const pooledUsers = [...items.entries()].filter(([, xs]) => xs.length >= MIN_POOL);
  console.log(`\n── Self-model skill (leave-one-out, z units). skill = 1 − MSE/MSE(mean); ρ = Spearman(pred, actual)`);
  console.log(`   users with ≥${MIN_POOL} ratings: ${pooledUsers.length}`);
  const header = `   ${'user'.padEnd(12)} ${'n'.padStart(4)}  ` + PREDS.filter((p) => p !== 'mean').map((p) => `${p.padStart(7)} skill/ρ    `).join('');
  console.log(header);
  const pooledSkill: Record<string, { se: number; se0: number }> = {};
  let anon = 0;
  for (const [u, xs] of pooledUsers) {
    const label = nameOf.get(u) ?? `user#${++anon}`;
    const z = xs.map((x) => x.z);
    const se0 = z.reduce((s, x) => s + x * x, 0);
    const cells = PREDS.filter((p) => p !== 'mean').map((p) => {
      const pr = xs.map((x) => x.pred[p]);
      const se = xs.reduce((s, x) => s + (x.z - x.pred[p]) ** 2, 0);
      pooledSkill[p] = { se: (pooledSkill[p]?.se ?? 0) + se, se0: (pooledSkill[p]?.se0 ?? 0) + se0 };
      return `${fmt(1 - se / se0)}/${fmt(spearman(pr, z))}   `;
    });
    console.log(`   ${label.padEnd(12)} ${String(xs.length).padStart(4)}  ${cells.join('')}`);
  }
  console.log(`   ${'POOLED'.padEnd(12)} ${String(pooledUsers.reduce((s, [, x]) => s + x.length, 0)).padStart(4)}  ` + PREDS.filter((p) => p !== 'mean').map((p) => `${fmt(1 - pooledSkill[p].se / pooledSkill[p].se0)}            `).join(''));

  // ── 3. crowd + critics ─────────────────────────────────────────────────────
  const all = pooledUsers.flatMap(([, xs]) => xs);
  const withCrowd = all.filter((x) => x.crowdZ != null);
  const withCrowd2 = all.filter((x) => x.crowdN >= 2);
  console.log(`\n── Crowd agreement (pooled): ratings with ≥1 other rater ${withCrowd.length}/${all.length}, ≥2: ${withCrowd2.length}`);
  if (withCrowd.length >= 5) console.log(`   Pearson(z, crowd z) = ${fmt(pearson(withCrowd.map((x) => x.z), withCrowd.map((x) => x.crowdZ!)))}  (n=${withCrowd.length})`);
  if (withCrowd2.length >= 5) console.log(`   Pearson(z, crowd z | n≥2) = ${fmt(pearson(withCrowd2.map((x) => x.z), withCrowd2.map((x) => x.crowdZ!)))}  (n=${withCrowd2.length})`);
  const withP = all.filter((x) => x.prestige != null);
  console.log(`   critic prestige_score present on ${withP.length}/${all.length} ratings` + (withP.length >= 5 ? `; Spearman(z, prestige) = ${fmt(spearman(withP.map((x) => x.z), withP.map((x) => x.prestige!)))}` : ''));

  // ── 4. noise floor ─────────────────────────────────────────────────────────
  const reRated: number[] = [];
  const reRatedFirstLast: number[] = [];
  for (const [k, h] of histBy) {
    if (h.length < 2) continue;
    const u = k.split('|')[0];
    const s = uStat.get(u)?.s ?? 1;
    reRated.push(sd(h) / s);
    reRatedFirstLast.push(Math.abs(h[h.length - 1] - h[0]) / s);
  }
  const resid = all.map((x) => x.z - x.pred.full);
  console.log(`\n── Noise floor (rating_history, z units): re-rated pairs ${reRated.length}; within-album sd median ${fmt(median(reRated))}, |last − first| median ${fmt(median(reRatedFirstLast))}, p75 ${fmt(quantile(reRatedFirstLast, 0.75))}`);
  console.log(`   residual (z − full pred) sd ${fmt(sd(resid))}; share of |residual| > 1.0: ${((100 * resid.filter((r) => Math.abs(r) > 1).length) / resid.length).toFixed(0)}%`);

  // ── 5. behavioural correlates ──────────────────────────────────────────────
  const rev = all.filter((x) => x.reviewed);
  const nrev = all.filter((x) => !x.reviewed);
  const rr = all.filter((x) => x.reRates > 0);
  const nrr = all.filter((x) => x.reRates === 0);
  const r = (x: Item) => x.z - x.pred.full;
  console.log(`\n── Do people act on resonance? (pooled, residual = z − full pred)`);
  console.log(`   reviewed/noted   n=${String(rev.length).padStart(3)}  mean resid ${fmt(mean(rev.map(r)))}  mean |resid| ${fmt(mean(rev.map((x) => Math.abs(r(x)))))}   vs not n=${nrev.length}: ${fmt(mean(nrev.map(r)))} / ${fmt(mean(nrev.map((x) => Math.abs(r(x)))))}`);
  console.log(`   re-rated         n=${String(rr.length).padStart(3)}  mean resid ${fmt(mean(rr.map(r)))}  mean |resid| ${fmt(mean(rr.map((x) => Math.abs(r(x)))))}   vs not n=${nrr.length}: ${fmt(mean(nrr.map(r)))} / ${fmt(mean(nrr.map((x) => Math.abs(r(x)))))}`);
  console.log(`   (z itself: reviewed ${fmt(mean(rev.map((x) => x.z)))} vs ${fmt(mean(nrev.map((x) => x.z)))}; re-rated ${fmt(mean(rr.map((x) => x.z)))} vs ${fmt(mean(nrr.map((x) => x.z)))})`);

  // ── 6. per-user detail ─────────────────────────────────────────────────────
  for (const name of USERS) {
    const u = [...nameOf.entries()].find(([, n]) => n === name)?.[0];
    const xs = u ? items.get(u) : undefined;
    if (!u || !xs?.length) continue;
    const st = uStat.get(u)!;
    const days = new Set(xs.map((x) => x.createdAt.slice(0, 10))).size;
    console.log(`\n════ ${name}: ${xs.length} ratings, mean ${st.m.toFixed(2)}, sd ${st.s.toFixed(2)}, rated on ${days} distinct days ════`);
    const order = [...xs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    console.log(`   drift: Spearman(rating order, z) = ${fmt(spearman(order.map((_, i) => i), order.map((x) => x.z)))}`);
    const withC = xs.filter((x) => x.crowdZ != null);
    console.log(`   albums with other raters: ${withC.length} (≥2: ${xs.filter((x) => x.crowdN >= 2).length})`);

    const res = (x: Item, p: Pred) => x.z - x.pred[p];
    const ranked = [...xs].sort((a, b) => res(b, 'full') - res(a, 'full'));
    const row = (x: Item) => {
      const rg = rgs.get(x.rg);
      const title = `${(rg?.artist_display ?? '?').slice(0, 22)} — ${(rg?.title ?? '?').slice(0, 34)}`;
      const exp = st.m + x.pred.full * st.s;
      const crowdTxt = x.crowdZ != null ? `crowd ${fmt(x.crowdZ, 1)} (n${x.crowdN})` : '';
      return `   ${fmt(res(x, 'full'))}  ${x.score.toFixed(1)} vs exp ${exp.toFixed(2)}  self ${fmt(x.pred.self)} art ${fmt(x.pred.artist)} jina ${fmt(x.pred.jina)} gen ${fmt(x.pred.genre)} ${crowdTxt.padEnd(16)} ${x.reviewed ? 'R' : ' '}${x.reRates ? `↻${x.reRates}` : '  '} ${title}`;
    };
    console.log(`   resid   score  expected   predictor z's (self = mean of art/jina/genre)    R = reviewed, ↻ = re-rates`);
    console.log(`   ── top ${TOP} positive (hits harder than expected)`);
    for (const x of ranked.slice(0, TOP)) console.log(row(x));
    console.log(`   ── top ${TOP} negative (lands softer than expected)`);
    for (const x of ranked.slice(-TOP).reverse()) console.log(row(x));
    const recRanked = [...xs].sort((a, b) => res(b, 'rec') - res(a, 'rec'));
    const short = (x: Item) => {
      const rg = rgs.get(x.rg);
      return `${fmt(res(x, 'rec'))} ${x.score.toFixed(1)}${x.crowdZ != null ? ` c${fmt(x.crowdZ, 1)}/n${x.crowdN}` : '        '}  ${(rg?.artist_display ?? '?').slice(0, 18)} — ${(rg?.title ?? '?').slice(0, 28)}`;
    };
    console.log(`   ── RECOMMENDED definition (sound gate ${soundGate.get(u) ? 'ON' : 'OFF: no held-out skill'}; crowd shrunk n/(n+2); artist prior not subtracted)`);
    console.log(`      top ${TOP} positive:`);
    for (const x of recRanked.slice(0, TOP)) console.log(`      ${short(x)}`);
    console.log(`      top ${Math.min(5, TOP)} negative:`);
    for (const x of recRanked.slice(-Math.min(5, TOP)).reverse()) console.log(`      ${short(x)}`);
    const crowdMoved = xs.filter((x) => x.crowdZ != null && Math.abs(res(x, 'rec') - x.z) > 0.3).length;
    console.log(`      albums whose resonance differs from raw z by > 0.3: ${crowdMoved}/${xs.length}; Spearman(rec resid, raw z) = ${fmt(spearman(xs.map((x) => res(x, 'rec')), xs.map((x) => x.z)))}`);
    console.log(`   ── for contrast: top ${Math.min(5, TOP)} by raw score`);
    for (const x of [...xs].sort((a, b) => b.z - a.z).slice(0, Math.min(5, TOP))) console.log(row(x));

    // Robustness: does the top list survive predictor changes?
    const topSet = (p: Pred, kk: number) => new Set([...xs].sort((a, b) => res(b, p) - res(a, p)).slice(0, kk).map((x) => x.rg));
    const jac = (a: Set<string>, b: Set<string>) => [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size;
    const T = Math.min(TOP, Math.floor(xs.length / 4));
    const base = topSet('full', T);
    console.log(`   robustness (Jaccard of top-${T} positive vs 'full'): self ${jac(base, topSet('self', T)).toFixed(2)}, jina ${jac(base, topSet('jina', T)).toFixed(2)}, genre ${jac(base, topSet('genre', T)).toFixed(2)}, artist ${jac(base, topSet('artist', T)).toFixed(2)}, raw score ${jac(base, topSet('mean', T)).toFixed(2)}`);
    console.log(`   Spearman(residual_full, raw z) = ${fmt(spearman(xs.map((x) => res(x, 'full')), xs.map((x) => x.z)))}, Spearman(residual_soundXA, raw z) = ${fmt(spearman(xs.map((x) => res(x, 'soundXA')), xs.map((x) => x.z)))}`);
    const ci = (p: Pred) => { const [lo, hi] = skillCI(xs, p); return `[${fmt(lo)}, ${fmt(hi)}]`; };
    console.log(`   skill 90% CI: artist ${ci('artist')}  genreXA ${ci('genreXA')}  jinaXA ${ci('jinaXA')}  soundXA ${ci('soundXA')}  full ${ci('full')}`);
  }
}

/** Bootstrap 90% interval of LOO skill (resampling albums; predictions held fixed). */
function skillCI(xs: Item[], p: Pred): [number, number] {
  const vals: number[] = [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let b = 0; b < 1000; b++) {
    let se = 0;
    let se0 = 0;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[Math.floor(rnd() * xs.length)];
      se += (x.z - x.pred[p]) ** 2;
      se0 += x.z * x.z;
    }
    vals.push(1 - se / se0);
  }
  return [quantile(vals, 0.05), quantile(vals, 0.95)];
}

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
}
function median(xs: number[]): number {
  return quantile(xs, 0.5);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
