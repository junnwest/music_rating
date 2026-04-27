import { notFound } from 'next/navigation';
import { getSpotifyArtist, getSpotifyArtistAlbums } from '../../../../lib/spotify';
import { getCachedArtist, cacheArtist } from '../../../../lib/dbCache';
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
  const { releases, nextCursor } = await getSpotifyArtistAlbums(params.id, artist.name);

  // Deduplicate by title+type, then sort newest first
  const seen = new Set<string>();
  const deduped = releases
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
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-10 flex gap-9 items-center">

          {/* Avatar */}
          <div
            className="w-[96px] h-[96px] rounded-full flex-shrink-0 overflow-hidden border-2 border-mint flex items-center justify-center font-bold text-mint-dark text-[36px]"
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
              className="text-[32px] font-extrabold text-ink"
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
              <div>
                <div className="text-[16px] font-bold text-ink">{formatFollowers(artist.followers)}</div>
                <div className="text-[11px] text-muted">followers</div>
              </div>
              <div>
                <div className="text-[16px] font-bold text-ink">{deduped.length}</div>
                <div className="text-[11px] text-muted">releases</div>
              </div>
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
