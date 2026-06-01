'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '../lib/supabaseClient';

export interface Playlist {
  id: string;
  title: string;
}

interface PlaylistContextType {
  userId: string | null;
  playlists: Playlist[];
  activeListId: string | null; // null = Listen Later
  activeListName: string;
  setActiveListId: (id: string | null) => void;
  addToActive: (
    releaseId: string, title: string, artist: string, coverUrl?: string | null,
    trackTitle?: string, trackPosition?: number
  ) => Promise<{ alreadyAdded?: boolean }>;
  removeFromActive: (releaseId: string) => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** Increments each time an item is successfully added/removed — panels watch this to reload */
  panelRefreshKey: number;
  /** Set of release IDs currently in the active list — live-updated for instant button feedback */
  activeReleaseIds: Set<string>;
}

const PlaylistContext = createContext<PlaylistContextType | null>(null);

const LL_KEY = 'sillajuku:listen-later';

async function ensureRelease(
  sb: NonNullable<typeof supabase>,
  releaseId: string,
  title: string,
  artist: string,
  coverUrl?: string | null,
) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(releaseId);
  if (isUUID) {
    await sb.from('releases').upsert(
      { id: releaseId, title, artist, cover_url: coverUrl ?? null },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  } else {
    await sb.from('releases').upsert(
      { spotify_id: releaseId, title, artist, cover_url: coverUrl ?? null, canonical_source: 'spotify' },
      { onConflict: 'spotify_id', ignoreDuplicates: true },
    );
  }
}

export function PlaylistProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelRefreshKey, setPanelRefreshKey] = useState(0);
  const [activeReleaseIds, setActiveReleaseIds] = useState<Set<string>>(new Set());

  const activeListName =
    activeListId == null
      ? 'Listen Later'
      : (playlists.find((p) => p.id === activeListId)?.title ?? 'Playlist');

  const fetchPlaylists = useCallback(async () => {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    setUserId(uid);
    if (!uid) { setPlaylists([]); return; }
    const { data } = await supabase
      .from('lists')
      .select('id, title')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    setPlaylists(data ?? []);
  }, []);

  useEffect(() => { void fetchPlaylists(); }, [fetchPlaylists]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1280) {
      setPanelOpen(true);
    }
  }, []);

  // Reload which release IDs are in the active list whenever it changes or items are added/removed
  useEffect(() => {
    if (activeListId == null) {
      const ids = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
      setActiveReleaseIds(new Set(ids));
      return;
    }
    if (!supabase || !userId) return;
    supabase
      .from('list_items')
      .select('release_id')
      .eq('list_id', activeListId)
      .then(({ data }) => {
        setActiveReleaseIds(new Set((data ?? []).map((item: any) => item.release_id)));
      });
  }, [activeListId, userId, panelRefreshKey]);

  const addToActive = useCallback(async (
    releaseId: string,
    title: string,
    artist: string,
    coverUrl?: string | null,
    trackTitle?: string,
    trackPosition?: number,
  ): Promise<{ alreadyAdded?: boolean }> => {
    if (activeListId == null) {
      const saved = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
      if (saved.includes(releaseId)) return { alreadyAdded: true };
      localStorage.setItem(LL_KEY, JSON.stringify([...saved, releaseId]));
      setActiveReleaseIds(prev => new Set([...prev, releaseId]));
      setPanelRefreshKey((k) => k + 1);
      return {};
    }
    if (!supabase || !userId) return {};
    await ensureRelease(supabase, releaseId, title, artist, coverUrl);
    await supabase
      .from('list_items')
      .upsert(
        {
          list_id: activeListId,
          release_id: releaseId,
          track_title: trackTitle ?? null,
          track_position: trackPosition ?? null,
        },
        { onConflict: 'list_id,release_id' },
      );
    setActiveReleaseIds(prev => new Set([...prev, releaseId]));
    setPanelRefreshKey((k) => k + 1);
    return {};
  }, [activeListId, userId]);

  const removeFromActive = useCallback(async (releaseId: string) => {
    if (activeListId == null) {
      const saved = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
      localStorage.setItem(LL_KEY, JSON.stringify(saved.filter(id => id !== releaseId)));
    } else {
      if (!supabase) return;
      await supabase.from('list_items').delete()
        .eq('list_id', activeListId).eq('release_id', releaseId);
    }
    setActiveReleaseIds(prev => {
      const next = new Set(prev);
      next.delete(releaseId);
      return next;
    });
    setPanelRefreshKey((k) => k + 1);
  }, [activeListId]);

  return (
    <PlaylistContext.Provider
      value={{
        userId, playlists, activeListId, activeListName,
        setActiveListId, addToActive, removeFromActive, refreshPlaylists: fetchPlaylists,
        panelOpen, setPanelOpen, panelRefreshKey, activeReleaseIds,
      }}
    >
      {children}
    </PlaylistContext.Provider>
  );
}

export function usePlaylist() {
  const ctx = useContext(PlaylistContext);
  if (!ctx) throw new Error('usePlaylist must be inside PlaylistProvider');
  return ctx;
}
