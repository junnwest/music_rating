'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  BookmarkPlus,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Music2,
  X,
} from 'lucide-react';
import FlowerGlyph from './FlowerGlyph';
import FlowerRateControl from './FlowerRateControl';
import ManualRateModal from './ManualRateModal';
import SaveToMixButton from './SaveToMixButton';
import ScoreBadge from './ScoreBadge';
import { OverflowMenuSurface, type OverflowItem } from './AlbumOverflowMenu';
import { useSession } from './SessionContext';
import { useMixName, useMixTarget } from './MixTargetContext';
import { openInNewTab } from './ContextMenu';
import { useLanguage } from '../../lib/i18n';
import { formatScore } from '../../lib/sj/display';
import { formatDuration, type TrackEntry, type TrackStats } from '../../lib/sj/tracks';
import type { SJRelease } from '../../lib/sj/data';
import type { PopoverAnchor } from './SavedToMixPopover';

/**
 * P5 — the album tracklist as a real list component.
 *
 * Each row: number · title (→ song page) + featured credit · hover bookmark ·
 * community average · duration · your rating (the same drag-or-tap flower as
 * album covers) · "…". Right-click (or long-press, or "…") opens the row menu.
 * A sticky header sorts by track order / your rating / community / duration —
 * remembered for the session; multi-disc grouping only in track order.
 *
 * `compact` is the song page's "other tracks on this album" mini-list: no
 * header or community column, the current track highlighted.
 */

export type TrackSort = 'order' | 'mine' | 'community' | 'duration';
const SORT_KEY = 'sj-tracklist-sort';

function readSort(): { col: TrackSort; desc: boolean } {
  try {
    const raw = sessionStorage.getItem(SORT_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (['order', 'mine', 'community', 'duration'].includes(p.col)) return { col: p.col, desc: !!p.desc };
    }
  } catch {
    /* storage blocked */
  }
  return { col: 'order', desc: false };
}

export default function Tracklist({
  tracks,
  release,
  myScores,
  stats,
  scoresLoading = false,
  onRate,
  compact = false,
  currentRecordingId,
}: {
  tracks: TrackEntry[];
  release: SJRelease;
  /** The viewer's track scores. */
  myScores: Record<string, number>;
  /** Community stats per recording; `null` while loading. */
  stats: Record<string, TrackStats> | null;
  scoresLoading?: boolean;
  onRate: (recordingId: string, score: number | null) => Promise<void> | void;
  compact?: boolean;
  currentRecordingId?: string;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const mixName = useMixName();
  const { userId, profile, requireAuth } = useSession();
  const { target, saveAndShow, openChange } = useMixTarget();
  const ratingStep = profile?.manual_rating_step ?? 0.5;
  const [sort, setSort] = useState<{ col: TrackSort; desc: boolean }>({ col: 'order', desc: false });
  const [menu, setMenu] = useState<{ x: number; y: number; track: TrackEntry } | null>(null);
  const [precise, setPrecise] = useState<TrackEntry | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!compact) setSort(readSort());
  }, [compact]);

  function applySort(col: TrackSort) {
    setSort((cur) => {
      // Same column flips direction; a new column starts where it's most useful
      // (ratings high→low, order/duration first→last).
      const next =
        cur.col === col
          ? { col, desc: !cur.desc }
          : { col, desc: col === 'mine' || col === 'community' };
      try {
        sessionStorage.setItem(SORT_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const multiDisc = tracks.some((tr) => tr.discNumber !== tracks[0]?.discNumber);
  const sorted = useMemo(() => {
    if (compact || sort.col === 'order') {
      return sort.desc && !compact ? [...tracks].reverse() : tracks;
    }
    const key = (tr: TrackEntry): number | null =>
      sort.col === 'mine'
        ? myScores[tr.recordingId] ?? null
        : sort.col === 'community'
          ? stats?.[tr.recordingId]?.avg ?? null
          : tr.durationMs ?? null;
    // Stable: ties (and unrated/unknown, always last) keep track order.
    return tracks
      .map((tr, i) => ({ tr, i, k: key(tr) }))
      .sort((a, b) => {
        if (a.k == null && b.k == null) return a.i - b.i;
        if (a.k == null) return 1;
        if (b.k == null) return -1;
        return (sort.desc ? b.k - a.k : a.k - b.k) || a.i - b.i;
      })
      .map((x) => x.tr);
  }, [tracks, sort, myScores, stats, compact]);

  const totalMs = tracks.reduce((a, tr) => a + (tr.durationMs ?? 0), 0);

  const songItem = (tr: TrackEntry) => ({
    kind: 'song' as const,
    recordingId: tr.recordingId,
    releaseGroupId: release.id,
  });
  const songMeta = (tr: TrackEntry) => ({ coverUrl: release.coverUrl, title: tr.title });
  const href = (tr: TrackEntry) => `/song/${tr.recordingId}?rg=${release.id}`;

  function menuItems(tr: TrackEntry, anchor: PopoverAnchor): OverflowItem[] {
    const rated = myScores[tr.recordingId] != null;
    return [
      {
        key: 'rate',
        label: t('sj.context.rate'),
        icon: <FlowerGlyph size={14} src="/icon-flower.svg" />,
        onSelect: () => requireAuth() && setPrecise(tr),
      },
      {
        key: 'save',
        label: target ? t('sj.mix.saveTo').replace('{mix}', mixName(target)) : t('sj.mix.saveToMix'),
        icon: <Bookmark size={15} />,
        onSelect: () => saveAndShow(songItem(tr), anchor, songMeta(tr)),
      },
      {
        key: 'save-other',
        label: t('sj.mix.saveToAnother'),
        icon: <BookmarkPlus size={15} />,
        onSelect: () => openChange(songItem(tr), anchor, songMeta(tr)),
      },
      {
        key: 'open-song',
        label: t('sj.context.openSong'),
        icon: <Music2 size={15} />,
        onSelect: () => router.push(href(tr)),
      },
      {
        key: 'open-new-tab',
        label: t('sj.context.openNewTab'),
        icon: <ExternalLink size={15} />,
        onSelect: () => openInNewTab(href(tr)),
      },
      {
        key: 'copy-link',
        label: t('sj.context.copyLink'),
        icon: <Link2 size={15} />,
        onSelect: () => {
          void navigator.clipboard
            ?.writeText(`${window.location.origin}${href(tr)}`)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            })
            .catch(() => {});
        },
      },
      ...(rated
        ? [
            {
              key: 'remove-rating',
              label: t('sj.context.deleteRating'),
              icon: <X size={15} />,
              destructive: true,
              onSelect: () => void onRate(tr.recordingId, null),
            },
          ]
        : []),
    ];
  }

  const modalTrack = precise;

  const SortHead = ({ col, label, className = '' }: { col: TrackSort; label: string; className?: string }) => (
    <span
      role="columnheader"
      aria-sort={sort.col === col ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      className={`inline-flex ${className}`}
    >
      <button
        type="button"
        onClick={() => applySort(col)}
        className={`inline-flex items-center gap-0.5 hover:text-ink transition ${
          sort.col === col ? 'text-ink' : ''
        }`}
      >
        {label}
        {sort.col === col && (sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
      </button>
    </span>
  );

  return (
    <div>
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2 px-1">
          <p className="text-[12px] text-muted">
            {t('sj.tracklist.summary')
              .replace('{n}', String(tracks.length))
              .replace('{time}', formatDuration(totalMs) || '—')}
          </p>
        </div>
      )}

      <div
        className={`rounded-2xl bg-surface border border-divider/60 ${compact ? 'overflow-hidden' : ''}`}
        role="table"
        aria-label={t('sj.album.tracklist')}
      >
        {!compact && (
          <div
            role="row"
            className="sticky top-[56px] md:top-0 z-10 flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 py-2 rounded-t-2xl bg-surface/95 backdrop-blur border-b border-divider text-[10.5px] font-semibold tracking-[0.06em] uppercase text-muted"
          >
            <SortHead col="order" label="#" className="w-6 justify-end" />
            <span role="columnheader" className="flex-1">{t('sj.tracklist.title')}</span>
            <SortHead col="community" label={t('sj.tracklist.community')} className="hidden sm:inline-flex w-[52px] justify-center" />
            <SortHead col="duration" label={t('sj.tracklist.time')} className="hidden sm:inline-flex w-10 justify-end" />
            <SortHead col="mine" label={t('sj.tracklist.you')} className="w-[30px] justify-center" />
            <span className="w-7" aria-hidden />
          </div>
        )}

        <div className="divide-y divide-divider [&>*:last-child]:rounded-b-2xl">
          {sorted.map((tr, i) => {
            const mine = myScores[tr.recordingId] ?? null;
            const st = stats?.[tr.recordingId];
            const showDisc =
              !compact &&
              sort.col === 'order' &&
              multiDisc &&
              (i === 0 || sorted[i - 1].discNumber !== tr.discNumber);
            // A credit that isn't just the album artist ("… feat. Guest") is worth showing.
            const credit =
              tr.artists && tr.artists.trim().toLowerCase() !== release.artist.trim().toLowerCase()
                ? tr.artists
                : null;
            const isCurrent = tr.recordingId === currentRecordingId;
            return (
              <Fragment key={`${tr.discNumber}-${tr.position}-${tr.recordingId}`}>
                {showDisc && (
                  <div className="px-4 py-1.5 bg-page/40 text-[11px] font-semibold tracking-[0.06em] uppercase text-muted">
                    {t('sj.album.discN').replace('{n}', String(tr.discNumber))}
                  </div>
                )}
                <div
                  role="row"
                  onContextMenu={(e) => {
                    const el = e.target as Element;
                    if (el.closest('input, textarea')) return;
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY, track: tr });
                  }}
                  aria-current={isCurrent ? 'true' : undefined}
                  className={`group flex items-center gap-2.5 sm:gap-3 px-3 sm:px-4 ${
                    compact ? 'py-2' : 'py-2.5'
                  } transition ${isCurrent ? 'bg-accent/[0.08]' : 'hover:bg-page/60'}`}
                >
                  <span
                    className={`w-6 text-right text-[13px] tabular-nums shrink-0 ${
                      isCurrent ? 'text-accent font-bold' : 'text-muted'
                    }`}
                  >
                    {tr.position}
                  </span>
                  <span className="flex-1 min-w-0">
                    {isCurrent ? (
                      <span className="block text-[14px] font-semibold text-ink truncate">{tr.title}</span>
                    ) : (
                      <Link href={href(tr)} className="block text-[14px] text-ink truncate hover:underline">
                        {tr.title}
                      </Link>
                    )}
                    {credit && <span className="block text-[11.5px] text-muted truncate">{credit}</span>}
                  </span>
                  {!compact && (
                    <SaveToMixButton
                      item={songItem(tr)}
                      meta={songMeta(tr)}
                      variant="inline"
                      size={28}
                      className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100 [@media(hover:none)]:hidden transition"
                    />
                  )}
                  {!compact && (
                    <span className="hidden sm:flex w-[52px] justify-center shrink-0">
                      {stats === null ? (
                        <span className="w-6 h-6 rounded-full bg-divider/50 animate-pulse" />
                      ) : st?.avg != null ? (
                        <span title={t('sj.tracklist.nRatings').replace('{n}', String(st.count))}>
                          <ScoreBadge score={st.avg} size={22} ringStroke={1.5} ringGap={1} />
                        </span>
                      ) : (
                        <span className="text-[12px] text-divider">—</span>
                      )}
                    </span>
                  )}
                  <span
                    className={`${compact ? '' : 'hidden sm:block'} w-10 text-right text-[12px] text-muted tabular-nums shrink-0`}
                  >
                    {formatDuration(tr.durationMs)}
                  </span>
                  <span className="w-[30px] flex justify-center shrink-0">
                    {scoresLoading ? (
                      <span className="w-[30px] h-[30px] rounded-full bg-divider/50 animate-pulse" />
                    ) : compact ? (
                      mine != null ? (
                        <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[11px] font-bold tabular-nums">
                          {formatScore(mine)}
                        </span>
                      ) : null
                    ) : (
                      <FlowerRateControl
                        ariaLabel={`${t('sj.album.rateTrack')} ${tr.title}`}
                        currentScore={mine}
                        onRate={(s) => requireAuth() && void onRate(tr.recordingId, s)}
                        onRequestPrecise={() => requireAuth() && setPrecise(tr)}
                        size={30}
                        ratingStep={ratingStep}
                        className={mine != null ? '' : '!bg-accent/[0.12] !shadow-none'}
                      />
                    )}
                  </span>
                  {!compact && (
                    <button
                      type="button"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu(menu ? null : { x: r.right, y: r.bottom + 6, track: tr });
                      }}
                      aria-label={t('sj.common.moreOptions')}
                      aria-haspopup="menu"
                      className="grid place-items-center w-7 h-7 rounded-lg text-muted hover:text-ink hover:bg-page transition shrink-0"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {copied && (
        <p role="status" className="mt-2 px-1 text-[12px] text-accent sj-fade-in">
          {t('sj.context.linkCopied')}
        </p>
      )}

      {menu && (
        <OverflowMenuSurface
          x={menu.x}
          y={menu.y}
          align="left"
          items={menuItems(menu.track, { x: menu.x, y: menu.y })}
          onClose={() => setMenu(null)}
        />
      )}

      {modalTrack && (
        <ManualRateModal
          key={modalTrack.recordingId}
          open
          release={release}
          track={{ recordingId: modalTrack.recordingId, title: modalTrack.title }}
          existingScore={myScores[modalTrack.recordingId] ?? null}
          ratingStep={ratingStep}
          onSave={(s) => onRate(modalTrack.recordingId, s)}
          onClose={() => setPrecise(null)}
        />
      )}
    </div>
  );
}
