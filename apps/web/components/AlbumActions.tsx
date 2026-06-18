'use client';

import { useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, Check, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { usePlaylist } from './PlaylistContext';

// Standalone "Save" button: add an album to Listen Later or a collection.
// No rating here — rating lives in the "Add" modal (StarRatingWidget → AddModal).

interface Props {
  albumId: string;
  albumTitle: string;
  albumArtist: string;
  coverUrl?: string | null;
}

const LL_KEY = 'LL';

export default function AlbumActions({ albumId, albumTitle, albumArtist, coverUrl }: Props) {
  const { userId, playlists, addItemTo, removeItemFrom } = usePlaylist();
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set()); // 'LL' or collection id
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const loadMembership = async () => {
    const next = new Set<string>();
    // Listen Later is stored in localStorage (mirrors PlaylistContext).
    try {
      const key = userId ? `sillajuku:listen-later:${userId}` : 'sillajuku:listen-later';
      const ll = JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
      if (ll.includes(albumId)) next.add(LL_KEY);
    } catch { /* ignore */ }
    // Collections via list_items.
    if (supabase && userId && playlists.length > 0) {
      const { data } = await supabase
        .from('list_items')
        .select('list_id')
        .eq('release_id', albumId)
        .in('list_id', playlists.map((p) => p.id));
      (data ?? []).forEach((r: any) => next.add(r.list_id));
    }
    setAdded(next);
    setLoaded(true);
  };

  const openMenu = () => {
    setOpen((o) => !o);
    if (!loaded) void loadMembership();
  };

  const toggle = async (key: string, listId: string | null) => {
    if (added.has(key)) {
      await removeItemFrom(listId, albumId);
      setAdded((s) => { const n = new Set(s); n.delete(key); return n; });
    } else {
      await addItemTo(listId, albumId, albumTitle, albumArtist, coverUrl);
      setAdded((s) => new Set(s).add(key));
    }
  };

  const anySaved = added.size > 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={openMenu}
        className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-bold border transition ${
          anySaved ? 'bg-mint-bg text-mint-dark border-mint' : 'bg-page border-divider text-ink hover:bg-surface'
        }`}
      >
        {anySaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
        Save
        <ChevronRight size={13} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1.5 bg-page border border-divider rounded-xl shadow-lg z-30 min-w-[220px] py-1 max-h-[60vh] overflow-y-auto">
          <button
            onClick={() => toggle(LL_KEY, null)}
            className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-ink hover:bg-surface w-full text-left transition"
          >
            {added.has(LL_KEY) ? <BookmarkCheck size={15} className="text-mint-dark" /> : <Bookmark size={15} className="text-muted" />}
            <span className="flex-1">Listen Later</span>
            {added.has(LL_KEY) && <Check size={13} className="text-mint-dark" />}
          </button>

          {playlists.length > 0 && <div className="my-1 border-t border-divider" />}

          {!loaded ? (
            <div className="px-4 py-2"><div className="h-6 rounded bg-surface animate-pulse" /></div>
          ) : (
            playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => toggle(p.id, p.id)}
                className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-ink hover:bg-surface w-full text-left transition"
              >
                {added.has(p.id) ? <Check size={15} className="text-mint-dark" /> : <span className="w-[15px]" />}
                <span className="flex-1 truncate">{p.title}</span>
              </button>
            ))
          )}

          {loaded && playlists.length === 0 && (
            <p className="px-4 py-2 text-[12px] text-muted">Create a collection from the collections panel.</p>
          )}
        </div>
      )}
    </div>
  );
}
