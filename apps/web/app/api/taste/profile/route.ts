import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';
import { cacheGet, cacheSet } from '../../../../lib/cache';
import { preferHangulName } from '../../../../lib/sj/display';
import { cosine, displayGenre } from '../../../../lib/taste/embeddings';
import { synonymsOf } from '../../../../lib/taste/genreSynonyms';
import { sceneOf, yearOf, type Scene } from '../../../../lib/taste/albumVector';
import { weightsFromRatings } from '../../../../lib/taste/profile';
import {
  buildTasteMap,
  placeAlbum,
  qualifiedVector,
  worldAffinity,
  OTHER_WORLD,
  type AlbumPlacement,
} from '../../../../lib/taste/worlds';
import { countriesOfLanguage, qualifiedInfo } from '../../../../lib/genres/language';

// Full taste analysis for the Taste page (2026-07-13 rebuild: a graphical
// analysis report — world composition, release-decade and score-distribution
// histograms, scene mix, canon reach, 12-month activity — the MBTI-style
// 4-letter type is gone). Everything is computed here from a single ratings
// fetch so the client renders one payload. Clustering/vector math stays in
// Node against the bundled embeddings (Micro-instance rule).
//
// The user's stored profile row (user_taste_profiles) is still upserted when
// it drifts, since iOS/other consumers read it — but this route derives from
// the ratings directly, which it needs anyway for the charts.
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const TTL_SECONDS = 60;
/** Tags per world that become sub-genre bubbles (and get their own rec list). */
const GRAPH_TAGS = 8;
/** Worlds that get a prestige candidate pool for the graph's side panel — every
 *  world the taste map can emit (MAX_WORLDS), each filtered to its own language. */
const REC_POOL_WORLDS = 7;
/** Tags an untagged album borrows from its artist's other albums. */
const BORROWED_TAGS = 4;
const RECS_PER_FOCUS = 6;
/** Cap on the rated albums shipped for the side panel (score-descending). */
const GRAPH_ALBUMS = 400;

interface RatingRow {
  score: number | null;
  created_at: string;
  release_groups: {
    id: string;
    title: string;
    artist_display: string;
    cover_url: string | null;
    native_title: string | null;
    genres: string[] | null;
    first_release_date: string | null;
    prestige_score: number | null;
    primary_artist_id: string | null;
    title_language: string | null;
    artists: { name_native: string | null; country: string | null; native_language: string | null } | null;
  } | null;
}

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, 'taste-profile', 30, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  // v10: 2026-08-12 — a scene-pinned world (j-pop/k-pop) now takes its scene from
  // its genres, not the countries of albums that landed nearest its centroid, and
  // its recs are scene-filtered — so a J-pop world stops labelling itself "Korean
  // scene" and stops recommending K-pop. v9 added synonym-merge + affinity recs;
  // v8 gave J-pop its own world; v7 the clustering scene-lock.
  // v11: 2026-08-27 — "By the numbers" rebuild adds the tied-#1 hall-of-fame list
  // (topAlbums/topScore) and richer stats (median, skew, effectiveGenres,
  // communityDelta, perfectRate). v10 scene-pinned worlds; v9 synonym-merge recs.
  // v12: 2026-09-26 — adds charts.countries (per-ISO-3166 artist country, the
  // web chart's replacement for the kr/jp/west/other scene mix). charts.scenes
  // stays for iOS, which still renders it; the world labels keep using scenes.
  // v13: 2026-09-28 — the taste map is rebuilt on taxonomy × language
  // (lib/taste/worlds.ts): worlds are language-qualified families (J-Rock,
  // Korean Hip-Hop, Rock…), tiles are qualified genres, untagged albums borrow
  // their artist's tags; clusters[] gains key/label/labelKo/language.
  // v14: 2026-09-28 — language-name labels ("Korean Rock"), tiles show the plain
  // genre (only the world names the language), MB tracklist language as evidence.
  const cacheKey = `taste:profile:v14:${userId}`;
  if (!refresh) {
    const cached = await cacheGet<object>(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'not configured' }, { status: 503 });

  const [ratingsRes, standingsRes, trackCountRes, albumCountRes] = await Promise.all([
    supabase
      .from('ratings')
      .select(
        'score, created_at, release_groups(id, title, artist_display, cover_url, native_title, genres, first_release_date, prestige_score, primary_artist_id, title_language, artists!release_groups_primary_artist_id_fkey(name_native, country, native_language))',
      )
      .eq('user_id', userId)
      .limit(500),
    supabase.rpc('get_user_genre_standings', { p_user_id: userId }),
    supabase
      .from('track_ratings')
      .select('recording_id', { count: 'exact', head: true })
      .eq('user_id', userId),
    // Exact album total — the row fetch above is capped at 500, and the "rated"
    // headline must agree with the profile header, which counts everything.
    supabase
      .from('ratings')
      .select('release_group_id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);
  if (ratingsRes.error) {
    console.error('[taste] ratings query error:', ratingsRes.error.message);
    return NextResponse.json({ error: ratingsRes.error.message }, { status: 503 });
  }

  const rows = ((ratingsRes.data as unknown as RatingRow[] | null) ?? []).filter(
    (r) => r.release_groups,
  );
  const display = (r: RatingRow) => r.score;
  const scored = rows.filter((r) => display(r) != null);

  // ── weights / clusters (+ keep the stored profile row in sync for iOS) ──
  const weights = weightsFromRatings(
    rows.map((r) => ({ score: r.score, genres: r.release_groups!.genres })),
  );
  // ── taste map: language-qualified worlds (lib/taste/worlds.ts) ──
  // Albums with no genre tags of their own (most of the Korean catalog) borrow
  // the tags most common across their artist's other albums, at half weight, so
  // they still land in a world instead of vanishing from the map.
  const untaggedArtists = Array.from(
    new Set(
      rows
        .filter((r) => !r.release_groups!.genres?.length && r.release_groups!.primary_artist_id)
        .map((r) => r.release_groups!.primary_artist_id!),
    ),
  ).slice(0, 200);
  const borrowed = new Map<string, string[]>();
  if (untaggedArtists.length > 0) {
    const { data: sib, error: sibErr } = await supabase
      .from('release_groups')
      .select('primary_artist_id, genres')
      .in('primary_artist_id', untaggedArtists)
      .not('genres', 'is', null)
      .limit(1000);
    if (sibErr) console.error('[taste] artist genre fallback error:', sibErr.message);
    const counts = new Map<string, { albums: number; tags: Map<string, number> }>();
    for (const g of (sib as { primary_artist_id: string; genres: string[] | null }[] | null) ?? []) {
      if (!g.genres?.length) continue;
      const e = counts.get(g.primary_artist_id) ?? { albums: 0, tags: new Map<string, number>() };
      e.albums += 1;
      for (const t of g.genres) e.tags.set(t, (e.tags.get(t) ?? 0) + 1);
      counts.set(g.primary_artist_id, e);
    }
    for (const [artist, e] of counts) {
      const tags = [...e.tags.entries()]
        .filter(([, n]) => n >= Math.max(1, 0.3 * e.albums))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, BORROWED_TAGS)
        .map(([t]) => t);
      if (tags.length > 0) borrowed.set(artist, tags);
    }
  }
  const placed = rows.map((r) => {
    const rg = r.release_groups!;
    const own = rg.genres?.length ? rg.genres : null;
    const genres = own ?? borrowed.get(rg.primary_artist_id ?? '') ?? null;
    return {
      row: r,
      inferred: !own && genres != null,
      placement: placeAlbum({
        genres,
        title: rg.title,
        nativeTitle: rg.native_title,
        artistCountry: rg.artists?.country ?? null,
        artistNativeLanguage: rg.artists?.native_language ?? null,
        titleLanguage: rg.title_language,
      }),
    };
  });
  const tasteMap = buildTasteMap(
    placed
      .filter((p) => display(p.row) != null)
      .map((p) => ({
        id: p.row.release_groups!.id,
        score: display(p.row)!,
        year: yearOf(p.row.release_groups!.first_release_date),
        country: p.row.release_groups!.artists?.country ?? null,
        placement: p.placement,
        confidence: p.inferred ? 0.5 : 1,
      })),
  );
  const worlds = tasteMap.worlds;
  // Genres you demonstrably dislike: weighted average ≤ 2.0 over enough evidence.
  const disliked = worlds
    .filter((w) => w.key !== OTHER_WORLD)
    .flatMap((w) => w.tiles)
    .filter((t) => t.mass >= 1.5 && t.avg <= 2.0)
    .sort((a, b) => a.avg - b.avg || b.mass - a.mass);
  // Fired here, awaited later (alongside recPools below) instead of blocking immediately --
  // nothing computed between here and the response depends on this write completing, it's a
  // side-effect for other consumers (iOS reads user_taste_profiles directly elsewhere). Still
  // awaited before the response is sent (not true fire-and-forget) since a Vercel serverless
  // function isn't guaranteed to keep running once a response goes out -- this only removes it
  // from the serial critical path, overlapping it with the CPU-bound work below and recPools'
  // own network round-trip instead of sitting in between them.
  const upsertPromise = supabase.from('user_taste_profiles').upsert({
    user_id: userId,
    genre_weights: weights,
    // Exact count, not rows.length — the row fetch is capped at 500 and writing
    // a capped number here would make the stored profile look drifted forever.
    rating_count: albumCountRes.count ?? rows.length,
    updated_at: new Date().toISOString(),
  });

  // ── headline stats (means + population std devs) ──
  const scores = scored.map((r) => display(r)!);
  const avgScore = scores.length > 0 ? scores.reduce((s, x) => s + x, 0) / scores.length : null;
  const sdScore =
    avgScore != null && scores.length > 1
      ? Math.sqrt(scores.reduce((s, x) => s + (x - avgScore) ** 2, 0) / scores.length)
      : null;
  const fiveStars = scores.filter((x) => x >= 5).length;
  const perfectRate = scores.length > 0 ? fiveStars / scores.length : null;

  // Median + distribution shape — what the mean alone can't tell you. The median
  // is the score you're as likely to sit above as below; comparing it to the mean
  // (and the sign of the Fisher–Pearson moment skewness) says which way your
  // scale leans: skew < 0 means a long tail of harsh ratings under a generous
  // hump, skew > 0 the reverse.
  const sortedScores = [...scores].sort((a, b) => a - b);
  const median =
    sortedScores.length === 0
      ? null
      : sortedScores.length % 2 === 1
        ? sortedScores[(sortedScores.length - 1) / 2]
        : (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2;
  const skew =
    avgScore != null && sdScore != null && sdScore > 0 && scores.length > 2
      ? scores.reduce((s, x) => s + ((x - avgScore) / sdScore) ** 3, 0) / scores.length
      : null;

  // Effective genre count — the Hill number of order 1 (exp of the Shannon
  // entropy over how many of your ratings fall in each genre). A genuine
  // diversity measure, not a raw tally: 1.0 means everything sits in one genre;
  // a value near your genre total means your listening spreads evenly across all
  // of them. Uses the language-qualified taxonomy ids, so spelling variants
  // don't inflate it and J-Rock counts apart from Rock.
  const genreCounts = new Map<string, number>();
  for (const p of placed) {
    for (const q of p.placement.all) genreCounts.set(q, (genreCounts.get(q) ?? 0) + 1);
  }
  const genreMass = Array.from(genreCounts.values()).reduce((a, b) => a + b, 0);
  let entropy = 0;
  if (genreMass > 0) {
    for (const c of genreCounts.values()) {
      const p = c / genreMass;
      if (p > 0) entropy -= p * Math.log(p);
    }
  }
  const effectiveGenres = genreMass > 0 ? Math.exp(entropy) : null;

  const years = rows
    .map((r) => r.release_groups!.first_release_date)
    .filter((d): d is string => !!d)
    .map((d) => parseInt(d.slice(0, 4), 10))
    .filter((y) => y >= 1900);
  const meanYear = years.length > 0 ? years.reduce((s, y) => s + y, 0) / years.length : null;
  const sdYears =
    meanYear != null && years.length > 1
      ? Math.sqrt(years.reduce((s, y) => s + (y - meanYear) ** 2, 0) / years.length)
      : null;

  const top = scored.reduce<RatingRow | null>(
    (best, r) => (best == null || (display(r) ?? 0) > (display(best) ?? 0) ? r : best),
    null,
  );

  // Every album tied at your top score — the "hall of fame" the client rotates
  // through. When a whole run of albums shares your ceiling (e.g. eleven 5.0s),
  // singling one out is arbitrary, so ship them all (newest first, capped, one
  // row per release group).
  const topScore = top != null ? display(top) : null;
  const seenTopIds = new Set<string>();
  const topAlbums =
    topScore == null
      ? []
      : scored
          .filter((r) => display(r) === topScore)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .filter((r) => {
            const id = r.release_groups!.id;
            if (seenTopIds.has(id)) return false;
            seenTopIds.add(id);
            return true;
          })
          .slice(0, 12)
          .map((r) => {
            const rg = r.release_groups!;
            return {
              id: rg.id,
              title: preferHangulName(rg.title, rg.native_title),
              artist: preferHangulName(rg.artist_display, rg.artists?.name_native ?? null),
              coverUrl: rg.cover_url,
              score: display(r)!,
            };
          });

  // ── chart data ──
  // Release decades (contiguous, zero-filled between first and last).
  const decadeMap = new Map<number, number>();
  for (const y of years) {
    const d = Math.floor(y / 10) * 10;
    decadeMap.set(d, (decadeMap.get(d) ?? 0) + 1);
  }
  const decades: { decade: number; count: number }[] = [];
  if (decadeMap.size > 0) {
    const first = Math.min(...decadeMap.keys());
    const last = Math.max(...decadeMap.keys());
    for (let d = first; d <= last; d += 10) decades.push({ decade: d, count: decadeMap.get(d) ?? 0 });
  }

  // Release years, contiguous and zero-filled. The "stock" chart draws a grouped
  // frequency histogram over this: per year, how many of your ratings landed
  // above vs below your overall average (two bars), plus a moving average of the
  // total-per-year as the pace line.
  const yearMap = new Map<number, number>();
  for (const y of years) yearMap.set(y, (yearMap.get(y) ?? 0) + 1);
  // Per-release-year split of scored ratings around the overall average.
  const yearSplit = new Map<number, { above: number; below: number }>();
  for (const r of scored) {
    const d = r.release_groups!.first_release_date;
    if (!d) continue;
    const y = parseInt(d.slice(0, 4), 10);
    if (!(y >= 1900)) continue;
    const cur = yearSplit.get(y) ?? { above: 0, below: 0 };
    if (avgScore != null && display(r)! >= avgScore) cur.above += 1;
    else cur.below += 1;
    yearSplit.set(y, cur);
  }
  const yearSeries: { year: number; above: number; below: number }[] = [];
  if (yearMap.size > 0) {
    const first = Math.min(...yearMap.keys());
    const last = Math.max(...yearMap.keys());
    for (let y = first; y <= last; y += 1) {
      const s = yearSplit.get(y);
      yearSeries.push({ year: y, above: s?.above ?? 0, below: s?.below ?? 0 });
    }
  }

  // Score distribution in half-star buckets (index 0 = 0.5★ … 9 = 5.0★).
  const scoreDist = Array.from({ length: 10 }, () => 0);
  for (const x of scores) scoreDist[Math.max(0, Math.min(9, Math.round(x * 2) - 1))] += 1;

  // Scene mix across all rated albums, by primary artist country.
  const sceneCounts: Record<Scene, number> = { kr: 0, jp: 0, west: 0, other: 0 };
  let sceneTotal = 0;
  for (const r of rows) {
    const s = sceneOf(r.release_groups!.artists?.country ?? null);
    if (s) {
      sceneCounts[s] += 1;
      sceneTotal += 1;
    }
  }

  // Country mix: the primary artist's actual country code, every one kept —
  // the client decides how many to show and folds the rest into "Other".
  // Albums whose artist has no country count separately as `unknown`.
  const countryCounts: Record<string, number> = {};
  let countryUnknown = 0;
  for (const r of rows) {
    const c = r.release_groups!.artists?.country?.trim().toUpperCase();
    if (c) countryCounts[c] = (countryCounts[c] ?? 0) + 1;
    else countryUnknown += 1;
  }
  const countryItems = Object.entries(countryCounts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  // Rating activity over the last 12 calendar months (oldest first).
  const timeline: { month: string; count: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    timeline.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, count: 0 });
  }
  const monthIndex = new Map(timeline.map((t, i) => [t.month, i]));
  for (const r of rows) {
    const d = new Date(r.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const i = monthIndex.get(key);
    if (i != null) timeline[i].count += 1;
  }
  const peakCount = Math.max(...timeline.map((t) => t.count));

  // Canon reach: share of rated albums in the prestige canon (proxy for
  // mainstream/canonical listening — prestige covers curated canon lists).
  const prestigeShare =
    rows.length > 0
      ? rows.filter((r) => r.release_groups!.prestige_score != null).length / rows.length
      : 0;

  const r2 = (x: number | null) => (x != null ? Math.round(x * 100) / 100 : null);

  // ── Taste map ──────────────────────────────────────────────────────────────
  // Worlds are language-qualified sound families (lib/taste/worlds.ts): a world
  // is a tile, its qualified genres are the sub-genre tiles you zoom into. The
  // similarity matrices ride along for clients that lay out by similarity.
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const graphWorlds = worlds.map((w, i) => {
    const tags = w.tiles.slice(0, GRAPH_TAGS);
    const vecs = tags.map((t) => qualifiedVector(t.id));
    return {
      key: `world:${i}`,
      label: w.label.en,
      labelKo: w.label.ko,
      primary: w.label.en,
      language: w.language,
      share: w.share,
      mass: w.mass,
      avg: w.avg,
      sim: worlds.map((o) => (w.centroid && o.centroid ? r3(cosine(w.centroid, o.centroid)) : 0)),
      tags: tags.map((t) => ({
        tag: t.id,
        display: t.display.en,
        displayKo: t.display.ko,
        mass: t.mass,
        share: t.share,
        avg: t.avg,
      })),
      tagSim: vecs.map((a) => vecs.map((b) => (a && b ? r3(cosine(a, b)) : 0))),
    };
  });

  // Every tile that can be focused — the side panel filters the user's ratings
  // against this vocabulary, so albums ship with their in-vocab tiles only.
  const vocab = new Set<string>();
  for (const w of graphWorlds) for (const t of w.tags) vocab.add(t.tag);

  const ratedIds = new Set<string>(rows.map((r) => r.release_groups!.id));
  const graphAlbums = scored
    .map((r) => {
      const rg = r.release_groups!;
      const tags = (tasteMap.albumTiles.get(rg.id) ?? []).filter((t) => vocab.has(t)).slice(0, 5);
      if (tags.length === 0) return null;
      return {
        id: rg.id,
        title: preferHangulName(rg.title, rg.native_title),
        artist: preferHangulName(rg.artist_display, rg.artists?.name_native ?? null),
        coverUrl: rg.cover_url,
        score: Math.round(display(r)! * 10) / 10,
        tags,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, GRAPH_ALBUMS);

  // One candidate pool per world: prestige gates it to canon-quality albums
  // overlapping the world's genres (every raw spelling of each tile's base
  // genre), restricted in SQL to the language's countries where it has a
  // country list; then every candidate is placed on the map in Node and only
  // same-language, in-world fits survive, ranked by world affinity with
  // prestige as the tiebreak. Already-rated albums are excluded here.
  const poolWorlds = worlds.slice(0, REC_POOL_WORLDS);
  const [recPools, { error: upsertErr }] = await Promise.all([
    Promise.all(
      poolWorlds.map(async (w) => {
        if (w.key === OTHER_WORLD) return { data: [] as unknown[], error: null };
        const spellings = new Set<string>();
        for (const t of w.tiles.slice(0, GRAPH_TAGS)) {
          const info = qualifiedInfo(t.id);
          for (const id of [t.id, info?.base]) {
            if (id && !id.includes('@')) for (const sp of synonymsOf(id)) spellings.add(sp);
          }
        }
        const countries = countriesOfLanguage(w.language);
        let q = supabase
          .from('release_groups')
          .select(
            `id, title, artist_display, cover_url, native_title, genres, first_release_date, prestige_score, title_language, artists!release_groups_primary_artist_id_fkey${countries.length > 0 ? '!inner' : ''}(country, native_language)`,
          )
          .overlaps('genres', Array.from(spellings))
          .not('prestige_score', 'is', null)
          .in('release_group_type', ['album', 'ep'])
          .not('cover_url', 'is', null);
        if (countries.length > 0) q = q.in('artists.country', countries);
        const { data, error } = await q.order('prestige_score', { ascending: false }).limit(90);
        return { data: (data ?? []) as unknown[], error };
      }),
    ),
    upsertPromise,
  ]);
  if (upsertErr) console.error('[taste] profile upsert error:', upsertErr.message);

  interface PoolRow {
    id: string;
    title: string;
    artist_display: string;
    cover_url: string | null;
    native_title: string | null;
    genres: string[] | null;
    first_release_date: string | null;
    prestige_score: number | null;
    title_language: string | null;
    artists: { country: string | null; native_language: string | null } | null;
  }
  const recs: Record<string, { id: string; title: string; artist: string; coverUrl: string | null }[]> =
    {};
  recPools.forEach((res, i) => {
    if (res.error) {
      console.error('[taste] rec pool error:', res.error.message);
      return;
    }
    const world = poolWorlds[i];
    const pool = (res.data as PoolRow[])
      .filter((r) => !ratedIds.has(r.id))
      .map((r) => {
        const placement: AlbumPlacement = placeAlbum({
          genres: r.genres,
          title: r.title,
          nativeTitle: r.native_title,
          artistCountry: r.artists?.country ?? null,
          artistNativeLanguage: r.artists?.native_language ?? null,
          titleLanguage: r.title_language,
        });
        return { r, placement, aff: worldAffinity(placement, yearOf(r.first_release_date), world) };
      })
      .filter((c) => c.aff > 0)
      .sort((a, b) => b.aff - a.aff || (b.r.prestige_score ?? 0) - (a.r.prestige_score ?? 0));
    // One album per artist so a single prolific act can't own a panel.
    const take = (candidates: typeof pool) => {
      const seenArtists = new Set<string>();
      const out: { id: string; title: string; artist: string; coverUrl: string | null }[] = [];
      for (const { r } of candidates) {
        if (out.length >= RECS_PER_FOCUS) break;
        if (seenArtists.has(r.artist_display)) continue;
        seenArtists.add(r.artist_display);
        out.push({
          id: r.id,
          title: preferHangulName(r.title, r.native_title),
          artist: r.artist_display,
          coverUrl: r.cover_url,
        });
      }
      return out;
    };
    recs[`world:${i}`] = take(pool);
    for (const t of graphWorlds[i].tags) {
      const forTag = pool.filter((c) => c.placement.all.includes(t.tag));
      if (forTag.length > 0) recs[`tag:${t.tag}`] = take(forTag);
    }
  });

  interface StandingRow {
    genre: string;
    user_avg: number;
    community_avg: number;
    user_count: number;
  }
  const standings = ((standingsRes.data as StandingRow[] | null) ?? []).map((s) => ({
    genre: displayGenre(s.genre),
    userAvg: Number(s.user_avg),
    communityAvg: Number(s.community_avg),
    userCount: Number(s.user_count),
  }));

  // Mean signed gap between your average and the community's, over the genres you
  // share with everyone else — a single "are you a soft or a tough grader vs the
  // crowd" number, and how far.
  const communityDelta =
    standings.length > 0
      ? standings.reduce((s, x) => s + (x.userAvg - x.communityAvg), 0) / standings.length
      : null;

  const albumTotal = albumCountRes.count ?? rows.length;
  const payload = {
    ratingCount: albumTotal + (trackCountRes.count ?? 0),
    albumRatingCount: albumTotal,
    totalTags: genreCounts.size,
    clusters: worlds.map((w) => ({
      key: w.key,
      label: w.label.en,
      labelKo: w.label.ko,
      language: w.language,
      share: w.share,
      avgScore: w.avg,
      meanYear: w.meanYear,
      sdYears: w.sdYears,
      dominantScene: w.dominantScene,
      tags: w.tiles.slice(0, 8).map((t) => ({
        tag: t.id,
        display: t.display.en,
        displayKo: t.display.ko,
        avg: t.avg,
        n: t.mass,
      })),
    })),
    disliked: disliked
      .slice(0, 6)
      .map((t) => ({ tag: t.id, display: t.fullDisplay.en, displayKo: t.fullDisplay.ko })),
    standings,
    graph: { worlds: graphWorlds, albums: graphAlbums, recs },
    charts: {
      decades,
      years: yearSeries,
      scoreDist,
      scenes: sceneTotal > 0 ? { counts: sceneCounts, total: sceneTotal } : null,
      countries:
        countryItems.length > 0
          ? { items: countryItems, unknown: countryUnknown, total: rows.length }
          : null,
      timeline,
      peakMonthIndex: peakCount > 0 ? timeline.findIndex((t) => t.count === peakCount) : null,
    },
    stats: {
      avgScore: r2(avgScore),
      sdScore: r2(sdScore),
      fiveStars,
      perfectRate: r2(perfectRate),
      median,
      skew: r2(skew),
      effectiveGenres: r2(effectiveGenres),
      communityDelta: r2(communityDelta),
      meanYear: meanYear != null ? Math.round(meanYear) : null,
      sdYears: r2(sdYears),
      prestigeShare: r2(prestigeShare),
    },
    topScore: topScore ?? null,
    topAlbums,
    topAlbum: top?.release_groups
      ? {
          id: top.release_groups.id,
          title: preferHangulName(top.release_groups.title, top.release_groups.native_title),
          artist: preferHangulName(
            top.release_groups.artist_display,
            top.release_groups.artists?.name_native,
          ),
          coverUrl: top.release_groups.cover_url,
          score: display(top)!,
        }
      : null,
  };

  await cacheSet(cacheKey, payload, TTL_SECONDS);
  return NextResponse.json(payload);
}
