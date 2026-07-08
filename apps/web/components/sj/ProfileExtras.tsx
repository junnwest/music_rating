'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronsUpDown, Download, X } from 'lucide-react';
import Cover from './Cover';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { eloToScore } from '../../lib/elo';
import { displayName, formatScore, typeLabelKey } from '../../lib/sj/display';
import { RG_EMBED_NATIVE } from '../../lib/sj/data';
import type { ProfileRatingItem } from './ProfileView';

// ── Library (saved albums) ──────────────────────────────────────────────────

interface SavedEntry {
  release_group_id: string;
  release_groups: {
    id: string;
    title: string;
    artist_display: string;
    cover_url: string | null;
    release_group_type: string | null;
    native_title: string | null;
    artists?: { name_native: string | null } | null;
  } | null;
}

/**
 * Saved-to-listen-later albums — the surface for the feed's bookmark button
 * (which previously wrote to a table nothing read). Own profile only until
 * library_visibility enforcement lands on web.
 */
export function SavedLibrary({ userId }: { userId: string }) {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<SavedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from('saved_releases')
      .select(`release_group_id, ${RG_EMBED_NATIVE}`)
      .eq('user_id', userId)
      .then(({ data }) => {
        if (cancelled) return;
        setEntries(
          ((data as unknown as SavedEntry[] | null) ?? []).filter((e) => e.release_groups),
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function remove(releaseGroupId: string) {
    setEntries((prev) => prev.filter((e) => e.release_group_id !== releaseGroupId));
    await supabase
      ?.from('saved_releases')
      .delete()
      .eq('user_id', userId)
      .eq('release_group_id', releaseGroupId);
  }

  if (loading) {
    return (
      <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-3 animate-pulse" aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="aspect-square rounded-[10px] bg-surface" />
        ))}
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <p className="py-16 text-center text-[13.5px] text-muted">{t('sj.profile.libraryEmpty')}</p>
    );
  }
  return (
    <div className="mt-4 grid grid-cols-3 sm:grid-cols-4 gap-3">
      {entries.map((e) => {
        const rg = e.release_groups!;
        return (
          <div key={e.release_group_id} className="group relative">
            <Link href={`/album/${rg.id}`} className="block">
              <Cover url={rg.cover_url} className="w-full aspect-square" />
              <p className="mt-1 text-[11.5px] font-semibold text-ink truncate group-hover:underline">
                {displayName(rg.title, rg.native_title)}
              </p>
              <p className="text-[10.5px] text-muted truncate">
                {displayName(rg.artist_display, rg.artists?.name_native ?? null)}
              </p>
            </Link>
            <button
              onClick={() => remove(e.release_group_id)}
              aria-label={t('sj.profile.removeFromLibrary')}
              title={t('sj.profile.removeFromLibrary')}
              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/55 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Rated table view (desktop power view) ───────────────────────────────────

type TableCol = 'title' | 'artist' | 'type' | 'score' | 'date';

export function RatedTable({ items }: { items: ProfileRatingItem[] }) {
  const { t } = useLanguage();
  const [sortCol, setSortCol] = useState<TableCol>('date');
  const [sortDesc, setSortDesc] = useState(true);

  const effectiveScore = useCallback(
    (i: ProfileRatingItem) =>
      i.score != null ? i.score : i.eloScore != null ? eloToScore(i.eloScore) : null,
    [],
  );

  const sorted = useMemo(() => {
    const rows = [...items];
    const dir = sortDesc ? -1 : 1;
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'title') cmp = a.title.localeCompare(b.title);
      else if (sortCol === 'artist') cmp = a.artistLine.localeCompare(b.artistLine);
      else if (sortCol === 'type')
        cmp = (a.isSong ? 'song' : (a.releaseType ?? '')).localeCompare(
          b.isSong ? 'song' : (b.releaseType ?? ''),
        );
      else if (sortCol === 'score') cmp = (effectiveScore(a) ?? -1) - (effectiveScore(b) ?? -1);
      else cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
      return cmp * dir;
    });
    return rows;
  }, [items, sortCol, sortDesc, effectiveScore]);

  function toggleSort(col: TableCol) {
    if (col === sortCol) setSortDesc((d) => !d);
    else {
      setSortCol(col);
      setSortDesc(col === 'score' || col === 'date');
    }
  }

  function exportCsv() {
    const esc = (v: string | number | null) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['title', 'artist', 'type', 'score', 'rated_at'];
    const lines = [header.join(',')].concat(
      sorted.map((i) =>
        [
          esc(i.title),
          esc(i.artistLine),
          esc(i.isSong ? 'song' : (i.releaseType ?? '')),
          esc(effectiveScore(i)),
          esc(i.createdAt ?? ''),
        ].join(','),
      ),
    );
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sillajuku-ratings.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const cols: { key: TableCol; label: string; className?: string }[] = [
    { key: 'title', label: t('sj.profile.colTitle') },
    { key: 'artist', label: t('sj.profile.colArtist') },
    { key: 'type', label: t('sj.profile.colType'), className: 'w-24' },
    { key: 'score', label: t('sj.profile.colScore'), className: 'w-20 text-right' },
    { key: 'date', label: t('sj.profile.colDate'), className: 'w-28 text-right' },
  ];

  return (
    <div className="mt-3">
      <div className="flex justify-end mb-2">
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-muted hover:text-ink hover:bg-surface transition"
        >
          <Download size={13} /> {t('sj.profile.exportCsv')}
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-divider/60">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-surface border-b border-divider">
              {cols.map(({ key, label, className }) => (
                <th key={key} className={`px-3 py-2 ${className ?? ''}`}>
                  <button
                    onClick={() => toggleSort(key)}
                    className={`inline-flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-[0.04em] transition ${
                      sortCol === key ? 'text-accent' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {label}
                    <ChevronsUpDown size={11} className={sortCol === key ? '' : 'opacity-40'} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {sorted.map((i) => {
              const score = effectiveScore(i);
              const href = i.isSong
                ? i.recordingId
                  ? `/song/${i.recordingId}`
                  : null
                : i.releaseGroupId
                  ? `/album/${i.releaseGroupId}`
                  : null;
              const typeKey = i.isSong ? 'sj.profile.filterSongs' : typeLabelKey(i.releaseType);
              return (
                <tr key={i.key} className="hover:bg-surface/60 transition">
                  <td className="px-3 py-2 max-w-0 w-2/5">
                    {href ? (
                      <Link
                        href={href}
                        className="flex items-center gap-2.5 min-w-0 hover:underline"
                      >
                        <Cover url={i.coverUrl} className="w-8 h-8 shrink-0" rounded="rounded-md" />
                        <span className="text-[13px] font-semibold text-ink truncate">
                          {i.title}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-[13px] font-semibold text-ink truncate">{i.title}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 max-w-0">
                    <span className="block text-[12.5px] text-muted truncate">{i.artistLine}</span>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-muted whitespace-nowrap">
                    {typeKey ? t(typeKey) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-[13px] font-bold text-ink tabular-nums">
                    {score != null ? formatScore(score) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-[12px] text-muted tabular-nums whitespace-nowrap">
                    {i.createdAt ? i.createdAt.slice(0, 10) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
