/**
 * The Add page's personal rows (/api/recommendations), rebuilt on the TASTE MAP
 * (2026-10-17).
 *
 * "For You" used to be ranked against the old greedy embedding clusters
 * (lib/taste/profile.ts buildClusters), which have no language axis and weigh a
 * genre by Σ(score − 3), so a mostly-Korean-hip-hop listener — many of whose
 * albums carry no tags at all — got idol K-pop and Western canon (Beatles, Pink
 * Floyd) and no Korean hip-hop (scripts/dump-recommendations.ts). The Taste tab
 * had already moved to language-qualified worlds (lib/taste/worlds.ts), so the
 * two disagreed about who the user is.
 *
 * Now every rated album is placed exactly as the Taste tab places it (tags +
 * artist prior, in the album's language), and:
 *   * each liked world (avg ≥ MIN_WORLD_AVG) gets its own candidate pool — the
 *     world's genre spellings, restricted to the language's countries, by
 *     prestige — the same pool the Taste tab's per-world recs use;
 *   * candidates are placed too, and only same-language, in-world fits survive
 *     (worldAffinity), with a penalty for genres the user rates ≤ 2;
 *   * For You splits its slots across worlds by how much of the map each one is
 *     and how much the user likes it; adventurousness flattens that split and
 *     widens how deep into each world's list the row draws;
 *   * world rows ("Because you love Korean Hip-Hop") are the next-best fits of
 *     the biggest worlds, deduped against the rows above.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { releasedFilter } from '../releaseWindow';
import { yearOf } from './albumVector';
import { synonymsOf } from './genreSynonyms';
import { countriesOfLanguage, qualifiedInfo } from '../genres/language';
import { artistInputFor, loadArtistPriors } from './artistPrior';
import {
  buildTasteMap,
  placeAlbum,
  worldAffinity,
  OTHER_WORLD,
  WORLD_TILE_LIMIT,
  type AlbumPlacement,
  type TasteWorld,
} from './worlds';

const BLOCK_SCORE = 1.5; // ≤ this → artist suppressed from all suggestion rows
const LOVED_SCORE = 3.5; // ≥ this → artist feeds "From Your Taste", not "For You"
const FOR_YOU_SIZE = 40;
const FROM_TASTE_SIZE = 40;
const WORLD_ROW_SIZE = 20;
const MAX_WORLD_ROWS = 3;
const MIN_WORLD_ROW = 6;
/** Worlds the user rates below this on average get no recommendations. */
const MIN_WORLD_AVG = 2.75;
/** Worlds that get a candidate pool (one query each). */
const POOL_WORLDS = 6;
/** Every liked world with candidates gets at least this many For You slots. */
const MIN_SLOTS = 2;
/** Affinity lost per disliked genre on a candidate. */
const DISLIKE_PENALTY = 0.15;
/** Candidates read per world pool. */
const POOL_SIZE = 150;
/**
 * Best fits per world re-placed with their artist prior before ranking. Without
 * it an idol album tagged only [hip hop, pop] lands in Korean Hip-Hop.
 */
const PRIOR_TOP = 40;

export interface CandidateRow {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  release_group_type: string | null;
  first_release_date: string | null;
  native_title: string | null;
  genres: string[] | null;
  prestige_score?: number | null;
  title_language?: string | null;
  primary_artist_id?: string | null;
  artists?: { country: string | null; native_language?: string | null } | null;
}

const CAND_COLS =
  'id, title, artist_display, cover_url, release_group_type, first_release_date, native_title, genres, prestige_score, title_language, primary_artist_id';

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

/**
 * The best `window` of an already best-first list, shuffled, then the rest. A
 * pull-to-refresh (or a high adventurousness) widens the window so the row
 * changes while the picks stay strong fits.
 */
function rotateTop<T>(sorted: T[], window: number): T[] {
  if (window <= 1) return sorted;
  const k = Math.min(sorted.length, window);
  return [...shuffle(sorted.slice(0, k)), ...sorted.slice(k)];
}

/** Largest-remainder split of `total` slots by weight, at least `min` each. */
function allocate(weights: number[], total: number, min: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const floor = Math.min(min, Math.floor(total / n));
  const rest = total - floor * n;
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const exact = weights.map((w) => (w / sum) * rest);
  const out = exact.map((x) => floor + Math.floor(x));
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) out[order[k].i]++;
  return out;
}

export interface RecommendationsPayload {
  fromYourTaste: ReturnType<typeof strip>[];
  forYou: ReturnType<typeof strip>[];
  worlds: { label: string; labelKo: string; albums: ReturnType<typeof strip>[] }[];
  blockedArtists: string[];
}

export interface RecommendationsDebug {
  worlds: { key: string; label: string; mass: number; avg: number; weight: number; pool: number; fits: number; slots: number }[];
}

interface RatingRow {
  release_group_id: string;
  score: number | null;
  release_groups: {
    id: string;
    title: string;
    native_title: string | null;
    artist_display: string;
    genres: string[] | null;
    first_release_date: string | null;
    primary_artist_id: string | null;
    title_language: string | null;
    artists: { name: string | null; country: string | null; native_language: string | null } | null;
  } | null;
}

/**
 * Compute the Add page's personal rows for one user. `vary` (pull-to-refresh)
 * draws a different selection of strong fits instead of strictly best-first.
 */
export async function computeRecommendations(
  supabase: SupabaseClient,
  userId: string,
  { vary = false }: { vary?: boolean } = {},
): Promise<{ payload: RecommendationsPayload; debug: RecommendationsDebug }> {
  // ── 1. Rating history + adventurousness ─────────────────────────────────────
  const [ratingsRes, profileRes] = await Promise.all([
    supabase
      .from('ratings')
      .select(
        'release_group_id, score, release_groups(id, title, native_title, artist_display, genres, first_release_date, primary_artist_id, title_language, artists!release_groups_primary_artist_id_fkey(name, country, native_language))',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase.from('profiles').select('recommendation_adventurousness').eq('id', userId).single(),
  ]);
  if (ratingsRes.error) throw new Error(ratingsRes.error.message);

  const ratings = ((ratingsRes.data as unknown as RatingRow[] | null) ?? []).filter(
    (r) => r.release_groups,
  );
  const adventurousness =
    (profileRes.data as { recommendation_adventurousness: number | null } | null)
      ?.recommendation_adventurousness ?? 50;
  const t = Math.max(0, Math.min(100, adventurousness)) / 100;

  // ── 2. Artist signals ───────────────────────────────────────────────────────
  const ratedIds = new Set<string>(ratings.map((r) => r.release_group_id));
  const blockedArtists = new Set<string>();
  const lovedArtists = new Set<string>();
  for (const r of ratings) {
    if (r.score == null) continue;
    const artist = r.release_groups!.artist_display;
    if (r.score <= BLOCK_SCORE) blockedArtists.add(artist);
    if (r.score >= LOVED_SCORE) lovedArtists.add(artist);
  }
  for (const a of blockedArtists) lovedArtists.delete(a);

  // ── 3. The user's taste map, placed exactly as the Taste tab places it ──────
  const priors = await loadArtistPriors(
    supabase,
    ratings.map((r) => r.release_groups!.primary_artist_id),
  );
  const tasteMap = buildTasteMap(
    ratings
      .filter((r) => r.score != null)
      .map((r) => {
        const rg = r.release_groups!;
        const placement = placeAlbum({
          genres: rg.genres,
          title: rg.title,
          nativeTitle: rg.native_title,
          artistCountry: rg.artists?.country ?? null,
          artistNativeLanguage: rg.artists?.native_language ?? null,
          titleLanguage: rg.title_language,
          artistName: rg.artists?.name ?? null,
          ...artistInputFor(priors, rg.primary_artist_id, rg.id, rg.artists?.country),
        });
        const inferred = !rg.genres?.length && placement.world != null;
        return {
          id: rg.id,
          score: r.score!,
          year: yearOf(rg.first_release_date),
          country: rg.artists?.country ?? null,
          placement,
          confidence: inferred ? 0.5 : 1,
        };
      }),
  );
  const disliked = new Set(
    tasteMap.worlds
      .filter((w) => w.key !== OTHER_WORLD)
      .flatMap((w) => w.tiles)
      .filter((tile) => tile.mass >= 1.5 && tile.avg <= 2.0)
      .map((tile) => tile.id),
  );
  // Liked worlds, strongest pull first: how much of the map it is × how much
  // the user likes it. Adventurousness flattens the split toward small worlds.
  const liked = tasteMap.worlds
    .filter((w) => w.key !== OTHER_WORLD && w.centroid && w.avg >= MIN_WORLD_AVG)
    .map((w) => ({ world: w, weight: w.mass * Math.max(0.25, w.avg - 2.5) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, POOL_WORLDS);

  // ── 4. Candidate pools: "From Your Taste" + one pool per liked world ───────
  const lovedList = Array.from(lovedArtists).slice(0, 30);
  const [exploitRes, ...poolResults] = await Promise.all([
    lovedList.length > 0
      ? supabase
          .from('release_groups')
          .select(CAND_COLS)
          .in('artist_display', lovedList)
          .in('release_group_type', ['album', 'ep'])
          .not('cover_url', 'is', null)
          .or(releasedFilter())
          .order('first_release_date', { ascending: false, nullsFirst: false })
          .limit(150)
      : Promise.resolve({ data: [] as CandidateRow[], error: null }),
    ...liked.map(({ world }) => worldPool(supabase, world)),
  ]);
  for (const res of [exploitRes, ...poolResults]) {
    if (res.error) console.error('[recs] candidate query error:', res.error.message);
  }

  const usable = (r: CandidateRow) => !ratedIds.has(r.id) && !blockedArtists.has(r.artist_display);

  // "From Your Taste": newest-first per loved artist, cap 3 per artist.
  const perArtist: Record<string, number> = {};
  const fromYourTaste: CandidateRow[] = [];
  for (const r of ((exploitRes.data as CandidateRow[] | null) ?? []).filter(usable)) {
    const n = perArtist[r.artist_display] ?? 0;
    if (n < 3) {
      fromYourTaste.push(r);
      perArtist[r.artist_display] = n + 1;
    }
  }

  // Each world's fits, best first (affinity, then prestige). A fit must LIVE in
  // the world — its own placement, not just a shared tag (an idol album tagged
  // [k-pop, hip hop] is K-Pop, not Korean Hip-Hop).
  const place = (r: CandidateRow, prior?: ReturnType<typeof artistInputFor>): AlbumPlacement =>
    placeAlbum({
      genres: r.genres,
      title: r.title,
      nativeTitle: r.native_title,
      artistCountry: r.artists?.country ?? null,
      artistNativeLanguage: r.artists?.native_language ?? null,
      titleLanguage: r.title_language ?? null,
      ...prior,
    });
  const score = (r: CandidateRow, placement: AlbumPlacement, world: TasteWorld) => {
    const aff = worldAffinity(placement, yearOf(r.first_release_date), world);
    return aff > 0 ? aff - DISLIKE_PENALTY * placement.all.filter((q) => disliked.has(q)).length : 0;
  };
  const best = (a: { row: CandidateRow; aff: number }, b: { row: CandidateRow; aff: number }) =>
    b.aff - a.aff || (b.row.prestige_score ?? 0) - (a.row.prestige_score ?? 0);
  // Pass 1, tags only: anything that could belong (the world or a runner-up).
  const roughFits = liked.map(({ world }, i) => {
    const seen = new Set<string>();
    return ((poolResults[i]?.data as CandidateRow[] | null) ?? [])
      .filter((r) => usable(r) && !seen.has(r.id) && (seen.add(r.id), true))
      .map((row) => ({ row, placement: place(row) }))
      .filter(
        ({ placement: p }) => p.world === world.key || p.alternates?.some((a) => a.world === world.key),
      )
      .map((c) => ({ ...c, aff: score(c.row, c.placement, world) }))
      .filter((c) => c.aff > 0)
      .sort(best)
      .slice(0, PRIOR_TOP);
  });
  // Pass 2: the top fits re-placed with their artist's prior; only true members stay.
  const candPriors = await loadArtistPriors(
    supabase,
    roughFits.flat().map((c) => c.row.primary_artist_id),
  );
  const fitsByWorld = liked.map(({ world }, i) =>
    roughFits[i]
      .map(({ row }) => {
        const p = place(row, artistInputFor(candPriors, row.primary_artist_id, row.id, row.artists?.country));
        return { row, aff: p.world === world.key ? score(row, p, world) : 0 };
      })
      .filter((c) => c.aff > 0)
      .sort(best),
  );

  // ── 5. For You: slots per world, drawn from the top of each world's fits ───
  const active = liked
    .map((l, i) => ({ ...l, fits: fitsByWorld[i] }))
    .filter((l) => l.fits.length > 0);
  const slots = allocate(
    active.map((a) => a.weight ** (1 - 0.6 * t)),
    FOR_YOU_SIZE,
    MIN_SLOTS,
  );
  const usedIds = new Set<string>();
  const usedArtists = new Set<string>();
  const perWorld: CandidateRow[][] = active.map((a, i) => {
    const want = slots[i];
    // Window: how deep into the best-first list the row may reach.
    const window = Math.round(want * (1 + 2 * t + (vary ? 1 : 0)));
    const out: CandidateRow[] = [];
    for (const { row } of rotateTop(a.fits, window)) {
      if (out.length >= want) break;
      // New to you: loved artists belong in "From Your Taste"; one per artist.
      if (lovedArtists.has(row.artist_display) || usedArtists.has(row.artist_display)) continue;
      if (usedIds.has(row.id)) continue;
      out.push(row);
      usedIds.add(row.id);
      usedArtists.add(row.artist_display);
    }
    return out;
  });
  // Interleave by weight (smooth weighted round-robin): the row opens on the
  // strongest world without becoming one block per world.
  const forYou: CandidateRow[] = [];
  const credit = perWorld.map(() => 0);
  const cursor = perWorld.map(() => 0);
  const totalSlots = slots.reduce((s, x) => s + x, 0) || 1;
  while (forYou.length < perWorld.reduce((s, l) => s + l.length, 0)) {
    let best = -1;
    for (let i = 0; i < perWorld.length; i++) {
      if (cursor[i] >= perWorld[i].length) continue;
      credit[i] += slots[i] / totalSlots;
      if (best < 0 || credit[i] > credit[best]) best = i;
    }
    if (best < 0) break;
    credit[best] -= 1;
    forYou.push(perWorld[best][cursor[best]++]);
  }

  // ── 6. World rows: the next-best fits of the biggest worlds ────────────────
  const worlds: RecommendationsPayload['worlds'] = [];
  for (const a of active) {
    if (worlds.length >= MAX_WORLD_ROWS) break;
    const albums: CandidateRow[] = [];
    const artistCount: Record<string, number> = {};
    for (const { row } of rotateTop(a.fits, vary ? WORLD_ROW_SIZE * 2 : 1)) {
      if (albums.length >= WORLD_ROW_SIZE) break;
      if (usedIds.has(row.id)) continue;
      const n = artistCount[row.artist_display] ?? 0;
      if (n >= 2) continue;
      albums.push(row);
      artistCount[row.artist_display] = n + 1;
    }
    if (albums.length < MIN_WORLD_ROW) continue;
    for (const r of albums) usedIds.add(r.id);
    worlds.push({ label: a.world.label.en, labelKo: a.world.label.ko, albums: albums.map(strip) });
  }

  return {
    payload: {
      fromYourTaste: shuffle(fromYourTaste).slice(0, FROM_TASTE_SIZE).map(strip),
      forYou: forYou.map(strip),
      worlds,
      blockedArtists: Array.from(blockedArtists),
    },
    debug: {
      worlds: liked.map((l, i) => {
        const ai = active.findIndex((a) => a.world.key === l.world.key);
        return {
          key: l.world.key,
          label: l.world.label.en,
          mass: l.world.mass,
          avg: l.world.avg,
          weight: Math.round(l.weight * 100) / 100,
          pool: ((poolResults[i]?.data as unknown[] | null) ?? []).length,
          fits: fitsByWorld[i].length,
          slots: ai >= 0 ? slots[ai] : 0,
        };
      }),
    },
  };
}

/**
 * One world's candidates: albums carrying any spelling of the world's top tiles
 * (or their unqualified base genre), restricted to the world language's
 * countries, best prestige first — the same pool as the Taste tab's world recs
 * (app/api/taste/profile/route.ts).
 */
async function worldPool(supabase: SupabaseClient, world: TasteWorld) {
  const spellings = new Set<string>();
  for (const tile of [{ id: world.key }, ...world.tiles.slice(0, WORLD_TILE_LIMIT)]) {
    const info = qualifiedInfo(tile.id);
    for (const id of [tile.id, info?.base]) {
      if (id && !id.includes('@')) for (const sp of synonymsOf(id)) spellings.add(sp);
    }
  }
  if (spellings.size === 0) return { data: [] as CandidateRow[], error: null };
  const countries = countriesOfLanguage(world.language);
  let q = supabase
    .from('release_groups')
    .select(
      `${CAND_COLS}, artists!release_groups_primary_artist_id_fkey${countries.length > 0 ? '!inner' : ''}(country, native_language)`,
    )
    .overlaps('genres', Array.from(spellings))
    .in('release_group_type', ['album', 'ep'])
    .not('cover_url', 'is', null)
    .or(releasedFilter());
  if (countries.length > 0) q = q.in('artists.country', countries);
  const { data, error } = await q
    .order('prestige_score', { ascending: false, nullsFirst: false })
    .limit(POOL_SIZE);
  return { data: (data ?? []) as unknown as CandidateRow[], error };
}
