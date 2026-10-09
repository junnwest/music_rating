'use client';

import { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Music2 } from 'lucide-react';
import ScoreBadge from './ScoreBadge';
import { useLanguage } from '../../lib/i18n';
import { loadPostRatedTracks, type RatedTrack } from '../../lib/sj/postRatedTracks';
import { trackAnchorHref, trackAnchorId } from '../../lib/sj/trackLinks';

/**
 * "♪ Rated N tracks ▾" under an album post: the tracks its author rated on that
 * album, expanding in place. Song ratings don't post on their own any more --
 * this and the album tracklist are the only places they show. Renders nothing
 * until it knows the author rated at least one track.
 */
export default function RatedTracksDropdown({
  userId,
  releaseGroupId,
  className = '',
}: {
  userId: string;
  releaseGroupId: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const [tracks, setTracks] = useState<RatedTrack[] | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();

  useEffect(() => {
    let live = true;
    setTracks(null);
    loadPostRatedTracks(userId, releaseGroupId).then((r) => live && setTracks(r));
    return () => {
      live = false;
    };
  }, [userId, releaseGroupId]);

  if (!tracks || tracks.length === 0) return null;
  const multiDisc = tracks.some((tr) => tr.discNumber !== tracks[0].discNumber);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={listId}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-page text-[12.5px] font-semibold text-muted hover:text-ink transition"
      >
        <Music2 size={13} />
        {(tracks.length === 1 ? t('sj.ratedTracks.one') : t('sj.ratedTracks.n')).replace(
          '{n}',
          String(tracks.length),
        )}
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol id={listId} className="mt-1.5 rounded-xl border border-divider/70 divide-y divide-divider overflow-hidden sj-fade-in">
          {tracks.map((tr) => (
            <li key={tr.recordingId}>
              <Link
                href={trackAnchorHref(releaseGroupId, tr.recordingId)}
                onClick={(e) => {
                  // Already on this album (a rating in its own comments): Next's
                  // same-page navigation fires no hashchange, so the tracklist
                  // wouldn't scroll. Set the hash and tell it directly.
                  if (window.location.pathname !== `/album/${releaseGroupId}`) return;
                  e.preventDefault();
                  history.replaceState(history.state, '', `#${trackAnchorId(tr.recordingId)}`);
                  window.dispatchEvent(new HashChangeEvent('hashchange'));
                }}
                className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-page/60 transition"
              >
                <span className="w-7 text-right text-[12px] text-muted tabular-nums shrink-0">
                  {multiDisc ? `${tr.discNumber}-${tr.position}` : tr.position}
                </span>
                <span className="flex-1 min-w-0 text-[13px] text-ink truncate">{tr.title}</span>
                <ScoreBadge score={tr.score} size={22} ringStroke={1.5} ringGap={1} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
