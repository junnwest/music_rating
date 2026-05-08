import { notFound } from 'next/navigation';
import { getSpotifyAlbum } from '../../../../lib/spotify';
import { getCachedAlbum, cacheAlbum } from '../../../../lib/dbCache';
import { createServerClient } from '../../../../lib/supabaseServer';

export const revalidate = 60;
import StarRatingWidget from '../../../../components/StarRatingWidget';
import ReviewsSection from '../../../../components/ReviewsSection';
import AlbumActions from '../../../../components/AlbumActions';

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-surface border border-[#EBEBEB] text-[11px] font-medium text-muted"
    >
      {children}
    </span>
  );
}

export default async function AlbumPage({ params }: { params: { mbid: string } }) {
  let album = await getCachedAlbum(params.mbid);
  if (!album) {
    album = await getSpotifyAlbum(params.mbid);
    if (!album) notFound();
    cacheAlbum(album); // fire and forget
  }

  // Fetch community stats
  let ratingsCount = 0;
  let avgScore: number | null = null;
  let reviewsCount = 0;

  const supabase = createServerClient();
  if (supabase) {
    const [{ data: ratingRows }, { count }] = await Promise.all([
      supabase.from('ratings').select('score').eq('release_id', album.id),
      supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('release_id', album.id),
    ]);
    if (ratingRows && ratingRows.length > 0) {
      ratingsCount = ratingRows.length;
      const sum = ratingRows.reduce((s: number, r: { score: number | null }) => s + (r.score ?? 0), 0);
      avgScore = Math.round((sum / ratingsCount) * 10) / 10;
    }
    reviewsCount = count ?? 0;
  }

  return (
    <div className="bg-white min-h-screen">

      {/* ── HERO ─────────────────────────────────────────────── */}
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-8 sm:py-11 pb-10 flex flex-col sm:flex-row gap-6 sm:gap-11">

          {/* Cover */}
          <div className="flex-shrink-0 flex sm:block justify-center">
            {album.coverUrl ? (
              <img
                src={album.coverUrl}
                alt={album.title}
                className="w-[160px] h-[160px] sm:w-[228px] sm:h-[228px] object-cover rounded-[10px]"
                style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.09)' }}
              />
            ) : (
              <div className="w-[160px] h-[160px] sm:w-[228px] sm:h-[228px] rounded-[10px] bg-[#EBEBEB] flex items-center justify-center text-muted text-sm">
                No cover
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
              className="text-[26px] sm:text-[34px] font-extrabold text-ink leading-[1.08]"
              style={{ letterSpacing: '-1.2px' }}
            >
              {album.title}
            </h1>

            {/* Artist */}
            {album.artistId ? (
              <a href={`/artist/${album.artistId}`} className="text-[17px] font-medium text-muted mt-2 hover:text-ink transition block">
                {album.artist}
              </a>
            ) : (
              <p className="text-[17px] font-medium text-muted mt-2">{album.artist}</p>
            )}

            {/* Community stats */}
            <div className="flex items-center gap-7 mt-[22px] pt-[18px] border-t border-[#EBEBEB]">
              <div>
                <div
                  className="text-[30px] font-extrabold text-ink"
                  style={{ letterSpacing: '-0.8px' }}
                >
                    {avgScore !== null ? (
                  <span>{avgScore.toFixed(1)}</span>
                ) : (
                  <span className="text-[22px]">—</span>
                )}
                </div>
                <div className="text-[12px] text-muted mt-0.5">avg</div>
              </div>
              <div className="w-px bg-[#EBEBEB] self-stretch" />
              <div>
                <div className="text-[18px] font-bold text-ink">{ratingsCount}</div>
                <div className="text-[12px] text-muted mt-0.5">ratings</div>
              </div>
              <div className="w-px bg-[#EBEBEB] self-stretch" />
              <div>
                <div className="text-[18px] font-bold text-ink">{reviewsCount}</div>
                <div className="text-[12px] text-muted mt-0.5">comments</div>
              </div>
              <div className="ml-auto">
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

      {/* ── BODY ─────────────────────────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-14 grid gap-[52px] grid-cols-1 md:grid-cols-[1fr_1.3fr]">

        {/* Tracklist */}
        {album.tracks.length > 0 && (
          <div>
            <h2 className="text-[17px] font-bold text-ink mb-[18px]">Tracklist</h2>
            {album.tracks.map((track) => (
              <div
                key={track.position}
                className="flex gap-[14px] py-[10px] border-b border-[#EBEBEB] items-center"
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
          Data from{' '}
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
