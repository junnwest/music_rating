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
  removeTrackFromActive: (albumId: string, trackPosition: number) => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  panelRefreshKey: number;
  /** Set of release IDs in the active list — for album-level button state */
  activeReleaseIds: Set<string>;
  /** Set of "albumId::trackPosition" keys — for track-level button state */
  activeTrackKeys: Set<string>;
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
  const [activeTrackKeys, setActiveTrackKeys] = useState<Set<string>>(new Set());

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

  // Reload album IDs + track keys whenever the active list or its contents change
  useEffect(() => {
    if (activeListId == null) {
      const ids = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
      setActiveReleaseIds(new Set(ids));
      setActiveTrackKeys(new Set());
      return;
    }
    if (!supabase || !userId) return;

    supabase
      .from('list_items')
      .select('id, release_id')
      .eq('list_id', activeListId)
      .then(async ({ data: items }) => {
        const releaseIds = (items ?? []).map((i: any) => i.release_id as string);
        setActiveReleaseIds(new Set(releaseIds));

        if (!items || items.length === 0) { setActiveTrackKeys(new Set()); return; }

        const itemIds = items.map((i: any) => i.id as string);
        const listItemToRelease = new Map<string, string>(
          items.map((i: any) => [i.id as string, i.release_id as string])
        );

        const { data: tracks } = await supabase!
          .from('list_item_tracks')
          .select('list_item_id, track_position')
          .in('list_item_id', itemIds);

        setActiveTrackKeys(
          new Set(
            (tracks ?? []).map((t: any) =>
              `${listItemToRelease.get(t.list_item_id)}::${t.track_position}`
            )
          )
        );
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
    const isTrack = trackTitle != null && trackPosition != null;

    // Listen Later: album-level only (no track sub-items)
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

    if (isTrack) {
      // 1. Ensure the album entry exists in list_items
      await supabase.from('list_items')
        .upsert(
          { list_id: activeListId, release_id: releaseId },
          { onConflict: 'list_id,release_id', ignoreDuplicates: true },
        );

      // 2. Fetch the list_item id
      const { data: listItem } = await supabase.from('list_items')
        .select('id')
        .eq('list_id', activeListId)
        .eq('release_id', releaseId)
        .maybeSingle();

      if (listItem) {
        // 3. Add the track as a sub-item
        await supabase.from('list_item_tracks')
          .upsert(
            { list_item_id: listItem.id, track_title: trackTitle, track_position: trackPosition },
            { onConflict: 'list_item_id,track_position', ignoreDuplicates: true },
          );

        setActiveReleaseIds(prev => new Set([...prev, releaseId]));
        setActiveTrackKeys(prev => new Set([...prev, `${releaseId}::${trackPosition}`]));
        setPanelRefreshKey((k) => k + 1);
      }
    } else {
      // Album-level add
      await supabase.from('list_items')
        .upsert(
          { list_id: activeListId, release_id: releaseId },
          { onConflict: 'list_id,release_id', ignoreDuplicates: true },
        );
      setActiveReleaseIds(prev => new Set([...prev, releaseId]));
      setPanelRefreshKey((k) => k + 1);
    }

    return {};
  }, [activeListId, userId]);

  const removeFromActive = useCallback(async (releaseId: string) => {
    if (activeListId == null) {
      const saved = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
      localStorage.setItem(LL_KEY, JSON.stringify(saved.filter(id => id !== releaseId)));
    } else {
      if (!supabase) return;
      // Cascade deletes list_item_tracks rows automatically
      await supabase.from('list_items').delete()
        .eq('list_id', activeListId).eq('release_id', releaseId);
    }
    setActiveReleaseIds(prev => {
      const next = new Set(prev);
      next.delete(releaseId);
      return next;
    });
    setActiveTrackKeys(prev => {
      const next = new Set(prev);
      const prefix = `${releaseId}::`;
      for (const key of [...next]) {
        if (key.startsWith(prefix)) next.delete(key);
      }
      return next;
    });
    setPanelRefreshKey((k) => k + 1);
  }, [activeListId]);

  const removeTrackFromActive = useCallback(async (albumId: string, trackPosition: number) => {
    if (!supabase || activeListId == null) return;

    const { data: listItem } = await supabase.from('list_items')
      .select('id')
      .eq('list_id', activeListId)
      .eq('release_id', albumId)
      .maybeSingle();

    if (listItem) {
      await supabase.from('list_item_tracks').delete()
        .eq('list_item_id', listItem.id)
        .eq('track_position', trackPosition);
    }

    setActiveTrackKeys(prev => {
      const next = new Set(prev);
      next.delete(`${albumId}::${trackPosition}`);
      return next;
    });
    setPanelRefreshKey((k) => k + 1);
  }, [activeListId]);

  return (
    <PlaylistContext.Provider
      value={{
        userId, playlists, activeListId, activeListName,
        setActiveListId, addToActive, removeFromActive, removeTrackFromActive,
        refreshPlaylists: fetchPlaylists,
        panelOpen, setPanelOpen, panelRefreshKey,
        activeReleaseIds, activeTrackKeys,
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
