'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, X } from 'lucide-react';
import { supabase } from '../../../../lib/supabaseClient';
import InlineStarRating from '../../../../components/InlineStarRating';

type SortKey = 'date_added' | 'title' | 'artist' | 'rating';

interface TrackSub {
  trackId: string;
  title: string;
  position: number | null;
}

interface PlaylistItem {
  itemId: string;
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  addedAt: string;
  releaseType: string;
  releaseDate: string | null;
  userRating: number | null;
  tracks: TrackSub[];
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'date_added', label: 'Date Added' },
  { key: 'title',      label: 'Title' },
  { key: 'artist',     label: 'Artist' },
  { key: 'rating',     label: 'Your Rating' },
];

export default function PlaylistPage() {
  const { id: listId } = useParams() as { id: string };

  const [listTitle, setListTitle] = useState('Playlist');
  const [items, setItems] = useState<PlaylistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortKey>('date_added');
  const [userId, setUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setUserId(uid);

    const [{ data: list }, { data: rows }] = await Promise.all([
      supabase.from('lists').select('title').eq('id', listId).maybeSingle(),
      supabase
        .from('list_items')
        .select('id, release_id, added_at, releases(id, title, artist, cover_url, release_type, release_date), list_item_tracks(id, track_title, track_position)')
        .eq('list_id', listId)
        .order('added_at', { ascending: false }),
    ]);

    if (list) setListTitle(list.title);

    const validRows = (rows ?? []).filter((r: any) => r.releases);
    const releaseIds = validRows.map((r: any) => r.releases.id as string);

    let ratingMap = new Map<string, number>();
    if (uid && releaseIds.length > 0) {
      const { data: ratings } = await supabase
        .from('ratings')
        .select('release_id, score')
        .eq('user_id', uid)
        .in('release_id', releaseIds);
      ratingMap = new Map((ratings ?? []).map((r: any) => [r.release_id as string, r.score as number]));
    }

    setItems(
      validRows.map((r: any) => ({
        itemId:      r.id,
        releaseId:   r.releases.id,
        title:       r.releases.title,
        artist:      r.releases.artist,
        coverUrl:    r.releases.cover_url ?? null,
        addedAt:     r.added_at,
        releaseType: r.releases.release_type ?? 'Album',
        releaseDate: r.releases.release_date ?? null,
        userRating:  ratingMap.get(r.releases.id) ?? null,
        tracks: ((r.list_item_tracks ?? []) as any[])
          .sort((a, b) => (a.track_position ?? 0) - (b.track_position ?? 0))
          .map((t) => ({ trackId: t.id, title: t.track_title, position: t.track_position ?? null })),
      }))
    );
    setLoading(false);
  }, [listId]);

  useEffect(() => { void load(); }, [load]);

  const removeItem = async (releaseId: string) => {
    if (!supabase) return;
    await supabase.from('list_items').delete()
      .eq('list_id', listId).eq('release_id', releaseId);
    setItems(prev => prev.filter(i => i.releaseId !== releaseId));
  };

  const removeTrack = async (itemId: string, position: number | null) => {
    if (!supabase || position == null) return;
    await supabase.from('list_item_tracks').delete()
      .eq('list_item_id', itemId).eq('track_position', position);
    setItems(prev => prev.map(i =>
      i.itemId === itemId
        ? { ...i, tracks: i.tracks.filter(t => t.position !== position) }
        : i
    ));
  };

  const sorted = [...items].sort((a, b) => {
    if (sort === 'title')  return a.title.localeCompare(b.title);
    if (sort === 'artist') return a.artist.localeCompare(b.artist);
    if (sort === 'rating') return (b.userRating ?? -1) - (a.userRating ?? -1);
    return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
  });

  return (
    <div className="bg-page min-h-screen">
      <div className="max-w-[960px] mx-auto px-5 py-10 pb-16">

        <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-ink transition mb-6">
          <ArrowLeft size={13} /> Back
        </Link>

        <div className="mb-7">
          <h1 className="text-[28px] font-extrabold text-ink tracking-tight">{listTitle}</h1>
          <p className="text-[13px] text-muted mt-1">
            {items.length} {items.length === 1 ? 'album' : 'albums'}
          </p>
        </div>

        {/* Sort chips */}
        <div className="flex gap-2 mb-7 flex-wrap">
          {SORTS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`px-4 py-[7px] rounded-lg text-[12px] font-semibold border transition ${
                sort === key
                  ? 'border-ink text-ink bg-surface'
                  : 'border-divider text-muted hover:border-mid'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Items */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-[20px]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i}>
                <div className="aspect-square rounded-[7px] bg-surface animate-pulse" />
                <div className="mt-2.5 space-y-1.5">
                  <div className="h-3 bg-surface animate-pulse rounded w-3/4" />
                  <div className="h-2.5 bg-surface animate-pulse rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-[15px] font-semibold text-ink mb-1">This playlist is empty</p>
            <p className="text-[13px] text-muted">Use the + button on any album card to add items.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-[20px]">
            {sorted.map((item) => (
              <div key={item.itemId} className="min-w-0 group/card">
                {/* Album cover + remove */}
                <div className="relative">
                  <Link href={`/album/${item.releaseId}`} className="block">
                    <div
                      className="relative overflow-hidden rounded-[7px]"
                      style={{ aspectRatio: '1 / 1' }}
                    >
                      {item.coverUrl ? (
                        <img
                          src={item.coverUrl}
                          alt={item.title}
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover/card:scale-105"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-surface border border-divider" />
                      )}
                    </div>
                  </Link>
                  <button
                    onClick={() => void removeItem(item.releaseId)}
                    title="Remove album"
                    className="absolute top-[6px] right-[6px] w-7 h-7 rounded-full bg-black/40 text-white/80 hover:bg-red-500 hover:text-white flex items-center justify-center transition backdrop-blur-sm opacity-0 group-hover/card:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </div>

                {/* Album info */}
                <div className="mt-[9px]">
                  <div className="text-[13px] font-semibold text-ink truncate leading-snug">{item.title}</div>
                  <div className="text-[11px] text-muted mt-0.5 truncate">{item.artist}</div>
                </div>

                {/* Rating */}
                {userId && (
                  <div className="mt-1.5">
                    <InlineStarRating
                      releaseId={item.releaseId}
                      releaseTitle={item.title}
                      releaseArtist={item.artist}
                      releaseDate={item.releaseDate}
                      releaseCountry={null}
                      releaseType={item.releaseType}
                      coverUrl={item.coverUrl}
                      size={14}
                    />
                  </div>
                )}

                {/* Track sub-items */}
                {item.tracks.length > 0 && (
                  <div className="mt-2 border-t border-divider pt-1.5 space-y-0.5">
                    {item.tracks.map((track) => (
                      <div key={track.trackId} className="flex items-center gap-1.5 group/track">
                        <span className="text-[10px] text-[#AAAAAA] w-5 text-right flex-shrink-0 tabular-nums">
                          {track.position ?? '–'}
                        </span>
                        <span className="text-[11px] text-muted flex-1 truncate">{track.title}</span>
                        <button
                          onClick={() => void removeTrack(item.itemId, track.position)}
                          title="Remove track"
                          className="flex-shrink-0 text-[#CCCCCC] hover:text-red-400 transition opacity-0 group-hover/track:opacity-100"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
