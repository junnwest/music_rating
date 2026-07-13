/**
 * enrich-subgenres-lastfm.ts — RYM-style per-ALBUM sub-genre enrichment for the
 * albums the taste system actually reads (rated ∪ prestige pool by default).
 *
 * For each album, calls Last.fm `album.getTopTags` (album-level and count-ordered,
 * i.e. importance-ordered — unlike our MB arrays, which are alphabetical) and APPENDS
 * new sub-genre tags to release_groups.genres. A tag is admitted only if it is either
 * (a) already in the catalog's genre vocabulary, or (b) a canonical MusicBrainz genre
 * (fetched once from /ws/2/genre/all) — this rejects Last.fm noise ("seen live",
 * "favorites", decades, country adjectives) while still letting genuinely new
 * sub-genres ("twee pop", "cloud rap") enter the vocabulary.
 *
 * Existing tags are never removed or reordered; new tags are appended in Last.fm
 * count order, capped at MAX_TOTAL per album. After a run that adds tags:
 *   1. npm run build:genre-embeddings     (new tags need vectors; co-occurrence shifts)
 *   2. re-run migration 20260712000010's backfill statement (profiles derive from genres)
 *
 *   npm run enrich:subgenres              # rated ∪ prestige (default)
 *   npm run enrich:subgenres -- --dry-run
 *   npm run enrich:subgenres -- --limit=200
 */
import { createClient } from '@supabase/supabase-js';

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
const MAX_NEW = 5; //   max tags appended per album
const MAX_TOTAL = 10; // cap on final array length

const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_KEY) {
  console.error('LASTFM_API_KEY is not set. Add it to .env.local.');
  process.exit(1);
}
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (g: string) => g.toLowerCase().trim().replace(/-/g, ' ').replace(/\s+/g, ' ');

interface RG {
  id: string;
  title: string;
  artist_display: string;
  genres: string[] | null;
}

// ── canonical MB genre list (one-time, ~22 paged requests) ──────────────────
async function mbGenreVocab(): Promise<Set<string>> {
  const vocab = new Set<string>();
  for (let offset = 0; ; offset += 100) {
    // Retry with backoff — the catalog pipeline shares this machine's MB rate
    // budget, so transient 503s are expected under live ingest.
    let data: any = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(
        `https://musicbrainz.org/ws/2/genre/all?fmt=json&limit=100&offset=${offset}`,
        { headers: { 'User-Agent': 'sillajuku/1.0 (redx1234550@naver.com)' } },
      );
      if (res.ok) {
        data = await res.json();
        break;
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
      .select('id, release_groups(id, title, artist_display, genres)')
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
      .select('id, title, artist_display, genres')
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
  console.log(`enrich-subgenres-lastfm ${DRY ? '(DRY RUN)' : ''}`);
  console.log('fetching MB canonical genre vocabulary…');
  const mbVocab = await mbGenreVocab();
  console.log(`  ${mbVocab.size} canonical genres`);

  let pool = await targets();
  if (OFFSET) pool = pool.slice(OFFSET);
  if (LIMIT) pool = pool.slice(0, LIMIT);
  console.log(`${pool.length} target albums (rated ∪ prestige${OFFSET ? `, offset ${OFFSET}` : ''})`);

  // Catalog vocabulary: normalized key → canonical spelling already in use,
  // so appended tags match existing rows ("synth-pop" not "synthpop").
  const { data: vocabRows } = await s.from('genre_vectors').select('tag');
  const catalogVocab = new Map<string, string>();
  for (const row of (vocabRows as { tag: string }[]) ?? []) catalogVocab.set(norm(row.tag), row.tag);

  let hit = 0;
  let updated = 0;
  let added = 0;
  const newTags = new Map<string, number>();

  for (const [i, rg] of pool.entries()) {
    if (i > 0 && i % 200 === 0) {
      console.log(`  …${i}/${pool.length} (hits ${hit}, updated ${updated}, tags added ${added})`);
    }
    const tags = await albumTopTags(rg.artist_display, rg.title);
    if (!tags || tags.length === 0) continue;
    hit++;

    const existing = rg.genres ?? [];
    const existingNorm = new Set(existing.map(norm));
    const toAdd: string[] = [];
    for (const t of tags) {
      if (t.count < MIN_COUNT) continue;
      const n = norm(t.name);
      if (!n || existingNorm.has(n)) continue;
      // admit: already in catalog vocab (canonical spelling) or canonical MB genre
      const canonical = catalogVocab.get(n) ?? (mbVocab.has(n) ? t.name.toLowerCase() : null);
      if (!canonical) continue;
      if (toAdd.includes(canonical)) continue;
      toAdd.push(canonical);
      existingNorm.add(n);
      if (toAdd.length >= MAX_NEW || existing.length + toAdd.length >= MAX_TOTAL) break;
    }
    if (toAdd.length === 0) continue;

    updated++;
    added += toAdd.length;
    for (const t of toAdd) newTags.set(t, (newTags.get(t) ?? 0) + 1);
    if (!DRY) {
      const { error } = await s
        .from('release_groups')
        .update({ genres: [...existing, ...toAdd] })
        .eq('id', rg.id);
      if (error) console.error(`  write failed for ${rg.artist_display} — ${rg.title}: ${error.message}`);
    }
  }

  console.log(`\ndone: ${pool.length} albums · lastfm hits ${hit} · albums updated ${updated} · tags added ${added}`);
  const top = Array.from(newTags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 25);
  console.log('most-added tags:', top.map(([t, n]) => `${t}(${n})`).join(', '));
  if (!DRY && added > 0) {
    console.log('\nNEXT: npm run build:genre-embeddings, then re-run the 20260712000010 backfill statement.');
  }
}

main();
