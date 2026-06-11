'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search } from 'lucide-react';
import type { AlbumRelease } from '../types';
import type { SpotifyArtist } from '../lib/spotify';

interface Suggestions {
  artists: SpotifyArtist[];
  releases: AlbumRelease[];
}

const EMPTY: Suggestions = { artists: [], releases: [] };

export default function SearchBar({ placeholder, className }: { placeholder: string; className?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestions>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!q.trim()) { setSuggestions(EMPTY); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search/suggest?query=${encodeURIComponent(q)}`);
      const data = await res.json();
      setSuggestions({
        artists:  data.artists  ?? [],
        releases: data.releases ?? [],
      });
      setOpen(true);
      setActiveIndex(-1);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setSuggestions(EMPTY); setOpen(false); return; }
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300);
  };

  const close = () => { setOpen(false); setQuery(''); setSuggestions(EMPTY); };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    router.push(`/search?query=${encodeURIComponent(query.trim())}`);
    close();
  };

  // Flat list used for keyboard navigation
  const flatItems: { href: string }[] = [
    ...suggestions.artists.map(a => ({ href: `/artist/${a.id}` })),
    ...suggestions.releases.map(r => ({ href: `/album/${r.id}` })),
  ];
  const hasResults = flatItems.length > 0;
  const seeAllIndex = flatItems.length; // index of the "See all" row

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || !hasResults) { if (e.key === 'Escape') setOpen(false); return; }
    const total = flatItems.length + 1; // +1 for "see all" row
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => (i + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => (i <= 0 ? total - 1 : i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      const dest = activeIndex < flatItems.length
        ? flatItems[activeIndex].href
        : `/search?query=${encodeURIComponent(query.trim())}`;
      router.push(dest);
      close();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showDropdown = open && query.trim() && hasResults;

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ''}`}>
      <form onSubmit={handleSubmit}>
        <div className="bg-surface border border-divider rounded-xl px-4 py-2 flex items-center gap-2 w-full hover:border-mid transition">
          <Search size={15} className="text-muted flex-shrink-0" />
          <input
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => { if (query.trim() && hasResults) setOpen(true); }}
            placeholder={placeholder}
            autoComplete="off"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-placeholder"
          />
          {loading && (
            <div className="w-3 h-3 border border-muted border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
        </div>
      </form>

      {showDropdown && (
        <div className="absolute top-full mt-1.5 left-0 right-0 bg-page border border-divider rounded-xl shadow-xl z-[60] overflow-hidden">

          {/* Artists */}
          {suggestions.artists.length > 0 && (
            <section>
              <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold text-muted uppercase tracking-wider">
                Artists
              </p>
              {suggestions.artists.map((artist, i) => (
                <Link
                  key={artist.id}
                  href={`/artist/${artist.id}`}
                  onClick={close}
                  className={`flex items-center gap-3 px-4 py-2.5 transition ${
                    activeIndex === i ? 'bg-surface' : 'hover:bg-surface'
                  }`}
                >
                  <div className="w-9 h-9 rounded-full overflow-hidden bg-surface border border-divider flex-shrink-0">
                    {artist.coverUrl
                      ? <img src={artist.coverUrl} alt={artist.name} className="w-full h-full object-cover" />
                      : <span className="w-full h-full flex items-center justify-center text-[13px] font-bold text-muted">{artist.name[0]}</span>
                    }
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink truncate">{artist.name}</p>
                    <p className="text-[11px] text-muted">Artist</p>
                  </div>
                </Link>
              ))}
            </section>
          )}

          {/* Releases */}
          {suggestions.releases.length > 0 && (
            <section className={suggestions.artists.length > 0 ? 'border-t border-divider' : ''}>
              <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold text-muted uppercase tracking-wider">
                Albums
              </p>
              {suggestions.releases.map((release, i) => {
                const idx = suggestions.artists.length + i;
                const year = release.date?.slice(0, 4);
                const meta = [release.artist, year, release.releaseType !== 'Album' ? release.releaseType : null]
                  .filter(Boolean).join(' · ');
                return (
                  <Link
                    key={release.id}
                    href={`/album/${release.id}`}
                    onClick={close}
                    className={`flex items-center gap-3 px-4 py-2.5 transition ${
                      activeIndex === idx ? 'bg-surface' : 'hover:bg-surface'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-[5px] overflow-hidden bg-divider flex-shrink-0">
                      {release.coverUrl
                        ? <img src={release.coverUrl} alt={release.title} className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-divider" />
                      }
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink truncate">{release.title}</p>
                      <p className="text-[11px] text-muted truncate">{meta}</p>
                    </div>
                  </Link>
                );
              })}
            </section>
          )}

          {/* See all */}
          <Link
            href={`/search?query=${encodeURIComponent(query.trim())}`}
            onClick={close}
            className={`flex items-center justify-between px-4 py-3 border-t border-divider text-[13px] font-medium transition ${
              activeIndex === seeAllIndex
                ? 'bg-surface text-[#E8A020]'
                : 'text-[#E8A020] hover:bg-surface'
            }`}
          >
            <span>See all results for &ldquo;{query}&rdquo;</span>
            <span>→</span>
          </Link>
        </div>
      )}
    </div>
  );
}
