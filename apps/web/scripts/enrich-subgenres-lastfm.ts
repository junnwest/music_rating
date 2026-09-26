/**
 * enrich-subgenres-lastfm.ts — the Last.fm genre SOURCE (GENRE_TAXONOMY.md Phase 3):
 * per-ALBUM tags for the albums the taste system actually reads (rated ∪ prestige by
 * default), landed in `release_genres(source='lastfm', confidence=tag weight)`.
 *
 * For each album, calls Last.fm `album.getTopTags` (album-level and count-ordered, weight
 * 0–100 relative to the top tag), keeps tags with weight ≥ MIN_COUNT, and hands them to
 * the shared per-source writer (lib/genres/sourceWriter.ts): each tag resolves to a
 * canonical taxonomy id; the album's `lastfm` rows are replaced with the current set;
 * other sources' rows are never touched. Tags with no taxonomy node are staged in
 * `genre_unmapped` ONLY if they are canonical MusicBrainz genres (fetched once from
 * /ws/2/genre/all) — real genres worth a node, while Last.fm noise ("seen live",
 * "favorites", decades, country adjectives) is dropped.
 *
 * It no longer writes `release_groups.genres`: the displayed genres come from the merge
 * (lib/genres/merge.ts) at the display cutover. Until then a run changes only
 * `release_genres`, so no embeddings/profile rebuild is needed afterwards.
 *
 *   npm run enrich:subgenres              # rated ∪ prestige (default)
 *   npm run enrich:subgenres -- --dry-run
 *   npm run enrich:subgenres -- --limit=200
 *   npm run enrich:subgenres -- --offset=5000   # resume (pool order is deterministic)
 */
import { createClient } from '@supabase/supabase-js';
import { writeSourceGenres, resolveSourceTags, type SourceGenreInput, type WriteSourceResult } from '../lib/genres/sourceWriter';

const DRY = process.argv.includes('--dry-run');
const LIMIT = (() => {
  const a = process.argv.find((x) => x.startsWith('--limit='));
  return a ? parseInt(a.split('=')[1], 10) : 0;
})();
// Resume support: pool order is deterministic (both target queries are
// ORDER BY id), so --offset=N skips the first N pool entries of a prior run.
const OFFSET = (() => {
  const a = process.argv.find((x) => x.startsWith('--offset='));
  return a ? parseInt(a.split('=')[1], 10) : 0;
})();
const DELAY_MS = 250; // ~4 req/s, under Last.fm's free-tier ceiling
const MIN_COUNT = 20; // Last.fm tag weight (0–100); drop weak tags
const MAX_TAGS = 10; //  tags recorded per album (strongest first)
const FLUSH_EVERY = 50; // albums per writer batch

const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_KEY) {
  console.error('LASTFM_API_KEY is not set. Add it to .env.local.');
  process.exit(1);
}
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}
const s = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (g: string) => g.toLowerCase().trim().replace(/-/g, ' ').replace(/\s+/g, ' ');

interface RG {
  id: string;
  title: string;
  artist_display: string;
}

// ── canonical MB genre list (one-time, ~22 paged requests) ──────────────────
async function mbGenreVocab(): Promise<Set<string>> {
  const vocab = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    // Retry with backoff — the catalog pipeline shares this machine's MB rate
    // budget, so transient 503s are expected under live ingest.
    let data: any = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const res = await fetch(
          `https://musicbrainz.org/ws/2/genre/all?fmt=json&limit=100&offset=${offset}`,
          { headers: { 'User-Agent': 'sillajuku/1.0 (redx1234550@naver.com)' } },
        );
        if (res.ok) {
          data = await res.json();
          break;
        }
      } catch {
        // network-level failure (connect timeout/reset) — retry like a 503
      }
      await sleep(3000 * (attempt + 1));
    }
    if (!data) throw new Error(`MB genre/all failed after retries (offset ${offset})`);
    for (const g of data.genres ?? []) vocab.add(norm(g.name));
    if ((data.genres ?? []).length < 100) break;
    await sleep(1500); // MB rate limit: 1 req/s, plus headroom for the pipeline
  }
  return vocab;
}

async function albumTopTags(artist: string, album: string, attempt = 0): Promise<{ name: string; count: number }[] | null> {
  await sleep(DELAY_MS);
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'album.gettoptags');
  url.searchParams.set('artist', artist);
  url.searchParams.set('album', album);
  url.searchParams.set('autocorrect', '1');
  url.searchParams.set('api_key', LASTFM_KEY!);
  url.searchParams.set('format', 'json');
  try {
    const res = await fetch(url);
    if (res.status === 429 && attempt < 3) {
      await sleep(5000 * (attempt + 1));
      return albumTopTags(artist, album, attempt + 1);
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    const tags = data.toptags?.tag;
    if (!tags) return null;
    const arr = Array.isArray(tags) ? tags : [tags];
    return arr.map((t: any) => ({ name: String(t.name ?? ''), count: Number(t.count ?? 0) }));
  } catch {
    return null;
  }
}

async function targets(): Promise<RG[]> {
  // rated ∪ prestige — the sets the taste profiles and discovery pools read.
  // Paged in 1000-row windows WITH a stable order: PostgREST silently clamps
  // any .limit() to its 1000-row max (the same cap that broke the pipeline's
  // dedup set on 2026-07-10 — don't trust a bare .limit() for bulk reads).
  const byId = new Map<string, RG>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from('ratings')
      .select('id, release_groups(id, title, artist_display)')
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of (data as any[]) ?? []) {
      const rg = r.release_groups;
      if (rg) byId.set(rg.id, rg);
    }
    if (!data || data.length < 1000) break;
  }
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s
      .from('release_groups')
      .select('id, title, artist_display')
      .not('prestige_score', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const rg of (data as RG[]) ?? []) byId.set(rg.id, rg);
    if (!data || data.length < 1000) break;
  }
  return Array.from(byId.values());
}

async function main() {
  console.log(`enrich-subgenres-lastfm → release_genres(source='lastfm') ${DRY ? '(DRY RUN)' : ''}`);
  console.log('fetching MB canonical genre vocabulary…');
  const mbVocab = await mbGenreVocab();
  console.log(`  ${mbVocab.size} canonical genres`);

  let pool = await targets();
  if (OFFSET) pool = pool.slice(OFFSET);
  if (LIMIT) pool = pool.slice(0, LIMIT);
  console.log(`${pool.length} target albums (rated ∪ prestige${OFFSET ? `, offset ${OFFSET}` : ''})`);

  const total: WriteSourceResult = { releaseGroups: 0, upserted: 0, deleted: 0, unmappedStaged: 0, unchanged: 0 };
  const resolvedCounts = new Map<string, number>();
  const unmappedCounts = new Map<string, number>();
  let hit = 0;
  let withGenres = 0;
  let batch: SourceGenreInput[] = [];

  const flush = async () => {
    if (!batch.length) return;
    const r = await writeSourceGenres(s, 'lastfm', batch, {
      dryRun: DRY,
      stageUnmapped: (tag) => mbVocab.has(norm(tag)),
    });
    for (const k of Object.keys(total) as (keyof WriteSourceResult)[]) total[k] += r[k];
    batch = [];
  };

  for (const [i, rg] of pool.entries()) {
    if (i > 0 && i % 200 === 0) {
      console.log(`  …${i}/${pool.length} (lastfm hits ${hit}, with genres ${withGenres}, rows written ${total.upserted})`);
    }
    const tags = await albumTopTags(rg.artist_display, rg.title);
    // A failed/unknown lookup is NOT evidence the album has no tags — skip rather than
    // replace (which would delete this source's existing rows on a transient error).
    if (!tags) continue;
    hit++;

    const kept = tags
      .filter((t) => t.name && t.count >= MIN_COUNT)
      .slice(0, MAX_TAGS)
      .map((t) => ({ tag: t.name, confidence: t.count }));
    const { genres, unmapped } = resolveSourceTags(kept);
    if (genres.length) withGenres++;
    for (const g of genres) resolvedCounts.set(g.genreId, (resolvedCounts.get(g.genreId) ?? 0) + 1);
    for (const u of unmapped) {
      if (mbVocab.has(norm(u))) unmappedCounts.set(u.toLowerCase(), (unmappedCounts.get(u.toLowerCase()) ?? 0) + 1);
    }

    batch.push({ releaseGroupId: rg.id, title: rg.title, tags: kept });
    if (batch.length >= FLUSH_EVERY) await flush();
  }
  await flush();

  console.log(
    `\ndone: ${pool.length} albums · lastfm hits ${hit} · with ≥1 taxonomy genre ${withGenres}` +
      ` · release_genres rows ${DRY ? 'to write' : 'written'} ${total.upserted}, deleted ${total.deleted}` +
      ` · already current ${total.unchanged} · unmapped staged ${total.unmappedStaged}`,
  );
  const top = (m: Map<string, number>, n: number) =>
    [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t, c]) => `${t}(${c})`).join(', ');
  console.log('top genres:', top(resolvedCounts, 25));
  console.log('top unmapped MB genres (taxonomy growth candidates):', top(unmappedCounts, 25) || '(none)');
  if (DRY) console.log('\nDRY RUN — no writes.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
