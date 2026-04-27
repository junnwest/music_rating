'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import ScrollRow from './ScrollRow';
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

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function PersonalizedFeed() {
  const [status, setStatus] = useState<Status>('loading');
  const [username, setUsername] = useState('');
  const [recentRatings, setRecentRatings] = useState<RatedRelease[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  useEffect(() => {
    if (!supabase) { setStatus('guest'); return; }

    (async () => {
      const { data: { session } } = await supabase!.auth.getSession();
      if (!session) { setStatus('guest'); return; }

      setUsername(session.user.email?.split('@')[0] ?? 'there');

      const { data: ratings } = await supabase!
        .from('ratings')
        .select('release_id, score, releases(title, artist, cover_url, release_type, release_date)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (!ratings || ratings.length === 0) { setStatus('empty'); return; }

      setRecentRatings(ratings.slice(0, 8) as RatedRelease[]);

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

      if (topArtists.length === 0) { setStatus('empty'); return; }

      const ratedIds = ratings.map((r) => r.release_id);
      const params = new URLSearchParams({
        artists: topArtists.join(','),
        excludeIds: ratedIds.join(','),
      });

      const res = await fetch(`/api/personalized?${params}`);
      const data = await res.json();
      setSections(data.sections ?? []);
      setStatus('ready');
    })();
  }, []);

  const greeting = (
    <div className="mb-11">
      {status === 'ready' ? (
        <>
          <h1 className="text-[30px] font-extrabold text-ink" style={{ letterSpacing: '-1px' }}>
            {timeGreeting()}, {username}.
          </h1>
          <p className="text-sm text-muted mt-1.5">Here's what's waiting for you.</p>
        </>
      ) : (
        <>
          <h1 className="text-[30px] font-extrabold text-ink" style={{ letterSpacing: '-1px' }}>
            Discover your next favorite album.
          </h1>
          <p className="text-sm text-muted mt-1.5">
            Rate albums, write reviews, and build your music catalog.
          </p>
        </>
      )}
    </div>
  );

  if (status === 'loading' || status === 'guest' || status === 'empty') {
    return greeting;
  }

  return (
    <div>
      {greeting}

      {/* Recently Rated */}
      {recentRatings.length > 0 && (
        <div className="mb-0">
          <div className="flex items-end justify-between mb-[18px]">
            <div>
              <div className="text-[17px] font-bold text-ink">Recently Rated</div>
              <div className="text-[12px] text-muted mt-0.5">Your latest listens</div>
            </div>
            <Link href="/profile" className="text-[12px] font-medium text-muted hover:text-mid transition">
              See all →
            </Link>
          </div>
          <div className="overflow-x-hidden">
            <div className="flex gap-[18px] pb-2">
              {recentRatings.map((r) => {
                const rel = r.releases;
                if (!rel) return null;
                return (
                  <Link key={r.release_id} href={`/album/${r.release_id}`} className="flex-shrink-0 w-[152px] group/card">
                    <div className="relative w-[152px] h-[152px] rounded-[7px] overflow-hidden">
                      {rel.cover_url ? (
                        <img src={rel.cover_url} alt={rel.title} className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 bg-surface border border-[#EBEBEB]" />
                      )}
                      {r.score && (
                        <div
                          className="absolute bottom-1.5 right-1.5 text-[10px] font-bold rounded-[4px] px-[6px] py-[2px]"
                          style={{ background: '#3DFFD1', color: '#00453A' }}
                        >
                          ★ {r.score}
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
