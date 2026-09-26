'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Plus, Search as SearchIcon, X } from 'lucide-react';
import Cover from './Cover';
import SongChip from './SongChip';
import AlbumSongPicker from './AlbumSongPicker';
import { useSession } from './SessionContext';
import { useMixTarget } from './MixTargetContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { displayName, typeLabelKey } from '../../lib/sj/display';
import type { MixItemRef } from '../../lib/sj/mixes';

/**
 * P4 — the mix page's inline "+" add mode (owner only). Same suggest API as the
 * omnibox, plus songs; each result's rate control is replaced by a "+" that adds
 * straight to *this* mix (bypassing the global save target). Albums expand to
 * their tracks, so any song is reachable even when a title search is too broad.
 *
 * Keyboard: type → ↑/↓ → Enter toggles, → / ← expand/collapse an album, Esc closes.
 */

interface Row {
  key: string;
  item: MixItemRef;
  title: string;
  subtitle: string;
  typeLabel: string | null;
  coverUrl: string | null;
}

export default function MixAddPanel({ mixId, onClose }: { mixId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const { userId } = useSession();
  const { membership, add, remove } = useMixTarget();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Row[] | null>(null);
  const [recent, setRecent] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const seq = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  // Empty query → your recently rated albums, the likeliest things to add.
  useEffect(() => {
    if (!supabase || !userId) return;
    let cancelled = false;
    supabase
      .from('ratings')
      .select(
        'release_groups(id, title, native_title, artist_display, cover_url, release_group_type, artists!release_groups_primary_artist_id_fkey(name_native))',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error('[mix add] recent failed:', error.message);
        setRecent(
          ((data as any[] | null) ?? [])
            .map((r) => r.release_groups)
            .filter(Boolean)
            .map((rg: any) => ({
              key: `a:${rg.id}`,
              item: { kind: 'album', releaseGroupId: rg.id } as MixItemRef,
              title: displayName(rg.title, rg.native_title),
              subtitle: displayName(rg.artist_display, rg.artists?.name_native),
              typeLabel: t(typeLabelKey(rg.release_group_type)),
              coverUrl: rg.cover_url,
            })),
        );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    const my = ++seq.current;
    setLoading(true);
    const id = setTimeout(() => {
      fetch(`/api/search/suggest?query=${encodeURIComponent(q)}&types=songs`)
        .then((r) => (r.ok ? r.json() : { albums: [], songs: [] }))
        .then((data: { albums?: any[]; songs?: any[] }) => {
          if (my !== seq.current) return;
          const albums: Row[] = (data.albums ?? []).map((a) => ({
            key: `a:${a.id}`,
            item: { kind: 'album', releaseGroupId: a.id },
            title: displayName(a.title, a.titleNative),
            subtitle: a.artist,
            typeLabel: t(typeLabelKey(a.releaseType)),
            coverUrl: a.coverUrl,
          }));
          const songs: Row[] = (data.songs ?? []).map((s) => ({
            key: `s:${s.id}`,
            item: { kind: 'song', recordingId: s.id, releaseGroupId: s.releaseGroupId },
            title: s.title,
            subtitle: `${s.artist} · ${s.albumTitle}`,
            typeLabel: null,
            coverUrl: s.coverUrl,
          }));
          setResults([...albums, ...songs]);
          setActive(0);
          setLoading(false);
        })
        .catch(() => {
          if (my === seq.current) {
            setResults([]);
            setLoading(false);
          }
        });
    }, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const rows = useMemo(() => (query.trim().length >= 2 ? results ?? [] : recent ?? []), [
    query,
    results,
    recent,
  ]);

  function toggle(row: Row, el?: HTMLElement | null) {
    if (membership(row.item).includes(mixId)) void remove(row.item, mixId);
    else
      void add(row.item, {
        mixId,
        remember: false,
        meta: { coverUrl: row.coverUrl, title: row.title },
        from: el?.getBoundingClientRect() ?? null,
      });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (rows.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      setActive(next);
      listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[active];
      if (row) toggle(row, listRef.current?.children[active]?.querySelector('button[data-add]') as HTMLElement);
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && rows[active]?.item.kind === 'album') {
      e.preventDefault();
      setExpanded(e.key === 'ArrowRight' ? rows[active].key : null);
    }
  }

  const showingRecent = query.trim().length < 2;

  return (
    <section
      className="mt-5 rounded-2xl bg-surface border border-divider/60 overflow-hidden sj-pop-in"
      aria-label={t('sj.mixAdd.title')}
    >
      <div className="flex items-center gap-2.5 px-4 h-12 border-b border-divider">
        <SearchIcon size={16} className="text-muted shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls="mix-add-results"
          aria-activedescendant={rows[active] ? `mix-add-${rows[active].key}` : undefined}
          placeholder={t('sj.mixAdd.placeholder')}
          className="flex-1 min-w-0 bg-transparent text-[14.5px] text-ink placeholder-placeholder outline-none"
        />
        {loading && (
          <span className="w-4 h-4 rounded-full border-2 border-divider border-t-accent animate-spin shrink-0" />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t('sj.mixAdd.close')}
          className="grid place-items-center w-8 h-8 -mr-2 rounded-lg text-muted hover:text-ink hover:bg-page transition"
        >
          <X size={16} />
        </button>
      </div>

      {showingRecent && (
        <p className="px-4 pt-3 pb-1 text-[11px] font-semibold tracking-[0.08em] uppercase text-muted">
          {t('sj.mixAdd.recent')}
        </p>
      )}

      {(showingRecent ? recent === null : results === null) ? (
        <div className="px-4 py-3 space-y-2.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-md bg-page animate-pulse" />
              <span className="h-3 w-1/2 rounded bg-page animate-pulse" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-muted">
          {showingRecent ? t('sj.mixAdd.noRecent') : t('sj.search.noResults').replace('{q}', query.trim())}
        </p>
      ) : (
        <ul id="mix-add-results" ref={listRef} role="listbox" className="max-h-[420px] overflow-y-auto py-1">
          {rows.map((row, i) => {
            const inMix = membership(row.item).includes(mixId);
            const isOpen = expanded === row.key;
            return (
              <li key={row.key} id={`mix-add-${row.key}`} role="option" aria-selected={i === active}>
                <div
                  onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-2 pl-2 pr-3 py-1.5 ${i === active ? 'bg-page/70' : ''}`}
                >
                  {row.item.kind === 'album' ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setExpanded(isOpen ? null : row.key)}
                      aria-expanded={isOpen}
                      aria-label={isOpen ? t('sj.dock.hideSongs') : t('sj.dock.showSongs')}
                      className="grid place-items-center w-6 h-6 rounded-md text-muted hover:text-ink hover:bg-page transition shrink-0"
                    >
                      <ChevronRight size={14} className={`transition ${isOpen ? 'rotate-90' : ''}`} />
                    </button>
                  ) : (
                    <span className="w-6 shrink-0" />
                  )}
                  <Cover url={row.coverUrl} className="w-10 h-10" rounded="rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13.5px] font-semibold text-ink truncate">{row.title}</span>
                      {row.item.kind === 'song' && <SongChip />}
                    </span>
                    <span className="block text-[12px] text-muted truncate">
                      {row.typeLabel ? `${row.typeLabel} · ${row.subtitle}` : row.subtitle}
                    </span>
                  </span>
                  <button
                    type="button"
                    data-add
                    tabIndex={-1}
                    onClick={(e) => toggle(row, e.currentTarget)}
                    aria-pressed={inMix}
                    aria-label={
                      inMix
                        ? t('sj.mix.remove')
                        : t('sj.mixAdd.addItem').replace('{title}', row.title)
                    }
                    className={`grid place-items-center w-8 h-8 rounded-full shrink-0 transition active:scale-95 ${
                      inMix
                        ? 'bg-accent text-white'
                        : 'bg-accent/10 text-accent hover:bg-accent/20'
                    }`}
                  >
                    {inMix ? <Check size={15} strokeWidth={3} /> : <Plus size={16} strokeWidth={2.6} />}
                  </button>
                </div>
                {isOpen && row.item.kind === 'album' && (
                  <AlbumSongPicker
                    releaseGroupId={row.item.releaseGroupId}
                    coverUrl={row.coverUrl}
                    mixId={mixId}
                    remember={false}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="px-4 py-2 border-t border-divider text-[11px] text-muted">{t('sj.mixAdd.hint')}</p>
    </section>
  );
}
