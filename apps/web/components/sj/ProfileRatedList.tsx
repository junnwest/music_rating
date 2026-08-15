'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Download, ExternalLink, SlidersHorizontal, Trash2, X } from 'lucide-react';
import Cover from './Cover';
import FlowerGlyph from './FlowerGlyph';
import { useContextMenu, openInNewTab } from './ContextMenu';
import { useLanguage } from '../../lib/i18n';
import { formatScore, spectrumFill, spectrumNumber, spectrumRing, typeLabelKey } from '../../lib/sj/display';
import type { ProfileRatingItem } from './ProfileView';

/**
 * The Rated tab's single list view — what used to be two modes ("list" on
 * mobile, "table" on desktop, self only). They showed the same rows with
 * different affordances and each grew its own sort model, so switching between
 * them lost your sort and the table was invisible to anyone viewing someone
 * else's profile.
 *
 * Now there is one responsive grid: cover · title · (artist · type · score ·
 * date as their own columns from `md` up, stacked under the title below that).
 * The column headers are the desktop sort control and the `<select>` is the
 * mobile one — both drive the same `sortCol`/`sortDesc` state that lives in
 * ProfileView, so the ordering survives a viewport change.
 */

export type RatedSortCol = 'title' | 'artist' | 'type' | 'score' | 'date';
export type KindFilter = 'all' | 'albums' | 'eps' | 'singles' | 'songs';
/** Inclusive score bounds, on the 0–5 display scale. `[0, 5]` means "no filter". */
export type ScoreRange = [number, number];

export const FULL_RANGE: ScoreRange = [0, 5];

/** The score a row is filtered and sorted by. */
export function effectiveScore(i: ProfileRatingItem): number | null {
  return i.score;
}

/** The bucket a row falls into for the kind filter. */
export function kindOf(i: ProfileRatingItem): KindFilter {
  if (i.isSong) return 'songs';
  const t = (i.releaseType ?? '').toLowerCase();
  if (t === 'ep') return 'eps';
  if (t === 'single') return 'singles';
  return 'albums';
}

// ── Filter bar ──────────────────────────────────────────────────────────────

const KINDS: { key: KindFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'sj.profile.filterAll' },
  { key: 'albums', labelKey: 'sj.profile.filterAlbums' },
  { key: 'eps', labelKey: 'sj.profile.filterEps' },
  { key: 'singles', labelKey: 'sj.profile.filterSingles' },
  { key: 'songs', labelKey: 'sj.profile.filterSongs' },
];

export function RatedFilterBar({
  kind,
  onKind,
  range,
  onRange,
  sortCol,
  sortDesc,
  onSort,
  counts,
}: {
  kind: KindFilter;
  onKind: (k: KindFilter) => void;
  range: ScoreRange;
  onRange: (r: ScoreRange) => void;
  sortCol: RatedSortCol;
  sortDesc: boolean;
  onSort: (col: RatedSortCol, desc: boolean) => void;
  /** How many rows fall in each bucket, so empty filters can be hidden. */
  counts: Record<KindFilter, number>;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const rangeActive = range[0] !== FULL_RANGE[0] || range[1] !== FULL_RANGE[1];

  // Close the range panel on outside click / Escape, like the overflow menus.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    const id = setTimeout(() => document.addEventListener('mousedown', onDown));
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The `<select>` flattens (col, dir) into the six orderings worth naming.
  const sortValue = `${sortCol}:${sortDesc ? 'desc' : 'asc'}`;
  const SORTS: [string, string][] = [
    ['date:desc', t('sj.profile.sortRecent')],
    ['date:asc', t('sj.profile.sortOldest')],
    ['score:desc', t('sj.profile.sortTop')],
    ['score:asc', t('sj.profile.sortBottom')],
    ['title:asc', t('sj.profile.sortAz')],
    ['artist:asc', t('sj.profile.sortArtist')],
  ];

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {KINDS.filter((k) => k.key === 'all' || counts[k.key] > 0).map(({ key, labelKey }) => (
        <button
          key={key}
          onClick={() => onKind(key)}
          className={`px-3 py-1.5 rounded-lg text-[12px] transition ${
            kind === key ? 'bg-accent/10 text-accent font-semibold' : 'text-muted hover:text-ink'
          }`}
        >
          {t(labelKey)}
        </button>
      ))}

      <span className="flex-1" />

      {/* Score range — a disclosure rather than two always-on sliders, which
          would dominate a bar that is mostly one-tap filters. */}
      <div className="relative" ref={panelRef}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={t('sj.profile.scoreRange')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium transition ${
            rangeActive ? 'bg-accent/10 text-accent' : 'text-muted hover:text-ink'
          }`}
        >
          <SlidersHorizontal size={13} />
          {rangeActive ? `${formatScore(range[0])}–${formatScore(range[1])}` : t('sj.profile.score')}
        </button>
        {open && (
          <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-xl border border-divider bg-page p-3 shadow-lg">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-ink">
                {t('sj.profile.scoreRange')}
              </span>
              {rangeActive && (
                <button
                  onClick={() => onRange(FULL_RANGE)}
                  className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-ink transition"
                >
                  <X size={11} /> {t('sj.profile.clearFilter')}
                </button>
              )}
            </div>
            <div className="mt-2.5 space-y-2.5">
              {([0, 1] as const).map((idx) => (
                <label key={idx} className="flex items-center gap-2">
                  <span className="w-8 text-[11px] text-muted">
                    {t(idx === 0 ? 'sj.profile.min' : 'sj.profile.max')}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.5}
                    value={range[idx]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      // Dragging one handle past the other clamps the other
                      // rather than producing an empty (min > max) range.
                      onRange(
                        idx === 0
                          ? [v, Math.max(v, range[1])]
                          : [Math.min(v, range[0]), v],
                      );
                    }}
                    className="flex-1 accent-[#2979B7]"
                  />
                  <span className="w-7 text-right text-[12px] font-semibold text-ink tabular-nums">
                    {formatScore(range[idx])}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">{t('sj.profile.scoreRangeNote')}</p>
          </div>
        )}
      </div>

      <select
        value={sortValue}
        onChange={(e) => {
          const [col, dir] = e.target.value.split(':');
          onSort(col as RatedSortCol, dir === 'desc');
        }}
        aria-label={t('sj.profile.sort')}
        className="ml-1 bg-transparent text-[12px] font-medium text-accent outline-none cursor-pointer"
      >
        {SORTS.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── The list itself ─────────────────────────────────────────────────────────

/** Grid template shared by the header and every row, so columns stay aligned. */
const GRID =
  'grid grid-cols-[46px_minmax(0,1fr)_auto] md:grid-cols-[46px_minmax(0,2fr)_minmax(0,1.4fr)_5.5rem_4.5rem_6rem] items-center gap-3';

export default function ProfileRatedList({
  items,
  showScores,
  sortCol,
  sortDesc,
  onSort,
  onDelete,
  canExport,
}: {
  items: ProfileRatingItem[];
  showScores: boolean;
  sortCol: RatedSortCol;
  sortDesc: boolean;
  onSort: (col: RatedSortCol, desc: boolean) => void;
  onDelete?: (item: ProfileRatingItem) => void;
  canExport: boolean;
}) {
  const { t } = useLanguage();

  const toggle = useCallback(
    (col: RatedSortCol) => {
      // First click on a new column picks the direction that column is usually
      // read in — newest and highest first, but A→Z for text.
      if (col === sortCol) onSort(col, !sortDesc);
      else onSort(col, col === 'score' || col === 'date');
    },
    [sortCol, sortDesc, onSort],
  );

  function exportCsv() {
    const esc = (v: string | number | null) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['title', 'artist', 'type', 'score', 'rated_at'];
    const lines = [header.join(',')].concat(
      items.map((i) =>
        [
          esc(i.title),
          esc(i.artistLine),
          esc(i.isSong ? 'song' : (i.releaseType ?? '')),
          esc(effectiveScore(i)),
          esc(i.createdAt ?? ''),
        ].join(','),
      ),
    );
    // BOM so Excel reads the UTF-8 titles instead of mojibake.
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sillajuku-ratings.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const cols: { key: RatedSortCol; label: string; className: string }[] = [
    { key: 'title', label: t('sj.profile.colTitle'), className: '' },
    { key: 'artist', label: t('sj.profile.colArtist'), className: '' },
    { key: 'type', label: t('sj.profile.colType'), className: '' },
    { key: 'score', label: t('sj.profile.colScore'), className: 'justify-end' },
    { key: 'date', label: t('sj.profile.colDate'), className: 'justify-end' },
  ];

  return (
    <div className="mt-3">
      {canExport && (
        <div className="flex justify-end">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-muted hover:text-ink hover:bg-surface transition"
          >
            <Download size={13} /> {t('sj.profile.exportCsv')}
          </button>
        </div>
      )}

      {/* Column headers double as the desktop sort control. Hidden below `md`,
          where the same state is driven by the filter bar's select. */}
      <div
        className={`${GRID} hidden md:grid border-b border-divider px-1 pb-1.5`}
        role="row"
      >
        <span aria-hidden />
        {cols.map(({ key, label, className }) => (
          <button
            key={key}
            onClick={() => toggle(key)}
            // Not a real <table>, so `aria-sort` has nowhere valid to live —
            // the active column announces its direction in its own label.
            aria-label={
              sortCol === key
                ? `${label} — ${t(sortDesc ? 'sj.profile.sortDesc' : 'sj.profile.sortAsc')}`
                : label
            }
            className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.04em] transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded ${className} ${
              sortCol === key ? 'text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {label}
            <ChevronsUpDown size={11} className={sortCol === key ? '' : 'opacity-40'} />
          </button>
        ))}
      </div>

      <ul className="divide-y divide-divider">
        {items.map((item) => (
          <Row
            key={item.key}
            item={item}
            showScore={showScores || item.score != null}
            onDelete={onDelete ? () => onDelete(item) : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  item,
  showScore,
  onDelete,
}: {
  item: ProfileRatingItem;
  showScore: boolean;
  onDelete?: () => void;
}) {
  const { t } = useLanguage();
  const score = item.score;
  const href = item.isSong
    ? `/song/${item.recordingId}${item.releaseGroupId ? `?rg=${item.releaseGroupId}` : ''}`
    : `/album/${item.releaseGroupId}`;
  const typeKey = item.isSong ? 'sj.type.song' : typeLabelKey(item.releaseType);
  const typeLabel = typeKey ? t(typeKey) : null;

  const { onContextMenu, menu } = useContextMenu([
    {
      key: 'open-new-tab',
      label: t('sj.context.openNewTab'),
      icon: <ExternalLink size={15} />,
      onSelect: () => openInNewTab(href),
    },
    ...(onDelete
      ? [
          {
            key: 'delete',
            label: t('sj.context.deleteRating'),
            icon: <Trash2 size={15} />,
            destructive: true,
            onSelect: onDelete,
          },
        ]
      : []),
  ]);

  return (
    <li
      onContextMenu={onContextMenu}
      className={`group relative ${GRID} px-1 py-2.5 hover:bg-surface/50 transition`}
    >
      {menu}
      {/* One stretched link behind the whole row rather than an anchor wrapping
          the cells — the cells are grid items, and an anchor around them would
          need `display: contents` (unreliable for hit-testing). The delete
          button sits above it on z-10 and stays independently clickable. */}
      <Link href={href} aria-label={item.title} className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/50" />

      <Cover url={item.coverUrl} className="w-[46px] h-[46px]" rounded="rounded-md" />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="text-[13px] font-semibold text-ink truncate group-hover:underline">
            {item.title}
          </span>
          {/* The type chip is redundant once the Type column shows, so it's
              mobile-only rather than duplicated at every width. */}
          {typeLabel && (
            <span className="md:hidden px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[9.5px] font-medium shrink-0">
              {typeLabel}
            </span>
          )}
        </span>
        <span className="block md:hidden text-[12px] text-muted truncate">{item.artistLine}</span>
      </span>
      <span className="hidden md:block min-w-0 text-[12.5px] text-muted truncate">
        {item.artistLine}
      </span>
      <span className="hidden md:block text-[12px] text-muted truncate">{typeLabel ?? '—'}</span>

      {/* Score: the chip on mobile (where it's the only score affordance), a
          plain right-aligned number in the desktop column. */}
      <span className="md:hidden justify-self-end pointer-events-none">
        <ScoreChip score={showScore ? score : null} />
      </span>
      {/* Scores wear the app's score ramp (same as ScoreBadge/Stats) instead of
          flat ink, so a 4.5 and a 2.0 read differently at a glance. */}
      {showScore && score != null ? (
        <span
          className="hidden md:block text-right text-[13px] font-bold tabular-nums"
          style={{ color: spectrumRing(score) }}
        >
          {formatScore(score)}
        </span>
      ) : (
        <span className="hidden md:block text-right text-[13px] font-bold text-muted tabular-nums">
          —
        </span>
      )}
      <span className="hidden md:block text-right text-[12px] text-muted tabular-nums whitespace-nowrap">
        {item.createdAt ? item.createdAt.slice(0, 10) : '—'}
      </span>

      {onDelete && (
        <button
          onClick={onDelete}
          aria-label={t('sj.profile.deleteRatingTitle')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-md bg-page/90 text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}

function ScoreChip({ score }: { score: number | null }) {
  if (score != null) {
    // Ramp-colored chip — same fill/number pairing the Taste page's top-album
    // badge uses, replacing the old flat accent chip.
    return (
      <span
        className="flex items-center gap-1 px-2 py-1 rounded-md"
        style={{ background: spectrumFill(score), color: spectrumNumber(score) }}
      >
        <FlowerGlyph size={11} />
        <span className="text-[13px] font-bold tabular-nums">{formatScore(score)}</span>
      </span>
    );
  }
  return <FlowerGlyph size={11} className="text-muted" />;
}
