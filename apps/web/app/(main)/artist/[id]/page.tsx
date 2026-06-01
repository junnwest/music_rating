import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSpotifyArtist, getSpotifyArtistAlbums } from '../../../../lib/spotify';
import { getCachedArtist, getArtistFromDb, cacheArtist, getArtistReleases } from '../../../../lib/dbCache';
import { createServerClient } from '../../../../lib/supabaseServer';
import DiscographyGrid, { type ReleaseStats } from '../../../../components/DiscographyGrid';
import { getServerT } from '../../../../lib/i18n/server';

export const revalidate = 3600;

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default async function ArtistPage({ params }: { params: { id: string } }) {
  const t = getServerT();
  let artist = await getCachedArtist(params.id);
  if (!artist) {
    const spotifyArtist = await getSpotifyArtist(params.id);
    if (spotifyArtist) {
      artist = spotifyArtist;
      cacheArtist(artist);
    } else {
      artist = await getArtistFromDb(params.id);
      if (!artist) notFound();
    }
  }

  const dbReleases = await getArtistReleases(params.id, artist.name);
  let rawReleases: typeof dbReleases;
  let nextCursor: string | null = null;
  if (dbReleases.length > 0) {
    rawReleases = dbReleases;
  } else {
    const fromSpotify = await getSpotifyArtistAlbums(params.id, artist.name);
    rawReleases = fromSpotify.releases;
    nextCursor = fromSpotify.nextCursor;
  }

  const seen = new Set<string>();
  const releases = rawReleases
    .filter((r) => {
      const key = `${r.title.toLowerCase()}::${r.releaseType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  // ── Fetch native name + per-release ratings ────────────────────────────────
  let nameNative: string | null = null;
  const statsMap = new Map<string, ReleaseStats>();

  const supabase = createServerClient();
  if (supabase) {
    const { data: artistRow } = await supabase
      .from('artists')
      .select('name_native')
      .eq('id', params.id)
      .maybeSingle();
    nameNative = artistRow?.name_native ?? null;

    const releaseIds = releases.map((r) => r.id);
    if (releaseIds.length > 0) {
      const { data: ratingRows } = await supabase
        .from('ratings')
        .select('release_id, score')
        .in('release_id', releaseIds);

      if (ratingRows) {
        const grouped = new Map<string, number[]>();
        for (const r of ratingRows) {
          if (!grouped.has(r.release_id)) grouped.set(r.release_id, []);
          grouped.get(r.release_id)!.push(r.score);
        }
        for (const [releaseId, scores] of grouped) {
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          statsMap.set(releaseId, {
            avgScore: Math.round(avg * 10) / 10,
            count: scores.length,
          });
        }
      }
    }
  }

  // ── Aggregate artist-level stats ──────────────────────────────────────────
  let totalRatings = 0;
  let overallAvg: number | null = null;
  if (statsMap.size > 0) {
    let totalSum = 0;
    let totalCount = 0;
    for (const s of statsMap.values()) {
      totalRatings += s.count;
      totalSum += (s.avgScore ?? 0) * s.count;
      totalCount += s.count;
    }
    if (totalCount > 0) overallAvg = Math.round((totalSum / totalCount) * 10) / 10;
  }

  // Top-rated releases: need at least 2 ratings, sorted by avg desc
  const topReleases = releases
    .filter((r) => (statsMap.get(r.id)?.count ?? 0) >= 2)
    .sort((a, b) => (statsMap.get(b.id)?.avgScore ?? 0) - (statsMap.get(a.id)?.avgScore ?? 0))
    .slice(0, 5);

  const statsObj: Record<string, ReleaseStats> = Object.fromEntries(statsMap);

  const albumCount  = releases.filter((r) => r.releaseType === 'Album').length;
  const epCount     = releases.filter((r) => r.releaseType === 'EP').length;
  const singleCount = releases.filter((r) => r.releaseType === 'Single').length;

  return (
    <div className="bg-page min-h-screen">

      {/* ── HERO ─────────────────────────────────────────────────────────────── */}
      <div className="relative">
        <div className="absolute inset-0 overflow-hidden">
          {artist.coverUrl && (
            <div
              className="absolute inset-0 scale-110"
              style={{
                backgroundImage: `url(${artist.coverUrl})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(70px) saturate(1.3)',
              }}
            />
          )}
          <div className="absolute inset-0 bg-black/60" />
        </div>

        <div className="relative max-w-[1440px] mx-auto px-5 py-10 sm:py-14 flex flex-col sm:flex-row gap-6 sm:gap-10 items-start sm:items-end">
          {/* Avatar */}
          <div
            className="w-[90px] h-[90px] sm:w-[140px] sm:h-[140px] rounded-full flex-shrink-0 overflow-hidden border-2 border-white/20 flex items-center justify-center font-bold text-[#E8A020] text-[38px] sm:text-[56px]"
            style={{ background: '#221a0e', boxShadow: '0 8px 40px rgba(0,0,0,0.45)' }}
          >
            {artist.coverUrl ? (
              <img src={artist.coverUrl} alt={artist.name} className="w-full h-full object-cover" />
            ) : (
              artist.name[0].toUpperCase()
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0 pb-1">
            <p className="text-[11px] font-semibold text-white/50 uppercase tracking-[0.7px] mb-2">
              {t('artist.artistLabel')}
            </p>
            <h1
              className="text-[28px] sm:text-[42px] font-extrabold text-white leading-[1.05]"
              style={{ letterSpacing: '-1.3px' }}
            >
              {artist.name}
            </h1>
            {nameNative && nameNative !== artist.name && (
              <p className="text-[18px] text-white/55 mt-1 font-medium">{nameNative}</p>
            )}
            {artist.genres.length > 0 && (
              <div className="flex flex-wrap gap-[6px] mt-3">
                {artist.genres.slice(0, 5).map((g) => (
                  <span
                    key={g}
                    className="px-[10px] py-[3px] rounded-full text-[11px] font-medium text-white/70 border border-white/15"
                    style={{ background: 'rgba(255,255,255,0.08)' }}
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {/* Stats row */}
            <div className="flex flex-wrap items-stretch gap-0 mt-6 pt-5 border-t border-white/15">
              {artist.followers > 0 && (
                <div className="pr-6">
                  <div className="text-[22px] sm:text-[26px] font-extrabold text-white" style={{ letterSpacing: '-0.5px' }}>
                    {formatFollowers(artist.followers)}
                  </div>
                  <div className="text-[11px] text-white/45 mt-0.5">{t('artist.spotifyFollowers')}</div>
                </div>
              )}
              {overallAvg !== null && (
                <>
                  <div className="w-px bg-white/15 mx-4 self-stretch hidden sm:block" />
                  <div className="pr-6 sm:pr-0 sm:px-6">
                    <div className="text-[22px] sm:text-[26px] font-extrabold text-white" style={{ letterSpacing: '-0.5px' }}>
                      {overallAvg.toFixed(1)}
                    </div>
                    <div className="text-[11px] text-white/45 mt-0.5">avg rating</div>
                  </div>
                </>
              )}
              {totalRatings > 0 && (
                <>
                  <div className="w-px bg-white/15 mx-4 self-stretch hidden sm:block" />
                  <div className="pr-6 sm:pr-0 sm:px-6">
                    <div className="text-[22px] sm:text-[26px] font-extrabold text-white" style={{ letterSpacing: '-0.5px' }}>
                      {totalRatings}
                    </div>
                    <div className="text-[11px] text-white/45 mt-0.5">community ratings</div>
                  </div>
                </>
              )}
              {releases.length > 0 && (
                <>
                  <div className="w-px bg-white/15 mx-4 self-stretch hidden sm:block" />
                  <div className="sm:px-6">
                    <div className="text-[22px] sm:text-[26px] font-extrabold text-white" style={{ letterSpacing: '-0.5px' }}>
                      {releases.length}
                    </div>
                    <div className="text-[11px] text-white/45 mt-0.5">
                      {[
                        albumCount > 0 && `${albumCount} album${albumCount !== 1 ? 's' : ''}`,
                        epCount > 0    && `${epCount} EP${epCount !== 1 ? 's' : ''}`,
                        singleCount > 0 && `${singleCount} single${singleCount !== 1 ? 's' : ''}`,
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── TOP RATED ───────────────────────────────────────────────────────── */}
      {topReleases.length > 0 && (
        <div className="max-w-[1440px] mx-auto px-5 pt-10">
          <h2
            className="text-[11px] font-bold text-muted uppercase mb-5"
            style={{ letterSpacing: '0.7px' }}
          >
            Top Rated
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-[18px]">
            {topReleases.map((r, idx) => {
              const s = statsMap.get(r.id);
              return (
                <Link key={r.id} href={`/album/${r.id}`} className="block group">
                  <div className="relative rounded-[8px] overflow-hidden" style={{ aspectRatio: '1 / 1' }}>
                    {r.coverUrl ? (
                      <img
                        src={r.coverUrl}
                        alt={r.title}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-surface border border-divider" />
                    )}
                    {/* Rank badge */}
                    <div className="absolute top-2 left-2 w-[22px] h-[22px] rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center text-[11px] font-bold text-white/90">
                      {idx + 1}
                    </div>
                    {/* Score badge */}
                    {s?.avgScore && (
                      <div className="absolute bottom-2 right-2 px-2 py-[3px] rounded-[5px] bg-black/60 backdrop-blur-sm text-[12px] font-bold text-white">
                        ★ {s.avgScore.toFixed(1)}
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <div className="text-[13px] font-semibold text-ink truncate group-hover:text-mint-dark transition">
                      {r.title}
                    </div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {r.date?.slice(0, 4)}
                      {s && s.count > 0 && ` · ${s.count} rating${s.count !== 1 ? 's' : ''}`}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <hr className="border-t border-divider mx-5 mt-10" />

      {/* ── DISCOGRAPHY ─────────────────────────────────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14">
        <h2 className="text-[17px] font-bold text-ink mb-5">{t('artist.discography')}</h2>
        <DiscographyGrid
          initialReleases={releases}
          initialNextCursor={nextCursor}
          stats={statsObj}
        />
      </div>
    </div>
  );
}
