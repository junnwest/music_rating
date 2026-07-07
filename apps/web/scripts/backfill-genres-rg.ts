/**
 * backfill-genres-rg.ts — fill missing genres on release_groups via artist propagation.
 *
 * Post-renovation, charts/discovery read `release_groups.genres` (text[]). MusicBrainz
 * tags only ~half of release groups, so the rest are null. This script derives each
 * artist's genre profile from their already-tagged release groups and applies the
 * artist's top genres to their untagged ones. Fully offline (DB-only), idempotent
 * (only writes where genres IS NULL), and safe to run alongside the live pipeline.
 *
 * Artists with zero tagged release groups can't be propagated to — those need an
 * external source (Last.fm) and are reported as the residual.
 *
 *   npm run backfill:genres:rg        # apply
 *   npm run backfill:genres:rg:dry    # preview, no writes
 */
import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const DRY = process.argv.includes("--dry-run");
const TOP_N = 3; // assign an artist's top-N genres to their untagged release groups

type RG = { id: string; primary_artist_id: string | null; genres: string[] | null };

async function pageAll(): Promise<RG[]> {
  const out: RG[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await s
      .from("release_groups")
      .select("id,primary_artist_id,genres")
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as RG[]));
    if (data.length < page) break;
    from += page;
  }
  return out;
}

(async () => {
  console.log(`backfill-genres-rg ${DRY ? "(DRY RUN)" : ""}`);
  const rgs = await pageAll();
  const tagged = rgs.filter((r) => Array.isArray(r.genres) && r.genres.length > 0);
  const untagged = rgs.filter((r) => (!r.genres || r.genres.length === 0) && r.primary_artist_id);

  // per-artist genre frequency from tagged release groups
  const profile = new Map<string, Map<string, number>>();
  for (const r of tagged) {
    if (!r.primary_artist_id) continue;
    const m = profile.get(r.primary_artist_id) ?? new Map<string, number>();
    for (const g of r.genres!) m.set(g, (m.get(g) ?? 0) + 1);
    profile.set(r.primary_artist_id, m);
  }
  const topGenres = (aid: string): string[] => {
    const m = profile.get(aid);
    if (!m) return [];
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([g]) => g);
  };

  // group untagged RGs by artist
  const byArtist = new Map<string, string[]>();
  for (const r of untagged) {
    const arr = byArtist.get(r.primary_artist_id!) ?? [];
    arr.push(r.id);
    byArtist.set(r.primary_artist_id!, arr);
  }

  let fillArtists = 0;
  let fillRGs = 0;
  let residualRGs = 0;
  const updates: { ids: string[]; genres: string[] }[] = [];
  for (const [aid, ids] of byArtist) {
    const g = topGenres(aid);
    if (g.length === 0) {
      residualRGs += ids.length;
      continue;
    }
    fillArtists++;
    fillRGs += ids.length;
    updates.push({ ids, genres: g });
  }

  console.log(`  release_groups total : ${rgs.length}`);
  console.log(`  already tagged       : ${tagged.length}`);
  console.log(`  untagged (w/ artist) : ${untagged.length}`);
  console.log(`  → will fill          : ${fillRGs} RGs across ${fillArtists} artists`);
  console.log(`  → residual (no profile, need Last.fm): ${residualRGs}`);

  if (DRY) {
    console.log("\n  sample assignments:");
    for (const u of updates.slice(0, 8)) console.log(`    ${u.ids.length}× RGs → [${u.genres.join(", ")}]`);
    console.log("\nDRY RUN — no writes.");
    return;
  }

  // Supabase Micro's disk-IO budget makes large UPDATEs time out (57014) under load. Keep each
  // statement small, retry timeouts with backoff, and pace gently so a re-run mops up rather than
  // fail-storms. Idempotent (genres IS NULL guard), so retries/re-runs never double-write.
  const CHUNK = 50;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const isTimeout = (msg: string) => /timeout|57014|canceling statement/i.test(msg);

  let written = 0, failed = 0;
  for (const u of updates) {
    for (let i = 0; i < u.ids.length; i += CHUNK) {
      const chunk = u.ids.slice(i, i + CHUNK);
      let ok = false;
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        if (attempt > 0) await sleep(400 * attempt); // back off before a retry
        const { error } = await s
          .from("release_groups")
          .update({ genres: u.genres })
          .in("id", chunk)
          .is("genres", null);
        if (!error) { ok = true; written += chunk.length; }
        else if (!isTimeout(error.message)) { console.log("  update error:", error.message); break; }
      }
      if (!ok) failed += chunk.length;
      await sleep(15); // gentle pacing to spare the IO budget
    }
    if (written % 1000 < CHUNK) process.stdout.write(`\r  written ~${written}/${fillRGs}  (failed ${failed})`);
  }
  console.log(`\n  done — wrote genres to ${written} release_groups${failed ? ` (${failed} still failed after retries)` : ""}.`);

  // final coverage
  const { count: nowTagged } = await s.from("release_groups").select("*", { count: "exact", head: true }).not("genres", "is", null);
  const { count: total } = await s.from("release_groups").select("*", { count: "exact", head: true });
  console.log(`  coverage now: ${nowTagged}/${total} (${((nowTagged! / total!) * 100).toFixed(1)}%)`);
})();
