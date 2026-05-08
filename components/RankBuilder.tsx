'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

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
  prefillAlbum?: RankedAlbum | null;
}

const POOL_SIZE = 8;
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

export default function RankBuilder({ categoryId, categoryTitle, slug, initialSuggestions, filterYear, filterGenre, prefillAlbum }: Props) {
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

  // Search debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ query: query.trim() });
        if (filterYear) params.set('year', String(filterYear));
        const res = await fetch(`/api/search?${params}`);
        const json = await res.json();
        setSearchResults((json.releases ?? []).map((r: any) => ({
          id: r.id, title: r.title, artist: r.artist, coverUrl: r.coverUrl ?? null,
        })));
      } catch {}
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
        ? `<img src="${album.coverUrl}" style="width:64px;height:64px;border-radius:6px;object-fit:cover;border:2px solid #3DFFD1;display:block;" />`
        : `<div style="width:64px;height:64px;border-radius:6px;background:${coverColor(album.id)};border:2px solid #3DFFD1;"></div>`;
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
      showToast(res.ok ? 'Ranking saved' : 'Failed to save');
      if (res.ok) router.refresh();
    } catch { showToast('Failed to save'); }
    setSaving(false);
  }

  const usedIds = new Set(ranking.flat().map(a => a.id));
  const pool = query.trim()
    ? searchResults
    : initialSuggestions.filter(a => !usedIds.has(a.id)).slice(0, POOL_SIZE);

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
        background: '#fff', borderBottom: '1px solid #EBEBEB',
        padding: '0 24px', height: 56,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Link href={`/rankings/${slug}`} style={{ fontSize: 12, color: '#888', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Rankings
        </Link>
        <button
          onClick={save}
          disabled={saving}
          style={{
            background: '#111', color: '#fff', border: 'none',
            fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
            padding: '8px 20px', borderRadius: 8, cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.5 : 1, transition: 'opacity 0.15s',
          }}
        >
          {saving ? 'Saving…' : 'Save Ranking'}
        </button>
      </header>

      {/* Body */}
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 380px', minHeight: 'calc(100vh - 56px)' }}>

        {/* LEFT: Builder */}
        <div style={{ borderRight: '1px solid #EBEBEB', padding: '32px 28px 80px', position: 'relative' }}>
          <div style={{
            position: 'sticky', top: 56, zIndex: 50,
            background: '#fff', margin: '-32px -28px 24px', padding: '24px 28px 16px',
            borderBottom: '1px solid #EBEBEB',
          }}>
            <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.8px', lineHeight: 1.05 }}>{categoryTitle}</h1>
            <p style={{ fontSize: 13, color: '#888', marginTop: 6 }}>Drag albums to rank. Drop between slots to create a new tier.</p>
          </div>

          <div>
            {ranking.map((tier, tierIdx) => (
              <div key={tierIdx}>
                {/* Drop zone above each tier */}
                <div
                  onDragOver={e => { e.preventDefault(); setDragTarget({ type: 'zone', index: tierIdx }); }}
                  onDragLeave={() => setDragTarget(null)}
                  onDrop={e => { e.preventDefault(); handleDrop(tierIdx, 'between'); }}
                  style={{
                    height: dragTarget?.type === 'zone' && dragTarget.index === tierIdx ? 48 : 8,
                    margin: '-4px 0',
                    borderRadius: 4,
                    background: dragTarget?.type === 'zone' && dragTarget.index === tierIdx ? '#F7F7F5' : 'transparent',
                    boxShadow: dragTarget?.type === 'zone' && dragTarget.index === tierIdx ? 'inset 0 0 0 2px #3DFFD1' : 'none',
                    transition: 'height 0.15s, background 0.15s',
                    position: 'relative', zIndex: 5,
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {dragTarget?.type === 'zone' && dragTarget.index === tierIdx && (
                    <span style={{
                      position: 'absolute', left: 64, fontSize: 11, fontWeight: 600,
                      color: '#00453A', background: '#3DFFD1', padding: '2px 10px', borderRadius: 4,
                    }}>New rank</span>
                  )}
                </div>

                {/* Tier row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '14px 0', borderBottom: '1px solid #EBEBEB' }}>
                  {/* Rank number */}
                  <div style={{
                    flexShrink: 0, width: 48, textAlign: 'right',
                    fontSize: 32, fontWeight: 800,
                    color: tier.length === 0 ? '#EBEBEB' : tier.length > 1 ? '#888' : '#444',
                    lineHeight: 1, paddingTop: 10, userSelect: 'none', fontVariantNumeric: 'tabular-nums',
                  }}>
                    {tierIdx + 1}
                  </div>

                  {/* Tier body — drop target */}
                  <div
                    onDragOver={e => { e.preventDefault(); if (tier.length < MAX_TIER_SIZE) setDragTarget({ type: 'tier', index: tierIdx }); }}
                    onDragLeave={() => setDragTarget(null)}
                    onDrop={e => { e.preventDefault(); handleDrop(tierIdx, 'into'); }}
                    style={{
                      flex: 1, minWidth: 0,
                      display: 'flex', flexWrap: 'wrap', gap: 10,
                      minHeight: 64, padding: 4, borderRadius: 10,
                      background: dragTarget?.type === 'tier' && dragTarget.index === tierIdx ? '#F7F7F5' : 'transparent',
                      boxShadow: dragTarget?.type === 'tier' && dragTarget.index === tierIdx ? 'inset 0 0 0 2px #3DFFD1' : 'none',
                      transition: 'background 0.15s, box-shadow 0.15s',
                    }}
                  >
                    {tier.length === 0 && (
                      <div style={{
                        width: '100%', fontSize: 12, color: '#C0C0BE',
                        padding: '20px 12px', border: '1.5px dashed #EBEBEB',
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
              onDragOver={e => { e.preventDefault(); setDragTarget({ type: 'zone', index: ranking.length }); }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={e => { e.preventDefault(); handleDrop(ranking.length, 'between'); }}
              style={{
                height: dragTarget?.type === 'zone' && dragTarget.index === ranking.length ? 48 : 8,
                borderRadius: 4,
                background: dragTarget?.type === 'zone' && dragTarget.index === ranking.length ? '#F7F7F5' : 'transparent',
                boxShadow: dragTarget?.type === 'zone' && dragTarget.index === ranking.length ? 'inset 0 0 0 2px #3DFFD1' : 'none',
                transition: 'height 0.15s',
                position: 'relative',
              }}
            >
              {dragTarget?.type === 'zone' && dragTarget.index === ranking.length && (
                <span style={{
                  position: 'absolute', left: 64, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 11, fontWeight: 600, color: '#00453A', background: '#3DFFD1', padding: '2px 10px', borderRadius: 4,
                }}>New rank</span>
              )}
            </div>
          </div>

          {/* Add Tier */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0', marginTop: 4 }}>
            <button
              onClick={() => setRanking(prev => [...prev, []])}
              onDragOver={e => { e.preventDefault(); setDragTarget({ type: 'addTier' }); }}
              onDragLeave={() => setDragTarget(null)}
              onDrop={e => { e.preventDefault(); handleDrop(ranking.length, 'addTier'); }}
              style={{
                fontSize: 12, fontWeight: 600,
                color: dragTarget?.type === 'addTier' ? '#00453A' : '#C0C0BE',
                background: dragTarget?.type === 'addTier' ? 'rgba(61,255,209,0.08)' : 'none',
                border: `1.5px dashed ${dragTarget?.type === 'addTier' ? '#3DFFD1' : '#EBEBEB'}`,
                padding: '8px 24px', borderRadius: 8, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              + Add Tier
            </button>
          </div>
        </div>

        {/* RIGHT: Picker */}
        <div style={{ background: '#fff', padding: 24, position: 'sticky', top: 56, height: 'calc(100vh - 56px)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Search */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10, background: '#fff', paddingBottom: 16 }}>
            <input
              type="text"
              placeholder="Search for an album…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{
                width: '100%', background: '#F7F7F5', border: '1px solid #EBEBEB',
                borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#111',
                outline: 'none', transition: 'border-color 0.15s',
              }}
              onFocus={e => (e.target.style.borderColor = '#111')}
              onBlur={e => (e.target.style.borderColor = '#EBEBEB')}
            />
            {searching && <p style={{ fontSize: 11, color: '#888', marginTop: 6 }}>Searching…</p>}
          </div>

          {(filterYear || filterGenre) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {filterYear && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#00453A', background: '#3DFFD1', padding: '2px 8px', borderRadius: 4 }}>
                  {filterYear} only
                </span>
              )}
              {filterGenre && (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#444', background: '#F0F0EE', padding: '2px 8px', borderRadius: 4 }}>
                  {filterGenre}
                </span>
              )}
            </div>
          )}

          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#888', margin: '8px 0 12px' }}>
            {query.trim() ? 'Results' : 'Suggested'}
          </p>

          {pool.length === 0 && !searching && (
            <p style={{ fontSize: 12, color: '#C0C0BE', textAlign: 'center', padding: '32px 0' }}>
              {query.trim() ? 'No albums found.' : 'All suggested albums added.'}
            </p>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            {pool.map(album => {
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
        </div>
      </div>

      {/* Toast */}
      <div style={{
        position: 'fixed', bottom: 24, left: '50%',
        transform: `translateX(-50%) translateY(${toast.visible ? 0 : 20}px)`,
        background: '#111', color: '#fff', fontSize: 12, fontWeight: 600,
        padding: '10px 24px', borderRadius: 10, zIndex: 200,
        opacity: toast.visible ? 1 : 0, transition: 'all 0.3s', pointerEvents: 'none',
      }}>
        {toast.msg}
      </div>
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
      <div style={{ width: 64, height: 64, borderRadius: 6, overflow: 'hidden', border: '1px solid #EBEBEB', background: coverColor(album.id) }}>
        {album.coverUrl
          ? <img src={album.coverUrl} alt={album.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', textTransform: 'uppercase' }}>{album.title.slice(0, 2)}</div>
        }
      </div>
      <div style={{ marginTop: 5 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{album.title}</div>
        <div style={{ fontSize: 9, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2, marginTop: 1 }}>{album.artist}</div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        style={{
          position: 'absolute', top: -6, right: -6, zIndex: 10,
          width: 18, height: 18, borderRadius: '50%',
          background: '#fff', border: '1px solid #EBEBEB',
          color: '#888', fontSize: 14, lineHeight: 1,
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
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: coverColor(album.id), border: '1px solid #EBEBEB', opacity: isAdded ? 0.5 : 1 }}>
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
            background: isAdded ? '#EBEBEB' : '#3DFFD1',
            color: isAdded ? '#888' : '#00453A',
            padding: '4px 12px', borderRadius: 6,
          }}>
            {isAdded ? 'Added' : 'Add'}
          </span>
        </div>
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{album.title}</div>
        <div style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{album.artist}</div>
      </div>
    </div>
  );
}
