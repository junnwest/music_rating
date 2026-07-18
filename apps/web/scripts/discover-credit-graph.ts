/**
 * Catalog expansion — the credit-graph discovery lane.
 *
 * Closes a structural blind spot: an artist who only ever appears as a track-level `feat.` on
 * someone we already own gets stored as a denormalized `recordings.artist_display` string but
 * creates NO artist row and NO queue entry. None of the other lanes (ListenBrainz, Wikipedia, the
 * MB country sweep) mine our OWN credit graph, so these collaborators stay invisible no matter how
 * many of our tracks credit them. This is how Masta Wu — an OG KR rapper credited on E-Sens/PSY/
 * Wheesung tracks we already have — was absent from the catalog entirely.
 *
 * Pipeline:
 *   1. aggregate feat-containing artist_display strings on country-primary recordings (SQL),
 *   2. parse out featured names, drop the ones we already own (artist rows + aliases),
 *   3. resolve each survivor name → MBID via MusicBrainz using the SAME confidence-gated resolver
 *      the ingest pipeline trusts (exact/alias match, short-CJK collision guard, region gating) —
 *      missing > wrong, so an unconfirmable name is skipped, never guessed,
 *   4. queue the confirmed MBIDs as source='mbid' rows (MBID-direct ingest, no re-resolution).
 *
 *   npx tsx --env-file=.env.local scripts/discover-credit-graph.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/discover-credit-graph.ts --min-count=3
 *   npx tsx --env-file=.env.local scripts/discover-credit-graph.ts --country=KR --limit=200
 *   npx tsx --env-file=.env.local scripts/discover-credit-graph.ts --backdate   # claim ahead of the pending tail
 *
 * Resumable: MBID resolution is the slow part (MusicBrainz ~1 req/s). Every resolved name — hit or
 * miss — is persisted to the state file, so a re-run only re-hits MB for names it hasn't seen.
 * SAFE ONLY AFTER the pipeline is running the source='mbid' code path (see seed-missing-artists.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDB } from './itunes-ingest-core';
import { resolveArtist, SPECIAL_MBIDS } from './mb-ingest';
import { getArtist } from './mb-client';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const arg = (f: string) => args.find(a => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const COUNTRY = arg('--country') ?? 'KR';
const MIN_COUNT = arg('--min-count') ? parseInt(arg('--min-count')!, 10) : 3;
const LIMIT = arg('--limit') ? parseInt(arg('--limit')!, 10) : Infinity;
// --backdate: stamp queued rows with an early created_at so the INGEST lane claims these
// on-target KR credit-graph artists ahead of the long pending tail (same 2019-01-01 seed:missing
// uses to claim before the 2020 prestige backfill). Off by default → they queue at 'now'.
const BACKDATE = args.includes('--backdate') ? '2019-01-01T00:00:00Z' : null;

const STATE_PATH = path.resolve('scripts/discover-credit-graph-state.json');

// Normalize for membership testing (must match how we key both the known-set and parsed names):
// NFKC folds width/compatibility variants, then strip to letters + numbers (drops the leading ". "
// artifact, spacing, and punctuation) so "P-Type", "P.Type" and "ptype" collapse together.
function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// ── State ─────────────────────────────────────────────────────────────────────
// normName → resolution outcome. `mbid` set only when confidently resolved.
type Outcome = { mbid: string | null; display: string; status: 'resolved' | 'no-match' | 'needs-review' | 'ambiguous' | 'wrong-region' };
interface State { resolved: Record<string, Outcome> }

function loadState(): State {
  if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  return { resolved: {} };
}
function saveState(state: State): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Management-API SQL (aggregation over millions of recordings — not a PostgREST job) ──
async function sql(query: string): Promise<any[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN not set (needed for the feat-credit aggregation)');
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL!.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)![1];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`SQL ${res.status}: ${await res.text()}`);
  return res.json();
}

async function pageAll(db: any, table: string, columns: string, orderBy: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order(orderBy).range(from, from + 999);
    if (error) throw new Error(`${table} page@${from}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// Parse featured names out of one artist_display string. Mirrors the audit's splitter, plus a
// trailing "of <group>" strip so "화사 of 마마무" resolves as "화사" not the whole clause.
const FEAT = /\b(feat\.?|ft\.?|featuring)\b/i;
function featuredNames(display: string): string[] {
  const m = display.match(FEAT);
  if (!m) return [];
  let tail = display.slice(m.index! + m[0].length).replace(/[()\[\]]/g, ' ');
  return tail
    .split(/,|&|\/|\bx\b|\band\b|\bwith\b/i)
    .map(p => p
      .replace(/\bprod\.?.*$/i, '')      // drop "prod. by …" tails
      .replace(/\s+of\s+.+$/i, '')       // drop "X of <group>" → keep X
      .replace(/^[.\s]+/, '')            // strip the leading ". " the (ft branch leaves behind
      .trim())
    .filter(Boolean);
}

async function main() {
  const db = getDB();

  // 1) Everything we could already resolve a collaborator to.
  console.log('Loading owned artist names + aliases…');
  const known = new Set<string>();
  const artists = await pageAll(db, 'artists', 'id,name,name_native,name_phonetic_ko', 'id');
  for (const a of artists) for (const v of [a.name, a.name_native, a.name_phonetic_ko]) if (v) known.add(norm(v));
  const aliases = await pageAll(db, 'artist_aliases', 'alias', 'id');
  for (const a of aliases) if (a.alias) known.add(norm(a.alias));
  console.log(`  ${artists.length} artists, ${aliases.length} aliases → ${known.size} name keys`);

  // 2) Distinct feat-containing display strings on <COUNTRY>-primary recordings, with counts.
  console.log(`Aggregating feat credits on ${COUNTRY}-primary recordings…`);
  const rows: { artist_display: string; c: number }[] = [];
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const batch = await sql(
      `select r.artist_display, count(*)::int as c
       from recordings r join artists a on a.id = r.primary_artist_id
       where a.country = '${COUNTRY}' and r.artist_display ~* '(feat| featuring|\\(ft)'
       group by r.artist_display order by c desc limit ${PAGE} offset ${off}`,
    );
    rows.push(...batch);
    process.stdout.write(`\r  ${rows.length} distinct display strings…`);
    if (batch.length < PAGE) break;
  }
  console.log('');

  // 3) Parse → drop owned → weight by total track-rows crediting each name.
  const missing = new Map<string, { display: string; recCount: number }>(); // normName → sample + weight
  for (const { artist_display: disp, c } of rows) {
    for (const name of featuredNames(disp)) {
      const key = norm(name);
      if (key.length < 2) continue;      // single-char / punctuation-only fragments
      if (known.has(key)) continue;
      const cur = missing.get(key);
      if (cur) cur.recCount += c;
      else missing.set(key, { display: name, recCount: c });
    }
  }
  const ranked = [...missing.entries()]
    .filter(([, v]) => v.recCount >= MIN_COUNT)
    .sort((a, b) => b[1].recCount - a[1].recCount);
  console.log(`Feat-only collaborators not owned: ${missing.size} total, ${ranked.length} with ≥${MIN_COUNT} credits.`);

  // 4) Resolve names → MBID (confidence-gated, resumable). missing > wrong: skip the unconfirmable.
  const state = loadState();
  let resolvedNow = 0, hits = 0, processed = 0;
  for (const [key, v] of ranked) {
    if (processed >= LIMIT) break;
    if (state.resolved[key]) continue;   // already tried in a prior run
    processed++;
    const r = await resolveArtist(v.display, COUNTRY);
    let outcome: Outcome;
    if (r.best && !r.needsReview && !r.ambiguous && !SPECIAL_MBIDS.has(r.best.id)) {
      // MB's search endpoint omits country for many records, so resolveArtist's "prefer
      // unconfirmed-region over confirmed-wrong-region" rule can promote a fuzzy fallback whose
      // country was merely absent from the search payload (the KR credit "Los" grabbing GB's
      // "Los Campesinos!"). When the search country is unconfirmed, verify against the full artist
      // record before trusting it — missing > wrong.
      let region = r.best.country as string | null;
      if (region == null) region = (await getArtist(r.best.id))?.country ?? null;
      if (region == null || region === COUNTRY) {
        outcome = { mbid: r.best.id, display: v.display, status: 'resolved' };
        hits++;
      } else {
        outcome = { mbid: null, display: v.display, status: 'wrong-region' };
      }
    } else {
      outcome = { mbid: null, display: v.display, status: r.ambiguous ? 'ambiguous' : r.needsReview ? 'needs-review' : 'no-match' };
    }
    state.resolved[key] = outcome;
    resolvedNow++;
    process.stdout.write(`\r  resolved ${resolvedNow} (${hits} MBID hits)…   `);
    if (resolvedNow % 25 === 0) saveState(state);
  }
  saveState(state);
  console.log(`\n  ${Object.keys(state.resolved).length} names tried total (state file).`);

  // 5) Collect confirmed MBIDs, drop any already in the catalog or already queued.
  const wantByMbid = new Map<string, string>(); // mbid → display (dedupe: two credit spellings, one artist)
  for (const o of Object.values(state.resolved)) if (o.mbid) wantByMbid.set(o.mbid, o.display);
  const mbids = [...wantByMbid.keys()];
  console.log(`Confirmed MBIDs: ${mbids.length}`);
  if (mbids.length === 0) { console.log('Nothing to queue.'); return; }

  const have = new Set<string>();
  for (let i = 0; i < mbids.length; i += 100) {
    const { data } = await db.from('artist_external_ids')
      .select('external_id').eq('source', 'musicbrainz').in('external_id', mbids.slice(i, i + 100));
    for (const r of data ?? []) have.add((r as any).external_id);
  }
  const queued = new Set<string>();
  for (let i = 0; i < mbids.length; i += 100) {
    const { data } = await db.from('artist_ingestion_queue')
      .select('source_id').eq('source', 'mbid').in('source_id', mbids.slice(i, i + 100));
    for (const r of data ?? []) queued.add((r as any).source_id);
  }

  const usedNames = new Set<string>();
  const toQueue: { name: string; source: string; source_id: string; status: string; created_at?: string }[] = [];
  let skipHave = 0, skipQueued = 0;
  for (const [mbid, display] of wantByMbid) {
    if (have.has(mbid)) { skipHave++; continue; }
    if (queued.has(mbid)) { skipQueued++; continue; }
    let n = display;
    if (usedNames.has(n.toLowerCase())) n = `${display} (${mbid.slice(0, 6)})`;
    usedNames.add(n.toLowerCase());
    toQueue.push({ name: n, source: 'mbid', source_id: mbid, status: 'pending', ...(BACKDATE ? { created_at: BACKDATE } : {}) });
  }

  console.log(`To queue: ${toQueue.length}  (skipped ${skipHave} already-in-catalog, ${skipQueued} already-queued)${BACKDATE ? '  [BACKDATED → claims first]' : ''}${DRY ? '  [DRY RUN]' : ''}`);
  if (DRY) { console.log('  sample:', toQueue.slice(0, 20).map(r => r.name).join(', ')); return; }

  for (let i = 0; i < toQueue.length; i += 500) {
    const { error } = await db.from('artist_ingestion_queue')
      .upsert(toQueue.slice(i, i + 500), { onConflict: 'name,source', ignoreDuplicates: true });
    if (error) { console.error(`  ! batch ${i}: ${error.message}`); process.exit(1); }
  }
  const { count } = await db.from('artist_ingestion_queue')
    .select('id', { count: 'exact', head: true }).eq('source', 'mbid').eq('status', 'pending');
  console.log(`[discover-credit-graph] queued ${toQueue.length}. Total source='mbid' pending: ${count}.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
