/**
 * Creates the pre-launch bot population (HANDOFF-WINDOWS.md item 3).
 * Parametric over scripts/data/bot-personas.ts — generates N auth.users + profiles per persona with
 * believable handles, is_bot=true, and BACKDATED profile.created_at spread across a pre-launch window
 * (bots shouldn't all share one signup instant). Idempotent/resumable: skips personas already at count
 * by reading existing is_bot profiles. Writes scripts/bot-roster.json (user_id → persona) for the
 * ratings + follows scripts to consume.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY + BOT_PASSWORD in .env.local.
 *
 *   npx tsx --env-file=.env.local scripts/create-bots.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/create-bots.ts --limit=8   # pilot
 *   npx tsx --env-file=.env.local scripts/create-bots.ts
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { PERSONAS, makeIdentity, TOTAL_BOTS, type Persona } from './data/bot-personas';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PW  = process.env.BOT_PASSWORD;
if (!URL || !KEY) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
if (!PW && !DRY) { console.error('Missing BOT_PASSWORD in .env.local (see .env.example)'); process.exit(1); }
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
// --per-persona=N caps each persona at N this run (a representative cross-persona pilot).
const PER_PERSONA = (() => { const a = args.find(x => x.startsWith('--per-persona=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
const ROSTER = `${__dirname}/bot-roster.json`;

const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Seeded PRNG (mulberry32) so re-runs are deterministic → same handles, clean resume.
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const COUNTRY: Record<Persona['bucket'], string[]> = { ko: ['KR'], ja: ['JP'], western: ['US', 'GB', 'CA', 'KR', 'AU'] };

interface RosterEntry { user_id: string; username: string; persona: string; bucket: string; created_at: string }

function loadRoster(): RosterEntry[] { try { return existsSync(ROSTER) ? JSON.parse(readFileSync(ROSTER, 'utf8')) : []; } catch { return []; } }
function saveRoster(r: RosterEntry[]) { writeFileSync(ROSTER, JSON.stringify(r, null, 0)); }

// Backdate across a plausible pre-launch window: 3–75 days ago. Timestamps must be passed in (scripts
// can't safely use Date.now for reproducibility of the *window*, but a real signup date is fine here).
function backdate(rand: () => number): string {
  const daysAgo = 3 + Math.floor(rand() * 72);
  const d = new Date(Date.now() - daysAgo * 86400_000 - Math.floor(rand() * 86400_000));
  return d.toISOString();
}

async function usernameTaken(username: string): Promise<boolean> {
  const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true }).eq('username', username);
  return (count ?? 0) > 0;
}

async function main() {
  console.log(`\n  Bot population — ${TOTAL_BOTS} across ${PERSONAS.length} personas${DRY ? '  [DRY RUN]' : ''}${LIMIT < Infinity ? `  [limit ${LIMIT}]` : ''}\n`);
  const roster = loadRoster();
  const doneByPersona = new Map<string, number>();
  for (const e of roster) doneByPersona.set(e.persona, (doneByPersona.get(e.persona) ?? 0) + 1);

  let created = 0, seed = 1000;
  outer:
  for (const p of PERSONAS) {
    const already = doneByPersona.get(p.key) ?? 0;
    const upTo = Math.min(p.count, PER_PERSONA);
    for (let i = already; i < upTo; i++) {
      if (created >= LIMIT) break outer;
      const rand = rng(seed++);
      const country = COUNTRY[p.bucket][Math.floor(rand() * COUNTRY[p.bucket].length)];
      // believable name/handle, matched to country; retry until the handle is free
      let username = '', display_name = '', tries = 0;
      do { const id = makeIdentity(country, p, rand); username = id.username; display_name = id.displayName; tries++; }
      while ((!username || roster.some(e => e.username === username) || (!DRY && await usernameTaken(username))) && tries < 15);
      const created_at = backdate(rand);
      const email = `${username}.${p.key}@bots.sillajuku.app`;

      if (DRY) { console.log(`  [${p.key}] @${username.padEnd(20)} ${display_name.padEnd(12)} ${country}  joined ${created_at.slice(0, 10)}`); created++; continue; }

      const { data: au, error: ae } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true, user_metadata: { onboarding_completed: true, is_bot: true } });
      if (ae || !au?.user) { console.warn(`  ! auth ${username}: ${ae?.message}`); continue; }
      const { error: pe } = await admin.from('profiles').insert({
        id: au.user.id, username, display_name, is_bot: true, country,
        created_at,
      });
      // If the profile insert fails, delete the just-created auth user so a failure can never orphan
      // auth rows (and never silently spin past --limit without counting).
      if (pe) { console.warn(`  ! profile ${username}: ${pe.message}`); await admin.auth.admin.deleteUser(au.user.id).catch(() => {}); continue; }
      const entry: RosterEntry = { user_id: au.user.id, username, persona: p.key, bucket: p.bucket, created_at };
      roster.push(entry); created++;
      if (created % 10 === 0) { saveRoster(roster); console.log(`  … ${created} created`); }
    }
  }
  if (!DRY) saveRoster(roster);
  console.log(`\n  DONE — ${created} bots created this run, ${roster.length} total in roster\n`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
