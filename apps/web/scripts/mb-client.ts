/**
 * MusicBrainz API client — the primary catalog source (RENOVATION_PLAN §2–4).
 *
 * - CC0 core data (commercial-OK). Identity = MBID.
 * - Hard rule: ONE global limiter at <=1 request/second per IP (MB returns 503 above that).
 *   Every MB-touching lane shares this module's single limiter.
 * - MB requires a descriptive User-Agent with contact info, or it may block you.
 *
 * Endpoints used:
 *   searchArtists      /ws/2/artist?query=         resolve a discovered name → candidate MBIDs
 *   getArtist          /ws/2/artist/{mbid}?inc=aliases+genres
 *   browseReleaseGroups/ws/2/release-group?artist={mbid}  (paginated)
 *   browseReleases     /ws/2/release?release-group={mbid}&inc=media   (pick representative edition)
 *   getRelease         /ws/2/release/{mbid}?inc=recordings+isrcs+artist-credits+media+genres
 */

const MB_BASE = 'https://musicbrainz.org/ws/2';
const CONTACT = process.env.MB_CONTACT || 'admin@sillajuku.com';
const USER_AGENT = `sillajuku/1.0 ( ${CONTACT} )`;
const MIN_INTERVAL_MS = 1100; // <1 req/s with headroom

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

// Single global limiter shared by every caller of this module.
let chain: Promise<void> = Promise.resolve();
let last = 0;
function acquire(): Promise<void> {
  chain = chain.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last));
    if (wait) await sleep(wait);
    last = Date.now();
  });
  return chain;
}

async function mbGet(path: string, attempt = 0): Promise<any> {
  await acquire();
  let res: Response;
  try {
    res = await fetch(`${MB_BASE}${path}${path.includes('?') ? '&' : '?'}fmt=json`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
  } catch {
    if (attempt >= 5) return null;
    await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
    return mbGet(path, attempt + 1);
  }
  if (res.status === 503 || res.status === 429) {
    const wait = Math.min(60_000, 2_000 * 2 ** attempt); // MB throttle → back off
    process.stdout.write(`\n  [${res.status}] MB throttled — waiting ${wait / 1000}s… `);
    await sleep(wait);
    if (attempt >= 6) return null;
    return mbGet(path, attempt + 1);
  }
  if (res.status === 404) return null;
  if (!res.ok) return null;
  try { return await res.json(); } catch { return null; }
}

const enc = encodeURIComponent;

// ── Types (only the fields we use) ─────────────────────────────────────────────

export interface MbAlias {
  name: string;
  locale: string | null;
  primary: boolean | null;
  type: string | null;     // 'Artist name' | 'Legal name' | 'Search hint' ...
}
export interface MbArtistCandidate {
  id: string;              // MBID
  name: string;
  score: number;           // 0–100 search relevance
  type: string | null;     // 'Person' | 'Group' | ...
  country: string | null;
  area: string | null;
  disambiguation: string | null;
}
export interface MbArtistDetail {
  id: string;
  name: string;
  country: string | null;
  area: string | null;
  disambiguation: string | null;
  aliases: MbAlias[];
  genres: string[];
}
export interface MbReleaseGroup {
  id: string;
  title: string;
  primaryType: string | null;       // 'Album' | 'EP' | 'Single' | 'Broadcast' | 'Other'
  secondaryTypes: string[];         // 'Compilation' | 'Live' | 'Soundtrack' | 'Remix' ...
  firstReleaseDate: string | null;  // YYYY[-MM[-DD]]
  artistCredit: string;             // "Lady Gaga & Bradley Cooper"
  genres: string[];
}
export interface MbReleaseStub {
  id: string;
  status: string | null;            // 'Official' | 'Promotion' | 'Bootleg' ...
  date: string | null;
  country: string | null;
  trackCount: number;
}
export interface MbTrack {
  position: number;
  discNumber: number;
  title: string;
  recordingId: string;              // MBID
  recordingTitle: string;
  artistCredit: string;
  lengthMs: number | null;
  isrcs: string[];
}

// ── API wrappers ───────────────────────────────────────────────────────────────

export async function searchArtists(name: string, limit = 8): Promise<MbArtistCandidate[]> {
  // Search the NAME *and* ALIAS fields: many Korean artists' MB primary name is
  // Hangul (e.g. 혁오) with the romanized form ("Hyukoh") only as an alias, so a
  // name-only query misses them. Escape Lucene specials inside the quotes.
  const q = name.replace(/(["\\])/g, '\\$1');
  const data = await mbGet(`/artist?query=${enc(`artist:"${q}" OR alias:"${q}"`)}&limit=${limit}`);
  return (data?.artists ?? []).map((a: any): MbArtistCandidate => ({
    id: a.id,
    name: a.name,
    score: a.score ?? 0,
    type: a.type ?? null,
    country: a.country ?? null,
    area: a.area?.name ?? null,
    disambiguation: a.disambiguation ?? null,
  }));
}

export async function getArtist(mbid: string): Promise<MbArtistDetail | null> {
  const a = await mbGet(`/artist/${mbid}?inc=${enc('aliases genres')}`);
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    country: a.country ?? null,
    area: a.area?.name ?? null,
    disambiguation: a.disambiguation ?? null,
    aliases: (a.aliases ?? []).map((al: any): MbAlias => ({
      name: al.name, locale: al.locale ?? null, primary: al.primary ?? null, type: al.type ?? null,
    })),
    genres: (a.genres ?? []).map((g: any) => g.name).filter(Boolean),
  };
}

export async function browseReleaseGroups(artistMbid: string): Promise<MbReleaseGroup[]> {
  const out: MbReleaseGroup[] = [];
  let offset = 0;
  for (;;) {
    const data = await mbGet(
      `/release-group?artist=${artistMbid}&type=${enc('album|ep|single')}&inc=${enc('genres')}&limit=100&offset=${offset}`,
    );
    const rgs: any[] = data?.['release-groups'] ?? [];
    for (const rg of rgs) {
      out.push({
        id: rg.id,
        title: rg.title,
        primaryType: rg['primary-type'] ?? null,
        secondaryTypes: rg['secondary-types'] ?? [],
        firstReleaseDate: rg['first-release-date'] || null,
        artistCredit: creditPhrase(rg['artist-credit']),
        genres: (rg.genres ?? []).map((g: any) => g.name).filter(Boolean),
      });
    }
    const total = data?.['release-group-count'] ?? out.length;
    offset += rgs.length;
    if (rgs.length === 0 || offset >= total) break;
  }
  return out;
}

export async function browseReleases(releaseGroupMbid: string): Promise<MbReleaseStub[]> {
  const data = await mbGet(`/release?release-group=${releaseGroupMbid}&inc=media&limit=100`);
  return (data?.releases ?? []).map((r: any): MbReleaseStub => ({
    id: r.id,
    status: r.status ?? null,
    date: r.date || null,
    country: r.country ?? null,
    trackCount: (r.media ?? []).reduce((n: number, m: any) => n + (m['track-count'] ?? 0), 0),
  }));
}

export async function getReleaseTracks(releaseMbid: string): Promise<MbTrack[]> {
  const r = await mbGet(`/release/${releaseMbid}?inc=${enc('recordings isrcs artist-credits media')}`);
  if (!r) return [];
  const tracks: MbTrack[] = [];
  for (const m of r.media ?? []) {
    const disc = m.position ?? 1;
    for (const t of m.tracks ?? []) {
      const rec = t.recording ?? {};
      tracks.push({
        position: t.position ?? tracks.length + 1,
        discNumber: disc,
        title: t.title ?? rec.title ?? '',
        recordingId: rec.id,
        recordingTitle: rec.title ?? t.title ?? '',
        artistCredit: creditPhrase(t['artist-credit'] ?? rec['artist-credit']),
        lengthMs: t.length ?? rec.length ?? null,
        isrcs: rec.isrcs ?? [],
      });
    }
  }
  return tracks;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function creditPhrase(credit: any[] | undefined): string {
  if (!Array.isArray(credit)) return '';
  return credit.map(c => `${c.name ?? c.artist?.name ?? ''}${c.joinphrase ?? ''}`).join('').trim();
}

export { MB_BASE, USER_AGENT };
