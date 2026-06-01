'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { useLanguage } from '../lib/i18n';
import InlineStarRating from './InlineStarRating';
import type { AlbumRelease } from '../types';

// ── Filter configuration ──────────────────────────────────────────────────────
const TYPE_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Albums', value: 'Album' },
  { label: 'EPs', value: 'EP' },
] as const;

const DECADE_OPTIONS = [
  { label: 'Any decade', value: '' },
  { label: '2020s', value: '2020' },
  { label: '2010s', value: '2010' },
  { label: '2000s', value: '2000' },
  { label: '1990s', value: '1990' },
  { label: '1980s', value: '1980' },
  { label: '1970s', value: '1970' },
] as const;

const GENRE_OPTIONS = [
  { label: 'Any genre', value: '' },
  { label: 'Hip-hop', value: 'hip hop' },
  { label: 'R&B', value: 'r&b' },
  { label: 'Pop', value: 'pop' },
  { label: 'Rock', value: 'rock' },
  { label: 'Electronic', value: 'electronic' },
  { label: 'Jazz', value: 'jazz' },
  { label: 'K-pop', value: 'k-pop' },
  { label: 'Soul', value: 'soul' },
  { label: 'Indie', value: 'indie' },
  { label: 'Classical', value: 'classical' },
  { label: 'Metal', value: 'metal' },
  { label: 'Folk', value: 'folk' },
] as const;

const LL_KEY = 'sillajuku:listen-later';

function BookmarkButton({ albumId, overlay = false }: { albumId: string; overlay?: boolean }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const ids = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
    setSaved(ids.includes(albumId));
  }, [albumId]);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const ids = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
    const next = ids.includes(albumId) ? ids.filter(id => id !== albumId) : [...ids, albumId];
    localStorage.setItem(LL_KEY, JSON.stringify(next));
    setSaved(!saved);
  };

  if (overlay) {
    return (
      <button
        onClick={toggle}
        title={saved ? 'Remove from Listen Later' : 'Save to Listen Later'}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition backdrop-blur-sm ${
          saved
            ? 'bg-[#E8A020] text-white shadow-sm'
            : 'bg-black/40 text-white/80 hover:bg-black/60'
        }`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      title={saved ? 'Remove from Listen Later' : 'Save to Listen Later'}
      className={`transition flex-shrink-0 ${saved ? 'text-[#E8A020]' : 'text-muted hover:text-ink'}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}

type Status = 'init' | 'guest' | 'ready';

export default function ExplorePage() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>('init');
  const [albums, setAlbums] = useState<AlbumRelease[]>([]);
  const [fetching, setFetching] = useState(false);

  // Active filter state (for rendering)
  const [filterType, setFilterType] = useState('');
  const [filterDecade, setFilterDecade] = useState('');
  const [filterGenre, setFilterGenre] = useState('');

  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const fetchingRef = useRef(false);
  const seenRef = useRef(new Set<string>());
  const artistsRef = useRef<string[]>([]);
  const genresRef = useRef<string[]>([]);
  const excludeRef = useRef<string[]>([]);
  const adventurousnessRef = useRef<number>(50);
  const userIdRef = useRef<string>('');
  // Filter refs — updated in sync with state, readable inside loadMore
  const filterTypeRef = useRef('');
  const filterDecadeRef = useRef('');
  const filterGenreRef = useRef('');
  const [hasMore, setHasMore] = useState(true);

  const loadMore = useCallback(async () => {
    if (fetchingRef.current || !hasMoreRef.current) return;
    fetchingRef.current = true;
    setFetching(true);

    try {
      const params = new URLSearchParams({
        artists: artistsRef.current.join(','),
        genres: genresRef.current.join(','),
        excludeIds: excludeRef.current.join(','),
        page: String(pageRef.current),
        adventurousness: String(adventurousnessRef.current),
        userId: userIdRef.current,
        filterType: filterTypeRef.current,
        filterDecade: filterDecadeRef.current,
        filterGenre: filterGenreRef.current,
      });
      const res = await fetch(`/api/recommendations?${params}`);
      const data = await res.json();

      const fresh = (data.albums ?? []).filter((a: AlbumRelease) => {
        if (seenRef.current.has(a.id)) return false;
        seenRef.current.add(a.id);
        return true;
      });

      setAlbums((prev) => [...prev, ...fresh]);
      hasMoreRef.current = data.hasMore ?? false;
      setHasMore(hasMoreRef.current);
      pageRef.current += 1;
    } catch {
      // leave hasMore true so user can retry on next scroll
    } finally {
      fetchingRef.current = false;
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) { setStatus('guest'); return; }

    (async () => {
      const { data: { session } } = await supabase!.auth.getSession();
      if (!session) { setStatus('guest'); return; }

      userIdRef.current = session.user.id;

      // Fetch user's recent ratings + profile in parallel
      const [ratingsResult, profileResult] = await Promise.all([
        supabase!
          .from('ratings')
          .select('release_id, score, releases(artist, genres)')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase!
          .from('profiles')
          .select('recommendation_adventurousness')
          .eq('id', session.user.id)
          .maybeSingle(),
      ]);

      const ratings = ratingsResult.data ?? [];
      adventurousnessRef.current = profileResult.data?.recommendation_adventurousness ?? 50;

      const artistCount = new Map<string, number>();
      const genreCount  = new Map<string, number>();
      for (const r of ratings) {
        const artist = (r.releases as any)?.artist as string | undefined;
        if (artist) {
          const primary = artist.split(',')[0].trim();
          artistCount.set(primary, (artistCount.get(primary) ?? 0) + 1);
        }
        // Only count genres from albums the user liked (≥3★)
        if ((r.score ?? 0) >= 3) {
          const genres = (r.releases as any)?.genres as string | undefined;
          if (genres) {
            for (const g of genres.split(',').map((s: string) => s.trim()).filter(Boolean)) {
              genreCount.set(g, (genreCount.get(g) ?? 0) + 1);
            }
          }
        }
      }

      artistsRef.current = [...artistCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);

      genresRef.current = [...genreCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([g]) => g);

      excludeRef.current = ratings.map((r) => r.release_id);

      await loadMore();
      setStatus('ready');
    })();
  }, [loadMore]);

  // Reset results and refetch when a filter changes
  const applyFilter = (genre: string, type: string, decade: string) => {
    filterGenreRef.current = genre;
    filterTypeRef.current = type;
    filterDecadeRef.current = decade;
    pageRef.current = 0;
    hasMoreRef.current = true;
    fetchingRef.current = false;
    seenRef.current = new Set();
    setAlbums([]);
    setHasMore(true);
    loadMore();
  };

  const handleFilterType = (val: string) => {
    setFilterType(val);
    applyFilter(filterGenreRef.current, val, filterDecadeRef.current);
  };
  const handleFilterDecade = (val: string) => {
    setFilterDecade(val);
    applyFilter(filterGenreRef.current, filterTypeRef.current, val);
  };
  const handleFilterGenre = (val: string) => {
    setFilterGenre(val);
    applyFilter(val, filterTypeRef.current, filterDecadeRef.current);
  };

  const hasActiveFilters = filterType !== '' || filterDecade !== '' || filterGenre !== '';

  const skeletonGrid = (
    <div className="grid gap-x-[18px] gap-y-8" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))' }}>
      {Array.from({ length: 18 }).map((_, i) => (
        <div key={i}>
          <div className="w-full rounded-[7px] bg-[#F3F3F1] animate-pulse" style={{ aspectRatio: '1 / 1' }} />
          <div className="h-3 w-3/4 bg-[#F3F3F1] rounded mt-3 animate-pulse" />
          <div className="h-3 w-1/2 bg-[#F3F3F1] rounded mt-2 animate-pulse" />
        </div>
      ))}
    </div>
  );

  return (
    <div className="bg-page min-h-screen">
      <div className="bg-surface border-b border-divider">
        <div className="max-w-[1440px] mx-auto px-5 py-12">
          <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
            {t('explore.discover')}
          </p>
          <h1 className="text-[28px] sm:text-[38px] font-extrabold text-ink leading-[1.06]" style={{ letterSpacing: '-1.2px' }}>
            {t('explore.title')}
          </h1>
          <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
            {status === 'guest' ? t('explore.subtitleGuest') : t('explore.subtitleReady')}
          </p>
        </div>
      </div>

      {/* Filter bar — only shown when logged in */}
      {status === 'ready' && (
        <div className="border-b border-divider bg-page">
          <div className="max-w-[1440px] mx-auto px-5 py-3 flex flex-wrap items-center gap-3">
            {/* Type filter chips */}
            <div className="flex items-center gap-1.5">
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleFilterType(opt.value)}
                  className={`px-3 py-[5px] rounded-full text-[12px] font-semibold border transition ${
                    filterType === opt.value
                      ? 'bg-ink border-ink text-white'
                      : 'bg-surface border-divider text-muted hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="w-px h-4 bg-divider" />

            {/* Decade select */}
            <select
              value={filterDecade}
              onChange={e => handleFilterDecade(e.target.value)}
              className={`text-[12px] font-medium border rounded-full px-3 py-[5px] bg-surface outline-none cursor-pointer transition ${
                filterDecade ? 'border-ink text-ink' : 'border-divider text-muted'
              }`}
            >
              {DECADE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Genre select */}
            <select
              value={filterGenre}
              onChange={e => handleFilterGenre(e.target.value)}
              className={`text-[12px] font-medium border rounded-full px-3 py-[5px] bg-surface outline-none cursor-pointer transition ${
                filterGenre ? 'border-ink text-ink' : 'border-divider text-muted'
              }`}
            >
              {GENRE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {/* Clear filters */}
            {hasActiveFilters && (
              <button
                onClick={() => {
                  setFilterType('');
                  setFilterDecade('');
                  setFilterGenre('');
                  applyFilter('', '', '');
                }}
                className="text-[12px] text-muted hover:text-ink transition underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div className="max-w-[1440px] mx-auto px-5 py-10 pb-16">

        {status === 'init' && skeletonGrid}

        {status === 'guest' && (
          <div className="text-center py-20">
            <p className="text-[15px] font-semibold text-ink mb-2">{t('explore.signInTitle')}</p>
            <p className="text-[13px] text-muted mb-6">{t('explore.signInDesc')}</p>
            <Link
              href="/login"
              className="inline-block text-[13px] font-semibold text-mint-dark bg-mint-bg border border-mint rounded-lg px-5 py-2.5 hover:opacity-80 transition"
            >
              {t('explore.signInBtn')}
            </Link>
          </div>
        )}

        {status === 'ready' && albums.length === 0 && !fetching && (
          <div className="text-center py-20">
            <p className="text-[15px] font-semibold text-ink mb-2">
              {hasActiveFilters ? 'No results for this filter combination' : t('explore.nothingYet')}
            </p>
            <p className="text-[13px] text-muted">
              {hasActiveFilters ? 'Try adjusting your filters above.' : t('explore.nothingYetDesc')}
            </p>
          </div>
        )}

        {status === 'ready' && albums.length > 0 && (
          <>
            <div
              className="grid gap-x-[18px] gap-y-8"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))' }}
            >
              {albums.map((album) => (
                <div key={album.id} className="min-w-0 group/card">
                  <Link href={`/album/${album.id}`} className="block">
                    <div className="relative overflow-hidden rounded-[7px]" style={{ aspectRatio: '1 / 1' }}>
                      {album.coverUrl ? (
                        <img
                          src={album.coverUrl}
                          alt={album.title}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-surface border border-divider" />
                      )}
                      {/* Bookmark overlay — top-right corner of cover */}
                      <div className="absolute top-[6px] right-[6px]" onClick={e => e.preventDefault()}>
                        <BookmarkButton albumId={album.id} overlay />
                      </div>
                    </div>
                    <div className="mt-[9px]">
                      <div className="text-[13px] font-semibold text-ink truncate leading-snug group-hover/card:text-mint-dark transition">
                        {album.title}
                      </div>
                      <div className="text-[12px] text-muted mt-0.5 truncate">{album.artist}</div>
                    </div>
                  </Link>
                  <div className="mt-1.5">
                    <InlineStarRating
                      releaseId={album.id}
                      releaseTitle={album.title}
                      releaseArtist={album.artist}
                      releaseDate={album.date}
                      releaseCountry={album.country}
                      releaseType={album.releaseType}
                      coverUrl={album.coverUrl ?? null}
                      size={16}
                    />
                  </div>
                </div>
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-10">
                <button
                  onClick={loadMore}
                  disabled={fetching}
                  className="text-[13px] font-semibold text-mint-dark bg-mint-bg border border-mint rounded-lg px-6 py-2.5 hover:opacity-80 transition disabled:opacity-40"
                >
                  {fetching ? t('notifications.loading') : t('explore.loadMore')}
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
