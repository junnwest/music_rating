'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import type { AlbumRelease } from '../types';

type Status = 'init' | 'guest' | 'ready';

export default function ForYouPage() {
  const [status, setStatus] = useState<Status>('init');
  const [albums, setAlbums] = useState<AlbumRelease[]>([]);
  const [fetching, setFetching] = useState(false);

  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const fetchingRef = useRef(false);
  const seenRef = useRef(new Set<string>());
  const artistsRef = useRef<string[]>([]);
  const excludeRef = useRef<string[]>([]);
  const [hasMore, setHasMore] = useState(true);

  const loadMore = useCallback(async () => {
    if (fetchingRef.current || !hasMoreRef.current) return;
    fetchingRef.current = true;
    setFetching(true);

    try {
      const params = new URLSearchParams({
        artists: artistsRef.current.join(','),
        excludeIds: excludeRef.current.join(','),
        page: String(pageRef.current),
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

  // Phase 1: resolve user session and kick off first fetch
  useEffect(() => {
    if (!supabase) { setStatus('guest'); return; }

    (async () => {
      const { data: { session } } = await supabase!.auth.getSession();
      if (!session) { setStatus('guest'); return; }

      const { data: ratings } = await supabase!
        .from('ratings')
        .select('release_id, releases(artist)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      const artistCount = new Map<string, number>();
      for (const r of ratings ?? []) {
        const artist = (r.releases as any)?.artist;
        if (artist) {
          const primary = artist.split(',')[0].trim();
          artistCount.set(primary, (artistCount.get(primary) ?? 0) + 1);
        }
      }

      artistsRef.current = [...artistCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);

      excludeRef.current = (ratings ?? []).map((r) => r.release_id);

      await loadMore();
      setStatus('ready');
    })();
  }, [loadMore]);


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
    <div className="bg-white min-h-screen">
      <div className="bg-surface border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 py-8">
          <h1 className="text-[24px] font-extrabold text-ink" style={{ letterSpacing: '-0.6px' }}>
            For You
          </h1>
          <p className="text-[13px] text-muted mt-1">
            {status === 'guest'
              ? 'Log in to get personalized album suggestions.'
              : 'Albums you might love or already know.'}
          </p>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14">

        {status === 'init' && skeletonGrid}

        {status === 'guest' && (
          <div className="text-center py-20">
            <p className="text-[15px] font-semibold text-ink mb-2">Sign in to unlock personalized picks</p>
            <p className="text-[13px] text-muted mb-6">Rate a few albums and we'll suggest what to listen to next.</p>
            <Link
              href="/login"
              className="inline-block text-[13px] font-semibold text-mint-dark bg-mint-bg border border-mint rounded-lg px-5 py-2.5 hover:opacity-80 transition"
            >
              Log in
            </Link>
          </div>
        )}

        {status === 'ready' && albums.length === 0 && !fetching && (
          <div className="text-center py-20">
            <p className="text-[15px] font-semibold text-ink mb-2">Nothing to suggest yet</p>
            <p className="text-[13px] text-muted">Rate a few more albums and we'll start building your picks.</p>
          </div>
        )}

        {status === 'ready' && albums.length > 0 && (
          <>
            <div
              className="grid gap-x-[18px] gap-y-8"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(152px, 1fr))' }}
            >
              {albums.map((album) => (
                <Link key={album.id} href={`/album/${album.id}`} className="block min-w-0 group/card">
                  <div className="relative overflow-hidden rounded-[7px]" style={{ aspectRatio: '1 / 1' }}>
                    {album.coverUrl ? (
                      <img
                        src={album.coverUrl}
                        alt={album.title}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-surface border border-[#EBEBEB]" />
                    )}
                    <div className="absolute inset-0 flex items-end justify-end p-2 opacity-0 group-hover/card:opacity-100 transition-opacity">
                      <span className="bg-ink text-white rounded-[6px] px-[11px] py-[5px] text-[11px] font-semibold">Rate →</span>
                    </div>
                  </div>
                  <div className="mt-[9px]">
                    <div className="text-[13px] font-semibold text-ink truncate leading-snug group-hover/card:text-mint-dark transition">
                      {album.title}
                    </div>
                    <div className="text-[12px] text-muted mt-0.5 truncate">{album.artist}</div>
                  </div>
                </Link>
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-10">
                <button
                  onClick={loadMore}
                  disabled={fetching}
                  className="text-[13px] font-semibold text-mint-dark bg-mint-bg border border-mint rounded-lg px-6 py-2.5 hover:opacity-80 transition disabled:opacity-40"
                >
                  {fetching ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
