'use client';

import { useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { useMixTarget } from './MixTargetContext';
import { useLanguage } from '../../lib/i18n';
import type { MixItemRef } from '../../lib/sj/mixes';
import { loadAlbumTracks, type TrackEntry } from '../../lib/sj/tracks';

const trackCache = new Map<string, TrackEntry[]>();

/**
 * An album's tracks, each toggling that song in/out of `mixId` — the Mix
 * Dock's expandable album rows and the mix page's add panel both use it.
 */
export default function AlbumSongPicker({
  releaseGroupId,
  coverUrl,
  mixId,
  remember,
}: {
  releaseGroupId: string;
  coverUrl: string | null;
  mixId: string;
  /** Passed through to `add` — false when curating a mix in place. */
  remember?: boolean;
}) {
  const { t } = useLanguage();
  const { membership, add, remove } = useMixTarget();
  const [tracks, setTracks] = useState<TrackEntry[] | null>(trackCache.get(releaseGroupId) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (tracks) return;
    let cancelled = false;
    loadAlbumTracks(releaseGroupId).then((rows) => {
      if (cancelled) return;
      if (!rows) return setFailed(true);
      trackCache.set(releaseGroupId, rows);
      setTracks(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [releaseGroupId, tracks]);

  if (failed) return <p className="pl-10 pr-3 py-2 text-[11.5px] text-muted">{t('sj.common.loadError')}</p>;
  if (!tracks)
    return (
      <div className="pl-10 pr-3 py-2 space-y-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="block h-2.5 w-2/3 rounded bg-surface animate-pulse" />
        ))}
      </div>
    );
  if (tracks.length === 0)
    return <p className="pl-10 pr-3 py-2 text-[11.5px] text-muted">{t('sj.dock.noTracks')}</p>;

  return (
    <ul className="pl-8 pr-2 pb-1.5">
      {tracks.map((tr) => {
        const item: MixItemRef = { kind: 'song', recordingId: tr.recordingId, releaseGroupId };
        const inMix = membership(item).includes(mixId);
        return (
          <li key={`${tr.discNumber}-${tr.position}-${tr.recordingId}`}>
            <button
              type="button"
              aria-pressed={inMix}
              onClick={(e) => {
                if (inMix) void remove(item, mixId);
                else
                  void add(item, {
                    mixId,
                    remember,
                    meta: { coverUrl, title: tr.title },
                    from: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                  });
              }}
              className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-surface transition group/track"
            >
              <span className="w-5 text-right text-[11px] text-muted tabular-nums shrink-0">{tr.position}</span>
              <span className={`flex-1 min-w-0 text-[12.5px] truncate ${inMix ? 'text-ink font-medium' : 'text-mid'}`}>
                {tr.title}
              </span>
              <span
                className={`grid place-items-center w-[18px] h-[18px] rounded-full shrink-0 transition ${
                  inMix
                    ? 'bg-accent text-white'
                    : 'border border-divider text-muted opacity-0 group-hover/track:opacity-100'
                }`}
              >
                {inMix ? <Check size={11} strokeWidth={3} /> : <Plus size={11} strokeWidth={2.5} />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
