/**
 * backfill-primary-genre.ts — assign each release_group a single PRIMARY genre by a scene-first
 * precedence, so genre charts show an album in exactly ONE ranking (its dominant scene/style)
 * instead of every genre it's tagged with.
 *
 * WHY: genres[] is a flat multi-tag array and charts filter by membership (_rg_has_genre), so a
 * k-pop album tagged [k-pop, hip hop, pop] leaks into the Hip-Hop, Pop AND K-Pop charts. ~60% of
 * k-pop albums carry a generic style co-tag. This picks the highest-precedence tag as `primary_genre`;
 * the chart RPCs then substring-match p_genre against primary_genre only (migration 20260706000001),
 * so idol/scene content stops polluting the Western/global style charts.
 *
 * PRECEDENCE (scene-first, per user decision 2026-07-06): national-scene genres (Korean, then
 * Japanese) outrank cross-cutting styles; within a scene, specific styles outrank the broad
 * pop umbrella; among Western styles, specific outranks generic. The stored value is a clean
 * canonical string chosen to substring-match the existing client slugs (k-pop/hip-hop/rock/
 * electronic/indie/r&b/…), so NO client change is needed.
 *
 *   npx tsx --env-file=.env.local scripts/backfill-primary-genre.ts --dry-run            # full compute, report only
 *   npx tsx --env-file=.env.local scripts/backfill-primary-genre.ts --dry-run --sample=6000
 *   npx tsx --env-file=.env.local scripts/backfill-primary-genre.ts                       # write (needs the column)
 */
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY = process.argv.includes("--dry-run");
const SAMPLE = (() => { const a = process.argv.find((x) => x.startsWith("--sample=")); return a ? parseInt(a.split("=")[1], 10) : 0; })();

const norm = (g: string) => g.toLowerCase().replace(/-/g, " ").replace(/&/g, " and ").replace(/\s+/g, " ").trim();

// Ordered precedence (highest first). `store` is the canonical value written to primary_genre,
// chosen so the existing client slugs still substring-match it. `subs` are normalized substrings.
const PRECEDENCE: { store: string; subs: string[] }[] = [
  // ── Korean scene (specific styles first, then the k-pop umbrella) ──
  { store: "korean hip hop", subs: ["korean hip hop", "k rap", "korean rap"] },
  { store: "korean r&b",     subs: ["korean r and b", "k r and b", "korean rnb"] },
  { store: "korean indie",   subs: ["korean indie", "k indie"] },
  { store: "korean folk",    subs: ["korean folk", "k folk"] },
  { store: "korean ballad",  subs: ["korean ballad", "k ballad"] },
  { store: "k-pop",          subs: ["k pop", "korean pop"] },
  // ── Japanese scene ──
  { store: "city pop",       subs: ["city pop"] },
  { store: "j-rock",         subs: ["j rock", "japanese rock", "visual kei"] },
  { store: "j-pop",          subs: ["j pop", "japanese pop"] },
  // ── Western / global styles (specific → generic) ──
  { store: "shoegaze",       subs: ["shoegaze", "dream pop"] },
  { store: "math rock",      subs: ["math rock"] },
  { store: "post-rock",      subs: ["post rock"] },
  { store: "indie rock",     subs: ["indie rock"] },
  { store: "indie pop",      subs: ["indie pop", "bedroom pop"] },
  { store: "alternative",    subs: ["alternative", "alt rock"] },
  { store: "metal",          subs: ["metal"] },
  { store: "punk",           subs: ["punk"] },
  { store: "classic rock",   subs: ["classic rock", "hard rock", "psychedelic rock", "prog rock", "progressive rock"] },
  { store: "jazz",           subs: ["jazz"] },
  { store: "funk",           subs: ["funk", "disco"] },
  { store: "r&b",            subs: ["r and b", "rnb", "neo soul", "soul"] },
  { store: "hip hop",        subs: ["hip hop", "rap", "trap"] },
  { store: "electronic",     subs: ["electronic", "house", "techno", "edm", "idm", "electro", "synth pop", "synthpop"] },
  { store: "ambient",        subs: ["ambient", "lo fi", "lofi"] },
  { store: "folk",           subs: ["folk", "singer songwriter", "americana"] },
  { store: "classical",      subs: ["classical", "orchestral", "baroque"] },
  { store: "country",        subs: ["country"] },
  { store: "bossa nova",     subs: ["bossa nova"] },
  { store: "afrobeat",       subs: ["afrobeat"] },
  { store: "rock",           subs: ["rock"] },   // generic rock catch (after the specific rock styles)
  { store: "pop",            subs: ["pop"] },     // generic pop catch — lowest
];

/** Highest-precedence family present in the album's genres, else the first raw genre (fallback). */
function primaryOf(genres: string[] | null): string | null {
  if (!genres || genres.length === 0) return null;
  const normed = genres.map(norm);
  for (const fam of PRECEDENCE) {
    if (normed.some((g) => fam.subs.some((sub) => g.includes(sub)))) return fam.store;
  }
  return genres[0]; // no family matched — keep the album's own first tag so it isn't chart-orphaned
}

type RG = { id: string; genres: string[] | null; primary_genre?: string | null };

async function pageAll(sample: number): Promise<RG[]> {
  const out: RG[] = []; const page = 1000;
  for (let from = 0; ; from += page) {
    // Resumable: skip rows already assigned a primary_genre (a re-run only processes the remainder).
    // In --dry-run mode we don't filter, so the reported distribution reflects the whole catalog.
    let q = s.from("release_groups").select("id,genres").not("genres", "is", null);
    if (!DRY) q = q.is("primary_genre", null);
    const { data, error } = await q.range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as RG[]));
    if (data.length < page || (sample && out.length >= sample)) break;
  }
  return sample ? out.slice(0, sample) : out;
}

(async () => {
  console.log(`backfill-primary-genre ${DRY ? "(DRY RUN)" : ""}${SAMPLE ? ` sample=${SAMPLE}` : ""}`);
  const rgs = await pageAll(SAMPLE);
  console.log(`  release_groups with genres: ${rgs.length}`);

  const dist = new Map<string, number>();
  let nullP = 0;
  const rows: { id: string; primary_genre: string }[] = [];
  for (const r of rgs) {
    const p = primaryOf(r.genres);
    if (!p) { nullP++; continue; }
    dist.set(p, (dist.get(p) ?? 0) + 1);
    rows.push({ id: r.id, primary_genre: p });
  }

  console.log(`\n  primary_genre distribution (top 30):`);
  [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).forEach(([g, n]) => console.log(`    ${String(n).padStart(6)}  ${g}`));
  console.log(`  (no genres / unassigned: ${nullP})`);

  if (DRY) {
    // leak check: any album whose primary is k-pop but still tagged hip hop/r&b — should be OUT of those charts now
    const kpop = rgs.filter((r) => primaryOf(r.genres) === "k-pop");
    const kpopWithStyle = kpop.filter((r) => (r.genres || []).some((g) => /hip.?hop|r&b|rap|electronic/i.test(g)));
    console.log(`\n  k-pop-primary albums: ${kpop.length}; of those still carrying a style tag: ${kpopWithStyle.length}`);
    console.log(`  → all ${kpopWithStyle.length} now leave the Hip-Hop/R&B/Electronic charts (primary=k-pop).`);
    console.log(`\n  DRY RUN — no writes.`);
    return;
  }

  let written = 0, failed = 0;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // group by primary so we can update in bulk per value with the same IO-safe retry pattern
  const byVal = new Map<string, string[]>();
  for (const r of rows) (byVal.get(r.primary_genre) ?? byVal.set(r.primary_genre, []).get(r.primary_genre)!).push(r.id);
  for (const [val, ids] of byVal) {
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        if (attempt > 0) await sleep(400 * attempt);
        const { error } = await s.from("release_groups").update({ primary_genre: val }).in("id", chunk).is("primary_genre", null);
        if (!error) { ok = true; written += chunk.length; }
        else if (!/timeout|57014|canceling statement/i.test(error.message)) { console.log("  update error:", error.message); break; }
      }
      if (!ok) failed += chunk.length;
      await sleep(15);
    }
    process.stdout.write(`\r  written ~${written}/${rows.length}  (failed ${failed})`);
  }
  console.log(`\n  done — wrote primary_genre to ${written} release_groups${failed ? ` (${failed} failed)` : ""}.`);
})();
