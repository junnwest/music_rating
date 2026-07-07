/**
 * backfill-genres-rg-lastfm.ts — genre backfill for the residual release groups that
 * artist-propagation ([backfill-genres-rg.ts]) can't reach: artists with ZERO MB-tagged
 * release groups, so there's no in-catalog profile to propagate from.
 *
 * For each such artist we call Last.fm `artist.getTopTags` and keep the top tags that
 * already exist in the catalog's genre vocabulary (release_groups.genres). Matching
 * against the existing vocab guarantees the values we write line up with the rest of the
 * catalog (charts/genre filters keep working) and discards Last.fm noise tags
 * ("seen live", "favorites", country names, decades, …) for free.
 *
 *   npm run backfill:genres:rg:lastfm        # apply
 *   npm run backfill:genres:rg:lastfm:dry    # preview, no writes
 *
 * Idempotent (writes only where genres IS NULL). Requires LASTFM_API_KEY.
 */
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry-run");
const DELAY_MS = 250;      // ~4 req/s, under Last.fm's ~5 req/s free-tier ceiling
const MIN_COUNT = 10;      // Last.fm artist tag weight (0–100); ignore weak tags
const MAX_GENRES = 3;

const LASTFM_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_KEY) { console.error("LASTFM_API_KEY is not set. Add it to .env.local."); process.exit(1); }

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (g: string) => g.toLowerCase().trim().replace(/-/g, " ").replace(/\s+/g, " ");

type RG = { id: string; primary_artist_id: string | null; artist_display: string; genres: string[] | null };

async function pageAll(): Promise<RG[]> {
  const out: RG[] = []; let from = 0; const page = 1000;
  for (;;) {
    const { data, error } = await s.from("release_groups")
      .select("id,primary_artist_id,artist_display,genres").range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as RG[]));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

async function artistTopTags(artist: string, attempt = 0): Promise<{ name: string; count: number }[] | null> {
  await sleep(DELAY_MS);
  const url = new URL("https://ws.audioscrobbler.com/2.0/");
  url.searchParams.set("method", "artist.gettoptags");
  url.searchParams.set("artist", artist);
  url.searchParams.set("api_key", LASTFM_KEY!);
  url.searchParams.set("format", "json");
  url.searchParams.set("autocorrect", "1");
  try {
    const res = await fetch(url.toString(), { headers: { "User-Agent": "sillajuku-genre-backfill/1.0" } });
    if (res.status === 429) {
      if (attempt >= 5) return null;
      const wait = Math.min(60000, 5000 * 2 ** attempt);
      process.stdout.write(`\n  [429] waiting ${wait / 1000}s… `);
      await sleep(wait);
      return artistTopTags(artist, attempt + 1);
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    const tags = data.toptags?.tag;
    if (!tags) return null;
    return Array.isArray(tags) ? tags : [tags];
  } catch { return null; }
}

(async () => {
  console.log(`backfill-genres-rg-lastfm ${DRY ? "(DRY RUN)" : ""}`);
  const rgs = await pageAll();

  // existing catalog genre vocab → normalized-key → canonical form already in the catalog
  const vocab = new Map<string, string>();
  for (const r of rgs) if (r.genres) for (const g of r.genres) if (!vocab.has(norm(g))) vocab.set(norm(g), g);
  console.log(`  catalog genre vocab: ${vocab.size} distinct values`);

  // residual artists = those with untagged RGs and NO tagged RG
  const artistHasTag = new Set<string>();
  for (const r of rgs) if (r.genres?.length && r.primary_artist_id) artistHasTag.add(r.primary_artist_id);
  const residual = new Map<string, { name: string; ids: string[] }>();
  for (const r of rgs) {
    if (r.genres?.length || !r.primary_artist_id || artistHasTag.has(r.primary_artist_id)) continue;
    const e = residual.get(r.primary_artist_id) ?? { name: r.artist_display, ids: [] };
    e.ids.push(r.id);
    residual.set(r.primary_artist_id, e);
  }
  const totalRGs = [...residual.values()].reduce((a, e) => a + e.ids.length, 0);
  console.log(`  residual artists: ${residual.size}  (${totalRGs} untagged RGs)`);
  console.log(`  est. time: ~${Math.ceil(residual.size * DELAY_MS / 60000)} min\n`);

  let matchedArtists = 0, matchedRGs = 0, noMatch = 0, written = 0;
  let i = 0;
  for (const [, e] of residual) {
    i++;
    const tags = await artistTopTags(e.name);
    const genres: string[] = [];
    if (tags) {
      for (const t of tags) {
        if (t.count < MIN_COUNT) continue;
        const hit = vocab.get(norm(t.name));
        if (hit && !genres.includes(hit)) genres.push(hit);
        if (genres.length >= MAX_GENRES) break;
      }
    }
    if (genres.length === 0) {
      noMatch++;
      process.stdout.write(`  [${i}/${residual.size}] ${e.name} … no match\n`);
      continue;
    }
    matchedArtists++; matchedRGs += e.ids.length;
    process.stdout.write(`  [${i}/${residual.size}] ${e.name} → [${genres.join(", ")}] ×${e.ids.length}\n`);
    if (!DRY) {
      for (let j = 0; j < e.ids.length; j += 100) {
        const chunk = e.ids.slice(j, j + 100);
        let ok = false;
        for (let attempt = 0; attempt < 4 && !ok; attempt++) {
          if (attempt > 0) await sleep(400 * attempt); // back off, then retry a timed-out chunk
          const { error } = await s.from("release_groups").update({ genres }).in("id", chunk).is("genres", null);
          if (!error) { ok = true; written += chunk.length; }
          else if (!/timeout|57014|canceling statement/i.test(error.message)) { console.log("    update error:", error.message); break; }
        }
      }
    }
  }

  console.log(`\n  matched ${matchedArtists}/${residual.size} artists → ${matchedRGs} RGs; no-match ${noMatch} artists`);
  if (!DRY) {
    console.log(`  wrote genres to ${written} release_groups.`);
    const { count: tagged } = await s.from("release_groups").select("*", { count: "exact", head: true }).not("genres", "is", null);
    const { count: total } = await s.from("release_groups").select("*", { count: "exact", head: true });
    console.log(`  coverage now: ${tagged}/${total} (${((tagged! / total!) * 100).toFixed(1)}%)`);
  }
})();
