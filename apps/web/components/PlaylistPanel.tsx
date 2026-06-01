'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  X, Plus, ChevronDown, Trash2, Edit2, Check,
  Share2, Clipboard, ExternalLink, Music2, ListMusic,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { usePlaylist } from './PlaylistContext';

const LL_KEY = 'sillajuku:listen-later';

interface TrackItem {
  trackId: string;
  title: string;
  position: number | null;
}

interface Album {
  id: string;
  listItemId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  tracks: TrackItem[];
}

function SpotifyIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={`flex-shrink-0 ${className}`}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

export default function PlaylistPanel() {
  const {
    userId, playlists, activeListId, activeListName,
    setActiveListId, refreshPlaylists, removeFromActive, removeTrackFromActive,
    panelOpen, setPanelOpen, panelRefreshKey,
  } = usePlaylist();

  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ url?: string; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const selectorRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Reset "has loaded" when switching lists so skeleton shows on first switch
  useEffect(() => { setHasLoaded(false); }, [activeListId]);

  const loadAlbums = useCallback(async () => {
    if (!panelOpen) return;
    setLoading(true);

    if (activeListId == null) {
      const ids = JSON.parse(localStorage.getItem(LL_KEY) ?? '[]') as string[];
      if (ids.length === 0) { setLoading(false); return; }
      if (!supabase) { setLoading(false); return; }
      const { data } = await supabase
        .from('releases')
        .select('id, title, artist, cover_url')
        .in('id', ids);
      if (data) {
        const map = new Map(data.map((r: any) => [r.id, r]));
        setAlbums(
          ids
            .map((id) => map.get(id))
            .filter(Boolean)
            .map((r: any) => ({ id: r.id, listItemId: '', title: r.title, artist: r.artist, coverUrl: r.cover_url ?? null, tracks: [] })),
        );
      }
    } else {
      if (!supabase) { setLoading(false); return; }
      const { data } = await supabase
        .from('list_items')
        .select('id, release_id, added_at, releases(id, title, artist, cover_url), list_item_tracks(id, track_title, track_position)')
        .eq('list_id', activeListId)
        .order('added_at', { ascending: false });
      if (data) {
        setAlbums(
          (data as any[])
            .filter((item) => item.releases)
            .map((item) => ({
              id: item.releases.id,
              listItemId: item.id,
              title: item.releases.title,
              artist: item.releases.artist,
              coverUrl: item.releases.cover_url ?? null,
              tracks: ((item.list_item_tracks ?? []) as any[])
                .sort((a, b) => (a.track_position ?? 0) - (b.track_position ?? 0))
                .map((t) => ({ trackId: t.id, title: t.track_title, position: t.track_position ?? null })),
            })),
        );
      }
    }
    setHasLoaded(true);
    setLoading(false);
  }, [activeListId, panelOpen]);

  useEffect(() => { void loadAlbums(); }, [loadAlbums, panelRefreshKey]);

  useEffect(() => {
    if (!userId || !supabase) return;
    supabase
      .from('spotify_connections')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => setSpotifyConnected(!!data));
  }, [userId]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) setShowSelector(false);
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) setShowContextMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const removeAlbum = async (releaseId: string) => {
    await removeFromActive(releaseId);
    setAlbums((prev) => prev.filter((a) => a.id !== releaseId));
  };

  const removeTrack = async (albumId: string, position: number | null) => {
    if (position == null) return;
    await removeTrackFromActive(albumId, position);
    setAlbums((prev) => prev.map((a) =>
      a.id === albumId
        ? { ...a, tracks: a.tracks.filter((t) => t.position !== position) }
        : a
    ));
  };

  const createList = async () => {
    if (!newListName.trim() || !userId || !supabase) return;
    setCreating(true);
    const { data } = await supabase
      .from('lists')
      .insert({ title: newListName.trim(), user_id: userId })
      .select('id, title')
      .single();
    if (data) {
      await refreshPlaylists();
      setActiveListId(data.id);
      setNewListName('');
      setShowCreateInput(false);
      setShowSelector(false);
    }
    setCreating(false);
  };

  const renameList = async () => {
    if (!editValue.trim() || !activeListId || !supabase) return;
    await supabase.from('lists').update({ title: editValue.trim() }).eq('id', activeListId);
    await refreshPlaylists();
    setEditingId(null);
    setShowContextMenu(false);
  };

  const deleteList = async () => {
    if (!activeListId || !supabase) return;
    await supabase.from('lists').delete().eq('id', activeListId);
    await refreshPlaylists();
    setActiveListId(null);
    setShowContextMenu(false);
  };

  const copyTracklist = () => {
    const text = albums.map((a) => `${a.title} — ${a.artist}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportToSpotify = async () => {
    if (!userId || !supabase) return;
    setExporting(true);
    setExportResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/spotify/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          playlistName: activeListName,
          albums: albums.map((a) => ({ title: a.title, artist: a.artist })),
        }),
      });
      const json = await res.json();
      if (json.url) {
        setExportResult({ url: json.url });
      } else {
        setExportResult({ error: json.error ?? 'Export failed' });
      }
    } catch {
      setExportResult({ error: 'Export failed' });
    }
    setExporting(false);
  };

  const connectSpotify = async () => {
    if (!supabase) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const res = await fetch('/api/spotify/auth', {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const { url } = await res.json();
    if (url) window.location.href = url;
  };

  // Closed on mobile — show floating toggle button
  if (!panelOpen) {
    return (
      <button
        onClick={() => setPanelOpen(true)}
        title="Open playlist panel"
        className="fixed right-4 bottom-6 z-30 xl:hidden bg-page border border-divider rounded-full w-10 h-10 flex items-center justify-center shadow-md text-muted hover:text-ink transition"
      >
        <ListMusic size={18} />
      </button>
    );
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-30 xl:hidden"
        onClick={() => setPanelOpen(false)}
      />

      <aside className="fixed xl:sticky top-[58px] right-0 h-[calc(100vh-58px)] w-[260px] flex-shrink-0 bg-page border-l border-divider z-40 xl:z-20 flex flex-col">
        {/* ── Header ── */}
        <div className="flex items-center gap-1.5 px-3 py-3 border-b border-divider min-h-[48px]">
          {/* List selector */}
          <div className="relative flex-1 min-w-0" ref={selectorRef}>
            <button
              onClick={() => setShowSelector((o) => !o)}
              className="flex items-center gap-1 w-full text-left"
            >
              <span className="text-[13px] font-bold text-ink truncate max-w-[150px]">{activeListName}</span>
              <ChevronDown size={13} className={`flex-shrink-0 text-muted transition-transform ${showSelector ? 'rotate-180' : ''}`} />
            </button>

            {showSelector && (
              <div className="absolute top-full left-0 mt-1.5 bg-page border border-divider rounded-xl shadow-lg z-50 w-[220px] py-1 max-h-[320px] overflow-y-auto">
                {/* Listen Later */}
                <button
                  onClick={() => { setActiveListId(null); setShowSelector(false); }}
                  className="flex items-center gap-2.5 w-full px-3 py-2.5 text-[13px] text-left hover:bg-surface transition"
                >
                  <span className="w-3 flex-shrink-0">
                    {activeListId == null && <Check size={12} className="text-mint-dark" />}
                  </span>
                  <span className={`truncate ${activeListId == null ? 'font-bold text-ink' : 'text-ink'}`}>
                    Listen Later
                  </span>
                </button>

                {playlists.length > 0 && <div className="mx-3 border-t border-divider my-1" />}

                {playlists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => { setActiveListId(pl.id); setShowSelector(false); }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 text-[13px] text-left hover:bg-surface transition"
                  >
                    <span className="w-3 flex-shrink-0">
                      {activeListId === pl.id && <Check size={12} className="text-mint-dark" />}
                    </span>
                    <span className={`truncate ${activeListId === pl.id ? 'font-bold text-ink' : 'text-ink'}`}>
                      {pl.title}
                    </span>
                  </button>
                ))}

                <div className="mx-3 border-t border-divider my-1" />

                {showCreateInput ? (
                  <div className="px-3 py-2 flex gap-2">
                    <input
                      type="text"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void createList();
                        if (e.key === 'Escape') setShowCreateInput(false);
                      }}
                      placeholder="Playlist name…"
                      autoFocus
                      className="flex-1 text-[12px] bg-surface rounded-lg px-2 py-1.5 border border-divider outline-none text-ink min-w-0"
                    />
                    <button
                      onClick={() => void createList()}
                      disabled={creating || !newListName.trim()}
                      className="text-[11px] font-semibold text-ink border border-divider rounded-lg px-2.5 py-1 hover:bg-surface transition disabled:opacity-40 flex-shrink-0"
                    >
                      {creating ? '…' : 'Add'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setShowCreateInput(true); }}
                    className="flex items-center gap-2 w-full px-3 py-2.5 text-[13px] text-muted hover:bg-surface hover:text-ink transition"
                  >
                    <Plus size={13} />
                    New playlist
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Link to full playlist page */}
          {activeListId && (
            <Link
              href={`/playlist/${activeListId}`}
              className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition flex-shrink-0"
              title="Open full playlist"
            >
              <ExternalLink size={14} />
            </Link>
          )}

          {/* Rename / delete for custom playlists */}
          {activeListId && (
            <div className="relative flex-shrink-0" ref={contextMenuRef}>
              <button
                onClick={() => {
                  setShowContextMenu((o) => !o);
                  if (editingId !== activeListId) {
                    setEditValue(playlists.find((p) => p.id === activeListId)?.title ?? '');
                    setEditingId(activeListId);
                  }
                }}
                className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition"
                title="Playlist options"
              >
                <Edit2 size={14} />
              </button>

              {showContextMenu && (
                <div className="absolute top-full right-0 mt-1 bg-page border border-divider rounded-xl shadow-lg z-50 py-2 w-[180px]">
                  <div className="px-3 pb-2">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void renameList(); if (e.key === 'Escape') setShowContextMenu(false); }}
                      autoFocus
                      className="w-full text-[12px] bg-surface rounded-lg px-2 py-1.5 border border-divider outline-none text-ink"
                    />
                    <button
                      onClick={() => void renameList()}
                      disabled={!editValue.trim()}
                      className="mt-2 w-full text-[12px] font-semibold text-ink border border-divider rounded-lg py-1.5 hover:bg-surface transition disabled:opacity-40"
                    >
                      Rename
                    </button>
                  </div>
                  <div className="mx-3 border-t border-divider mb-1" />
                  <button
                    onClick={() => { if (window.confirm('Delete this playlist?')) void deleteList(); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-red-500 hover:bg-surface transition"
                  >
                    <Trash2 size={13} />
                    Delete playlist
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Close on mobile */}
          <button
            onClick={() => setPanelOpen(false)}
            className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition xl:hidden flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto">
          {loading && !hasLoaded ? (
            <div className="flex flex-col gap-2 px-3 py-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-surface animate-pulse" />
              ))}
            </div>
          ) : albums.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 px-4 text-center">
              <Music2 size={28} className="text-subtle mb-3" />
              <p className="text-[13px] font-semibold text-ink">No albums yet</p>
              <p className="text-[12px] text-muted mt-1 leading-relaxed">
                Tap + on any album or track to add it here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col py-1">
              {albums.map((album) => (
                <div key={album.id} className="group/album">
                  {/* Album row */}
                  <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface transition">
                    <Link href={`/album/${album.id}`} className="flex items-center gap-2.5 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-md overflow-hidden bg-surface border border-divider flex-shrink-0">
                        {album.coverUrl ? (
                          <img src={album.coverUrl} alt={album.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-[#DDDDD8]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-ink truncate leading-tight">{album.title}</p>
                        <p className="text-[11px] text-muted truncate">{album.artist}</p>
                      </div>
                    </Link>
                    <button
                      onClick={() => void removeAlbum(album.id)}
                      title="Remove album"
                      className="flex-shrink-0 p-1 text-muted hover:text-red-500 transition opacity-0 group-hover/album:opacity-100"
                    >
                      <X size={13} />
                    </button>
                  </div>

                  {/* Track sub-items */}
                  {album.tracks.length > 0 && (
                    <div className="pl-[52px] pr-3 pb-1">
                      {album.tracks.map((track) => (
                        <div key={track.trackId} className="flex items-center gap-1.5 py-[3px] group/track">
                          <span className="text-[10px] text-[#AAAAAA] flex-shrink-0 tabular-nums w-4 text-right">
                            {track.position ?? '–'}
                          </span>
                          <span className="text-[11px] text-muted flex-1 truncate">{track.title}</span>
                          <button
                            onClick={() => void removeTrack(album.id, track.position)}
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

        {/* ── Footer: Export ── */}
        {albums.length > 0 && (
          <div className="border-t border-divider px-3 py-3">
            <button
              onClick={() => { setShowExportModal(true); setExportResult(null); }}
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-divider text-[13px] font-semibold text-ink hover:bg-surface transition"
            >
              <Share2 size={14} />
              Export
            </button>
          </div>
        )}
      </aside>

      {/* ── Export modal ── */}
      {showExportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowExportModal(false)}
        >
          <div
            className="bg-page rounded-2xl shadow-2xl w-full max-w-[380px] mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-divider">
              <p className="text-[15px] font-bold text-ink">Export "{activeListName}"</p>
              <button onClick={() => setShowExportModal(false)} className="text-muted hover:text-ink transition p-1">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-3">
              {/* Copy tracklist */}
              <button
                onClick={copyTracklist}
                className="flex items-center gap-3 px-4 py-3.5 border border-divider rounded-xl hover:bg-surface transition text-left"
              >
                <Clipboard size={16} className="text-muted flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink">{copied ? '✓ Copied!' : 'Copy tracklist'}</p>
                  <p className="text-[11px] text-muted mt-0.5">Album · Artist, one per line</p>
                </div>
              </button>

              {/* Spotify export */}
              {spotifyConnected ? (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => void exportToSpotify()}
                    disabled={exporting}
                    className="flex items-center gap-3 px-4 py-3.5 border border-divider rounded-xl hover:bg-surface transition text-left disabled:opacity-50"
                  >
                    <SpotifyIcon size={16} className="text-[#1DB954]" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink">
                        {exporting ? 'Creating playlist…' : 'Export to Spotify'}
                      </p>
                      <p className="text-[11px] text-muted mt-0.5">Creates a Spotify playlist with matched tracks</p>
                    </div>
                  </button>
                  {exportResult?.url && (
                    <a
                      href={exportResult.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2.5 bg-[#1DB954]/10 rounded-xl text-[13px] font-semibold text-[#1DB954] hover:bg-[#1DB954]/20 transition"
                    >
                      <ExternalLink size={13} />
                      Open in Spotify
                    </a>
                  )}
                  {exportResult?.error && (
                    <p className="px-1 text-[12px] text-red-500">{exportResult.error}</p>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => void connectSpotify()}
                  className="flex items-center gap-3 px-4 py-3.5 border border-divider rounded-xl hover:bg-surface transition text-left"
                >
                  <SpotifyIcon size={16} className="text-[#1DB954]" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-ink">Connect Spotify</p>
                    <p className="text-[11px] text-muted mt-0.5">Required to create playlists on Spotify</p>
                  </div>
                </button>
              )}

              {/* YouTube Music: no write API */}
              <div className="flex items-start gap-3 px-4 py-3.5 border border-divider rounded-xl bg-surface">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-px text-[#FF0000]">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
                  <polygon points="10.5,9.5 15.5,12 10.5,14.5" fill="currentColor" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink">YouTube Music</p>
                  <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
                    No public write API exists. Use "Copy tracklist" to paste manually, or search each album in the app.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
