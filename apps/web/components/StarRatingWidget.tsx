'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { eloToScore, INSTINCT_REVEAL_THRESHOLD } from '../lib/elo';
import AddModal, { type RateTarget } from './AddModal';
import type { Session } from '@supabase/supabase-js';

const STAR_PATH = 'M6 1 L7.3 4.1 L10.8 4.1 L8.0 6.2 L9.0 9.5 L6 7.5 L3.0 9.5 L4.0 6.2 L1.2 4.1 L4.7 4.1 Z';
const MINT = '#E8A020';
const EMPTY = '#E5E5E0';

function StarsDisplay({ score, size = 26 }: { score: number; size?: number }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => {
        const full = score >= n;
        const half = !full && score >= n - 0.5;
        return (
          <svg key={n} width={size} height={size} viewBox="0 0 12 12">
            {full ? (
              <path d={STAR_PATH} fill={MINT} />
            ) : half ? (
              <>
                <path d={STAR_PATH} fill={EMPTY} />
                <path d={STAR_PATH} fill={MINT} style={{ clipPath: 'inset(0 50% 0 0)' }} />
              </>
            ) : (
              <path d={STAR_PATH} fill={EMPTY} />
            )}
          </svg>
        );
      })}
    </div>
  );
}

/**
 * Rate/Re-rank/Delete control for an album OR a song. "Add" = rate (opens the
 * Add modal); collections live on a separate "Save" action. `compact` renders a
 * minimal version for tracklist rows (button + score only, no delete).
 */
export default function StarRatingWidget({ target, compact = false }: { target: RateTarget; compact?: boolean }) {
  const isSong = target.kind === 'song';
  const releaseId = target.kind === 'album' ? target.id : target.releaseId;
  const position = target.kind === 'song' ? target.position : null;
  const selfKey = isSong ? `${releaseId}:${position}` : releaseId;

  const [session, setSession] = useState<Session | null>(null);
  const [ratingMode, setRatingMode] = useState<'manual' | 'instinct'>('manual');
  const [manualScore, setManualScore] = useState<number | null>(null);
  const [instinctScore, setInstinctScore] = useState<number | null>(null);
  const [instinctRank, setInstinctRank] = useState<number | null>(null);
  const [instinctTotal, setInstinctTotal] = useState(0);
  const [instinctRated, setInstinctRated] = useState(false);
  const [open, setOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'rerank'>('add');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  const refresh = useCallback(async () => {
    if (!session || !supabase) return;
    const { data: profile } = await supabase
      .from('profiles').select('rating_mode').eq('id', session.user.id).maybeSingle();
    const mode = profile?.rating_mode === 'instinct' ? 'instinct' : 'manual';
    setRatingMode(mode);

    if (mode === 'instinct') {
      const table = isSong ? 'track_ratings' : 'ratings';
      const cols = isSong ? 'release_id, track_position, elo_score' : 'release_id, elo_score';
      const { data } = await supabase.from(table).select(cols).eq('user_id', session.user.id).not('elo_score', 'is', null);
      const items = (data ?? []).map((r: any) => ({
        id: isSong ? `${r.release_id}:${r.track_position}` : r.release_id,
        elo: Number(r.elo_score),
      }));
      const sorted = [...items].sort((a, b) => b.elo - a.elo);
      const idx = sorted.findIndex((i) => i.id === selfKey);
      setInstinctTotal(items.length);
      setInstinctRated(idx >= 0);
      setInstinctRank(idx >= 0 ? idx + 1 : null);
      setInstinctScore(idx >= 0 ? eloToScore(sorted[idx].elo) : null);
    } else {
      let q = supabase.from(isSong ? 'track_ratings' : 'ratings').select('score').eq('user_id', session.user.id).eq('release_id', releaseId);
      if (isSong) q = q.eq('track_position', position!);
      const { data } = await q.maybeSingle();
      setManualScore(data?.score != null ? Number(data.score) : null);
    }
  }, [session, selfKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openModal = (m: 'add' | 'rerank') => {
    if (!session) { setShowLogin(true); return; }
    setModalMode(m);
    setOpen(true);
  };

  const handleDelete = async () => {
    if (!session || !supabase) return;
    setDeleting(true);
    if (isSong) {
      await supabase.from('track_ratings').delete().eq('user_id', session.user.id).eq('release_id', releaseId).eq('track_position', position!);
      await supabase.from('track_pairwise_comparisons').delete()
        .eq('user_id', session.user.id)
        .or(`and(winner_release_id.eq.${releaseId},winner_position.eq.${position}),and(loser_release_id.eq.${releaseId},loser_position.eq.${position})`);
    } else {
      await supabase.from('ratings').delete().eq('user_id', session.user.id).eq('release_id', releaseId);
      await supabase.from('pairwise_comparisons').delete()
        .eq('user_id', session.user.id)
        .or(`winner_release_id.eq.${releaseId},loser_release_id.eq.${releaseId}`);
    }
    setDeleting(false);
    setConfirmDelete(false);
    await refresh();
  };

  const hasRating = ratingMode === 'instinct' ? instinctRated : manualScore !== null;
  const revealed = instinctTotal >= INSTINCT_REVEAL_THRESHOLD && instinctScore !== null;

  // ── Compact (tracklist row): score chip + Add/Re-rank, no delete ────────────
  if (compact) {
    return (
      <div className="relative flex items-center gap-2 flex-shrink-0">
        {hasRating && ratingMode === 'manual' && manualScore !== null && (
          <span className="text-[12px] font-bold text-[#E8A020] tabular-nums">{manualScore.toFixed(1)}</span>
        )}
        {hasRating && ratingMode === 'instinct' && (
          revealed
            ? <span className="text-[12px] font-bold text-[#E8A020] tabular-nums">{instinctScore!.toFixed(1)}</span>
            : <span className="text-[10px] text-muted">rated</span>
        )}
        <button
          onClick={() => openModal(hasRating ? 'rerank' : 'add')}
          aria-label={hasRating ? 'Re-rank' : 'Add rating'}
          className="inline-flex items-center justify-center p-1 rounded-md text-muted hover:text-ink transition"
        >
          {hasRating ? <RefreshCw size={13} /> : <Plus size={14} />}
        </button>

        {open && <AddModal target={target} mode={modalMode} onClose={() => setOpen(false)} onSaved={() => void refresh()} />}
        {showLogin && <LoginPrompt onClose={() => setShowLogin(false)} />}
      </div>
    );
  }

  return (
    <div className="relative flex items-center gap-4">
      {/* Current rating display */}
      {ratingMode === 'instinct' ? (
        instinctRated ? (
          revealed ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-extrabold text-[#E8A020] tabular-nums leading-none">{instinctScore!.toFixed(1)}</span>
              {instinctRank !== null && <span className="text-[12px] text-muted">#{instinctRank} of {instinctTotal}</span>}
            </div>
          ) : (
            <span className="text-[13px] text-muted">Rated · scores reveal after {Math.max(0, INSTINCT_REVEAL_THRESHOLD - instinctTotal)} more</span>
          )
        ) : null
      ) : (
        manualScore !== null && (
          <div className="flex items-center gap-2">
            <StarsDisplay score={manualScore} />
            <span className="text-[13px] font-semibold text-ink tabular-nums">{manualScore.toFixed(1)}</span>
          </div>
        )
      )}

      {/* Actions: Re-rank + Delete when rated, Add when not */}
      {hasRating ? (
        confirmDelete ? (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted">Delete rating?</span>
            <button onClick={handleDelete} disabled={deleting}
              className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-[12px] font-bold hover:bg-red-700 transition disabled:opacity-50">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)} disabled={deleting}
              className="px-3 py-1.5 rounded-lg border border-divider text-[12px] font-semibold text-ink hover:bg-surface transition disabled:opacity-50">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button onClick={() => openModal('rerank')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] text-[13px] font-bold hover:opacity-80 transition">
              <RefreshCw size={13} /> Re-rank
            </button>
            <button onClick={() => setConfirmDelete(true)} aria-label="Delete rating"
              className="inline-flex items-center justify-center p-2 rounded-lg border border-divider text-muted hover:text-red-600 hover:border-red-300 transition">
              <Trash2 size={14} />
            </button>
          </div>
        )
      ) : (
        <button onClick={() => openModal('add')}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] text-[13px] font-bold hover:opacity-80 transition">
          <Plus size={14} /> Add
        </button>
      )}

      {open && <AddModal target={target} mode={modalMode} onClose={() => setOpen(false)} onSaved={() => void refresh()} />}
      {showLogin && <LoginPrompt onClose={() => setShowLogin(false)} />}
    </div>
  );
}

function LoginPrompt({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="rounded-2xl bg-page p-8 shadow-xl w-80" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink">Sign in to rate</h2>
        <p className="mt-2 text-sm text-muted">Create an account or sign in to save your ratings.</p>
        <div className="mt-6 flex flex-col gap-3">
          <a href="/login" className="w-full rounded-lg bg-ink px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-80 transition">Sign in</a>
          <button onClick={onClose} className="w-full rounded-lg border border-divider px-4 py-2.5 text-sm font-semibold text-mid hover:bg-surface transition">Cancel</button>
        </div>
      </div>
    </div>
  );
}
