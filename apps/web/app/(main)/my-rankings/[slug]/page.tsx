'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';

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

export default function MyRankingDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const [items, setItems] = useState<RatedItem[]>([]);
  const [tracks, setTracks] = useState<RatedTrack[]>([]);
  const [loading, setLoading] = useState(true);

  const isSongs = slug === 'songs';
  const isAlbums = slug === 'albums';
  const isEps = slug === 'eps';
  const isAll = slug === 'all';
  const genreSlug = !isSongs && !isAlbums && !isEps && !isAll ? slug : null;

  const title = isSongs ? 'My Songs'
    : isAlbums ? 'My Albums'
    : isEps ? 'My EPs'
    : isAll ? 'All Rated'
    : decodeURIComponent(slug).split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      if (isSongs) {
        const { data, error } = await supabase
          .from('track_ratings')
          .select('release_id, track_position, track_title, score')
          .eq('user_id', session.user.id)
          .not('score', 'is', null)
          .order('score', { ascending: false });

        if (!error && data) {
          const releaseIds = [...new Set(data.map((r: any) => r.release_id))];
          let releaseMap = new Map<string, any>();
          if (releaseIds.length > 0) {
            const { data: rels } = await supabase.from('releases').select('id, title, artist, cover_url').in('id', releaseIds);
            releaseMap = new Map((rels ?? []).map((r: any) => [r.id, r]));
          }
          setTracks(data.map((r: any) => {
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
      } else {
        const { data } = await supabase
          .from('ratings')
          .select('score, release_id, releases(id, title, artist, cover_url, genres, release_type, release_date)')
          .eq('user_id', session.user.id)
          .not('score', 'is', null)
          .order('score', { ascending: false });

        if (data) {
          let mapped: RatedItem[] = data
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

          if (isAlbums) mapped = mapped.filter(i => i.releaseType.toLowerCase() === 'album');
          else if (isEps) mapped = mapped.filter(i => i.releaseType.toLowerCase() === 'ep');
          else if (genreSlug) {
            const decoded = decodeURIComponent(genreSlug).toLowerCase().replace(/-/g, ' ');
            mapped = mapped.filter(i => i.genres.some(g => g.toLowerCase() === decoded || g.toLowerCase().replace(/[^a-z0-9]/g, '-') === genreSlug));
          }

          setItems(mapped);
        }
      }
      setLoading(false);
    })();
  }, [slug]);

  if (loading) {
    return (
      <div className="bg-page min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-ink/20 border-t-ink rounded-full animate-spin" />
      </div>
    );
  }

  const list = isSongs ? tracks : items;

  return (
    <div className="bg-page min-h-screen">
      <div className="max-w-[900px] mx-auto px-5 py-8">
        <button onClick={() => router.push('/my-rankings')} className="flex items-center gap-1 text-[13px] text-muted hover:text-ink transition mb-4">
          <ChevronLeft size={16} />
          My Tierlists
        </button>

        <h1 className="text-[24px] font-extrabold text-ink mb-1" style={{ letterSpacing: '-0.5px' }}>
          {title}
        </h1>
        <p className="text-[13px] text-muted mb-6">
          {list.length} {isSongs ? (list.length === 1 ? 'song' : 'songs') : (list.length === 1 ? 'release' : 'releases')}
        </p>

        <div className="flex flex-col">
          {isSongs ? tracks.map((t, idx) => (
            <Link
              key={`${t.releaseId}-${t.trackPosition}`}
              href={`/album/${t.releaseId}`}
              className="flex items-center gap-4 py-3 px-3 -mx-3 rounded-xl hover:bg-surface transition"
            >
              <span className="w-[32px] text-right text-[14px] font-bold text-muted tabular-nums flex-shrink-0">{idx + 1}</span>
              <div className="w-[40px] h-[40px] rounded-[5px] overflow-hidden flex-shrink-0 bg-surface border border-divider">
                {t.coverUrl ? <img src={t.coverUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-ink truncate">{t.trackTitle}</p>
                <p className="text-[12px] text-muted truncate">{t.artist} · {t.albumTitle}</p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[16px] font-extrabold text-ink tabular-nums">{t.score.toFixed(1)}</span>
                <span className="text-[12px] text-amber-500">★</span>
              </div>
            </Link>
          )) : items.map((item, idx) => (
            <Link
              key={item.releaseId}
              href={`/album/${item.releaseId}`}
              className="flex items-center gap-4 py-3 px-3 -mx-3 rounded-xl hover:bg-surface transition"
            >
              <span className="w-[32px] text-right text-[14px] font-bold text-muted tabular-nums flex-shrink-0">{idx + 1}</span>
              <div className="w-[48px] h-[48px] rounded-[6px] overflow-hidden flex-shrink-0 bg-surface border border-divider">
                {item.coverUrl ? <img src={item.coverUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-ink truncate">{item.title}</p>
                <p className="text-[12px] text-muted truncate">
                  {item.artist}
                  {item.releaseDate && <span className="ml-2 text-[11px]">· {item.releaseDate.slice(0, 4)}</span>}
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-1 flex-shrink-0">
                {item.genres.slice(0, 2).map(g => (
                  <span key={g} className="px-2 py-0.5 rounded-full bg-surface border border-divider text-[10px] font-medium text-muted">{g}</span>
                ))}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[16px] font-extrabold text-ink tabular-nums">{item.score.toFixed(1)}</span>
                <span className="text-[12px] text-amber-500">★</span>
              </div>
            </Link>
          ))}

          {list.length === 0 && (
            <p className="text-[13px] text-muted text-center py-12">No ratings in this category yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
