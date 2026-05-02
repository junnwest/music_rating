'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

interface PinnedAlbum {
  release_id: string;
  releases: { title: string; artist: string; cover_url: string | null } | null;
}

const MAX_PINS = 10;

export default function PinnedTen({ userId, canEdit = true }: { userId: string; canEdit?: boolean }) {
  const [pinned, setPinned] = useState<PinnedAlbum[]>([]);
  const [rated, setRated] = useState<any[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadPinned(); }, [userId]);

  const loadPinned = async () => {
    if (!supabase) { setLoading(false); return; }
    const { data: pinnedRows } = await supabase
      .from('pinned_albums')
      .select('release_id')
      .eq('user_id', userId)
      .order('created_at');
    if (!pinnedRows || pinnedRows.length === 0) { setPinned([]); setLoading(false); return; }
    const ids = pinnedRows.map((p: any) => p.release_id);
    const { data: releaseRows } = await supabase
      .from('releases').select('id, title, artist, cover_url').in('id', ids);
    const rmap = new Map((releaseRows ?? []).map((r: any) => [r.id, { title: r.title, artist: r.artist, cover_url: r.cover_url }]));
    setPinned(pinnedRows.map((p: any) => ({ release_id: p.release_id, releases: rmap.get(p.release_id) ?? null })) as PinnedAlbum[]);
    setLoading(false);
  };

  const startEditing = async () => {
    setEditing(true);
    if (!supabase || rated.length > 0) return;
    const { data: ratingRows } = await supabase
      .from('ratings')
      .select('release_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!ratingRows || ratingRows.length === 0) return;
    const ids = ratingRows.map((r: any) => r.release_id);
    const { data: releaseRows } = await supabase
      .from('releases').select('id, title, artist, cover_url').in('id', ids);
    const rmap = new Map((releaseRows ?? []).map((r: any) => [r.id, { title: r.title, artist: r.artist, cover_url: r.cover_url }]));
    setRated(ratingRows.map((r: any) => ({ release_id: r.release_id, releases: rmap.get(r.release_id) ?? null })));
  };

  const handlePin = async (releaseId: string) => {
    if (!supabase || pinned.length >= MAX_PINS) return;
    if (pinned.find((p) => p.release_id === releaseId)) return;
    await supabase.from('pinned_albums').insert({ user_id: userId, release_id: releaseId });
    await loadPinned();
  };

  const handleUnpin = async (releaseId: string) => {
    if (!supabase) return;
    await supabase.from('pinned_albums').delete().eq('user_id', userId).eq('release_id', releaseId);
    await loadPinned();
  };

  if (loading) return null;

  const pinnedIds = new Set(pinned.map((p) => p.release_id));
  const unpinned = rated.filter((r) => !pinnedIds.has(r.release_id));
  const emptySlots = MAX_PINS - pinned.length;
  const isFull = pinned.length >= MAX_PINS;

  return (
    <div className="border-b border-[#EBEBEB] bg-white">
      <div className="max-w-[1440px] mx-auto px-5 py-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[13px] font-bold text-ink">Pinned Ten</span>
          {canEdit && (
            <button
              onClick={editing ? () => setEditing(false) : startEditing}
              className="text-[12px] font-medium text-muted hover:text-ink transition"
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
        </div>

        {/* Pinned slots */}
        <div className="flex gap-[10px] flex-wrap">
          {pinned.map((p) => (
            <div key={p.release_id} className="relative group/pin flex-shrink-0">
              <Link href={`/album/${p.release_id}`}>
                <div className="w-[84px] h-[84px] rounded-[6px] overflow-hidden bg-surface border border-[#EBEBEB]">
                  {p.releases?.cover_url ? (
                    <img src={p.releases.cover_url} alt={p.releases.title ?? ''} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-surface" />
                  )}
                </div>
              </Link>
              {canEdit && editing && (
                <button
                  onClick={() => handleUnpin(p.release_id)}
                  className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-ink text-white text-[11px] font-bold flex items-center justify-center hover:bg-red-500 transition z-10 leading-none"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {/* Empty slots */}
          {Array.from({ length: emptySlots }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="w-[84px] h-[84px] rounded-[6px] border border-dashed border-[#DDDDD8] flex-shrink-0"
            />
          ))}
        </div>

        {/* Picker */}
        {canEdit && editing && unpinned.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] text-muted mb-3">
              {isFull ? 'All 10 slots filled. Unpin an album to add another.' : `Pick from your catalog — ${emptySlots} slot${emptySlots !== 1 ? 's' : ''} remaining`}
            </p>
            <div className="flex gap-[10px] overflow-x-auto scrollbar-hide pb-1">
              {unpinned.slice(0, 40).map((r) => (
                <button
                  key={r.release_id}
                  onClick={() => handlePin(r.release_id)}
                  disabled={isFull}
                  className="flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="w-[68px] h-[68px] rounded-[5px] overflow-hidden border-2 border-transparent hover:border-mint transition">
                    {r.releases?.cover_url ? (
                      <img src={r.releases.cover_url} alt={r.releases.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-surface" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
