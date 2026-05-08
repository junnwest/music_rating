import { notFound } from 'next/navigation';
import { getSpotifyArtist, getSpotifyArtistAlbums } from '../../../../lib/spotify';
import { getCachedArtist, cacheArtist, getArtistReleases } from '../../../../lib/dbCache';
import DiscographyGrid from '../../../../components/DiscographyGrid';

export const revalidate = 3600;

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default async function ArtistPage({ params }: { params: { id: string } }) {
  let artist = await getCachedArtist(params.id);
  if (!artist) {
    artist = await getSpotifyArtist(params.id);
    if (!artist) notFound();
    cacheArtist(artist); // fire and forget
  }
  const { releases: spotifyReleases, nextCursor } = await getSpotifyArtistAlbums(params.id, artist.name);

  // If Spotify returned nothing (rate limit or network failure), fall back to the DB
  const rawReleases = spotifyReleases.length > 0
    ? spotifyReleases
    : await getArtistReleases(params.id);

  // Deduplicate by title+type, then sort newest first
  const seen = new Set<string>();
  const deduped = rawReleases
    .filter((r) => {
      const key = `${r.title.toLowerCase()}::${r.releaseType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  return (
    <div className="bg-white min-h-screen">

      {/* ── HEADER ────────────────────────────────────────────── */}
      <div className="relative overflow-hidden">
        {/* Blurred photo bleeds colour into the gradient — desaturated + brightened so it reads as a soft tint, not a photo */}
        {artist.coverUrl && (
          <div
            className="absolute inset-0 scale-110"
            style={{
              backgroundImage: `url(${artist.coverUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center top',
              filter: 'blur(70px) saturate(0.55) brightness(1.55)',
            }}
          />
        )}
        {/* White gradient washes out the bottom so the discography section below blends cleanly */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.82) 100%)' }}
        />

        <div className="relative max-w-[1440px] mx-auto px-5 py-8 sm:py-10 flex gap-5 sm:gap-9 items-center">

          {/* Avatar */}
          <div
            className="w-[72px] h-[72px] sm:w-[96px] sm:h-[96px] rounded-full flex-shrink-0 overflow-hidden border border-black/10 flex items-center justify-center font-bold text-mint-dark text-[28px] sm:text-[36px]"
            style={{ background: '#EDFFF9' }}
          >
            {artist.coverUrl ? (
              <img src={artist.coverUrl} alt={artist.name} className="w-full h-full object-cover" />
            ) : (
              artist.name[0].toUpperCase()
            )}
          </div>

          {/* Info */}
          <div>
            <p
              className="text-[12px] font-semibold text-muted uppercase mb-1"
              style={{ letterSpacing: '0.6px' }}
            >
              Artist
            </p>
            <h1
              className="text-[24px] sm:text-[32px] font-extrabold text-ink"
              style={{ letterSpacing: '-1px' }}
            >
              {artist.name}
            </h1>
            {artist.genres.length > 0 && (
              <p className="text-[13px] text-muted mt-1">
                {artist.genres.slice(0, 4).join(' · ')}
              </p>
            )}
            <div className="flex gap-6 mt-4">
              {artist.followers > 0 && (
                <div>
                  <div className="text-[16px] font-bold text-ink">{formatFollowers(artist.followers)}</div>
                  <div className="text-[11px] text-muted">Spotify followers</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── DISCOGRAPHY ───────────────────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14">
        <h2 className="text-[17px] font-bold text-ink mb-5">Discography</h2>
        <DiscographyGrid initialReleases={deduped} initialNextCursor={nextCursor} />
      </div>
    </div>
  );
}
