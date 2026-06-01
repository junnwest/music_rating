import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSpotifyAlbum } from '../../../../lib/spotify';
import { getCachedAlbum, cacheAlbum, getBasicRelease, isUUID } from '../../../../lib/dbCache';
import { createServerClient } from '../../../../lib/supabaseServer';

// KNOWN ISSUE: Next.js 14.2.5 returns HTTP 200 (with the not-found.tsx body)
// instead of 404 when `notFound()` is called from a page that also reads
// cookies via createServerClient. Confirmed reproducible in dev AND prod.
// Tried both removing `revalidate` and adding `dynamic = 'force-dynamic'` —
// neither helped. Affects: this page and rankings/[slug]/page.tsx (same
// cookie+notFound pattern). Doesn't affect: artist/[id], genre/[key],
// explore/[id] (no cookies).
//
// User-visible UX is correct (the friendly "Page not found" page renders),
// so this is an SEO / analytics issue only. Revisit post-launch via either:
// (a) upgrading Next.js, or (b) refactoring this page so cookie reads happen
// in a child Server Component that only mounts when album exists.

import StarRatingWidget from '../../../../components/StarRatingWidget';
import ReviewsSection from '../../../../components/ReviewsSection';
import AlbumActions from '../../../../components/AlbumActions';
import { StreamingButtons, TrackStreamingButtons } from '../../../../components/YouTubeMusicButton';
import TrackStarRating from '../../../../components/TrackStarRating';
import QuickAddButton from '../../../../components/QuickAddButton';
import { getServerT } from '../../../../lib/i18n/server';
import { cacheGet, cacheSet } from '../../../../lib/cache';
import { computeTierlistScores, combineSillaScores } from '../../../../lib/sillaScore';

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-white/10 border border-white/20 text-[11px] font-medium text-white/75">
      {children}
    </span>
  );
}

export default async function AlbumPage({ params }: { params: { mbid: string } }) {
  const t = getServerT();
  let album = await getCachedAlbum(params.mbid);
  if (!album) {
    // DB-first: render from the basic row when present (cover, title, artist,
    // type, genres, date). Tracklist is the only thing missing — page already
    // hides the tracklist section when tracks is empty. Skipping Spotify here
    // is what keeps album page renders from burning quota during cooldowns.
    const basic = await getBasicRelease(params.mbid);
    if (basic) {
      album = basic;
    } else {
      // Genuinely not in DB — last-resort Spotify lookup so deep-links to
      // unseen Spotify IDs still resolve. iTunes/UUID-shaped IDs can't be
      // looked up via Spotify, so they go straight to 404.
      const spotifyId = isUUID(params.mbid) || /^\d+$/.test(params.mbid) ? null : params.mbid;
      if (spotifyId) {
        const fetched = await getSpotifyAlbum(spotifyId);
        if (fetched) {
          const uuid = await cacheAlbum(fetched);
          album = { ...fetched, id: uuid ?? fetched.id };
        }
      }
      if (!album) {
        console.error('[album] no DB row or Spotify result for id:', params.mbid);
        notFound();
      }
    }
  }

  // Fetch community stats + ranking memberships
  let ratingsCount = 0;
  let avgScore: number | null = null;
  let reviewsCount = 0;
  let rankingMemberships: { slug: string; title: string; rank: number }[] = [];

  const supabase = createServerClient();
  if (supabase) {
    // Cache avg rating + count (TTL 5 min; ratings are submitted client-side so we rely on TTL)
    type StatsCache = { ratingsCount: number; avgScore: number | null };
    const statsCacheKey = `sj:album-stats:${album.id}`;
    const cachedStats = await cacheGet<StatsCache>(statsCacheKey);

    if (cachedStats) {
      ratingsCount = cachedStats.ratingsCount;
      avgScore = cachedStats.avgScore;
    }

    const [statsResult, reviewsResult, seedEntryResult, userEntryResult] = await Promise.all([
      cachedStats
        ? Promise.resolve({ data: null })
        : supabase.from('ratings').select('score').eq('release_id', album.id),
      supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('release_id', album.id),
      supabase.from('ranking_seed_entries').select('category_id').eq('release_id', album.id),
      supabase.from('user_ranking_entries').select('ranking_id').eq('release_id', album.id),
    ]);

    const { data: ratingRows } = statsResult as { data: { score: number | null }[] | null };
    const { count } = reviewsResult;
    const { data: seedEntryRows } = seedEntryResult;
    const { data: userEntryRows } = userEntryResult;

    if (!cachedStats && ratingRows && ratingRows.length > 0) {
      ratingsCount = ratingRows.length;
      const sum = ratingRows.reduce((s: number, r: { score: number | null }) => s + (r.score ?? 0), 0);
      avgScore = Math.round((sum / ratingsCount) * 10) / 10;
      cacheSet(statsCacheKey, { ratingsCount, avgScore }, 5 * 60).catch(() => {});
    }
    reviewsCount = count ?? 0;

    // Resolve category IDs from seed + user ranking entries
    const seedCatIds = (seedEntryRows ?? []).map(r => r.category_id);
    let userCatIds: string[] = [];
    const userRankingIds = (userEntryRows ?? []).map(r => r.ranking_id);
    if (userRankingIds.length > 0) {
      const { data: userRankings } = await supabase
        .from('user_rankings')
        .select('category_id')
        .in('id', userRankingIds);
      userCatIds = (userRankings ?? []).map(r => r.category_id);
    }
    const allCatIds = [...new Set([...seedCatIds, ...userCatIds])];
    if (allCatIds.length > 0) {
      const { data: cats } = await supabase
        .from('ranking_categories')
        .select('id, slug, title, genre, year')
        .in('id', allCatIds)
        .order('sort_order');

      // For each category, compute this album's rank using the combined Silla Score.
      // Mirrors the leaderboard exactly (shared lib/sillaScore helpers).
      const catList = cats ?? [];
      const rankResults = await Promise.all(catList.map(async (cat) => {
        const [{ data: allSeedEntries }, { data: catRankings }] = await Promise.all([
          supabase!.from('ranking_seed_entries').select('release_id, seed_votes').eq('category_id', cat.id),
          supabase!.from('user_rankings').select('id').eq('category_id', cat.id),
        ]);

        const seedRaw = new Map<string, number>(
          (allSeedEntries ?? []).map((s: any) => [s.release_id as string, Number(s.seed_votes)]),
        );

        let tierlistRaw = new Map<string, number>();
        const catRankingIds = (catRankings ?? []).map(r => r.id);
        if (catRankingIds.length > 0) {
          const { data: entries } = await supabase!
            .from('user_ranking_entries')
            .select('ranking_id, release_id, rank')
            .in('ranking_id', catRankingIds);
          tierlistRaw = computeTierlistScores(entries ?? []);
        }

        // Bayesian-damped calibrated ratings, including rated albums matching genre/year
        const seedIds = [...new Set([...tierlistRaw.keys(), ...seedRaw.keys()])];
        const { data: bayesianRows } = await supabase!.rpc('get_silla_rating_scores', {
          release_ids: seedIds,
          p_genre: cat.genre ?? null,
          p_year: cat.year ?? null,
        });
        const bayesianMap = new Map<string, number>(
          (bayesianRows ?? []).map((r: any) => [r.release_id as string, r.bayesian_score as number]),
        );

        const candidateIds = [...new Set([...seedIds, ...bayesianMap.keys()])];
        const combined = combineSillaScores({ candidateIds, tierlistRaw, seedRaw, bayesianMap });
        const sorted = [...combined.entries()].sort((a, b) => b[1] - a[1]);

        const rankIdx = sorted.findIndex(([id]) => id === album.id);
        const titleKey = `rankingTitles.${cat.slug}`;
        const titleT = t(titleKey);
        return { slug: cat.slug, title: titleT === titleKey ? cat.title : titleT, rank: rankIdx + 1 };
      }));

      rankingMemberships = rankResults.filter(r => r.rank > 0);
    }
  }

  return (
    <div className="bg-page min-h-screen">

      {/* ── HERO ─────────────────────────────────────────────── */}
      <div className="relative">
        {/* Blurred album art background — overflow-hidden scoped here so dropdowns aren't clipped */}
        <div className="absolute inset-0 overflow-hidden">
          {album.coverUrl && (
            <div
              className="absolute inset-0 scale-110"
              style={{
                backgroundImage: `url(${album.coverUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(60px) saturate(1.4)',
              }}
            />
          )}
          <div className="absolute inset-0 bg-black/55" />
        </div>

        <div className="relative max-w-[1440px] mx-auto px-5 py-8 sm:py-11 pb-10 flex flex-col sm:flex-row gap-6 sm:gap-11">

          {/* Cover */}
          <div className="flex-shrink-0 flex sm:block justify-center">
            {album.coverUrl ? (
              <img
                src={album.coverUrl}
                alt={album.title}
                className="w-[160px] h-[160px] sm:w-[228px] sm:h-[228px] object-cover rounded-[10px]"
                style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.35)' }}
              />
            ) : (
              <div className="w-[160px] h-[160px] sm:w-[228px] sm:h-[228px] rounded-[10px] bg-white/10 flex items-center justify-center text-white/50 text-sm">
                {t('album.noCover')}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 pt-0 sm:pt-1">
            {/* Pills */}
            <div className="flex flex-wrap gap-[7px] mb-[14px]">
              <TypePill>{album.releaseType}</TypePill>
              {album.date && <TypePill>{album.date.slice(0, 4)}</TypePill>}
              {album.genres.slice(0, 2).map((g) => (
                <TypePill key={g}>{g}</TypePill>
              ))}
            </div>

            {/* Title */}
            <h1
              className="text-[26px] sm:text-[34px] font-extrabold text-white leading-[1.08]"
              style={{ letterSpacing: '-1.2px' }}
            >
              {album.title}
            </h1>

            {/* Artist(s) */}
            <p className="text-[17px] font-medium text-white/65 mt-2">
              {album.artists && album.artists.length > 0 ? (
                album.artists.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && <span className="mx-[3px]">,</span>}
                    <a href={`/artist/${a.id}`} className="hover:text-white transition">
                      {a.name}
                    </a>
                  </span>
                ))
              ) : album.artistId ? (
                <a href={`/artist/${album.artistId}`} className="hover:text-white transition">
                  {album.artist}
                </a>
              ) : (
                album.artist
              )}
            </p>

            {/* Community stats */}
            <div className="flex items-center gap-7 mt-[22px] pt-[18px] border-t border-white/15">
              <div>
                <div
                  className="text-[30px] font-extrabold text-white"
                  style={{ letterSpacing: '-0.8px' }}
                >
                  {avgScore !== null ? (
                    <span>{avgScore.toFixed(1)}</span>
                  ) : (
                    <span className="text-[22px]">—</span>
                  )}
                </div>
                <div className="text-[12px] text-white/50 mt-0.5">{t('album.avg')}</div>
              </div>
              <div className="w-px bg-white/15 self-stretch" />
              <div>
                <div className="text-[18px] font-bold text-white">{ratingsCount}</div>
                <div className="text-[12px] text-white/50 mt-0.5">{t('album.ratings')}</div>
              </div>
              <div className="w-px bg-white/15 self-stretch" />
              <div>
                <div className="text-[18px] font-bold text-white">{reviewsCount}</div>
                <div className="text-[12px] text-white/50 mt-0.5">{t('album.comments')}</div>
              </div>
              <div className="ml-auto flex items-center gap-3">
                <StreamingButtons artist={album.artist} album={album.title} spotifyUrl={album.spotifyUrl} />
                <AlbumActions
                  albumId={album.id}
                  albumTitle={album.title}
                  albumArtist={album.artist}
                  coverUrl={album.coverUrl}
                />
              </div>
            </div>

            {/* User rating */}
            <div className="mt-[22px]">
              <StarRatingWidget
                releaseId={album.id}
                releaseTitle={album.title}
                releaseArtist={album.artist}
                releaseDate={album.date}
                releaseCountry={null}
                releaseType={album.releaseType}
                coverUrl={album.coverUrl}
                genres={album.genres}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── RANKINGS ─────────────────────────────────────────── */}
      {rankingMemberships.length > 0 && (
        <div className="max-w-[1440px] mx-auto px-5 pt-8">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
              {t('album.inRankings')}
            </span>
            {rankingMemberships.map((cat) => (
              <Link
                key={cat.slug}
                href={`/leaderboard/${cat.slug}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-divider text-[12px] font-medium text-ink hover:bg-surface hover:border-ink/20 transition"
              >
                {cat.title}
                <span className="text-[#E8A020] font-semibold">#{cat.rank}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── BODY ─────────────────────────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-14 grid gap-[52px] grid-cols-1 md:grid-cols-[1fr_1.3fr]">

        {/* Tracklist */}
        {album.tracks.length > 0 && (
          <div>
            <h2 className="text-[17px] font-bold text-ink mb-[18px]">{t('album.tracklist')}</h2>
            {album.tracks.map((track) => (
              <div
                key={track.position}
                className="flex gap-[14px] py-[10px] border-b border-divider items-center"
              >
                <span className="text-[12px] text-[#DDDDD8] w-[22px] text-right flex-shrink-0 tabular-nums">
                  {String(track.position).padStart(2, '0')}
                </span>
                <span className="text-[14px] font-medium text-ink flex-1 truncate">
                  {track.title}
                </span>
                {track.artists !== album.artist && (
                  <span className="text-[11px] text-muted truncate max-w-[120px]">
                    {track.artists}
                  </span>
                )}
                <TrackStarRating releaseId={album.id} trackPosition={track.position} trackTitle={track.title} />
                <TrackStreamingButtons artist={track.artists || album.artist} track={track.title} />
                <QuickAddButton albumId={album.id} albumTitle={album.title} albumArtist={album.artist} coverUrl={album.coverUrl} trackTitle={track.title} trackPosition={track.position} />
                <span className="text-[12px] text-muted flex-shrink-0 tabular-nums">
                  {formatDuration(track.durationMs)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Reviews */}
        <div>
          <ReviewsSection releaseId={album.id} />
        </div>
      </div>

      {/* Attribution */}
      <div className="max-w-[1440px] mx-auto px-5 pb-8">
        <p className="text-[11px] text-muted">
          {t('album.dataFrom')}{' '}
          {album.spotifyUrl ? (
            <a
              href={album.spotifyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-mid"
            >
              Spotify
            </a>
          ) : (
            'Spotify'
          )}
          .
        </p>
      </div>
    </div>
  );
}
