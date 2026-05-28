'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import InlineStarRating from './InlineStarRating';

export interface RankedAlbum {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
}

interface Props {
  categoryId: string;
  categoryTitle: string;
  slug: string;
  initialSuggestions: RankedAlbum[];
  filterYear?: number | null;
  filterGenre?: string | null;
  filterCountry?: string | null;
  prefillAlbum?: RankedAlbum | null;
}

const SUGGESTION_COUNT = 30;
const MAX_TIER_SIZE = 5;

function coverColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  return `hsl(${Math.abs(h) % 360}, 30%, 52%)`;
}

type DragTarget =
  | { type: 'tier'; index: number }
  | { type: 'zone'; index: number }
  | { type: 'addTier' }
  | null;

export default function RankBuilder({ categoryId, categoryTitle, slug, initialSuggestions, filterYear, filterGenre, filterCountry, prefillAlbum }: Props) {
  const router = useRouter();
  const [ranking, setRanking] = useState<RankedAlbum[][]>([[], [], []]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RankedAlbum[]>([]);
  const [searching, setSearching] = useState(false);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; visible: boolean }>({ msg: '', visible: false });
  const [userId, setUserId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [savedRanking, setSavedRanking] = useState<RankedAlbum[][]>([[], [], []]);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; album: RankedAlbum } | null>(null);
  const [autoPopulating, setAutoPopulating] = useState(false);

  const draggedRef = useRef<{ album: RankedAlbum; fromTier: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load user + existing ranking
  useEffect(() => {
    if (!supabase) {
      if (prefillAlbum) setRanking([[prefillAlbum], [], []]);
      setLoaded(true);
      return;
    }
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      let tiers: RankedAlbum[][] = [[], [], []];
      if (uid) {
        const res = await fetch(`/api/rankings/user-ranking?categoryId=${categoryId}&userId=${uid}`);
        const json = await res.json();
        if (json.tiers?.length) tiers = json.tiers;
      }
      setSavedRanking(tiers.map(t => [...t]));
      if (prefillAlbum && !tiers.flat().some((a: RankedAlbum) => a.id === prefillAlbum.id)) {
        const emptyIdx = tiers.findIndex((t: RankedAlbum[]) => t.length === 0);
        if (emptyIdx >= 0) {
          tiers = tiers.map((t: RankedAlbum[], i: number) => i === emptyIdx ? [prefillAlbum] : t);
        } else {
          tiers = [...tiers, [prefillAlbum]];
        }
      }
      setRanking(tiers);
      setLoaded(true);
    });
  }, [categoryId]);

  // Warn on browser-level navigation (refresh / close tab) when dirty
  useEffect(() => {
    const isDirty = JSON.stringify(ranking.map(t => t.map(a => a.id))) !== JSON.stringify(savedRanking.map(t => t.map(a => a.id)));
    if (!loaded || !userId || !isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [ranking, savedRanking, loaded, userId]);

  // Ghost follows cursor globally during drag
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (!ghostRef.current || ghostRef.current.style.display === 'none') return;
      ghostRef.current.style.left = e.clientX - 32 + 'px';
      ghostRef.current.style.top = e.clientY - 32 + 'px';
    };
    document.addEventListener('dragover', onDragOver);
    return () => document.removeEventListener('dragover', onDragOver);
  }, []);

  // Close context menu on any click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  // Search debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ query: query.trim() });
        if (filterYear) params.set('year', String(filterYear));
        if (filterCountry) params.set('market', filterCountry);
        const res = await fetch(`/api/search?${params}`);
        const json = await res.json();
        setSearchResults((json.releases ?? []).map((r: any) => ({
          id: r.id, title: r.title, artist: r.artist, coverUrl: r.coverUrl ?? null,
        })));
      } catch (err) {
        console.error('[RankBuilder] search failed:', err);
      }
      setSearching(false);
    }, 350);
  }, [query]);

  function showToast(msg: string) {
    setToast({ msg, visible: true });
    setTimeout(() => setToast(t => ({ ...t, visible: false })), 2000);
  }

  // ── Drag start helpers ──
  function startDrag(e: React.DragEvent, album: RankedAlbum, fromTier: number) {
    draggedRef.current = { album, fromTier };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', album.id);
    // Hide native ghost, use custom one
    const blank = new Image();
    blank.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(blank, 0, 0);
    if (ghostRef.current) {
      ghostRef.current.style.display = 'block';
      ghostRef.current.style.left = e.clientX - 32 + 'px';
      ghostRef.current.style.top = e.clientY - 32 + 'px';
      ghostRef.current.style.background = album.coverUrl ? 'transparent' : coverColor(album.id);
      ghostRef.current.innerHTML = album.coverUrl
        ? `<img src="${album.coverUrl}" style="width:64px;height:64px;border-radius:6px;object-fit:cover;border:2px solid #E8A020;display:block;" />`
        : `<div style="width:64px;height:64px;border-radius:6px;background:${coverColor(album.id)};border:2px solid #E8A020;"></div>`;
    }
  }

  function endDrag() {
    draggedRef.current = null;
    setDragTarget(null);
    if (ghostRef.current) ghostRef.current.style.display = 'none';
  }

  // ── Drop logic ──
  function handleDrop(toIndex: number, mode: 'into' | 'between' | 'addTier') {
    const dragged = draggedRef.current;
    if (!dragged) return;
    const { album, fromTier } = dragged;

    if (mode === 'into') {
      const tierSize = ranking[toIndex]?.length ?? 0;
      const willStay = fromTier === toIndex;
      if (!willStay && tierSize >= MAX_TIER_SIZE) {
        showToast('Max 5 albums per tier');
        return;
      }
    }

    if (ghostRef.current) ghostRef.current.style.display = 'none';

    setRanking(prev => {
      const next = prev.map(t => [...t]);

      if (fromTier >= 0) {
        next[fromTier] = next[fromTier].filter(a => a.id !== album.id);
      }

      if (mode === 'into') {
        if (fromTier === toIndex && prev[toIndex].some(a => a.id === album.id)) return prev;
        next[toIndex] = [...next[toIndex], album];
        return next.filter(t => t.length > 0);
      } else if (mode === 'between') {
        next.splice(toIndex, 0, [album]);
        return next.filter(t => t.length > 0);
      } else {
        const cleaned = next.filter(t => t.length > 0);
        return [...cleaned, [album]];
      }
    });

    setDragTarget(null);
  }

  function removeAlbum(tierIdx: number, albumIdx: number) {
    setRanking(prev => {
      const next = prev.map(t => [...t]);
      next[tierIdx].splice(albumIdx, 1);
      return next;
    });
  }

  function addFromClick(album: RankedAlbum) {
    setRanking(prev => {
      const next = prev.map(t => [...t]);
      const emptyIdx = next.findIndex(t => t.length === 0);
      if (emptyIdx >= 0) { next[emptyIdx] = [album]; return next; }
      return [...next, [album]];
    });
  }

  function dismissAlbum(album: RankedAlbum) {
    setDismissed(prev => new Set([...prev, album.id]));
  }

  // ── Auto-populate from ratings ──
  // Maps score bands to tier index: 5→0, 4-4.5→1, 3-3.5→2, 2-2.5→3, 0.5-1.5→4
  async function autoPopulate() {
    if (!userId || !supabase) { showToast('Sign in to use this feature'); return; }
    setAutoPopulating(true);
    try {
      const { data } = await supabase
        .from('ratings')
        .select('release_id, score, releases(id, title, artist, cover_url, release_date, release_type)')
        .eq('user_id', userId)
        .not('score', 'is', null)
        .order('score', { ascending: false });

      if (!data || data.length === 0) { showToast('No ratings found'); setAutoPopulating(false); return; }

      // Filter by category constraints if set
      let filtered = data.filter((r: any) => r.releases).map((r: any) => ({
        album: { id: r.releases.id, title: r.releases.title, artist: r.releases.artist, coverUrl: r.releases.cover_url } as RankedAlbum,
        score: r.score as number,
        date: r.releases.release_date as string | null,
        type: r.releases.release_type as string | null,
      }));

      if (filterYear) filtered = filtered.filter(r => r.date?.startsWith(String(filterYear)));
      if (filterGenre && filterGenre !== 'All Genres') {
        // loose filter: just use whatever we have (genre data not on rating rows)
      }

      if (filtered.length === 0) { showToast('No matching rated albums for this category'); setAutoPopulating(false); return; }

      // Build tiers by score band
      const tierMap = new Map<number, RankedAlbum[]>();
      for (const { album, score } of filtered) {
        const tierIdx = score >= 5 ? 0 : score >= 4 ? 1 : score >= 3 ? 2 : score >= 2 ? 3 : 4;
        if (!tierMap.has(tierIdx)) tierMap.set(tierIdx, []);
        const tier = tierMap.get(tierIdx)!;
        if (tier.length < MAX_TIER_SIZE) tier.push(album);
      }

      // Build dense tiers (skip empty bands)
      const newTiers: RankedAlbum[][] = [];
      for (let i = 0; i <= 4; i++) {
        if (tierMap.has(i)) newTiers.push(tierMap.get(i)!);
      }

      setRanking(newTiers.length > 0 ? newTiers : [[], [], []]);
      showToast(`Loaded ${filtered.length > 25 ? '25' : filtered.length} rated albums into tiers`);
    } catch {
      showToast('Failed to load ratings');
    }
    setAutoPopulating(false);
  }

  // ── Save ──
  async function save() {
    if (!userId) { showToast('Sign in to save your ranking'); return; }
    setSaving(true);
    const entries = ranking.flatMap((tier, i) =>
      tier.map(a => ({ releaseId: a.id, rank: i + 1, title: a.title, artist: a.artist, coverUrl: a.coverUrl }))
    );
    try {
      const res = await fetch('/api/rankings/user-ranking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, categoryId, entries }),
      });
      if (res.ok) {
        setSavedRanking(ranking.map(t => [...t]));
        showToast('Ranking saved');
        router.refresh();
      } else {
        showToast('Failed to save');
      }
    } catch { showToast('Failed to save'); }
    setSaving(false);
  }

  const usedIds = new Set(ranking.flat().map(a => a.id));
  const visible = initialSuggestions.filter(a => !dismissed.has(a.id) && !usedIds.has(a.id)).slice(0, SUGGESTION_COUNT);

  const isDirty = loaded && !!userId &&
    JSON.stringify(ranking.map(t => t.map(a => a.id))) !== JSON.stringify(savedRanking.map(t => t.map(a => a.id)));

  function tryNavigate(href: string) {
    if (isDirty) { setPendingHref(href); setShowLeaveModal(true); }
    else router.push(href);
  }

  if (!loaded) return null;

  return (
    <>
      {/* Custom drag ghost */}
      <div
        ref={ghostRef}
        style={{
          position: 'fixed', zIndex: 9999, pointerEvents: 'none',
          display: 'none', transform: 'rotate(3deg)',
          borderRadius: 6, boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      />

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgb(var(--color-page))', borderBottom: '1px solid rgb(var(--color-divider))',
        padding: '0 24px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <button onClick={() => tryNavigate(`/rankings/${slug}`)} style={{ fontSize: 12, color: 'rgb(var(--color-muted))', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Rankings
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {userId && (
            <button
              onClick={autoPopulate}
              disabled={autoPopulating}
              title="Auto-fill tiers from your rated albums"
              style={{
                background: 'rgb(var(--color-surface))', color: 'rgb(var(--color-muted))',
                border: '1px solid rgb(var(--color-divider))',
                fontSize: 11, fontWeight: 600,
                padding: '7px 14px', borderRadius: 8, cursor: autoPopulating ? 'not-allowed' : 'pointer',
                opacity: autoPopulating ? 0.5 : 1, transition: 'opacity 0.15s',
              }}
            >
              {autoPopulating ? 'Loading…' : '★ Fill from ratings'}
            </button>
          )}
          <button
            onClick={save}
            disabled={saving}
            style={{
              background: 'rgb(var(--color-ink))', color: 'rgb(var(--color-page))', border: 'none',
              fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
              padding: '8px 20px', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.5 : 1, transition: 'opacity 0.15s',
            }}
          >
            {saving ? 'Saving…' : 'Save Ranking'}
          </button>
        </div>
      </header>

      {/* Body */}
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 520px', minHeight: 'calc(100vh - 56px)' }}>

        {/* LEFT: Builder */}
        <div style={{ borderRight: '1px solid rgb(var(--color-divider))', padding: '32px 28px 80px', position: 'relative' }}>
          <div style={{
            position: 'sticky', top: 56, zIndex: 50,
            background: 'rgb(var(--color-page))', margin: '-32px -28px 24px', padding: '24px 28px 16px',
            borderBottom: '1px solid rgb(var(--color-divider))',
          }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.8px', lineHeight: 1.05 }}>{categoryTitle}</h1>
            <p style={{ fontSize: 13, color: 'rgb(var(--color-muted))', marginTop: 6 }}>Drag albums to rank. Drop between slots to create a new tier.</p>
          </div>

          <div>
            {ranking.map((tier, tierIdx) => (
              <div key={tierIdx}>
                {/* Drop zone above each tier */}
                <div
                  onDragOver={e => { if (!draggedRef.current) return; e.preventDefault(); setDragTarget({ type: 'zone', index: tierIdx }); }}
                  onDragLeave={() => setDragTarget(null)}
                  onDrop={e => { e.preventDefault(); handleDrop(tierIdx, 'between'); }}
                  style={{
                    height: dragTarget?.type === 'zone' && dragTarget.index === tierIdx ? 48 : 8,
                    margin: '-4px 0',
                    borderRadius: 4,
                    background: dragTarget?.type === 'zone' && dragTarget.index === tierIdx ? 'rgb(var(--color-surface))' : 'transparent',
                    boxShadow: dragTarget?.type === 'zone' && dragTarget.index === tierIdx ? 'inset 0 0 0 2px #E8A020' : 'none',
                    transition: 'height 0.15s, background 0.15s',
                    position: 'relative', zIndex: 5,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {dragTarget?.type === 'zone' && dragTarget.index === tierIdx && (
                    <span style={{
                      position: 'absolute', left: 64, fontSize: 11, fontWeight: 600,
                      color: '#7A4F0A', background: '#E8A020', padding: '2px 10px', borderRadius: 4,
                    }}>New rank</span>
                  )}
                </div>

                {/* Tier row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '14px 0', borderBottom: '1px solid rgb(var(--color-divider))' }}>
                  {/* Rank number */}
                  <div style={{
                    flexShrink: 0, width: 48, textAlign: 'right',
                    fontSize: 32, fontWeight: 800,
                    color: tier.length === 0 ? 'rgb(var(--color-divider))' : tier.length > 1 ? 'rgb(var(--color-muted))' : 'rgb(var(--color-mid))',
                    lineHeight: 1, paddingTop: 10, userSelect: 'none', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {tierIdx + 1}
                  </div>

                  {/* Tier body — drop target */}
                  <div
                    onDragOver={e => { if (!draggedRef.current) return; e.preventDefault(); if (tier.length < MAX_TIER_SIZE) setDragTarget({ type: 'tier', index: tierIdx }); }}
                    onDragLeave={() => setDragTarget(null)}
                    onDrop={e => { e.preventDefault(); handleDrop(tierIdx, 'into'); }}
                    style={{
                      flex: 1, minWidth: 0,
                      display: 'flex', flexWrap: 'wrap', gap: 10,
                      minHeight: 64, padding: 4, borderRadius: 10,
                      background: dragTarget?.type === 'tier' && dragTarget.index === tierIdx ? 'rgb(var(--color-surface))' : 'transparent',
                      boxShadow: dragTarget?.type === 'tier' && dragTarget.index === tierIdx ? 'inset 0 0 0 2px #E8A020' : 'none',
                      transition: 'background 0.15s, box-shadow 0.15s',
                    }}
                  >
                    {tier.length === 0 && (
                      <div style={{
                        width: '100%', fontSize: 12, color: 'rgb(var(--color-placeholder))',
                        padding: '20px 12px', border: '1.5px dashed rgb(var(--color-divider))',
                        borderRadius: 8, textAlign: 'center', pointerEvents: 'none',
                      }}>
                        Drop album here
                      </div>
                    )}
                    {tier.map((album, albumIdx) => (
                      <AlbumCard
                        key={album.id}
                        album={album}
                        onDragStart={e => startDrag(e, album, tierIdx)}
                        onDragEnd={endDrag}
                        onRemove={() => removeAlbum(tierIdx, albumIdx)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            ))}

            {/* Final drop zone */}
            <div
              onDragOver={e => { if (!draggedRef.current) return; e.preventDefault(); setDragTarget({ type: 'zone', index: ranking.length }); }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={e => { e.preventDefault(); handleDrop(ranking.length, 'between'); }}
              style={{
                height: dragTarget?.type === 'zone' && dragTarget.index === ranking.length ? 48 : 8,
                borderRadius: 4,
                background: dragTarget?.type === 'zone' && dragTarget.index === ranking.length ? 'rgb(var(--color-surface))' : 'transparent',
                boxShadow: dragTarget?.type === 'zone' && dragTarget.index === ranking.length ? 'inset 0 0 0 2px #E8A020' : 'none',
                transition: 'height 0.15s',
                position: 'relative',
              }}
            >
              {dragTarget?.type === 'zone' && dragTarget.index === ranking.length && (
                <span style={{
                  position: 'absolute', left: 64, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 11, fontWeight: 600, color: '#7A4F0A', background: '#E8A020', padding: '2px 10px', borderRadius: 4,
                }}>New rank</span>
              )}
            </div>
          </div>

          {/* Add Tier */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0', marginTop: 4 }}>
            <button
              onClick={() => setRanking(prev => [...prev, []])}
              onDragOver={e => { if (!draggedRef.current) return; e.preventDefault(); setDragTarget({ type: 'addTier' }); }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={e => { e.preventDefault(); handleDrop(ranking.length, 'addTier'); }}
              style={{
                fontSize: 12, fontWeight: 600,
                color: dragTarget?.type === 'addTier' ? '#7A4F0A' : '#C0C0BE',
                background: dragTarget?.type === 'addTier' ? 'rgba(232,160,32,0.1)' : 'none',
                border: `1.5px dashed ${dragTarget?.type === 'addTier' ? '#E8A020' : '#EBEBEB'}`,
                padding: '8px 24px', borderRadius: 8, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              + Add Tier
            </button>
          </div>
        </div>

        {/* RIGHT: Picker */}
        <div className="h-[calc(100vh-120px)] xl:h-[calc(100vh-56px)]" style={{ background: 'rgb(var(--color-page))', padding: 24, position: 'sticky', top: 56, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Search */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'rgb(var(--color-page))', paddingBottom: 16 }}>
            <input
              type="text"
              placeholder="Search for an album…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%', background: 'rgb(var(--color-surface))', border: '1px solid rgb(var(--color-divider))',
                borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'rgb(var(--color-ink))',
                outline: 'none', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = '#111')}
              onBlur={e => (e.target.style.borderColor = '#EBEBEB')}
            />
            {searching && <p style={{ fontSize: 11, color: 'rgb(var(--color-muted))', marginTop: 6 }}>Searching…</p>}
          </div>

          {(filterYear || filterGenre) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {filterYear && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#7A4F0A', background: '#E8A020', padding: '2px 8px', borderRadius: 4 }}>
                  {filterYear} only
                </span>
              )}
              {filterGenre && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'rgb(var(--color-mid))', background: 'rgb(var(--color-surface))', padding: '2px 8px', borderRadius: 4 }}>
                  {filterGenre}
                </span>
              )}
            </div>
          )}

          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgb(var(--color-muted))', margin: '8px 0 12px' }}>
            {query.trim() ? 'Results' : 'Suggested'}
          </p>

          {(query.trim() ? searchResults.length === 0 && !searching : visible.length === 0) && (
            <p style={{ fontSize: 12, color: 'rgb(var(--color-placeholder))', textAlign: 'center', padding: '32px 0' }}>
              {query.trim() ? 'No albums found.' : 'All suggested albums added or dismissed.'}
            </p>
          )}

          {query.trim() ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {searchResults.map(album => {
                const isAdded = usedIds.has(album.id);
                return (
                  <SuggestedCard
                    key={album.id}
                    album={album}
                    isAdded={isAdded}
                    onClick={() => !isAdded && addFromClick(album)}
                    onDragStart={e => !isAdded && startDrag(e, album, -1)}
                    onDragEnd={endDrag}
                  />
                );
              })}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 }}>
              {visible.map(album => (
                <SuggestionCard
                  key={album.id}
                  album={album}
                  onContextMenu={(e, a) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, album: a }); }}
                  onDragStart={e => startDrag(e, album, -1)}
                  onDragEnd={endDrag}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      <div style={{
        position: 'fixed', bottom: 24, left: '50%',
        transform: `translateX(-50%) translateY(${toast.visible ? 0 : 20}px)`,
        background: 'rgb(var(--color-ink))', color: 'rgb(var(--color-page))', fontSize: 12, fontWeight: 600,
        padding: '10px 24px', borderRadius: 10, zIndex: 200,
        opacity: toast.visible ? 1 : 0, transition: 'all 0.3s', pointerEvents: 'none',
      }}>
        {toast.msg}
      </div>

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', zIndex: 800,
            left: contextMenu.x, top: contextMenu.y,
            background: 'rgb(var(--color-page))', border: '1px solid rgb(var(--color-divider))',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            minWidth: 160, overflow: 'hidden',
          }}
        >
          <button
            onClick={() => { addFromClick(contextMenu.album); setContextMenu(null); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: 'rgb(var(--color-ink))', background: 'none', border: 'none', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgb(var(--color-surface))')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            Add to ranking
          </button>
          <button
            onClick={() => { dismissAlbum(contextMenu.album); setContextMenu(null); }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', fontSize: 12, fontWeight: 600, color: 'rgb(var(--color-muted))', background: 'none', border: 'none', cursor: 'pointer', borderTop: '1px solid rgb(var(--color-divider))' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgb(var(--color-surface))')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            Skip
          </button>
        </div>
      )}

      {/* Leave confirmation modal */}
      {showLeaveModal && (
        <div
          onClick={() => setShowLeaveModal(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'rgb(var(--color-page))', borderRadius: 16, padding: '32px 28px', maxWidth: 380, width: '100%', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'rgb(var(--color-ink))', margin: '0 0 8px' }}>Save changes?</h2>
            <p style={{ fontSize: 14, color: 'rgb(var(--color-muted))', lineHeight: 1.55, margin: '0 0 28px' }}>
              Your ranking has unsaved changes.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button
                disabled={saving}
                onClick={async () => {
                  await save();
                  setShowLeaveModal(false);
                  if (pendingHref) router.push(pendingHref);
                }}
                style={{ background: 'rgb(var(--color-ink))', color: 'rgb(var(--color-page))', border: 'none', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.5 : 1, transition: 'opacity 0.15s' }}
              >{saving ? 'Saving…' : 'Save & Leave'}</button>
              <button
                onClick={() => { setShowLeaveModal(false); if (pendingHref) router.push(pendingHref); }}
                style={{ background: 'rgb(var(--color-surface))', color: 'rgb(var(--color-mid))', border: 'none', borderRadius: 10, padding: '12px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >Leave without saving</button>
              <button
                onClick={() => setShowLeaveModal(false)}
                style={{ background: 'none', color: 'rgb(var(--color-muted))', border: 'none', padding: '8px', fontSize: 13, fontWeight: 500, cursor: 'pointer' }}
              >Stay on page</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function AlbumCard({ album, onDragStart, onDragEnd, onRemove }: {
  album: RankedAlbum;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRemove: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      draggable
      onDragStart={e => { setDragging(true); onDragStart(e); }}
      onDragEnd={() => { setDragging(false); onDragEnd(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', width: 64, flexShrink: 0, cursor: 'grab', userSelect: 'none', opacity: dragging ? 0.3 : 1, transition: 'opacity 0.15s' }}
    >
      <div style={{ width: 64, height: 64, borderRadius: 6, overflow: 'hidden', border: '1px solid rgb(var(--color-divider))', background: coverColor(album.id) }}>
        {album.coverUrl
          ? <img src={album.coverUrl} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{album.title.slice(0, 2)}</div>
        }
      </div>
      <div style={{ marginTop: 5 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'rgb(var(--color-ink))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{album.title}</div>
        <div style={{ fontSize: 9, color: 'rgb(var(--color-muted))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2, marginTop: 1 }}>{album.artist}</div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        style={{
          position: 'absolute', top: -6, right: -6, zIndex: 10,
          width: 18, height: 18, borderRadius: '50%',
          background: 'rgb(var(--color-page))', border: '1px solid rgb(var(--color-divider))',
          color: 'rgb(var(--color-muted))', fontSize: 14, lineHeight: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
          padding: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

function SuggestionCard({ album, onContextMenu, onDragStart, onDragEnd }: {
  album: RankedAlbum;
  onContextMenu: (e: React.MouseEvent, album: RankedAlbum) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 3 }}
      onContextMenu={e => onContextMenu(e, album)}
    >
      <div
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', background: coverColor(album.id), border: '1px solid rgb(var(--color-divider))', cursor: 'grab' }}
      >
        {album.coverUrl
          ? <img src={album.coverUrl} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{album.title.slice(0, 2)}</div>
        }
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'rgb(var(--color-ink))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{album.title}</div>
      <div style={{ fontSize: 9, color: 'rgb(var(--color-muted))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{album.artist}</div>
    </div>
  );
}

function SuggestedCard({ album, isAdded, onClick, onDragStart, onDragEnd }: {
  album: RankedAlbum;
  isAdded: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      draggable={!isAdded}
      onClick={onClick}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => !isAdded && setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', cursor: isAdded ? 'default' : 'pointer', transform: hovered ? 'translateY(-2px)' : 'none', transition: 'transform 0.15s' }}
    >
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: coverColor(album.id), border: '1px solid rgb(var(--color-divider))', opacity: isAdded ? 0.5 : 1 }}>
        {album.coverUrl
          ? <img src={album.coverUrl} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{album.title.slice(0, 2)}</div>
        }
        {/* Hover/added overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: isAdded ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: isAdded || hovered ? 1 : 0,
          transition: 'opacity 0.15s', borderRadius: 8,
        }}>
          <span style={{
            fontSize: 11, fontWeight: 700,
            background: isAdded ? 'rgb(var(--color-surface))' : '#E8A020',
            color: isAdded ? 'rgb(var(--color-muted))' : '#7A4F0A',
            padding: '4px 12px', borderRadius: 6,
          }}>
            {isAdded ? 'Added' : 'Add'}
          </span>
        </div>
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgb(var(--color-ink))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</div>
        <div style={{ fontSize: 10, color: 'rgb(var(--color-muted))', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{album.artist}</div>
        <div style={{ marginTop: 4 }} onClick={e => e.stopPropagation()}>
          <InlineStarRating
            releaseId={album.id}
            releaseTitle={album.title}
            releaseArtist={album.artist}
            releaseDate={null}
            releaseCountry={null}
            releaseType="Album"
            coverUrl={album.coverUrl}
            size={12}
          />
        </div>
      </div>
    </div>
  );
}
