/**
 * Bot-on-bot social graph for the pre-launch population — follows, likes, a few comments — so the
 * feed shows engagement (not 0/0) and Following / Find People aren't empty.
 *
 * SAFETY (locked with the user 2026-07-05):
 *   • BOT-ON-BOT ONLY. Bots never follow/like/comment a REAL user's account or content. Every
 *     like/comment/follow insert fires a notification trigger → a pg_net→APNs push webhook; keeping
 *     recipients to bots (null push_token) means real users get ZERO fake push notifications and the
 *     webhook calls all early-return. (~follows+likes+comments notifications fire, all on bot rows.)
 *   • Bounded volume, backdated into the signup→now window, seeded/reproducible.
 *   • Re-run safe: follows/likes use composite-PK ignoreDuplicates; comments are gated behind an
 *     "already populated" check unless --force (they have no unique constraint).
 *
 *   npx tsx --env-file=.env.local scripts/generate-bot-social.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/generate-bot-social.ts
 */
import { getDB } from './itunes-ingest-core';
import { readFileSync, existsSync } from 'fs';
import { PERSONAS, type Persona } from './data/bot-personas';
import { commentFor } from './data/bot-reviews';

const db = getDB();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const ROSTER = `${__dirname}/bot-roster.json`;

interface RosterEntry { user_id: string; username: string; persona: string; bucket: string; created_at: string }
const personaByKey = new Map(PERSONAS.map(p => [p.key, p]));

// seeded PRNG + gaussian (fixed seed → reproducible run)
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(r: () => number, m: number, sd: number) { const u = Math.max(1e-9, r()), v = r(); return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const bsearch = (cum: number[], x: number) => { let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < x) lo = m + 1; else hi = m; } return lo; };

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
// backdate a social action to between the actor's signup and now, biased recent
const backdate = (fromISO: string, r: () => number) => {
  const start = new Date(fromISO).getTime(), span = Math.max(1, Date.now() - start);
  return new Date(start + span * Math.pow(r(), 0.6)).toISOString();
};

async function main() {
  if (!existsSync(ROSTER)) { console.error('No bot-roster.json — run create-bots.ts first.'); process.exit(1); }
  const roster: RosterEntry[] = JSON.parse(readFileSync(ROSTER, 'utf8'));
  const botIds = new Set(roster.map(b => b.user_id));
  const botById = new Map(roster.map(b => [b.user_id, b]));
  console.log(`\n  Bot social — ${roster.length} bots${DRY ? '  [DRY RUN]' : ''}\n`);

  // Guard against doubling on an accidental re-run (follows/likes are idempotent; comments are not).
  const { count: existingFollows } = await db.from('follows').select('*', { count: 'exact', head: true }).in('follower_id', [...botIds]);
  if ((existingFollows ?? 0) > 100 && !FORCE && !DRY) {
    console.log(`  Bot social already populated (${existingFollows} bot follows). Re-run with --force to add more.\n`); process.exit(0);
  }

  const rand = rng(20260705);

  // ── canon set (for concentrating likes/comments on notable posts) ──
  const canon = new Set<string>();
  for (const scope of ['korean', 'japanese', 'western']) {
    const { data } = await db.rpc('get_critics_picks', { p_limit: 300, p_scope: scope });
    for (const d of (data ?? []) as any[]) canon.add(d.release_id);
  }

  // ── bot-authored ratings only (never target a real user's rating) ──
  type R = { id: string; user_id: string; release_group_id: string; score: number };
  const ratings = (await pageAll<R>((f) => db.from('ratings').select('id, user_id, release_group_id, score'))).filter(r => botIds.has(r.user_id));
  console.log(`  bot ratings: ${ratings.length}, canon albums: ${canon.size}`);

  // ================= FOLLOWS (bot→bot, taste-biased) =================
  const byPersona = new Map<string, string[]>(), byBucket = new Map<string, string[]>();
  for (const b of roster) {
    (byPersona.get(b.persona) ?? byPersona.set(b.persona, []).get(b.persona)!).push(b.user_id);
    (byBucket.get(b.bucket) ?? byBucket.set(b.bucket, []).get(b.bucket)!).push(b.user_id);
  }
  const followSet = new Set<string>();
  const follows: { follower_id: string; following_id: string; created_at: string }[] = [];
  for (const b of roster) {
    const k = Math.max(2, Math.min(11, Math.round(gauss(rand, 5.5, 2.2))));
    let tries = 0;
    let made = 0;
    while (made < k && tries++ < k * 6) {
      const roll = rand();
      const grp = roll < 0.5 ? byPersona.get(b.persona)! : roll < 0.8 ? byBucket.get(b.bucket)! : roster.map(x => x.user_id);
      const target = grp[Math.floor(rand() * grp.length)];
      if (target === b.user_id) continue;
      const key = b.user_id + '|' + target;
      if (followSet.has(key)) continue;
      followSet.add(key);
      follows.push({ follower_id: b.user_id, following_id: target, created_at: backdate(b.created_at, rand) });
      made++;
    }
  }

  // ================= LIKES (bot→bot, concentrated on notable/high-score posts) =================
  const likePool = ratings.filter(r => canon.has(r.release_group_id) || r.score >= 3.9);
  const cum: number[] = []; let tot = 0;
  for (const r of likePool) { const w = Math.pow(Math.max(0.1, r.score - 2), 1.6) * (canon.has(r.release_group_id) ? 2.2 : 1); cum.push(tot += w); }
  const likeTarget = 850;
  const likeSet = new Set<string>();
  const likes: { user_id: string; rating_id: string; created_at: string }[] = [];
  let lguard = 0;
  while (likes.length < likeTarget && lguard++ < likeTarget * 12) {
    const r = likePool[bsearch(cum, rand() * tot)];
    const liker = roster[Math.floor(rand() * roster.length)].user_id;
    if (liker === r.user_id) continue;                 // don't like your own post
    const key = liker + '|' + r.id;
    if (likeSet.has(key)) continue;
    likeSet.add(key);
    likes.push({ user_id: liker, rating_id: r.id, created_at: backdate(botById.get(liker)!.created_at, rand) });
  }

  // ================= COMMENTS (sparse, on notable high-score posts) =================
  const commentPool = ratings.filter(r => canon.has(r.release_group_id) && r.score >= 3.9);
  const commentTarget = 55;
  const comments: { user_id: string; rating_id: string; content: string; created_at: string }[] = [];
  const cSeen = new Set<string>();
  let cguard = 0;
  while (comments.length < commentTarget && cguard++ < commentTarget * 20 && commentPool.length) {
    const r = commentPool[Math.floor(rand() * commentPool.length)];
    const commenter = roster[Math.floor(rand() * roster.length)];
    if (commenter.user_id === r.user_id) continue;
    const key = commenter.user_id + '|' + r.id;
    if (cSeen.has(key)) continue;
    cSeen.add(key);
    const p = personaByKey.get(commenter.persona) as Persona;
    comments.push({ user_id: commenter.user_id, rating_id: r.id, content: commentFor(p, rand), created_at: backdate(commenter.created_at, rand) });
  }

  console.log(`  planned: ${follows.length} follows, ${likes.length} likes, ${comments.length} comments`);
  if (DRY) {
    console.log('\n  sample follows:', follows.slice(0, 3).map(f => botById.get(f.follower_id)!.username + '→' + botById.get(f.following_id)!.username).join(', '));
    console.log('  sample comments:', comments.slice(0, 5).map(c => `“${c.content}”`).join('  '));
    console.log('\n  [DRY RUN] nothing written\n'); process.exit(0);
  }

  const insertChunked = async (table: string, rows: any[], conflict?: string) => {
    let ok = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const q = conflict
        ? db.from(table).upsert(rows.slice(i, i + 500), { onConflict: conflict, ignoreDuplicates: true })
        : db.from(table).insert(rows.slice(i, i + 500));
      const { error } = await q;
      if (error) { console.warn(`  ! ${table}: ${error.message}`); break; }
      ok += rows.slice(i, i + 500).length;
    }
    return ok;
  };

  console.log('\n  writing…');
  console.log(`  follows:  ${await insertChunked('follows', follows, 'follower_id,following_id')}`);
  console.log(`  likes:    ${await insertChunked('rating_likes', likes, 'user_id,rating_id')}`);
  console.log(`  comments: ${await insertChunked('rating_comments', comments)}`);
  console.log('\n  DONE\n');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
