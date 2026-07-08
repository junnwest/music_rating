'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import Cover from './Cover';
import { useLanguage } from '../../lib/i18n';
import { displayName, typeLabelKey } from '../../lib/sj/display';

interface SuggestArtist {
  id: string;
  name: string;
  nameNative: string | null;
  coverUrl: string | null;
}

interface SuggestAlbum {
  id: string;
  title: string;
  titleNative: string | null;
  artist: string;
  coverUrl: string | null;
  releaseType: string | null;
}

/** A flat, keyboard-navigable list: artists, then albums, then "see all". */
type Item =
  | { kind: 'artist'; artist: SuggestArtist }
  | { kind: 'album'; album: SuggestAlbum }
  | { kind: 'all' };

/**
 * Top-bar search omnibox — the single, canonical search on web.
 * Typeahead via /api/search/suggest (Redis + CDN cached), ⌘K or "/" to
 * focus from anywhere, arrow keys + Enter to pick, Esc to dismiss,
 * Enter with no selection → full results on /search?q=.
 */
export default function SearchOmnibox() {
  const { t } = useLanguage();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [artists, setArtists] = useState<SuggestArtist[]>([]);
  const [albums, setAlbums] = useState<SuggestAlbum[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const requestSeq = useRef(0);

  const items: Item[] = [
    ...artists.map((artist): Item => ({ kind: 'artist', artist })),
    ...albums.map((album): Item => ({ kind: 'album', album })),
    ...(query.trim().length >= 2 ? [{ kind: 'all' } as Item] : []),
  ];

  // ⌘K / Ctrl+K / "/" focuses the box from anywhere (unless already typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inField =
        e.target instanceof HTMLElement &&
        (e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (e.key === '/' && !inField) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click outside closes
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, []);

  const fetchSuggestions = useCallback((q: string) => {
    const seq = ++requestSeq.current;
    fetch(`/api/search/suggest?query=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : { artists: [], albums: [] }))
      .then((body: { artists?: SuggestArtist[]; albums?: SuggestAlbum[] }) => {
        if (seq !== requestSeq.current) return; // stale response
        setArtists(body.artists ?? []);
        setAlbums(body.albums ?? []);
      })
      .catch(() => {});
  }, []);

  function onChange(value: string) {
    setQuery(value);
    setActiveIndex(-1);
    clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 2) {
      setArtists([]);
      setAlbums([]);
      setOpen(false);
      return;
    }
    setOpen(true);
    debounceRef.current = setTimeout(() => fetchSuggestions(q), 200);
  }

  function go(item: Item) {
    setOpen(false);
    setActiveIndex(-1);
    if (item.kind === 'artist') router.push(`/artist/${item.artist.id}`);
    else if (item.kind === 'album') router.push(`/album/${item.album.id}`);
    else router.push(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || items.length === 0) {
      if (e.key === 'Enter' && query.trim()) {
        e.preventDefault();
        go({ kind: 'all' });
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(activeIndex >= 0 ? items[activeIndex] : { kind: 'all' });
    }
  }

  return (
    <div ref={rootRef} className="relative flex-1 max-w-md">
      <div className="flex items-center gap-2 px-3 h-9 rounded-[10px] bg-surface border border-divider focus-within:border-accent/60 transition">
        <Search size={15} className="text-muted shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          placeholder={t('sj.nav.searchPlaceholder')}
          role="combobox"
          aria-expanded={open}
          aria-controls="sj-omnibox-listbox"
          aria-autocomplete="list"
          aria-label={t('sj.nav.searchHint')}
          className="w-full bg-transparent text-[13.5px] text-ink placeholder-placeholder outline-none"
        />
        <kbd className="hidden md:inline-flex items-center px-1.5 h-5 rounded border border-divider text-[10px] font-medium text-muted shrink-0">
          /
        </kbd>
      </div>

      {open && items.length > 0 && (
        <div
          id="sj-omnibox-listbox"
          role="listbox"
          className="absolute left-0 right-0 top-11 z-50 rounded-xl bg-surface border border-divider shadow-lg overflow-hidden sj-pop-in"
        >
          {items.map((item, i) => {
            const active = i === activeIndex;
            const rowClass = `w-full flex items-center gap-2.5 px-3 py-2 text-left transition ${
              active ? 'bg-accent-soft' : 'hover:bg-page/70'
            }`;
            if (item.kind === 'artist') {
              return (
                <button
                  key={`ar-${item.artist.id}`}
                  role="option"
                  aria-selected={active}
                  className={rowClass}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => go(item)}
                >
                  <Cover
                    url={item.artist.coverUrl}
                    className="w-8 h-8"
                    rounded="rounded-full"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-ink truncate">
                      {displayName(item.artist.name, item.artist.nameNative)}
                    </span>
                    <span className="block text-[11px] text-muted">
                      {t('sj.search.artists')}
                    </span>
                  </span>
                </button>
              );
            }
            if (item.kind === 'album') {
              const typeKey = typeLabelKey(item.album.releaseType);
              return (
                <button
                  key={`al-${item.album.id}`}
                  role="option"
                  aria-selected={active}
                  className={rowClass}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => go(item)}
                >
                  <Cover url={item.album.coverUrl} className="w-8 h-8" rounded="rounded-md" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-ink truncate">
                      {displayName(item.album.title, item.album.titleNative)}
                    </span>
                    <span className="block text-[11px] text-muted truncate">
                      {item.album.artist}
                      {typeKey ? ` · ${t(typeKey)}` : ''}
                    </span>
                  </span>
                </button>
              );
            }
            return (
              <button
                key="all"
                role="option"
                aria-selected={active}
                className={`${rowClass} border-t border-divider`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => go(item)}
              >
                <Search size={14} className="text-accent shrink-0 mx-2" />
                <span className="text-[13px] font-semibold text-accent truncate">
                  {t('sj.nav.seeAllResults').replace('{q}', query.trim())}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
