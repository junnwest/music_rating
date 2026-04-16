import { notFound } from 'next/navigation';
import { getSpotifyAlbum } from '../../../lib/spotify';
import StarRatingWidget from '../../../components/StarRatingWidget';

function formatDuration(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="group/lbl relative cursor-default">
      <span className="pointer-events-none absolute bottom-full left-0 mb-1 whitespace-nowrap rounded bg-slate-800 px-2 py-0.5 text-[10px] font-medium tracking-wide text-white opacity-0 transition-opacity group-hover/lbl:opacity-100">
        {label}
      </span>
      {children}
    </span>
  );
}

export default async function AlbumPage({ params }: { params: { mbid: string } }) {
  const album = await getSpotifyAlbum(params.mbid);
  if (!album) notFound();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-4xl space-y-10">

        {/* ── TOP SECTION ─────────────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200 bg-white p-8">
          <div className="flex flex-col gap-8 sm:flex-row">

            {/* Cover */}
            <div className="flex-shrink-0">
              {album.coverUrl ? (
                <img
                  src={album.coverUrl}
                  alt={album.title}
                  className="w-52 h-52 object-cover rounded-xl shadow-md"
                />
              ) : (
                <div className="w-52 h-52 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 text-sm">
                  No cover
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex flex-col justify-between gap-4 flex-1">
              <div className="space-y-1">
                <Labeled label="Release type">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                    {album.releaseType}
                  </p>
                </Labeled>
                <h1 className="text-4xl font-bold text-slate-900">{album.title}</h1>
                <Labeled label="Artist">
                  <p className="text-xl text-slate-500">{album.artist}</p>
                </Labeled>
              </div>

              {/* Metadata row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                {album.date && (
                  <Labeled label="Release date">
                    <span>{album.date}</span>
                  </Labeled>
                )}
                {album.totalTracks > 0 && (
                  <>
                    <span className="text-slate-300">·</span>
                    <Labeled label="Track count">
                      <span>{album.totalTracks} tracks</span>
                    </Labeled>
                  </>
                )}
              </div>

              {/* Label */}
              {album.label && (
                <Labeled label="Record label">
                  <span className="text-sm text-slate-600">{album.label}</span>
                </Labeled>
              )}

              {/* Genres */}
              {album.genres.length > 0 && (
                <Labeled label="Genres">
                  <div className="flex flex-wrap gap-2">
                    {album.genres.map((g) => (
                      <span
                        key={g}
                        className="rounded-full bg-slate-100 border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                </Labeled>
              )}

              {/* Star rating */}
              <div className="pt-2">
                <StarRatingWidget
                  releaseId={album.id}
                  releaseTitle={album.title}
                  releaseArtist={album.artist}
                  releaseDate={album.date}
                  releaseCountry={null}
                  releaseType={album.releaseType}
                  coverUrl={album.coverUrl}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── TRACK LISTING ───────────────────────────────────────── */}
        {album.tracks.length > 0 && (
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400">Track listing</h2>
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {album.tracks.map((track, i) => (
                <div
                  key={track.position}
                  className={`flex items-center justify-between px-6 py-3 text-sm hover:bg-slate-50 transition-colors ${
                    i < album.tracks.length - 1 ? 'border-b border-slate-100' : ''
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <span className="w-6 flex-shrink-0 text-right text-slate-400 tabular-nums">{track.position}</span>
                    <div className="min-w-0">
                      <p className="text-slate-900 truncate">{track.title}</p>
                      {track.artists !== album.artist && (
                        <p className="text-xs text-slate-400 truncate">{track.artists}</p>
                      )}
                    </div>
                  </div>
                  <span className="flex-shrink-0 ml-4 text-slate-400 tabular-nums">{formatDuration(track.durationMs)}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Attribution */}
        <p className="text-xs text-slate-400">
          Data from{' '}
          {album.spotifyUrl ? (
            <a href={album.spotifyUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">
              Spotify
            </a>
          ) : 'Spotify'}.
        </p>
      </div>
    </main>
  );
}
