'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import ScrollRow from './ScrollRow';
import { getCanonSuggestions, toAlbumRelease } from '../lib/canon-suggestions';
import { useHomeReady } from './HomeReadyContext';
import { useLanguage } from '../lib/i18n';
import type { AlbumRelease } from '../types';

type Status = 'loading' | 'guest' | 'empty' | 'ready';

interface Section {
  title: string;
  subtitle: string;
  albums: AlbumRelease[];
}

interface RatedRelease {
  release_id: string;
  score: number | null;
  releases: {
    title: string;
    artist: string;
    cover_url: string | null;
  } | null;
}


export default function PersonalizedFeed() {
  const [status, setStatus] = useState<Status>('loading');
  const [username, setUsername] = useState('');
  const [recentRatings, setRecentRatings] = useState<RatedRelease[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [coldStartAlbums, setColdStartAlbums] = useState<AlbumRelease[]>([]);
  const [coldStartLabel, setColdStartLabel] = useState('');
  const { setReady } = useHomeReady();
  const { t } = useLanguage();

  useEffect(() => {
    if (!supabase) { setStatus('guest'); setReady(); return; }

    (async () => {
      const { data: { session } } = await supabase!.auth.getSession();
      if (!session) { setStatus('guest'); setReady(); return; }

      setUsername(session.user.email?.split('@')[0] ?? 'there');

      const { data: ratings } = await supabase!
        .from('ratings')
        .select('release_id, score, releases(title, artist, cover_url, release_type, release_date)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (!ratings || ratings.length === 0) {
        // Cold-start: show canonical suggestions based on onboarding genre picks
        const { data: profile } = await supabase!
          .from('profiles')
          .select('preferred_genres, display_name')
          .eq('id', session.user.id)
          .maybeSingle();

        if (profile?.display_name) setUsername(profile.display_name);

        if (profile?.preferred_genres && supabase) {
          const genres = (profile.preferred_genres as string).split(',').filter(Boolean);
          const suggestions = await getCanonSuggestions(supabase, genres, 20);
          if (suggestions.length > 0) {
            setColdStartAlbums(suggestions.map(toAlbumRelease));
            setColdStartLabel(genres.slice(0, 3).join(', '));
          }
        }
        setStatus('empty');
        setReady();
        return;
      }

      setRecentRatings(ratings.slice(0, 8) as unknown as RatedRelease[]);

      // Extract top 2 artists by count
      const artistCount = new Map<string, number>();
      for (const r of ratings) {
        const artist = (r.releases as any)?.artist;
        if (artist) {
          const primary = artist.split(',')[0].trim();
          artistCount.set(primary, (artistCount.get(primary) ?? 0) + 1);
        }
      }
      const topArtists = [...artistCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name);

      if (topArtists.length === 0) { setStatus('empty'); setReady(); return; }

      const params = new URLSearchParams({
        artists: topArtists.join(','),
        userId: session.user.id,
      });

      const res = await fetch(`/api/personalized?${params}`);
      const data = await res.json();
      setSections(data.sections ?? []);
      setStatus('ready');
      setReady();
    })();
  }, []);

  const recentScrollRef = useRef<HTMLDivElement>(null);
  const SCROLL_PX = (180 + 18) * 4;

  const scrollRecent = (direction: 'left' | 'right') => {
    const el = recentScrollRef.current;
    if (!el) return;
    if (direction === 'right') {
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      el.scrollBy({ left: atEnd ? -el.scrollWidth : SCROLL_PX, behavior: 'smooth' });
    } else {
      const atStart = el.scrollLeft <= 4;
      el.scrollTo({ left: atStart ? el.scrollWidth : el.scrollLeft - SCROLL_PX, behavior: 'smooth' });
    }
  };

  const greeting = (
    <div className="mb-11">
      <h1 className="text-[30px] font-extrabold text-ink" style={{ letterSpacing: '-1px' }}>
        {t('home.discover')}
      </h1>
      <p className="text-sm text-muted mt-1.5">
        {t('home.discoverSub')}
      </p>
    </div>
  );

  if (status === 'loading') {
    return (
      <div>
        {greeting}
        <div className="flex gap-[18px] overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-[140px] md:w-[180px]">
              <div className="w-[140px] h-[140px] md:w-[180px] md:h-[180px] rounded-[7px] bg-surface animate-pulse" />
              <div className="mt-[9px] space-y-1.5">
                <div className="h-3 bg-surface animate-pulse rounded w-4/5" />
                <div className="h-2.5 bg-surface animate-pulse rounded w-3/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (status === 'guest') {
    return greeting;
  }

  if (status === 'empty') {
    return (
      <div>
        {greeting}
        {coldStartAlbums.length > 0 && (
          <div>
            <div className="flex items-end justify-between mb-[18px]">
              <div>
                <div className="text-[17px] font-bold text-ink">{t('home.startHere')}</div>
                <div className="text-[12px] text-muted mt-0.5">
                  {coldStartLabel ? `${t('home.canonicalPicks')} · ${coldStartLabel}` : t('home.canonicalPicks')}
                </div>
              </div>
            </div>
            <ScrollRow albums={coldStartAlbums} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {greeting}

      {/* Recently Rated */}
      {recentRatings.length > 0 && (
        <div className="mb-0">
          <div className="flex items-end justify-between mb-[18px]">
            <div>
              <div className="text-[17px] font-bold text-ink">{t('home.recentlyRated')}</div>
              <div className="text-[12px] text-muted mt-0.5">{t('home.latestListens')}</div>
            </div>
            <Link href="/profile" className="text-[12px] font-medium text-muted hover:text-mid transition">
              {t('home.seeAll')}
            </Link>
          </div>
          <div className="group relative">
            {/* Left arrow */}
            <button
              onClick={() => scrollRecent('left')}
              className="absolute left-0 top-[90px] z-10 -translate-x-1/2 -translate-y-1/2 hidden md:flex h-8 w-8 items-center justify-center rounded-full bg-page border border-divider shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface"
              aria-label="Scroll left"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div ref={recentScrollRef} className="overflow-x-auto scrollbar-hide">
              <div className="flex gap-[18px] pb-2">
                {recentRatings.map((r) => {
                  const rel = r.releases;
                  if (!rel) return null;
                  return (
                    <Link key={r.release_id} href={`/album/${r.release_id}`} className="flex-shrink-0 w-[140px] md:w-[180px] group/card">
                      <div className="relative w-[140px] h-[140px] md:w-[180px] md:h-[180px] rounded-[7px] overflow-hidden">
                        {rel.cover_url ? (
                          <img src={rel.cover_url} alt={rel.title} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 bg-surface border border-divider" />
                        )}
                        {r.score && (
                          <div
                            className="absolute bottom-1.5 right-1.5 text-[10px] font-bold rounded-[4px] px-[6px] py-[2px]"
                            style={{ background: '#5170ad', color: '#ffffff' }}
                          >
                            ★ {Number(r.score).toFixed(1)}
                          </div>
                        )}
                      </div>
                      <div className="mt-[9px]">
                        <div className="text-[13px] font-semibold text-ink truncate leading-snug">{rel.title}</div>
                        <div className="text-[12px] text-muted mt-0.5 truncate">{rel.artist}</div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Right arrow */}
            <button
              onClick={() => scrollRecent('right')}
              className="absolute right-0 top-[90px] z-10 translate-x-1/2 -translate-y-1/2 hidden md:flex h-8 w-8 items-center justify-center rounded-full bg-page border border-divider shadow-md opacity-0 transition-opacity group-hover:opacity-100 hover:bg-surface"
              aria-label="Scroll right"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Artist recommendation sections */}
      {sections.map((section) => (
        <div key={section.title}>
          <div className="h-px bg-[#EBEBEB] my-11" />
          <div className="flex items-end justify-between mb-[18px]">
            <div>
              <div className="text-[17px] font-bold text-ink">{section.title}</div>
              <div className="text-[12px] text-muted mt-0.5">{section.subtitle}</div>
            </div>
          </div>
          <ScrollRow albums={section.albums} />
        </div>
      ))}

      <div className="h-px bg-[#EBEBEB] my-11" />
    </div>
  );
}
