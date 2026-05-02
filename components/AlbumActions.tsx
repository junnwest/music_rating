'use client';

import { useEffect, useState } from 'react';
import { BookmarkPlus, BookmarkCheck } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

const LL_KEY = 'sillajuku:listen-later';

export default function AlbumActions({ albumId }: { albumId: string }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const [pinnedFull, setPinnedFull] = useState(false);
  const [listenLater, setListenLater] = useState(false);
  const [pinnedLoading, setPinnedLoading] = useState(false);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
    setListenLater(saved.includes(albumId));

    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (uid) checkPinned(uid);
    });
  }, [albumId]);

  const checkPinned = async (uid: string) => {
    if (!supabase) return;
    const { data } = await supabase
      .from('pinned_albums')
      .select('release_id')
      .eq('user_id', uid);
    const rows = data ?? [];
    setPinned(rows.some((r: any) => r.release_id === albumId));
    setPinnedFull(rows.length >= 10);
  };

  const togglePinned = async () => {
    if (!userId || !supabase || pinnedLoading) return;
    setPinnedLoading(true);
    if (pinned) {
      await supabase.from('pinned_albums').delete().eq('user_id', userId).eq('release_id', albumId);
      setPinned(false);
      setPinnedFull(false);
    } else {
      if (pinnedFull) { setPinnedLoading(false); return; }
      await supabase.from('pinned_albums').insert({ user_id: userId, release_id: albumId });
      setPinned(true);
    }
    setPinnedLoading(false);
  };

  const toggleListenLater = () => {
    const saved = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
    const next = saved.includes(albumId)
      ? saved.filter((id) => id !== albumId)
      : [...saved, albumId];
    localStorage.setItem(LL_KEY, JSON.stringify(next));
    setListenLater(!listenLater);
  };

  return (
    <div className="flex gap-2 mt-3 flex-wrap">
      {userId && (
        <button
          onClick={togglePinned}
          disabled={pinnedLoading || (!pinned && pinnedFull)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition disabled:opacity-50 ${
            pinned
              ? 'bg-mint text-mint-dark'
              : 'border border-divider text-muted hover:bg-surface hover:text-ink'
          }`}
        >
          {pinned ? '✓ Added to Pinned Ten' : pinnedFull ? 'Pinned Ten full' : '+ Add to Pinned Ten'}
        </button>
      )}
      <button
        onClick={toggleListenLater}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition ${
          listenLater
            ? 'bg-mint text-mint-dark'
            : 'border border-divider text-muted hover:bg-surface hover:text-ink'
        }`}
      >
        {listenLater ? (
          <><BookmarkCheck size={13} /> Saved</>
        ) : (
          <><BookmarkPlus size={13} /> Listen Later</>
        )}
      </button>
    </div>
  );
}
