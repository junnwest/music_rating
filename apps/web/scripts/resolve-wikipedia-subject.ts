/**
 * Stage 2 of the trend-post pipeline: resolve each candidate (artist, album,
 * or genre) to a VERIFIED Wikipedia article via its short description — never
 * just the top search hit. Same discipline regardless of type: no match, no
 * resolution. This is what caught "Crush" the word vs. "Crush" the singer,
 * and it's the same guard-by-description approach, just with a different
 * accepted pattern per subject type.
 *
 * Supersedes resolve-artist-wikipedia.ts (same logic, generalized to all
 * three types — that file can be retired once nothing references it).
 *
 * Input: scripts/output/trend-candidates.json (from select-trend-candidates.ts,
 * each entry tagged with its type)
 * Output: scripts/output/trend-artists-wiki.json — resolved + skipped
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/resolve-wikipedia-subject.ts
 *   npx tsx --env-file=.env.local scripts/resolve-wikipedia-subject.ts --dry-run
 *
 * Resume: re-run — already-resolved/skipped subjects are skipped on the next pass.
 */
import fs from 'fs';
import path from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const IN_PATH = path.resolve('scripts/output/trend-candidates.json');
const OUT_PATH = path.resolve('scripts/output/trend-artists-wiki.json');
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const DELAY_MS = 350;

const GUARDS: Record<'artist' | 'album' | 'genre', RegExp> = {
  artist: /singer|rapper|musician|band|idol|songwriter|record producer|composer|vocalist|group|duo|dj\b/i,
  album: /\balbum\b|\bep\b|mixtape|record by|studio album|extended play/i,
  genre: /genre|music style|subgenre|movement|style of music/i,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function wikiGet(params: Record<string, string>, attempt = 0): Promise<any> {
  await sleep(DELAY_MS);
  const url = new URL(WIKI_API);
  Object.entries({ ...params, format: 'json', origin: '*' }).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { headers: { 'User-Agent': 'sillajuku-trend-pipeline/1.0 (admin@sillajuku.com)' } });
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await sleep(2000 * 2 ** attempt);
    return wikiGet(params, attempt + 1);
  }
  if (!res.ok) return null;
  return res.json();
}

function searchQueryFor(type: 'artist' | 'album' | 'genre', name: string): string {
  if (type === 'album') {
    // "Title — Artist" -> search as "Title Artist album" so disambiguation-heavy
    // album titles (a real, common case) land on the right hit.
    const [title, artist] = name.split(' — ');
    return artist ? `${title} ${artist} album` : `${name} album`;
  }
  if (type === 'genre') return `${name} music genre`;
  return name;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

async function resolveOne(type: 'artist' | 'album' | 'genre', name: string): Promise<{ title: string; description: string } | null> {
  const search = await wikiGet({ action: 'query', list: 'search', srsearch: searchQueryFor(type, name), srlimit: '5' });
  const hits: { title: string }[] = search?.query?.search ?? [];
  if (hits.length === 0) return null;

  const titles = hits.map((h) => h.title).join('|');
  const desc = await wikiGet({ action: 'query', titles, prop: 'description' });
  const pages: Record<string, { title: string; description?: string }> = desc?.query?.pages ?? {};
  const guard = GUARDS[type];

  // Albums get an extra guard: the description has to actually name the
  // right artist (this is what caught "Wave — Colde" matching a SHINee
  // album), not just be described as "an album" by someone.
  const [expectedTitleRaw, expectedArtist] = type === 'album' ? name.split(' — ') : [name, undefined];
  const expectedArtistNorm = expectedArtist ? norm(expectedArtist) : null;
  const expectedTitleNorm = norm(expectedTitleRaw);

  // Albums AND genres both need the resolved article's own title to overlap
  // with what was actually searched for — a description-only guard isn't
  // enough. Observed live: "Interlude" (album) resolved to the wrong Crush
  // album "Crush on You"; "electronic" (genre) resolved to "Hardcore
  // (electronic dance music genre)", a specific subgenre, not the genre
  // itself; "r&b" resolved to "Rage (music genre)", an unrelated hip-hop
  // subgenre that merely matched the "genre" guard word.
  for (const hit of hits) {
    const page = Object.values(pages).find((p) => p.title === hit.title);
    if (!page?.description || !guard.test(page.description)) continue;
    if (expectedArtistNorm && !norm(page.description).includes(expectedArtistNorm)) continue;
    // Near-exact title match, not substring containment — substring alone
    // still accepted "Electronic body music" for "electronic" and
    // "Contemporary R&B" for "r&b" (both are real substrings of longer,
    // wrong titles). Strip a trailing disambiguator "(...)" and a trailing
    // "music" (the common "X" <-> "X music" Wikipedia genre-naming pattern,
    // e.g. "Rock" <-> "Rock music") before requiring an exact match.
    const coreTitleNorm = norm(page.title.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+music$/i, ''));
    if (coreTitleNorm !== expectedTitleNorm) continue;
    return { title: page.title, description: page.description };
  }
  return null;
}

interface ResolvedEntry {
  artist: string; // display name — historically "artist", now also holds album/genre names
  type: 'artist' | 'album' | 'genre';
  wikiTitle: string;
  description: string;
}
interface SkippedEntry {
  artist: string;
  type: 'artist' | 'album' | 'genre';
  reason: string;
}

async function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.error(`Missing ${IN_PATH} — run select-trend-candidates.ts first.`);
    process.exit(1);
  }
  const candidates: { type: 'artist' | 'album' | 'genre'; name: string }[] = JSON.parse(fs.readFileSync(IN_PATH, 'utf8'));

  const existing: { resolved: ResolvedEntry[]; skipped: SkippedEntry[] } = fs.existsSync(OUT_PATH)
    ? JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'))
    : { resolved: [], skipped: [] };
  const done = new Set([...existing.resolved.map((r) => r.artist), ...existing.skipped.map((s) => s.artist)]);

  for (const { type, name } of candidates) {
    if (done.has(name)) continue;
    console.log(`\n[${type}] ${name}`);

    if (DRY_RUN) {
      console.log('  [dry-run, no lookup]');
      continue;
    }

    const match = await resolveOne(type, name);
    if (match) {
      console.log(`  -> "${match.title}" (${match.description})`);
      existing.resolved.push({ artist: name, type, wikiTitle: match.title, description: match.description });
    } else {
      console.log('  -> no verified match found, skipping');
      existing.skipped.push({ artist: name, type, reason: `no ${type}-described Wikipedia match` });
    }
    fs.writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2));
  }

  if (!DRY_RUN) {
    console.log(`\nResolved ${existing.resolved.length}, skipped ${existing.skipped.length}.`);
    console.log(`Wrote ${OUT_PATH}`);
  }
}

main();
