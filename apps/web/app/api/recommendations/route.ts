import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../lib/authGuard';
import { rateLimit } from '../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../lib/cache';
import { eloToScore } from '../../../lib/elo';
import { albumCentroid, cosine, displayGenre } from '../../../lib/taste/embeddings';
import {
  W_GENRE,
  W_ERA,
  W_SCENE,
  eraAffinity,
  sceneAffinity,
  sceneOf,
  yearOf,
} from '../../../lib/taste/albumVector';
import {
  weightsFromRatings,
  buildClusters,
  clusterProfiles,
  blobAffinity,
  dislikedTags,
  type ClusterProfile,
  type TasteCluster,
} from '../../../lib/taste/profile';

// Personalized recommendations powering the Add page's discovery sections.
// Full rewrite (2026-07-12) — the previous version of this route was orphaned
// (nothing called it) and still queried the pre-renovation `releases` table,
// while the search page ran its own client-side queries that seeded from
// EVERY rated artist regardless of score (a 0.5★ artist seeded as strongly as
// a 5★ one) and never excluded already-rated albums.
//
// Service-role candidate queries (cheap, all index-backed) + in-memory
// genre-embedding rerank (lib/taste — zero extra DB load on the Micro
// instance), Redis-cached per user. Guarantees:
//   * nothing the user already rated is ever suggested;
//   * artists with any rating ≤ BLOCK_SCORE (1.5) are suppressed entirely —
//     and `blockedArtists` ships in the payload so the client can filter the
//     globally-cached rows (Popular/Trending) it assembles itself;
//   * candidates are ranked against the user's taste clusters (multi-modal),
//     with profiles.recommendation_adventurousness mixing how far from the
//     clusters the "For You" row is allowed to roam.
//
// Response sections (2026-07-12 restructure, same shape iOS should adopt):
//   fromYourTaste  — newest albums by artists the user loves (exploit)
//   forYou         — cross-cluster discovery blend (adventurousness-mixed)
//   worlds[]       — one cluster-pure row per taste world ("Because you love
//                    Shoegaze"), scored against THAT cluster's centroid only,
//                    deduped against the rows above
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 120;
const BLOCK_SCORE = 1.5; // ≤ this → artist suppressed from all suggestion rows
const LOVED_SCORE = 3.5; // ≥ this → artist eligible to seed "From Your Taste"
const SEED_SCORE = 4.0; //  ≥ this → album eligible to seed the similarity RPC
const FOR_YOU_SIZE = 40;
const FROM_TASTE_SIZE = 40;
const WORLD_ROW_SIZE = 20;
const MAX_WORLD_ROWS = 3;

interface CandidateRow {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  release_group_type: string | null;
  first_release_date: string | null;
  native_title: string | null;
  genres?: string[] | null;
  artists?: { country: string | null } | null;
}

const CAND_COLS =
  'id, title, artist_display, cover_url, release_group_type, first_release_date, native_title, genres, artists!release_groups_primary_artist_id_fkey(country)';

/** Response rows keep the RG_COLS shape the search page already maps. */
function strip(r: CandidateRow) {
  return {
    id: r.id,
    title: r.title,
    artist_display: r.artist_display,
    cover_url: r.cover_url,
    release_group_type: r.release_group_type,
    first_release_date: r.first_release_date,
    native_title: r.native_title,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Bucket proportions from adventurousness (0–100), carried over from the old
// route: conservative 90/8/2, default 70/20/10, adventurous 45/30/25.
function bucketSizes(adventurousness: number, total: number) {
  const t = Math.max(0, Math.min(100, adventurousness)) / 100;
  const inTastePct = 0.9 - 0.45 * t;
  const adjacentPct = 0.08 + 0.22 * t;
  const inTaste = Math.round(inTastePct * total);
  const adjacent = Math.round(adjacentPct * total);
  return { inTaste, adjacent, discovery: Math.max(0, total - inTaste - adjacent) };
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'recs', 30, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  // v4: 2026-07-12 blob scoring (genre ⊕ era ⊕ scene) changed the affinity math
  const cacheKey = `recs:v4:${userId}`;
  if (!refresh) {
    const cached = await cacheGet<object>(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  // ── 1. The user's rating history + adventurousness ─────────────────────────
  const [ratingsRes, profileRes] = await Promise.all([
    supabase
      .from('ratings')
      .select(
        'release_group_id, score, elo_score, release_groups(id, artist_display, genres, first_release_date, artists!release_groups_primary_artist_id_fkey(country))',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('profiles').select('recommendation_adventurousness').eq('id', userId).single(),
  ]);
  if (ratingsRes.error) {
    console.error('[recs] ratings query error:', ratingsRes.error.message);
    return NextResponse.json({ error: ratingsRes.error.message }, { status: 503 });
  }

  interface RatingRow {
    release_group_id: string;
    score: number | null;
    elo_score: number | null;
    release_groups: {
      id: string;
      artist_display: string;
      genres: string[] | null;
      first_release_date: string | null;
      artists: { country: string | null } | null;
    } | null;
  }
  const ratings = ((ratingsRes.data as unknown as RatingRow[] | null) ?? []).filter(
    (r) => r.release_groups,
  );
  const adventurousness =
    (profileRes.data as { recommendation_adventurousness: number | null } | null)
      ?.recommendation_adventurousness ?? 50;

  // ── 2. Signals ──────────────────────────────────────────────────────────────
  const ratedIds = new Set<string>(ratings.map((r) => r.release_group_id));
  const blockedArtists = new Set<string>();
  const lovedArtists = new Set<string>();
  const seedCandidates: { id: string; artist: string; display: number }[] = [];

  for (const r of ratings) {
    const display = r.score ?? (r.elo_score != null ? eloToScore(r.elo_score) : null);
    if (display == null) continue;
    const artist = r.release_groups!.artist_display;
    if (display <= BLOCK_SCORE) blockedArtists.add(artist);
    if (display >= LOVED_SCORE) lovedArtists.add(artist);
    if (display >= SEED_SCORE) {
      seedCandidates.push({ id: r.release_group_id, artist, display });
    }
  }
  for (const a of blockedArtists) lovedArtists.delete(a);

  // Top-rated seeds for the similarity RPC — max 3, distinct artists (RPC cost
  // scales with seed count; see migration 20260710000000's notes).
  const seenSeedArtists = new Set<string>();
  const seedIds = seedCandidates
    .filter((s) => !blockedArtists.has(s.artist))
    .sort((a, b) => b.display - a.display)
    .filter((s) => (seenSeedArtists.has(s.artist) ? false : (seenSeedArtists.add(s.artist), true)))
    .slice(0, 3)
    .map((s) => s.id);

  const weights = weightsFromRatings(
    ratings.map((r) => ({
      score: r.score,
      elo_score: r.elo_score,
      genres: r.release_groups!.genres,
    })),
  );
  const clusters = buildClusters(weights);
  const disliked = dislikedTags(weights);
  // Per-world era + scene profiles: the blob scoring judges a candidate's
  // year/country against the era/scene of the SPECIFIC world it genre-matches.
  const profiles = clusterProfiles(
    ratings.map((r) => ({
      genres: r.release_groups!.genres,
      first_release_date: r.release_groups!.first_release_date,
      country: r.release_groups!.artists?.country ?? null,
    })),
    clusters,
  );

  // ── 3. Candidate pools (parallel, all index-backed) ────────────────────────
  const lovedList = Array.from(lovedArtists).slice(0, 30);
  const clusterTagSets = clusters
    .slice(0, 3)
    .map((c) => c.tags.slice(0, 6).map((t) => t.tag));

  const [exploitRes, exploreRes, ...poolResults] = await Promise.all([
    // (a) more albums by artists the user loves — "From Your Taste"
    lovedList.length > 0
      ? supabase
          .from('release_groups')
          .select(CAND_COLS)
          .in('artist_display', lovedList)
          .in('release_group_type', ['album', 'ep'])
          .not('cover_url', 'is', null)
          .order('first_release_date', { ascending: false, nullsFirst: false })
          .limit(150)
      : Promise.resolve({ data: [] as CandidateRow[], error: null }),
    // (b) embedding-similar new artists (existing HNSW RPC)
    seedIds.length > 0
      ? supabase.rpc('get_taste_similar_releases', {
          p_seed_ids: seedIds,
          p_exclude_artists: Array.from(new Set([...lovedArtists, ...blockedArtists])),
        })
      : Promise.resolve({ data: [] as CandidateRow[], error: null }),
    // (c) per-cluster prestige pools — quality discovery inside each taste world
    ...clusterTagSets.map((tags) =>
      supabase
        .from('release_groups')
        .select(CAND_COLS)
        .overlaps('genres', tags)
        .not('prestige_score', 'is', null)
        .in('release_group_type', ['album', 'ep'])
        .not('cover_url', 'is', null)
        .order('prestige_score', { ascending: false })
        .limit(80),
    ),
  ]);

  for (const res of [exploitRes, exploreRes, ...poolResults]) {
    if (res.error) console.error('[recs] candidate query error:', res.error.message);
  }

  const usable = (r: CandidateRow) => !ratedIds.has(r.id) && !blockedArtists.has(r.artist_display);
  const exploit = ((exploitRes.data as CandidateRow[] | null) ?? []).filter(usable);
  // The RPC result lacks `genres` — affinity scoring treats missing genres as
  // neutral, which is fine: these already passed the RPC's own genre gate.
  const explore = ((exploreRes.data as CandidateRow[] | null) ?? []).filter(usable);
  // Kept per-cluster: the world rows need to know which pool belongs to which
  // taste world; forYou blends across all of them.
  const poolsByCluster = poolResults.map(
    (res) => ((res.data as CandidateRow[] | null) ?? []).filter(usable),
  );

  // ── 4. Assemble sections in-memory ─────────────────────────────────────────
  // "From Your Taste": newest-first per loved artist, cap 3 per artist.
  const perArtist: Record<string, number> = {};
  const fromYourTaste: CandidateRow[] = [];
  for (const r of exploit) {
    const n = perArtist[r.artist_display] ?? 0;
    if (n < 3) {
      fromYourTaste.push(r);
      perArtist[r.artist_display] = n + 1;
    }
  }

  const forYou = rankForYou({
    explore,
    pools: poolsByCluster.flat(),
    clusters,
    profiles,
    disliked,
    lovedArtists,
    adventurousness,
  });

  // World rows: cluster-pure, deduped against everything already shown above.
  const usedIds = new Set<string>([
    ...fromYourTaste.slice(0, FROM_TASTE_SIZE).map((r) => r.id),
    ...forYou.map((r) => r.id),
  ]);
  const worlds = buildWorldRows(clusters, profiles, poolsByCluster, usedIds, disliked);

  const payload = {
    fromYourTaste: shuffle(fromYourTaste).slice(0, FROM_TASTE_SIZE).map(strip),
    forYou: forYou.map(strip),
    worlds: worlds.map((w) => ({ label: w.label, albums: w.albums.map(strip) })),
    blockedArtists: Array.from(blockedArtists),
  };
  await cacheSet(cacheKey, payload, TTL_SECONDS);
  return NextResponse.json(payload);
}

/**
 * One row per taste world: pool candidates scored against that cluster's own
 * centroid (not the best-of-all-clusters blend forYou uses), so each row stays
 * stylistically pure — a k-pop+shoegaze listener gets one row of each instead
 * of two half-mixed ones. Rows that end up too thin (< 6 albums after dedupe)
 * are dropped rather than rendered sparse.
 */
function buildWorldRows(
  clusters: TasteCluster[],
  profiles: ClusterProfile[],
  poolsByCluster: CandidateRow[][],
  usedIds: Set<string>,
  disliked: Set<string>,
): { label: string; albums: CandidateRow[] }[] {
  const rows: { label: string; albums: CandidateRow[] }[] = [];
  clusters.slice(0, MAX_WORLD_ROWS).forEach((cluster, i) => {
    // A sliver of co-tag residue isn't a world — don't give it a whole row.
    if (cluster.share < 0.1) return;
    const pool = poolsByCluster[i] ?? [];
    const p = profiles[i];
    const scored = pool
      .filter((r) => !usedIds.has(r.id))
      .map((row) => {
        const vec = albumCentroid(row.genres);
        const genre = vec ? cosine(vec, cluster.centroid) : 0;
        // Same blob blend as forYou, but pinned to THIS world's era/scene.
        let sim = p
          ? W_GENRE * genre +
            W_ERA * eraAffinity(yearOf(row.first_release_date), { meanYear: p.meanYear, sdYears: p.sdYears }) +
            W_SCENE * sceneAffinity(sceneOf(row.artists?.country), p.sceneShares)
          : genre;
        sim -= Math.min(0.6, (row.genres ?? []).filter((g) => disliked.has(g)).length * 0.3);
        return { row, sim };
      })
      .sort((a, b) => b.sim - a.sim);

    const albums: CandidateRow[] = [];
    const artistCount: Record<string, number> = {};
    for (const { row } of scored) {
      if (albums.length >= WORLD_ROW_SIZE) break;
      const n = artistCount[row.artist_display] ?? 0;
      if (n >= 2) continue;
      albums.push(row);
      artistCount[row.artist_display] = n + 1;
      usedIds.add(row.id);
    }
    if (albums.length >= 6) {
      const top = cluster.tags[0];
      const second = cluster.tags[1];
      const label =
        second && second.w >= top.w * 0.5
          ? `${displayGenre(top.tag)} × ${displayGenre(second.tag)}`
          : displayGenre(top.tag);
      rows.push({ label, albums });
    }
  });
  return rows;
}

function rankForYou(args: {
  explore: CandidateRow[];
  pools: CandidateRow[];
  clusters: TasteCluster[];
  profiles: ClusterProfile[];
  disliked: Set<string>;
  lovedArtists: Set<string>;
  adventurousness: number;
}): CandidateRow[] {
  const { explore, pools, clusters, profiles, disliked, lovedArtists, adventurousness } = args;

  const seen = new Set<string>();
  const candidates: { row: CandidateRow; affinity: number; fromRpc: boolean }[] = [];
  for (const row of [...explore, ...pools]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    let affinity = blobAffinity(
      {
        genres: row.genres,
        year: yearOf(row.first_release_date),
        scene: sceneOf(row.artists?.country),
      },
      clusters,
      profiles,
    );
    const hitDisliked = (row.genres ?? []).filter((g) => disliked.has(g)).length;
    affinity -= Math.min(0.6, hitDisliked * 0.3);
    candidates.push({ row, affinity, fromRpc: explore.some((e) => e.id === row.id) });
  }

  // Buckets: in-taste = close to a cluster (or straight from the similarity
  // RPC), adjacent = mid-similarity, discovery = far/unknown territory.
  const inTaste = candidates.filter((c) => c.fromRpc || c.affinity >= 0.55);
  const adjacent = candidates.filter((c) => !c.fromRpc && c.affinity >= 0.35 && c.affinity < 0.55);
  const discovery = candidates.filter((c) => !c.fromRpc && c.affinity < 0.35);

  const sizes = bucketSizes(adventurousness, FOR_YOU_SIZE);
  const byAffinity = (a: { affinity: number }, b: { affinity: number }) => b.affinity - a.affinity;

  const picked: CandidateRow[] = [];
  const artistCount: Record<string, number> = {};
  const take = (
    pool: { row: CandidateRow; affinity: number }[],
    n: number,
    shuffled = false,
  ) => {
    const ordered = shuffled ? shuffle(pool) : [...pool].sort(byAffinity);
    let taken = 0;
    for (const c of ordered) {
      if (taken >= n) break;
      const a = c.row.artist_display;
      // Cap 2 per artist — discovery rows shouldn't be one artist's discography.
      if ((artistCount[a] ?? 0) >= 2) continue;
      if (picked.some((p) => p.id === c.row.id)) continue;
      // New-to-you bias: an artist the user already loves belongs in
      // "From Your Taste", not "For You".
      if (lovedArtists.has(a)) continue;
      picked.push(c.row);
      artistCount[a] = (artistCount[a] ?? 0) + 1;
      taken++;
    }
    return taken;
  };

  let filled = take(inTaste, sizes.inTaste);
  filled += take(adjacent, sizes.adjacent + (sizes.inTaste - filled));
  take(discovery, FOR_YOU_SIZE - filled, true);

  // Light shuffle so consecutive loads don't render an identical row, while
  // keeping roughly affinity-descending order (swap within a small window).
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.max(0, i - Math.floor(Math.random() * 4));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}
