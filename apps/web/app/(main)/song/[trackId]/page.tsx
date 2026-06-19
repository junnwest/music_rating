import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createServerClient } from '../../../../lib/supabaseServer';
import { isUUID } from '../../../../lib/dbCache';
import { TrackStreamingButtons } from '../../../../components/YouTubeMusicButton';
import TrackStarRating from '../../../../components/TrackStarRating';

function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Song detail page. Songs are rows in the `tracks` table (see SONGS_PLAN.md);
// metadata (cover, parent artist) comes from the parent release.
// NOTE (v1): rating here uses the existing Manual `track_ratings` widget. The
// full Add-modal + Instinct-for-songs flow (parity with albums) is the next
// SONGS_PLAN step and will replace this widget.
export default async function SongPage({ params }: { params: { trackId: string } }) {
  if (!isUUID(params.trackId)) notFound();

  const supabase = createServerClient();
  if (!supabase) notFound();

  const { data: track } = await supabase
    .from('tracks')
    .select('id, release_id, position, title, duration_ms, artists')
    .eq('id', params.trackId)
    .maybeSingle();
  if (!track) notFound();

  const { data: release } = await supabase
    .from('releases')
    .select('id, title, artist, cover_url')
    .eq('id', track.release_id)
    .maybeSingle();

  const artistName = track.artists || release?.artist || 'Unknown artist';
  const cover = release?.cover_url ?? null;
  const duration = formatDuration(track.duration_ms);

  // Community stats for this song (Manual track ratings).
  let ratingsCount = 0;
  let avgScore: number | null = null;
  const { data: ratingRows } = await supabase
    .from('track_ratings')
    .select('score')
    .eq('release_id', track.release_id)
    .eq('track_position', track.position);
  if (ratingRows && ratingRows.length > 0) {
    ratingsCount = ratingRows.length;
    const sum = ratingRows.reduce((s, r) => s + (r.score ?? 0), 0);
    avgScore = Math.round((sum / ratingsCount) * 10) / 10;
  }

  return (
    <div className="max-w-[900px] mx-auto px-5 py-10">
      {/* Hero */}
      <div className="flex items-center gap-5">
        <div className="w-[120px] h-[120px] rounded-xl overflow-hidden bg-surface flex-shrink-0">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-surface" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted mb-1">Song</p>
          <h1 className="text-[26px] font-extrabold text-ink leading-tight">{track.title}</h1>
          <p className="text-[15px] text-muted mt-1">{artistName}</p>
          {duration && <p className="text-[12px] text-muted mt-1 tabular-nums">{duration}</p>}
        </div>
      </div>

      {/* Rating + stats */}
      <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
        <TrackStarRating releaseId={track.release_id} trackPosition={track.position} trackTitle={track.title} />
        <div className="text-[13px] text-muted">
          {ratingsCount > 0 ? (
            <span><span className="font-bold text-ink tabular-nums">{avgScore?.toFixed(1)}</span> avg · {ratingsCount} {ratingsCount === 1 ? 'rating' : 'ratings'}</span>
          ) : (
            <span>No ratings yet</span>
          )}
        </div>
      </div>

      {/* Streaming */}
      <div className="mt-6">
        <TrackStreamingButtons artist={artistName} track={track.title} />
      </div>

      {/* Appears on */}
      {release && (
        <div className="mt-8 border-t border-divider pt-6">
          <p className="text-[12px] font-semibold text-muted mb-2">Appears on</p>
          <Link href={`/album/${release.id}`} className="inline-flex items-center gap-3 group">
            <div className="w-[44px] h-[44px] rounded-lg overflow-hidden bg-surface flex-shrink-0">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt={release.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-surface" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-ink group-hover:text-mid transition truncate">{release.title}</p>
              <p className="text-[12px] text-muted truncate">{release.artist}</p>
            </div>
          </Link>
        </div>
      )}
    </div>
  );
}
