'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

interface PinnedAlbum {
  release_id: string;
  releases: { title: string; artist: string; cover_url: string | null } | null;
}

interface PickerAlbum {
  release_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  userScore: number | null;
}

const MAX_PINS = 6;

export default function Essentials({ userId, canEdit = true }: { userId: string; canEdit?: boolean }) {
  const [pinned, setPinned] = useState<PinnedAlbum[]>([]);
  const [ratedMap, setRatedMap] = useState<Map<string, number | null>>(new Map());
  const [ratedList, setRatedList] = useState<PickerAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [dragPos, setDragPos] = useState<number | null>(null);
  const [dragOverPos, setDragOverPos] = useState<number | null>(null);
  const [replacingPos, setReplacingPos] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingPin, setPendingPin] = useState<PickerAlbum | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<PickerAlbum[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadPinned(); }, [userId]);

  useEffect(() => {
    if (!editing) { setDragPos(null); setDragOverPos(null); }
  }, [editing]);

  useEffect(() => {
    if (showPicker) setTimeout(() => searchRef.current?.focus(), 50);
  }, [showPicker]);

  useEffect(() => {
    if (!showPicker) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) { setSearchResults([]); setSearching(false); return; }

    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      if (!supabase) { setSearching(false); return; }
      const pinnedIds = new Set(pinned.map(p => p.release_id));
      const { data } = await supabase
        .from('releases')
        .select('id, title, artist, cover_url')
        .or(`title.ilike.%${search}%,artist.ilike.%${search}%`)
        .limit(48);
      setSearchResults(
        (data ?? [])
          .filter(r => !pinnedIds.has(r.id))
          .map(r => ({
            release_id: r.id,
            title: r.title,
            artist: r.artist,
            cover_url: r.cover_url,
            userScore: ratedMap.get(r.id) ?? null,
          }))
      );
      setSearching(false);
    }, 300);
  }, [search, showPicker]);

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

  const persistOrder = async (ordered: PinnedAlbum[]) => {
    if (!supabase) return;
    await supabase.from('pinned_albums').delete().eq('user_id', userId);
    for (const p of ordered) {
      await supabase.from('pinned_albums').insert({ user_id: userId, release_id: p.release_id });
    }
  };

  const handleDrop = (toPos: number) => {
    if (dragPos === null || dragPos === toPos) { setDragPos(null); setDragOverPos(null); return; }
    const slots: (PinnedAlbum | null)[] = Array(MAX_PINS).fill(null);
    pinned.forEach((p, i) => { slots[i] = p; });
    const tmp = slots[dragPos];
    slots[dragPos] = slots[toPos];
    slots[toPos] = tmp;
    const newPinned = slots.filter(Boolean) as PinnedAlbum[];
    setPinned(newPinned);
    setDragPos(null);
    setDragOverPos(null);
    void persistOrder(newPinned);
  };

  const loadRated = async () => {
    if (!supabase || ratedList.length > 0) return;
    const { data: ratingRows } = await supabase
      .from('ratings')
      .select('release_id, score')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (!ratingRows || ratingRows.length === 0) return;
    const ids = ratingRows.map((r: any) => r.release_id);
    const { data: releaseRows } = await supabase
      .from('releases').select('id, title, artist, cover_url').in('id', ids);
    const relMap = new Map((releaseRows ?? []).map((r: any) => [r.id, r]));
    const map = new Map<string, number | null>();
    const list: PickerAlbum[] = [];
    for (const r of ratingRows) {
      map.set(r.release_id, r.score ?? null);
      const rel = relMap.get(r.release_id);
      if (rel) list.push({ release_id: r.release_id, title: rel.title, artist: rel.artist, cover_url: rel.cover_url, userScore: r.score ?? null });
    }
    setRatedMap(map);
    setRatedList(list);
  };

  const openPicker = async (replaceAt?: number) => {
    await loadRated();
    setSearch('');
    setSearchResults([]);
    setPendingPin(null);
    setReplacingPos(replaceAt ?? null);
    setShowPicker(true);
  };

  const selectAlbum = (album: PickerAlbum) => {
    if (album.userScore === 5) {
      void commitPin(album);
    } else {
      setPendingPin(album);
    }
  };

  const commitPin = async (album: PickerAlbum) => {
    if (!supabase) return;
    setSaving(true);
    try {
      await supabase.from('ratings').upsert(
        { user_id: userId, release_id: album.release_id, score: 5 },
        { onConflict: 'user_id,release_id' }
      );
      if (replacingPos !== null) {
        const newPinned = pinned.map((p, i) =>
          i === replacingPos
            ? { release_id: album.release_id, releases: { title: album.title, artist: album.artist, cover_url: album.cover_url } }
            : p
        );
        setPinned(newPinned);
        await persistOrder(newPinned);
      } else {
        await supabase.from('pinned_albums').insert({ user_id: userId, release_id: album.release_id });
        await loadPinned();
      }
      setShowPicker(false);
      setPendingPin(null);
      setReplacingPos(null);
    } finally {
      setSaving(false);
    }
  };

  const handleUnpin = async (releaseId: string) => {
    if (!supabase) return;
    await supabase.from('pinned_albums').delete().eq('user_id', userId).eq('release_id', releaseId);
    await loadPinned();
  };

  if (loading) return null;
  if (pinned.length === 0 && !canEdit) return null;

  const pinnedIds = new Set(pinned.map(p => p.release_id));
  const isFull = pinned.length >= MAX_PINS;
  const displayList = search.trim() ? searchResults : ratedList.filter(r => !pinnedIds.has(r.release_id));

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-semibold text-muted uppercase" style={{ letterSpacing: '0.6px' }}>Essentials</p>
        {canEdit && (
          <button
            onClick={() => setEditing(e => !e)}
            className="text-[12px] font-medium text-muted hover:text-ink transition"
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {/* 1×6 horizontal strip — fixed 80px items, space-between fills the row */}
      <div className="grid justify-between" style={{ gridTemplateColumns: 'repeat(6, 96px)' }}>
        {Array.from({ length: MAX_PINS }, (_, pos) => {
          const album = pinned[pos];
          const isDragging = dragPos === pos;
          const isOver = dragOverPos === pos && dragPos !== pos;

          return album ? (
            <div
              key={pos}
              className="relative group/pin"
              draggable={editing}
              onDragStart={e => {
                setDragPos(pos);
                const ghost = document.createElement('div');
                ghost.style.cssText = 'width:1px;height:1px;opacity:0;position:fixed;top:0;left:0';
                document.body.appendChild(ghost);
                e.dataTransfer.setDragImage(ghost, 0, 0);
                requestAnimationFrame(() => document.body.removeChild(ghost));
              }}
              onDragEnd={() => { setDragPos(null); setDragOverPos(null); }}
              onDragOver={e => { e.preventDefault(); setDragOverPos(pos); }}
              onDrop={() => handleDrop(pos)}
            >
              <div
                className={`w-full aspect-square pin-shine rounded-[8px] overflow-hidden relative bg-surface border-2 transition ${
                  isDragging ? 'opacity-40 border-[#EBEBEB]'
                  : isOver ? 'border-ink scale-[1.04]'
                  : editing ? 'border-[#EBEBEB] cursor-grab active:cursor-grabbing'
                  : 'border-[#EBEBEB]'
                }`}
              >
                {album.releases?.cover_url ? (
                  <img src={album.releases.cover_url} alt={album.releases.title ?? ''} className="w-full h-full object-cover" draggable={false} />
                ) : (
                  <div className="w-full h-full bg-surface" />
                )}
                {editing && (
                  <div
                    onClick={() => openPicker(pos)}
                    className="absolute inset-0 bg-black/0 group-hover/pin:bg-black/40 transition-all flex items-center justify-center cursor-pointer pointer-events-auto"
                  >
                    <RefreshCw size={22} className="text-white opacity-0 group-hover/pin:opacity-100 transition-opacity" />
                  </div>
                )}
              </div>
              {!editing && (
                <Link href={`/album/${album.release_id}`} className="absolute inset-0" />
              )}
              {canEdit && editing && (
                <button
                  onClick={e => { e.stopPropagation(); handleUnpin(album.release_id); }}
                  className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-ink text-white text-[11px] font-bold flex items-center justify-center hover:bg-red-500 transition z-10 leading-none"
                >
                  ×
                </button>
              )}
            </div>
          ) : (
            <div
              key={`empty-${pos}`}
              onDragOver={e => { e.preventDefault(); setDragOverPos(pos); }}
              onDrop={() => handleDrop(pos)}
              onClick={canEdit && !isFull ? () => openPicker() : undefined}
              className={`w-full aspect-square rounded-[8px] border-2 border-dashed flex items-center justify-center transition ${
                isOver
                  ? 'border-ink text-ink scale-[1.04]'
                  : 'border-[#DDDDD8] text-[#DDDDD8] hover:border-mid hover:text-mid'
              } ${!canEdit || isFull ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <span className="text-[20px] font-light leading-none">+</span>
            </div>
          );
        })}
      </div>

      {/* Picker modal */}
      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={e => { if (e.target === e.currentTarget) { setShowPicker(false); setPendingPin(null); } }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[460px] mx-4 overflow-hidden">

            {pendingPin ? (
              <div className="p-6">
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-[64px] h-[64px] rounded-[8px] overflow-hidden flex-shrink-0 bg-surface border border-[#EBEBEB]">
                    {pendingPin.cover_url ? (
                      <img src={pendingPin.cover_url} alt={pendingPin.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-surface" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold text-ink truncate">{pendingPin.title}</p>
                    <p className="text-[12px] text-muted truncate">{pendingPin.artist}</p>
                    {pendingPin.userScore != null && (
                      <p className="text-[12px] text-muted mt-1">
                        Current rating: <span className="font-semibold text-ink">★ {pendingPin.userScore}</span>
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-[13px] font-semibold text-ink mb-1">Pin this album?</p>
                <p className="text-[12px] text-muted mb-6 leading-relaxed">
                  {pendingPin.userScore != null
                    ? `Your current rating of ★ ${pendingPin.userScore} will be updated to ★ 5.`
                    : 'This album will be added to your catalog with a rating of ★ 5.'}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setPendingPin(null)}
                    className="flex-1 border border-[#EBEBEB] rounded-lg py-2.5 text-[13px] font-semibold text-ink hover:bg-surface transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => commitPin(pendingPin)}
                    disabled={saving}
                    className="flex-1 bg-ink text-white rounded-lg py-2.5 text-[13px] font-semibold hover:opacity-80 transition disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Confirm & set ★ 5'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-[#EBEBEB]">
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search all albums…"
                    className="flex-1 text-[13px] text-ink outline-none placeholder:text-placeholder bg-transparent"
                  />
                  {searching && <span className="text-[12px] text-muted">Searching…</span>}
                  <button
                    onClick={() => { setShowPicker(false); setPendingPin(null); }}
                    className="text-[20px] font-light text-muted hover:text-ink transition leading-none"
                  >
                    ×
                  </button>
                </div>
                <div className="p-4 grid grid-cols-4 gap-3 max-h-[380px] overflow-y-auto">
                  {displayList.length === 0 && !searching ? (
                    <div className="col-span-4 py-10 text-center">
                      <p className="text-[13px] text-muted">
                        {search.trim() ? 'No albums found.' : 'No rated albums yet.'}
                      </p>
                    </div>
                  ) : (
                    displayList.map(r => (
                      <button key={r.release_id} onClick={() => selectAlbum(r)} className="group/pick text-left">
                        <div className="w-full aspect-square rounded-[6px] overflow-hidden relative bg-surface border border-[#EBEBEB] group-hover/pick:border-mid transition">
                          {r.cover_url ? (
                            <img src={r.cover_url} alt={r.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-surface" />
                          )}
                          {r.userScore != null && (
                            <span className="absolute bottom-1 right-1 text-[10px] font-bold rounded-[3px] px-[5px] py-[1px]" style={{ background: '#3DFFD1', color: '#00453A' }}>
                              ★ {r.userScore}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-medium text-ink truncate mt-1 leading-snug">{r.title}</p>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
