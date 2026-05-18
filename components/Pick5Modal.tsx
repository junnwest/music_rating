'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

interface PickAlbum {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  release_type: string;
}

const MAX = 5;

export default function Pick5Modal({ userId, onComplete }: { userId: string; onComplete: () => void }) {
  const [query, setQuery] = useState('');
  const [albums, setAlbums] = useState<PickAlbum[]>([]);
  const [selected, setSelected] = useState<PickAlbum[]>([]);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadDefaults(); }, []);

  const loadDefaults = async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('curated_releases')
      .select('release_id, title, artist, cover_url, release_type')
      .limit(20);
    if (data) {
      setAlbums(
        data.map((r) => ({
          id: r.release_id,
          title: r.title,
          artist: r.artist,
          cover_url: r.cover_url,
          release_type: r.release_type ?? 'Album',
        }))
      );
    }
  };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { loadDefaults(); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        if (json.releases) {
          setAlbums(
            json.releases.map((r: any) => ({
              id: r.id,
              title: r.title,
              artist: r.artist,
              cover_url: r.coverUrl,
              release_type: r.releaseType ?? 'Album',
            }))
          );
        }
      } catch {}
    }, 350);
  }, [query]);

  const toggle = (album: PickAlbum) => {
    if (selected.find((s) => s.id === album.id)) {
      setSelected(selected.filter((s) => s.id !== album.id));
    } else if (selected.length < MAX) {
      setSelected([...selected, album]);
    }
  };

  const markComplete = async () => {
    if (!supabase) return;
    await supabase.auth.updateUser({ data: { onboarding_completed: true } });
  };

  const handleSkip = async () => {
    await markComplete();
    onComplete();
  };

  const handleSave = async () => {
    if (!supabase || selected.length < MAX) return;
    setSaving(true);
    try {
      for (const album of selected) {
        await supabase.from('releases').insert({
          id: album.id,
          title: album.title,
          artist: album.artist,
          cover_url: album.cover_url,
          release_type: album.release_type,
        });
      }
      await supabase.from('pinned_albums').upsert(
        selected.map((a) => ({ user_id: userId, release_id: a.id })),
        { onConflict: 'user_id,release_id', ignoreDuplicates: true }
      );
      await markComplete();
      onComplete();
    } catch (err) {
      console.error('[Pick5] save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const selectedIds = new Set(selected.map((s) => s.id));
  const isFull = selected.length >= MAX;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
      <div
        className="bg-page rounded-[16px] w-full mx-4 flex flex-col"
        style={{ maxWidth: 680, maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="px-7 pt-7 pb-5 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-muted uppercase" style={{ letterSpacing: '0.7px' }}>
              Welcome to sillajuku
            </span>
            <button
              onClick={handleSkip}
              className="text-[12px] text-muted hover:text-ink transition"
            >
              Skip for now
            </button>
          </div>
          <h2
            className="text-[24px] font-extrabold text-ink"
            style={{ letterSpacing: '-0.7px' }}
          >
            Pick 5 albums that define you.
          </h2>
          <p className="text-[13px] text-muted mt-[5px]">
            These are pinned to your profile. You can swap them anytime.
          </p>
        </div>

        {/* Search */}
        <div className="px-7 pb-4 flex-shrink-0">
          <input
            type="text"
            placeholder="Search for an album…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-surface border border-divider rounded-lg px-4 py-[10px] text-[14px] text-ink placeholder:text-muted outline-none focus:border-ink transition"
            autoFocus
          />
        </div>

        {/* Album grid */}
        <div className="px-7 overflow-y-auto flex-1 pb-2">
          {albums.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-muted">No results. Try a different search.</div>
          ) : (
            <div className="grid gap-[10px]" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
              {albums.map((album) => {
                const isSelected = selectedIds.has(album.id);
                const disabled = !isSelected && isFull;
                return (
                  <button
                    key={album.id}
                    onClick={() => toggle(album)}
                    disabled={disabled}
                    className={`text-left ${disabled ? 'opacity-35 cursor-not-allowed' : ''}`}
                  >
                    <div className="relative rounded-[7px] overflow-hidden" style={{ aspectRatio: '1 / 1' }}>
                      {album.cover_url ? (
                        <img src={album.cover_url} alt={album.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-surface" />
                      )}
                      {isSelected && (
                        <div
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ background: 'rgba(232,160,32,0.2)' }}
                        >
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{ background: '#E8A020' }}
                          >
                            <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                              <path d="M1.5 5L5 8.5L12.5 1" stroke="#7A4F0A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                        </div>
                      )}
                      {!isSelected && !disabled && (
                        <div
                          className="absolute inset-0 opacity-0 hover:opacity-100 transition flex items-center justify-center"
                          style={{ background: 'rgba(0,0,0,0.18)' }}
                        >
                          <div className="w-7 h-7 rounded-full border-2 border-white" />
                        </div>
                      )}
                    </div>
                    <div className="mt-[6px] text-[11px] font-semibold text-ink truncate leading-snug">
                      {album.title}
                    </div>
                    <div className="text-[10px] text-muted truncate">{album.artist}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 pt-4 pb-6 flex-shrink-0 border-t border-divider mt-3">
          {/* Selected tray */}
          <div className="flex items-center gap-3 mb-[14px]">
            {Array.from({ length: MAX }).map((_, i) => {
              const album = selected[i];
              return (
                <div
                  key={i}
                  className="w-[48px] h-[48px] rounded-[6px] overflow-hidden flex-shrink-0 border border-dashed border-[#DDDDD8] bg-surface"
                >
                  {album?.cover_url && (
                    <img src={album.cover_url} alt={album.title} className="w-full h-full object-cover" />
                  )}
                </div>
              );
            })}
            <p className="text-[12px] text-muted flex-1 leading-snug">
              {selected.length === 0
                ? 'Select 5 albums to continue'
                : selected.length < MAX
                ? `${MAX - selected.length} more to go`
                : 'Looking good.'}
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={selected.length < MAX || saving}
            className="w-full bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] rounded-lg py-[13px] text-[14px] font-bold transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Start my journey →'}
          </button>
        </div>
      </div>
    </div>
  );
}
