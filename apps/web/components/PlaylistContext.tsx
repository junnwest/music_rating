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
  activeListId: string | null;
  activeListName: string;
  setActiveListId: (id: string | null) => void;
  addToActive: (
    releaseId: string, title: string, artist: string, coverUrl?: string | null,
    trackTitle?: string, trackPosition?: number
  ) => Promise<{ alreadyAdded?: boolean }>;
  removeFromActive: (releaseId: string) => Promise<void>;
  removeTrackFromActive: (albumId: string, trackPosition: number) => Promise<void>;
  /** Add an item to a specific collection (null = Listen Later). */
  addItemTo: (
    listId: string | null, releaseId: string, title: string, artist: string,
    coverUrl?: string | null, trackTitle?: string, trackPosition?: number
  ) => Promise<{ alreadyAdded?: boolean }>;
  /** Remove an album (or a single track when trackPosition is given) from a specific collection. */
  removeItemFrom: (listId: string | null, releaseId: string, trackPosition?: number) => Promise<void>;
  /** Display name for a collection id (null = Listen Later). */
  nameForList: (listId: string | null) => string;
  refreshPlaylists: () => Promise<void>;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  panelRefreshKey: number;
  activeReleaseIds: Set<string>;
  activeTrackKeys: Set<string>;
}

const PlaylistContext = createContext<PlaylistContextType | null>(null);

// ── helpers ──────────────────────────────────────────────────────────────────

function llKey(uid: string | null)       { return uid ? `sillajuku:listen-later:${uid}`        : 'sillajuku:listen-later'; }
function llTracksKey(uid: string | null) { return uid ? `sillajuku:listen-later-tracks:${uid}` : 'sillajuku:listen-later-tracks'; }

function llAlbums(uid: string | null): string[] {
  try { return JSON.parse(localStorage.getItem(llKey(uid)) ?? '[]') as string[]; }
  catch { return []; }
}
function llTracks(uid: string | null): Record<string, { title: string; position: number }[]> {
  try { return JSON.parse(localStorage.getItem(llTracksKey(uid)) ?? '{}'); }
  catch { return {}; }
}
function saveLLAlbums(uid: string | null, ids: string[]) { localStorage.setItem(llKey(uid), JSON.stringify(ids)); }
function saveLLTracks(uid: string | null, map: Record<string, { title: string; position: number }[]>) {
  localStorage.setItem(llTracksKey(uid), JSON.stringify(map));
}

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
      { id: releaseId, title, artist, cover_url: coverUrl ?? null, release_type: 'Album' },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  } else {
    await sb.from('releases').upsert(
      { spotify_id: releaseId, title, artist, cover_url: coverUrl ?? null, release_type: 'Album', canonical_source: 'spotify' },
      { onConflict: 'spotify_id', ignoreDuplicates: true },
    );
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function PlaylistProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelRefreshKey, setPanelRefreshKey] = useState(0);
  const [activeReleaseIds, setActiveReleaseIds] = useState<Set<string>>(new Set());
  const [activeTrackKeys, setActiveTrackKeys] = useState<Set<string>>(new Set());

  const nameForList = useCallback(
    (listId: string | null) =>
      listId == null
        ? 'Listen Later'
        : (playlists.find((p) => p.id === listId)?.title ?? 'Collection'),
    [playlists],
  );

  const activeListName = nameForList(activeListId);

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

  // Reload membership sets whenever the active list or contents change
  useEffect(() => {
    if (activeListId == null) {
      // Listen Later — read both album array and tracks map from localStorage
      setActiveReleaseIds(new Set(llAlbums(userId)));
      const tracksMap = llTracks(userId);
      const keys = new Set<string>();
      for (const [albumId, tracks] of Object.entries(tracksMap)) {
        for (const t of tracks) keys.add(`${albumId}::${t.position}`);
      }
      setActiveTrackKeys(keys);
      return;
    }
    if (!supabase || !userId) return;

    supabase
      .from('list_items')
      .select('id, release_id')
      .eq('list_id', activeListId)
      .then(async ({ data: items }) => {
        setActiveReleaseIds(new Set((items ?? []).map((i: any) => i.release_id as string)));
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
  }, [activeListId, userId, panelRefreshKey]); // userId here ensures LL re-reads scoped key on login/logout

  // Add to an arbitrary collection (null = Listen Later). Active membership sets
  // and the panel refresh only update when the affected collection is the open one.
  const addItemTo = useCallback(async (
    listId: string | null,
    releaseId: string,
    title: string,
    artist: string,
    coverUrl?: string | null,
    trackTitle?: string,
    trackPosition?: number,
  ): Promise<{ alreadyAdded?: boolean }> => {
    const isTrack = trackTitle != null && trackPosition != null;
    const isActive = listId === activeListId;

    // ── Listen Later ──────────────────────────────────────────────────────────
    if (listId == null) {
      const albums = llAlbums(userId);
      const tracksMap = llTracks(userId);

      if (isTrack) {
        // Add album if not already present
        if (!albums.includes(releaseId)) {
          saveLLAlbums(userId, [...albums, releaseId]);
          if (isActive) setActiveReleaseIds(prev => new Set([...prev, releaseId]));
        }
        // Add track if not already present
        const existing = tracksMap[releaseId] ?? [];
        if (!existing.some(t => t.position === trackPosition)) {
          tracksMap[releaseId] = [...existing, { title: trackTitle!, position: trackPosition! }];
          saveLLTracks(userId, tracksMap);
          if (isActive) {
            setActiveTrackKeys(prev => new Set([...prev, `${releaseId}::${trackPosition}`]));
            setPanelRefreshKey(k => k + 1);
          }
        }
      } else {
        // Album-level add
        if (albums.includes(releaseId)) return { alreadyAdded: true };
        saveLLAlbums(userId, [...albums, releaseId]);
        if (isActive) {
          setActiveReleaseIds(prev => new Set([...prev, releaseId]));
          setPanelRefreshKey(k => k + 1);
        }
      }
      return {};
    }

    // ── Custom collection ─────────────────────────────────────────────────────
    if (!supabase || !userId) return {};

    await ensureRelease(supabase, releaseId, title, artist, coverUrl);

    if (isTrack) {
      // Ensure album entry exists in list_items, then add track to list_item_tracks
      await supabase.from('list_items')
        .upsert(
          { list_id: listId, release_id: releaseId },
          { onConflict: 'list_id,release_id', ignoreDuplicates: true },
        );
      const { data: listItem } = await supabase.from('list_items')
        .select('id')
        .eq('list_id', listId)
        .eq('release_id', releaseId)
        .maybeSingle();
      if (listItem) {
        await supabase.from('list_item_tracks')
          .upsert(
            { list_item_id: listItem.id, track_title: trackTitle, track_position: trackPosition },
            { onConflict: 'list_item_id,track_position', ignoreDuplicates: true },
          );
        if (isActive) {
          setActiveReleaseIds(prev => new Set([...prev, releaseId]));
          setActiveTrackKeys(prev => new Set([...prev, `${releaseId}::${trackPosition}`]));
          setPanelRefreshKey(k => k + 1);
        }
      }
    } else {
      await supabase.from('list_items')
        .upsert(
          { list_id: listId, release_id: releaseId },
          { onConflict: 'list_id,release_id', ignoreDuplicates: true },
        );
      if (isActive) {
        setActiveReleaseIds(prev => new Set([...prev, releaseId]));
        setPanelRefreshKey(k => k + 1);
      }
    }
    return {};
  }, [activeListId, userId]);

  // Remove an album (trackPosition omitted) or a single track from a collection.
  const removeItemFrom = useCallback(async (
    listId: string | null,
    releaseId: string,
    trackPosition?: number,
  ) => {
    const isActive = listId === activeListId;
    const isTrack = trackPosition != null;

    if (listId == null) {
      const tracksMap = llTracks(userId);
      if (isTrack) {
        if (tracksMap[releaseId]) {
          tracksMap[releaseId] = tracksMap[releaseId].filter(t => t.position !== trackPosition);
          if (tracksMap[releaseId].length === 0) delete tracksMap[releaseId];
          saveLLTracks(userId, tracksMap);
        }
      } else {
        saveLLAlbums(userId, llAlbums(userId).filter(id => id !== releaseId));
        delete tracksMap[releaseId];
        saveLLTracks(userId, tracksMap);
      }
    } else {
      if (!supabase) return;
      if (isTrack) {
        const { data: listItem } = await supabase.from('list_items')
          .select('id')
          .eq('list_id', listId)
          .eq('release_id', releaseId)
          .maybeSingle();
        if (listItem) {
          await supabase.from('list_item_tracks').delete()
            .eq('list_item_id', listItem.id)
            .eq('track_position', trackPosition);
        }
      } else {
        await supabase.from('list_items').delete()
          .eq('list_id', listId).eq('release_id', releaseId);
      }
    }

    if (!isActive) return;
    if (isTrack) {
      setActiveTrackKeys(prev => { const n = new Set(prev); n.delete(`${releaseId}::${trackPosition}`); return n; });
    } else {
      setActiveReleaseIds(prev => { const n = new Set(prev); n.delete(releaseId); return n; });
      setActiveTrackKeys(prev => {
        const n = new Set(prev);
        const prefix = `${releaseId}::`;
        for (const k of [...n]) if (k.startsWith(prefix)) n.delete(k);
        return n;
      });
    }
    setPanelRefreshKey(k => k + 1);
  }, [activeListId, userId]);

  // Active-collection convenience wrappers (preserve existing call sites)
  const addToActive = useCallback((
    releaseId: string, title: string, artist: string, coverUrl?: string | null,
    trackTitle?: string, trackPosition?: number,
  ) => addItemTo(activeListId, releaseId, title, artist, coverUrl, trackTitle, trackPosition),
  [addItemTo, activeListId]);

  const removeFromActive = useCallback(
    (releaseId: string) => removeItemFrom(activeListId, releaseId),
    [removeItemFrom, activeListId]);

  const removeTrackFromActive = useCallback(
    (albumId: string, trackPosition: number) => removeItemFrom(activeListId, albumId, trackPosition),
    [removeItemFrom, activeListId]);

  return (
    <PlaylistContext.Provider
      value={{
        userId, playlists, activeListId, activeListName,
        setActiveListId, addToActive, removeFromActive, removeTrackFromActive,
        addItemTo, removeItemFrom, nameForList,
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
