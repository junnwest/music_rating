'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

interface RatedItem {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  score: number;
  genres: string[];
  releaseType: string;
  releaseDate: string | null;
}

interface RatedTrack {
  releaseId: string;
  trackPosition: number;
  trackTitle: string;
  artist: string;
  albumTitle: string;
  coverUrl: string | null;
  score: number;
}

interface RecommendedAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  genres: string[];
}

interface RankingSection {
  slug: string;
  title: string;
  items: { id: string; title: string; subtitle: string; coverUrl: string | null; score: number }[];
  total: number;
}

function toSlug(genre: string): string {
  return genre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function MiniCard({ section }: { section: RankingSection }) {
  return (
    <Link
      href={`/my-rankings/${section.slug}`}
      className="block border border-divider rounded-xl p-4 hover:bg-surface transition group"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-bold text-ink">{section.title}</h3>
        <div className="flex items-center gap-1 text-[12px] text-muted group-hover:text-ink transition">
          {section.total} total
          <ChevronRight size={14} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {section.items.slice(0, 5).map((item, idx) => (
          <div key={item.id} className="flex items-center gap-3 py-1.5">
            <span className="w-[20px] text-right text-[12px] font-bold text-muted tabular-nums flex-shrink-0">
              {idx + 1}
            </span>
            <div className="w-[32px] h-[32px] rounded-[4px] overflow-hidden flex-shrink-0 bg-surface border border-divider">
              {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-ink truncate">{item.title}</p>
              <p className="text-[11px] text-muted truncate">{item.subtitle}</p>
            </div>
            <span className="text-[13px] font-bold text-ink tabular-nums flex-shrink-0">{item.score.toFixed(1)}<span className="text-[10px] text-amber-500 ml-0.5">★</span></span>
          </div>
        ))}
      </div>
    </Link>
  );
}

export default function MyRankingsPage() {
  const [items, setItems] = useState<RatedItem[]>([]);
  const [tracks, setTracks] = useState<RatedTrack[]>([]);
  const [recs, setRecs] = useState<RecommendedAlbum[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const [ratingsRes, tracksRes] = await Promise.all([
        supabase
          .from('ratings')
          .select('score, release_id, releases(id, title, artist, cover_url, genres, release_type, release_date)')
          .eq('user_id', session.user.id)
          .not('score', 'is', null)
          .order('score', { ascending: false }),
        Promise.resolve(
          supabase
            .from('track_ratings')
            .select('release_id, track_position, track_title, score')
            .eq('user_id', session.user.id)
            .not('score', 'is', null)
            .order('score', { ascending: false })
        ).catch(() => ({ data: null, error: { message: 'table missing' } })),
      ]);

      const data = ratingsRes.data;
      if (!data) { setLoading(false); return; }

      const mapped: RatedItem[] = data
        .filter((r: any) => r.releases)
        .map((r: any) => {
          const rel = r.releases;
          return {
            releaseId: rel.id,
            title: rel.title,
            artist: rel.artist,
            coverUrl: rel.cover_url,
            score: r.score,
            genres: rel.genres ? rel.genres.split(',').map((g: string) => g.trim()).filter(Boolean) : [],
            releaseType: rel.release_type ?? 'Album',
            releaseDate: rel.release_date,
          };
        });
      setItems(mapped);

      // Track ratings
      if (tracksRes.data && !tracksRes.error) {
        const trackData = tracksRes.data as any[];
        const releaseIds = [...new Set(trackData.map((r: any) => r.release_id))];
        let releaseMap = new Map<string, any>();
        if (releaseIds.length > 0) {
          const { data: rels } = await supabase.from('releases').select('id, title, artist, cover_url').in('id', releaseIds);
          releaseMap = new Map((rels ?? []).map((r: any) => [r.id, r]));
        }
        setTracks(trackData.map((r: any) => {
          const rel = releaseMap.get(r.release_id);
          return {
            releaseId: r.release_id,
            trackPosition: r.track_position,
            trackTitle: r.track_title,
            artist: rel?.artist ?? '',
            albumTitle: rel?.title ?? '',
            coverUrl: rel?.cover_url ?? null,
            score: r.score,
          };
        }));
      }

      // Recommendations: find genres user rates highly, suggest unrated albums in those genres
      const ratedIds = new Set(mapped.map(i => i.releaseId));
      const genreCounts = new Map<string, number>();
      for (const item of mapped) {
        if (item.score >= 3.5) {
          for (const g of item.genres) {
            genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
          }
        }
      }
      const topGenres = [...genreCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([g]) => g);

      if (topGenres.length > 0) {
        const orClause = topGenres.map(g => `genres.ilike.%${g}%`).join(',');
        const { data: recData } = await supabase
          .from('releases')
          .select('id, title, artist, cover_url, genres')
          .or(orClause)
          .not('release_type', 'ilike', 'single')
          .not('cover_url', 'is', null)
          .order('prestige', { ascending: true, nullsFirst: false })
          .limit(60);

        if (recData) {
          const unrated = recData
            .filter((r: any) => !ratedIds.has(r.id))
            .slice(0, 12)
            .map((r: any) => ({
              id: r.id,
              title: r.title,
              artist: r.artist,
              coverUrl: r.cover_url,
              genres: r.genres ? r.genres.split(',').map((g: string) => g.trim()).filter(Boolean) : [],
            }));
          setRecs(unrated);
        }
      }

      setLoading(false);
    })();
  }, []);

  // Build sections
  const sections: RankingSection[] = [];

  // All rated
  if (items.length > 0) {
    sections.push({
      slug: 'all',
      title: 'All Rated',
      items: items.map(i => ({ id: i.releaseId, title: i.title, subtitle: i.artist, coverUrl: i.coverUrl, score: i.score })),
      total: items.length,
    });
  }

  // Albums only
  const albums = items.filter(i => i.releaseType.toLowerCase() === 'album');
  if (albums.length > 0) {
    sections.push({
      slug: 'albums',
      title: 'Albums',
      items: albums.map(i => ({ id: i.releaseId, title: i.title, subtitle: i.artist, coverUrl: i.coverUrl, score: i.score })),
      total: albums.length,
    });
  }

  // EPs only
  const eps = items.filter(i => i.releaseType.toLowerCase() === 'ep');
  if (eps.length > 0) {
    sections.push({
      slug: 'eps',
      title: 'EPs',
      items: eps.map(i => ({ id: i.releaseId, title: i.title, subtitle: i.artist, coverUrl: i.coverUrl, score: i.score })),
      total: eps.length,
    });
  }

  // Songs
  if (tracks.length > 0) {
    sections.push({
      slug: 'songs',
      title: 'Songs',
      items: tracks.map(t => ({ id: `${t.releaseId}-${t.trackPosition}`, title: t.trackTitle, subtitle: `${t.artist} · ${t.albumTitle}`, coverUrl: t.coverUrl, score: t.score })),
      total: tracks.length,
    });
  }

  // Per-genre sections
  const genreCounts = new Map<string, RatedItem[]>();
  for (const item of items) {
    for (const g of item.genres) {
      if (!genreCounts.has(g)) genreCounts.set(g, []);
      genreCounts.get(g)!.push(item);
    }
  }
  const genreSections = [...genreCounts.entries()]
    .filter(([, arr]) => arr.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 8);

  for (const [genre, genreItems] of genreSections) {
    const sorted = [...genreItems].sort((a, b) => b.score - a.score);
    sections.push({
      slug: toSlug(genre),
      title: genre,
      items: sorted.map(i => ({ id: i.releaseId, title: i.title, subtitle: i.artist, coverUrl: i.coverUrl, score: i.score })),
      total: sorted.length,
    });
  }

  if (loading) {
    return (
      <div className="bg-page min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
      </div>
    );
  }

  if (items.length === 0 && tracks.length === 0) {
    return (
      <div className="bg-page min-h-screen flex flex-col items-center justify-center gap-3 px-5">
        <p className="text-[15px] text-muted">No ratings yet.</p>
        <p className="text-[13px] text-muted">Rate some albums to build your personal tierlists here.</p>
      </div>
    );
  }

  return (
    <div className="bg-page min-h-screen">
      <div className="max-w-[1100px] mx-auto px-5 py-8">
        <h1 className="text-[24px] font-extrabold text-ink mb-1" style={{ letterSpacing: '-0.5px' }}>
          My Tierlists
        </h1>
        <p className="text-[13px] text-muted mb-8">
          {items.length} releases · {tracks.length} songs rated
        </p>

        {/* Ranking cards grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
          {sections.map(section => (
            <MiniCard key={section.slug} section={section} />
          ))}
        </div>

        {/* Recommended for you */}
        {recs.length > 0 && (
          <div>
            <h2 className="text-[17px] font-bold text-ink mb-1">Recommended for You</h2>
            <p className="text-[12px] text-muted mb-4">Based on your top-rated genres — albums you haven't rated yet</p>

            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
              {recs.map(r => (
                <Link key={r.id} href={`/album/${r.id}`} className="group">
                  <div className="aspect-square rounded-[7px] overflow-hidden bg-surface border border-divider">
                    {r.coverUrl ? (
                      <img src={r.coverUrl} alt={r.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full" />
                    )}
                  </div>
                  <p className="text-[12px] font-semibold text-ink mt-1.5 truncate group-hover:text-amber-600 transition">{r.title}</p>
                  <p className="text-[11px] text-muted truncate">{r.artist}</p>
                  {r.genres.length > 0 && (
                    <p className="text-[10px] text-muted truncate mt-0.5">{r.genres.slice(0, 2).join(', ')}</p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
