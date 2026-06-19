'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Bookmark, BookmarkCheck, Check } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { usePlaylist } from './PlaylistContext';
import { seedElo, deriveInstinctScores, INSTINCT_REVEAL_THRESHOLD, type Sentiment } from '../lib/elo';

// NOTE: English-only copy for now (flow still settling); i18n pass to follow.

interface AlbumInfo {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  date: string | null;
  releaseType: string;
  genres?: string[];
}
interface RankedAlbum { id: string; elo: number; title: string; artist: string; coverUrl: string | null; }

const BUCKETS: { key: Sentiment; label: string; hint: string }[] = [
  { key: 'bad', label: 'Bad', hint: 'Not for me' },
  { key: 'neutral', label: 'Neutral', hint: 'It was fine' },
  { key: 'good', label: 'Good', hint: 'Loved it' },
];
const MAX_COMPARISONS = 3;
const STAR_PATH = 'M6 1 L7.3 4.1 L10.8 4.1 L8.0 6.2 L9.0 9.5 L6 7.5 L3.0 9.5 L4.0 6.2 L1.2 4.1 L4.7 4.1 Z';
const MINT = '#E8A020';

function MiniCover({ album, size = 56 }: { album: { title: string; coverUrl: string | null }; size?: number }) {
  return (
    <div style={{ width: size, height: size }} className="rounded-lg overflow-hidden bg-surface flex-shrink-0">
      {album.coverUrl ? <img src={album.coverUrl} alt={album.title} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-surface" />}
    </div>
  );
}

export default function AddModal({ album, onClose, onSaved, mode = 'add' }: { album: AlbumInfo; onClose: () => void; onSaved?: () => void; mode?: 'add' | 'rerank' }) {
  const router = useRouter();
  const { playlists, addItemTo, removeItemFrom } = usePlaylist();

  const [uid, setUid] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ratingMode, setRatingMode] = useState<'manual' | 'instinct'>('manual');
  const [ratingStep, setRatingStep] = useState(0.5);
  const [loading, setLoading] = useState(true);

  const [phase, setPhase] = useState<'rate' | 'comparing' | 'done'>('rate');
  const [rated, setRated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual input
  const [hovered, setHovered] = useState<number | null>(null);
  const [manualValue, setManualValue] = useState<number | null>(null);
  const [sliderValue, setSliderValue] = useState(3.0);

  // Instinct
  const [opponents, setOpponents] = useState<RankedAlbum[]>([]);
  const search = useRef({ lo: 0, hi: 0, left: 0 });
  const [, setRound] = useState(0);
  const [finalScore, setFinalScore] = useState<number | null>(null);
  const [totalRated, setTotalRated] = useState(0);

  // Reveal: lists + comment
  const [addedLists, setAddedLists] = useState<Set<string>>(new Set()); // 'LL' or collection id
  const [comment, setComment] = useState('');
  const [commentPosted, setCommentPosted] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.push('/login'); return; }
      setUid(session.user.id);
      setToken(session.access_token);
      const { data: profile } = await supabase
        .from('profiles').select('rating_mode, manual_rating_step').eq('id', session.user.id).maybeSingle();
      const mode = profile?.rating_mode === 'instinct' ? 'instinct' : 'manual';
      setRatingMode(mode);
      if (profile?.manual_rating_step) setRatingStep(Number(profile.manual_rating_step));

      if (mode === 'instinct') {
        const { data: rows } = await supabase
          .from('ratings')
          .select('release_id, elo_score, releases(id, title, artist, cover_url)')
          .eq('user_id', session.user.id)
          .not('elo_score', 'is', null);
        const ranked: RankedAlbum[] = (rows ?? [])
          .map((r: any) => ({ id: r.release_id, elo: Number(r.elo_score), title: r.releases?.title ?? '', artist: r.releases?.artist ?? '', coverUrl: r.releases?.cover_url ?? null }))
          .filter((r) => r.id !== album.id)
          .sort((a, b) => b.elo - a.elo);
        setOpponents(ranked);
      } else {
        const { data: r } = await supabase.from('ratings').select('score').eq('user_id', session.user.id).eq('release_id', album.id).maybeSingle();
        if (r?.score != null) { setManualValue(Number(r.score)); setSliderValue(Number(r.score)); }
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [album.id]);

  const ensureReleaseRow = async () => {
    if (!supabase) return;
    await supabase.from('releases').upsert(
      { id: album.id, title: album.title, artist: album.artist, release_date: album.date, release_type: album.releaseType, cover_url: album.coverUrl, genres: album.genres?.join(',') ?? null },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  };

  // ── Manual: commit a star/slider value ──────────────────────────────────────
  const commitManual = async (value: number) => {
    if (!uid || !supabase) return;
    setSaving(true); setError(null);
    await ensureReleaseRow();
    await supabase.from('ratings').delete().eq('user_id', uid).eq('release_id', album.id);
    const { error: e } = await supabase.from('ratings').insert({ user_id: uid, release_id: album.id, score: value, status: 'Listened' });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setManualValue(value);
    setRated(true);
    onSaved?.();
  };

  // ── Instinct: pick a bucket → seed → reveal ─────────────────────────────────
  const handleBucket = async (bucket: Sentiment) => {
    if (!uid || !supabase) return;
    setSaving(true); setError(null);
    await ensureReleaseRow();
    const { error: e } = await supabase.from('ratings').upsert(
      { user_id: uid, release_id: album.id, elo_score: seedElo(bucket), elo_games: 0, status: 'Listened' },
      { onConflict: 'user_id,release_id' },
    );
    setSaving(false);
    if (e) { setError(e.message); return; }
    setRated(true);
    onSaved?.();
  };

  const beginCompare = () => {
    const n = opponents.length;
    if (n === 0) { void finish(); return; }
    const rounds = Math.min(MAX_COMPARISONS, Math.ceil(Math.log2(n + 1)));
    search.current = { lo: 0, hi: n, left: rounds };
    setRound((r) => r + 1);
    setPhase('comparing');
  };

  // Re-rank (Instinct): the rating already exists, so skip the gut-check bucket
  // (no reseed — preserves the album's current Elo + games) and go straight into
  // comparisons against the existing ranked list.
  useEffect(() => {
    if (mode !== 'rerank' || loading || ratingMode !== 'instinct' || phase !== 'rate') return;
    setRated(true);
    beginCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loading, ratingMode, phase]);

  const handlePick = async (targetWins: boolean) => {
    if (!token) return;
    const { lo, hi, left } = search.current;
    const mid = Math.floor((lo + hi) / 2);
    const opponent = opponents[mid];
    if (!opponent) { void finish(); return; }
    setSaving(true); setError(null);
    const res = await fetch('/api/rate/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ winnerId: targetWins ? album.id : opponent.id, loserId: targetWins ? opponent.id : album.id }),
    });
    setSaving(false);
    if (!res.ok) { const { error: e } = await res.json().catch(() => ({ error: 'Comparison failed.' })); setError(e ?? 'Comparison failed.'); return; }
    if (targetWins) search.current.hi = mid; else search.current.lo = mid + 1;
    search.current.left = left - 1;
    if (search.current.left <= 0 || search.current.lo >= search.current.hi) void finish();
    else setRound((r) => r + 1);
  };

  const finish = async () => {
    if (supabase && uid) {
      const { data: rows } = await supabase.from('ratings').select('release_id, elo_score').eq('user_id', uid).not('elo_score', 'is', null);
      const items = (rows ?? []).map((r: any) => ({ id: r.release_id, elo: Number(r.elo_score) }));
      setTotalRated(items.length);
      setFinalScore(deriveInstinctScores(items)[album.id] ?? null);
    }
    onSaved?.();
    setPhase('done');
  };

  // ── Reveal helpers: lists + comment ─────────────────────────────────────────
  const toggleList = async (key: string, listId: string | null) => {
    const isAdded = addedLists.has(key);
    if (isAdded) {
      await removeItemFrom(listId, album.id);
      setAddedLists((s) => { const n = new Set(s); n.delete(key); return n; });
    } else {
      await addItemTo(listId, album.id, album.title, album.artist, album.coverUrl);
      setAddedLists((s) => new Set(s).add(key));
    }
  };

  const postComment = async () => {
    if (!uid || !supabase || !comment.trim()) return;
    setSaving(true); setError(null);
    const { data: profile } = await supabase.from('profiles').select('username').eq('id', uid).maybeSingle();
    const username = profile?.username ?? 'user';
    const { error: e } = await supabase.from('reviews').insert({ release_id: album.id, user_id: uid, username, body: comment.trim(), visibility: 'public' });
    setSaving(false);
    if (e) { setError(e.message); return; }
    setComment(''); setCommentPosted(true);
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  const Reveal = (
    <div className="mt-6 border-t border-divider pt-5 space-y-5">
      <div>
        <p className="text-[12px] font-semibold text-ink mb-2">Add to a list</p>
        <div className="flex flex-wrap gap-2">
          {[{ key: 'LL', id: null as string | null, label: 'Listen Later' }, ...playlists.map((p) => ({ key: p.id, id: p.id as string | null, label: p.title }))].map((l) => {
            const on = addedLists.has(l.key);
            return (
              <button key={l.key} onClick={() => toggleList(l.key, l.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition ${on ? 'border-mint bg-mint-bg text-mint-dark' : 'border-divider text-muted hover:border-ink hover:text-ink'}`}>
                {on ? <BookmarkCheck size={13} /> : <Bookmark size={13} />} {l.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-[12px] font-semibold text-ink mb-2">Leave a comment</p>
        {commentPosted ? (
          <p className="text-[12px] text-mint-dark flex items-center gap-1.5"><Check size={13} /> Comment posted</p>
        ) : (
          <div>
            <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 1000))} rows={2} placeholder="Share a thought (optional)…"
              className="w-full bg-surface border border-divider rounded-lg px-3 py-2 text-[13px] text-ink placeholder:text-muted outline-none focus:border-ink transition resize-none" />
            {comment.trim() && (
              <button onClick={postComment} disabled={saving} className="mt-2 px-4 py-1.5 rounded-lg bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] text-[12px] font-bold hover:opacity-80 transition disabled:opacity-50">Post comment</button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const display = hovered ?? manualValue ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!saving) onClose(); }}>
      <div className="bg-page rounded-2xl shadow-2xl w-full max-w-[460px] max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <MiniCover album={album} />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-ink truncate">{album.title}</p>
              <p className="text-[12px] text-muted truncate">{album.artist}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink transition p-1 flex-shrink-0"><X size={18} /></button>
        </div>

        <div className="px-5 pb-6">
          {loading ? (
            <p className="text-[13px] text-muted py-8 text-center">Loading…</p>
          ) : phase === 'done' ? (
            <div className="text-center py-4">
              <p className="text-[18px] font-extrabold text-ink mb-3">Done!</p>
              {ratingMode === 'instinct' && (
                totalRated >= INSTINCT_REVEAL_THRESHOLD && finalScore !== null
                  ? <p className="text-[15px] text-ink">Your score: <span className="font-extrabold text-[#E8A020]">{finalScore.toFixed(1)}</span></p>
                  : <p className="text-[13px] text-muted">Rate {Math.max(0, INSTINCT_REVEAL_THRESHOLD - totalRated)} more to reveal your scores.</p>
              )}
              <button onClick={onClose} className="mt-5 px-5 py-2.5 rounded-xl bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] text-[13px] font-bold hover:opacity-80 transition">Close</button>
            </div>
          ) : phase === 'comparing' ? (
            (() => {
              const { lo, hi } = search.current;
              const opponent = opponents[Math.floor((lo + hi) / 2)];
              if (!opponent) { void finish(); return <p className="text-[13px] text-muted text-center py-6">Finishing…</p>; }
              return (
                <div>
                  <p className="text-[15px] font-bold text-ink text-center mb-1">Which do you prefer?</p>
                  <p className="text-[12px] text-muted text-center mb-6">Tap the one you like more.</p>
                  <div className="flex items-stretch justify-center gap-3">
                    {[{ a: album, win: true }, { a: opponent, win: false }].map(({ a, win }, i) => (
                      <div key={i} className="contents">
                        {i === 1 && <div className="flex items-center text-[11px] font-bold text-muted">vs</div>}
                        <button onClick={() => handlePick(win)} disabled={saving}
                          className="flex flex-col items-center gap-2 w-full max-w-[160px] rounded-xl border border-divider bg-page p-3 hover:border-ink transition disabled:opacity-60 disabled:cursor-wait">
                          <MiniCover album={a} size={120} />
                          <div className="text-center w-full min-w-0">
                            <p className="text-[12px] font-bold text-ink truncate">{a.title}</p>
                            <p className="text-[11px] text-muted truncate">{a.artist}</p>
                          </div>
                        </button>
                      </div>
                    ))}
                  </div>
                  {error && <p className="text-[12px] text-red-500 text-center mt-4">{error}</p>}
                </div>
              );
            })()
          ) : (
            // phase === 'rate'
            <div>
              {ratingMode === 'instinct' ? (
                <>
                  <p className="text-[15px] font-bold text-ink text-center mb-1">First impression?</p>
                  <p className="text-[12px] text-muted text-center mb-5">How did it hit you?</p>
                  <div className="grid grid-cols-3 gap-2">
                    {BUCKETS.map((b) => (
                      <button key={b.key} onClick={() => handleBucket(b.key)} disabled={saving || rated}
                        className={`flex flex-col items-center gap-1 rounded-xl border py-3 transition disabled:cursor-default ${rated ? 'border-divider opacity-50' : 'border-divider hover:border-ink'}`}>
                        <span className="text-[14px] font-bold text-ink">{b.label}</span>
                        <span className="text-[10px] text-muted">{b.hint}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[15px] font-bold text-ink text-center mb-4">Your rating</p>
                  {ratingStep === 0.1 ? (
                    <div className="flex items-center justify-center gap-3">
                      <input type="range" min={0.5} max={5} step={0.1} value={sliderValue}
                        onChange={(e) => setSliderValue(Number(e.target.value))}
                        onPointerUp={() => commitManual(sliderValue)} onKeyUp={() => commitManual(sliderValue)}
                        disabled={saving} className="w-48" style={{ accentColor: MINT }} />
                      <span className="text-[18px] font-bold tabular-nums text-ink w-10">{sliderValue.toFixed(1)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-center gap-1.5" onMouseLeave={() => setHovered(null)}>
                      {[1, 2, 3, 4, 5].map((n) => {
                        const full = display >= n; const half = !full && display >= n - 0.5;
                        return (
                          <button key={n} disabled={saving}
                            onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHovered(e.clientX - r.left < r.width / 2 ? n - 0.5 : n); }}
                            onClick={() => commitManual(hovered ?? n)} className="transition-transform hover:scale-110 disabled:cursor-wait">
                            <svg width={32} height={32} viewBox="0 0 12 12">
                              {full
                                ? <path d={STAR_PATH} fill={MINT} />
                                : half
                                ? (<><path d={STAR_PATH} fill="#E5E5E0" /><path d={STAR_PATH} fill={MINT} style={{ clipPath: 'inset(0 50% 0 0)' }} /></>)
                                : <path d={STAR_PATH} fill="#E5E5E0" />}
                            </svg>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {manualValue !== null && <p className="text-[12px] text-muted text-center mt-2">Saved: {manualValue.toFixed(1)}</p>}
                </>
              )}

              {error && <p className="text-[12px] text-red-500 text-center mt-3">{error}</p>}

              {rated && (
                <>
                  {Reveal}
                  <button
                    onClick={() => { if (ratingMode === 'instinct') beginCompare(); else onClose(); }}
                    disabled={saving}
                    className="mt-6 w-full rounded-xl bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] py-2.5 text-[13px] font-bold hover:opacity-80 transition disabled:opacity-50"
                  >
                    {ratingMode === 'instinct' ? (opponents.length > 0 ? 'Continue to comparisons' : 'Finish') : 'Done'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
