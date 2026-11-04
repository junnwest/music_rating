/**
 * Backfill artist_similar — the similar-artist graph behind the taste map's 'graph'
 * feature block (TASTE_MAP_PLAN.md §3, Phase 1; migration 20261103000000_taste_map.sql).
 *
 * Per artist, two sources, each stored as SimilarArtist[] (lib/tasteMap/types.ts):
 *   lastfm        artist.getSimilar, limit 50. By MB id when the artist has one; by name
 *                 (autocorrect=1) when it has none or Last.fm doesn't know the MB id.
 *                 `match` is Last.fm's own 0–1. ≤ ~4.5 req/s.
 *   listenbrainz  labs.api.listenbrainz.org/similar-artists/json?artist_mbids=<one mbid>
 *                 &algorithm=<--lb-algorithm>. MB id only (skipped for artists without
 *                 one). The API returns a flat array of
 *                   { artist_mbid, name, comment, type, gender, score, reference_mbid }
 *                 ordered by raw `score`; `match` = score / top score. One MB id per
 *                 request (several → HTTP 400). No key. ~1 req/s, backs off on 429.
 * Each similar artist's MB id is mapped to our artists.id through artist_external_ids
 * (artists.id is our own uuid; the MBID lives there). Unmapped → artistId null.
 * An empty array is stored too ("fetched, nothing there") so it isn't refetched.
 *
 * Scope: artists with ≥ 1 album rating (default), or the whole catalog with --all
 * (rated artists still go first). An artist/source fetched within --stale-days (60)
 * is skipped — checked against artist_similar.fetched_at and the local state file
 * scripts/data/backfill-artist-similar-state.json (gitignored) — unless --force.
 * Stop any time with Ctrl+C; re-running resumes.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-artist-similar.ts [--all] [--limit=N]
 *       [--force] [--stale-days=60] [--sources=lastfm,listenbrainz] [--lb-algorithm=…] [--dry-run]
 *
 * --dry-run fetches and prints, writes nothing (no DB, no state file), and works before
 * the migration is applied (a missing artist_similar table is treated as empty).
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { getDB } from './mb-ingest';
import { pgRetry } from '../lib/genres/pgRetry';
import type { SimilarArtist } from '../lib/tasteMap/types';

type Source = 'lastfm' | 'listenbrainz';
const ALL_SOURCES: Source[] = ['lastfm', 'listenbrainz'];

const arg = (f: string) => process.argv.find((a) => a.startsWith(`${f}=`))?.split('=').slice(1).join('=');
const LIMIT = Number(arg('--limit') ?? Infinity);
const STALE_DAYS = Number(arg('--stale-days') ?? 60);
const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const ALL = process.argv.includes('--all');
const SOURCES = (arg('--sources') ?? ALL_SOURCES.join(','))
  .split(',')
  .filter((s): s is Source => (ALL_SOURCES as string[]).includes(s));
const LB_ALGORITHM =
  arg('--lb-algorithm') ?? 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const MAX_SIMILAR = 50;
const LASTFM_GAP_MS = 220; // ≤ ~4.5 req/s
const LB_GAP_MS = 1100; // ~1 req/s
const UA = 'sillajuku-similar-backfill/1.0 (admin@sillajuku.com)';
const STATE_PATH = resolve(__dirname, 'data/backfill-artist-similar-state.json');
const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (SOURCES.length === 0) {
  console.error(`--sources must list one or more of: ${ALL_SOURCES.join(',')}`);
  process.exit(1);
}
const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (SOURCES.includes('lastfm') && !LASTFM_KEY) {
  console.error('LASTFM_API_KEY missing from environment (.env.local) — or pass --sources=listenbrainz');
  process.exit(1);
}

// ── Rate limiting ────────────────────────────────────────────────────────────

/** Spaces calls to one host at least `gapMs` apart. */
function gate(gapMs: number) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + gapMs;
    if (at > now) await sleep(at - now);
  };
}
const lastfmGate = gate(LASTFM_GAP_MS);
const lbGate = gate(LB_GAP_MS);

/** GET JSON with retries on network errors, 429 (Retry-After honoured) and 5xx. 404 → null body. */
async function getJson(url: string, wait: () => Promise<void>): Promise<{ status: number; body: any }> {
  for (let attempt = 0; ; attempt++) {
    await wait();
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 429 || res.status >= 500) {
        if (attempt >= 5) throw new Error(`HTTP ${res.status}`);
        const hinted =
          Number(res.headers.get('retry-after')) || Number(res.headers.get('x-ratelimit-reset-in')) || 0;
        const ms = Math.min(120_000, Math.max(hinted * 1000, 5000 * 2 ** attempt));
        process.stdout.write(`\n  [${res.status}] ${new URL(url).host} — waiting ${Math.round(ms / 1000)}s… `);
        await sleep(ms);
        continue;
      }
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        if (res.ok) throw new Error(`non-JSON response (${text.slice(0, 80)})`);
      }
      return { status: res.status, body };
    } catch (e) {
      if (attempt >= 5) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

// ── Sources ──────────────────────────────────────────────────────────────────

interface Raw {
  name: string;
  mbid: string | null;
  match: number;
}

async function lastfmCall(params: Record<string, string>): Promise<Raw[] | 'not_found'> {
  for (let attempt = 0; ; attempt++) {
    const url = new URL('https://ws.audioscrobbler.com/2.0/');
    for (const [k, v] of Object.entries({
      method: 'artist.getSimilar',
      limit: String(MAX_SIMILAR),
      autocorrect: '1',
      ...params,
      api_key: LASTFM_KEY!,
      format: 'json',
    }))
      url.searchParams.set(k, v);
    const { status, body } = await getJson(url.toString(), lastfmGate);
    if (body?.error === 6) return 'not_found';
    // 29 = rate limit exceeded, 8/16 = transient backend errors.
    if ([8, 16, 29].includes(body?.error) && attempt < 4) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (body?.error) throw new Error(`Last.fm ${body.error}: ${body.message}`);
    if (status === 404) return 'not_found';
    if (status >= 400) throw new Error(`Last.fm HTTP ${status}`);
    const list = body?.similarartists?.artist;
    const arr: any[] = !list ? [] : Array.isArray(list) ? list : [list];
    return arr
      .map((a) => ({
        name: String(a.name ?? ''),
        mbid: MBID_RE.test(String(a.mbid ?? '')) ? String(a.mbid).toLowerCase() : null,
        match: Math.max(0, Math.min(1, Number.parseFloat(a.match) || 0)),
      }))
      .filter((a) => a.name);
  }
}

async function lastfmSimilar(name: string, mbid: string | null): Promise<Raw[]> {
  if (mbid) {
    const r = await lastfmCall({ mbid });
    if (r !== 'not_found') return r;
  }
  const r = await lastfmCall({ artist: name });
  return r === 'not_found' ? [] : r;
}

async function listenbrainzSimilar(mbid: string): Promise<Raw[]> {
  const url = `https://labs.api.listenbrainz.org/similar-artists/json?${new URLSearchParams({
    artist_mbids: mbid,
    algorithm: LB_ALGORITHM,
  })}`;
  const { status, body } = await getJson(url, lbGate);
  if (status === 404) return [];
  if (status >= 400) throw new Error(`ListenBrainz HTTP ${status}${body?.error ? `: ${body.error}` : ''}`);
  if (!Array.isArray(body)) throw new Error('ListenBrainz: unexpected response shape');
  const rows = (body as any[])
    .filter((r) => r?.artist_mbid && String(r.artist_mbid).toLowerCase() !== mbid.toLowerCase())
    .map((r) => ({ name: String(r.name ?? ''), mbid: String(r.artist_mbid).toLowerCase(), score: Number(r.score) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIMILAR);
  const top = rows[0]?.score || 1;
  return rows.map((r) => ({ name: r.name, mbid: r.mbid, match: Math.round((r.score / top) * 1000) / 1000 }));
}

// ── DB helpers ───────────────────────────────────────────────────────────────

const db = getDB();

async function pageAll<T>(label: string, q: (from: number, to: number) => PromiseLike<any>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const rows = (await pgRetry<T[]>(label, () => q(from, from + 999))) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function inChunks<T>(label: string, ids: string[], size: number, q: (chunk: string[]) => PromiseLike<any>) {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(...((await pgRetry<T[]>(label, () => q(ids.slice(i, i + size)))) ?? []));
  }
  return out;
}

/** MB id → our artists.id (null = not in the catalog). Cached across artists. */
const mbidToArtist = new Map<string, string | null>();
async function resolveMbids(mbids: string[]): Promise<void> {
  const todo = [...new Set(mbids)].filter((m) => !mbidToArtist.has(m));
  if (todo.length === 0) return;
  const rows = await inChunks<{ artist_id: string; external_id: string }>('mbid lookup', todo, 100, (chunk) =>
    db.from('artist_external_ids').select('artist_id, external_id').eq('source', 'musicbrainz').in('external_id', chunk),
  );
  for (const m of todo) mbidToArtist.set(m, null);
  for (const r of rows) mbidToArtist.set(r.external_id.toLowerCase(), r.artist_id);
}

const MISSING_TABLE = /artist_similar|42P01|PGRST205|does not exist|could not find the table/i;

/** artist_id → source → fetched_at ms, from artist_similar. Empty if the table doesn't exist yet (dry run). */
async function storedFetchedAt(ids: string[] | null): Promise<Map<string, Partial<Record<Source, number>>>> {
  const out = new Map<string, Partial<Record<Source, number>>>();
  type Row = { artist_id: string; source: Source; fetched_at: string };
  let rows: Row[];
  try {
    rows = ids
      ? await inChunks<Row>('artist_similar', ids, 200, (chunk) =>
          db.from('artist_similar').select('artist_id, source, fetched_at').in('artist_id', chunk),
        )
      : await pageAll<Row>('artist_similar', (a, b) =>
          db
            .from('artist_similar')
            .select('artist_id, source, fetched_at')
            .order('artist_id')
            .order('source')
            .range(a, b),
        );
  } catch (e) {
    const msg = (e as Error).message;
    if (!MISSING_TABLE.test(msg)) throw e;
    if (!DRY) {
      console.error(`artist_similar is not readable (${msg}). Apply migration 20261103000000_taste_map.sql first.`);
      process.exit(1);
    }
    console.log('  (artist_similar table not found — treating as empty for the dry run)');
    return out;
  }
  for (const r of rows) {
    const m = out.get(r.artist_id) ?? {};
    m[r.source] = Date.parse(r.fetched_at);
    out.set(r.artist_id, m);
  }
  return out;
}

// ── Resumable state ──────────────────────────────────────────────────────────

type State = Record<Source, Record<string, string>>; // source → artist_id → ISO fetched_at
function loadState(): State {
  try {
    if (existsSync(STATE_PATH)) {
      const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
      return { lastfm: raw.lastfm ?? {}, listenbrainz: raw.listenbrainz ?? {} };
    }
  } catch {
    console.warn('  state file unreadable — starting fresh');
  }
  return { lastfm: {}, listenbrainz: {} };
}
const state = loadState();
let stateDirty = false;
function saveState() {
  if (DRY || !stateDirty) return;
  writeFileSync(STATE_PATH, JSON.stringify(state));
  stateDirty = false;
}
process.on('SIGINT', () => {
  saveState();
  console.log('\ninterrupted — progress saved; re-run to resume');
  process.exit(130);
});

// ── Main ─────────────────────────────────────────────────────────────────────

interface Target {
  id: string;
  name: string;
  mbid: string | null;
  rated: boolean;
}

async function main() {
  const rated = new Set(
    (
      await pageAll<{ release_groups: { primary_artist_id: string | null } | null }>('rated', (a, b) =>
        db.from('ratings').select('release_groups(primary_artist_id)').order('id').range(a, b),
      )
    )
      .map((r) => r.release_groups?.primary_artist_id)
      .filter((x): x is string => !!x),
  );

  let artists: { id: string; name: string }[];
  let links: { artist_id: string; external_id: string }[];
  if (ALL) {
    artists = await pageAll('artists', (a, b) => db.from('artists').select('id, name').order('id').range(a, b));
    links = await pageAll('mbids', (a, b) =>
      db
        .from('artist_external_ids')
        .select('artist_id, external_id')
        .eq('source', 'musicbrainz')
        .order('external_id')
        .range(a, b),
    );
  } else {
    const ids = [...rated];
    artists = await inChunks('artists', ids, 200, (chunk) => db.from('artists').select('id, name').in('id', chunk));
    links = await inChunks('mbids', ids, 200, (chunk) =>
      db.from('artist_external_ids').select('artist_id, external_id').eq('source', 'musicbrainz').in('artist_id', chunk),
    );
  }
  const mbidOf = new Map<string, string>();
  for (const l of links) {
    if (!mbidOf.has(l.artist_id) && MBID_RE.test(l.external_id)) mbidOf.set(l.artist_id, l.external_id.toLowerCase());
    mbidToArtist.set(l.external_id.toLowerCase(), l.artist_id); // seed the lookup cache for free
  }

  const stored = FORCE ? new Map() : await storedFetchedAt(ALL ? null : artists.map((a) => a.id));
  const cutoff = Date.now() - STALE_DAYS * 86_400_000;
  const due = (t: Target): Source[] =>
    SOURCES.filter((s) => {
      if (s === 'listenbrainz' && !t.mbid) return false;
      if (FORCE) return true;
      const at = Math.max(stored.get(t.id)?.[s] ?? 0, Date.parse(state[s][t.id] ?? '') || 0);
      return at < cutoff;
    });

  const queue = artists
    .map((a): Target => ({ id: a.id, name: a.name, mbid: mbidOf.get(a.id) ?? null, rated: rated.has(a.id) }))
    .filter((t) => due(t).length > 0)
    .sort((x, y) => Number(y.rated) - Number(x.rated) || x.id.localeCompare(y.id))
    .slice(0, LIMIT);
  console.log(
    `${artists.length} artists in scope (${ALL ? 'catalog' : 'rated'}) · ${rated.size} rated · ` +
      `${queue.length} due (${queue.filter((t) => t.rated).length} rated, ${queue.filter((t) => !t.mbid).length} without MB id)` +
      ` · sources ${SOURCES.join(',')}${FORCE ? ' · FORCE' : ''}${DRY ? ' · DRY RUN' : ''}`,
  );

  const stats = Object.fromEntries(
    SOURCES.map((s) => [s, { artists: 0, empty: 0, similar: 0, withMbid: 0, mapped: 0, failed: 0 }]),
  ) as Record<Source, { artists: number; empty: number; similar: number; withMbid: number; mapped: number; failed: number }>;
  const started = Date.now();
  let n = 0;

  for (const t of queue) {
    n++;
    const want = due(t);
    const results = await Promise.all(
      want.map(async (s): Promise<[Source, Raw[] | null]> => {
        try {
          return [s, s === 'lastfm' ? await lastfmSimilar(t.name, t.mbid) : await listenbrainzSimilar(t.mbid!)];
        } catch (e) {
          stats[s].failed++;
          console.warn(`\n  ${s} failed for ${t.name}: ${(e as Error).message}`);
          return [s, null];
        }
      }),
    );
    await resolveMbids(results.flatMap(([, r]) => (r ?? []).map((x) => x.mbid).filter((m): m is string => !!m)));

    const fetchedAt = new Date().toISOString();
    const rows: { artist_id: string; source: Source; similar: SimilarArtist[]; fetched_at: string }[] = [];
    for (const [s, raw] of results) {
      if (!raw) continue;
      const similar: SimilarArtist[] = raw.map((r) => ({
        name: r.name,
        mbid: r.mbid,
        artistId: (r.mbid && mbidToArtist.get(r.mbid)) || null,
        match: r.match,
      }));
      const st = stats[s];
      st.artists++;
      if (similar.length === 0) st.empty++;
      st.similar += similar.length;
      st.withMbid += similar.filter((x) => x.mbid).length;
      st.mapped += similar.filter((x) => x.artistId).length;
      rows.push({ artist_id: t.id, source: s, similar, fetched_at: fetchedAt });
    }

    if (DRY) {
      if (n <= 10) {
        console.log(`\n  ${t.name}${t.mbid ? '' : ' (no MB id)'}${t.rated ? '' : ' · unrated'}`);
        for (const r of rows) {
          const top = r.similar
            .slice(0, 6)
            .map((x) => `${x.name} ${x.match.toFixed(2)}${x.artistId ? '✓' : ''}`)
            .join(', ');
          console.log(
            `    ${r.source.padEnd(12)} ${r.similar.length} similar, ${r.similar.filter((x) => x.artistId).length} in catalog — ${top}`,
          );
        }
      }
    } else if (rows.length > 0) {
      try {
        await pgRetry('upsert', () => db.from('artist_similar').upsert(rows, { onConflict: 'artist_id,source' }));
        for (const r of rows) state[r.source][t.id] = fetchedAt;
        stateDirty = true;
      } catch (e) {
        for (const r of rows) stats[r.source].failed++;
        console.warn(`\n  write failed for ${t.name}: ${(e as Error).message}`);
      }
    }
    if (n % 20 === 0) saveState();
    if (!DRY && (n % 10 === 0 || n === queue.length)) {
      const rate = n / ((Date.now() - started) / 3_600_000);
      process.stdout.write(
        `\r  ${n}/${queue.length} artists · ${SOURCES.map((s) => `${s} ${stats[s].artists}/${stats[s].failed}✗`).join(' · ')} · ~${Math.round(rate)}/hr   `,
      );
    }
  }
  saveState();

  console.log(`\ndone: ${n} artists${DRY ? ' (dry run — nothing written)' : ''}`);
  for (const s of SOURCES) {
    const st = stats[s];
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
    console.log(
      `  ${s.padEnd(12)} ${st.artists} fetched (${st.empty} empty, ${st.failed} failed) · ` +
        `${st.similar} similar (avg ${st.artists ? (st.similar / st.artists).toFixed(1) : 0}) · ` +
        `${pct(st.withMbid, st.similar)} with MB id · ${pct(st.mapped, st.similar)} mapped to our catalog`,
    );
  }
}

main().catch((e) => {
  saveState();
  console.error(e);
  process.exit(1);
});
