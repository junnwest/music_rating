'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { scoreFromRank, INSTINCT_REVEAL_THRESHOLD } from '../lib/elo';
import AddModal from './AddModal';
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

interface Props {
  releaseId: string;
  releaseTitle: string;
  releaseArtist: string;
  releaseDate: string | null;
  releaseCountry: string | null;
  releaseType: string;
  coverUrl: string | null;
  genres?: string[];
}

export default function StarRatingWidget({
  releaseId, releaseTitle, releaseArtist, releaseDate, releaseType, coverUrl, genres,
}: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [ratingMode, setRatingMode] = useState<'manual' | 'instinct'>('manual');
  const [manualScore, setManualScore] = useState<number | null>(null);
  const [instinctScore, setInstinctScore] = useState<number | null>(null);
  const [instinctRank, setInstinctRank] = useState<number | null>(null);
  const [instinctTotal, setInstinctTotal] = useState(0);
  const [instinctRated, setInstinctRated] = useState(false);
  const [open, setOpen] = useState(false);
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
      const { data } = await supabase
        .from('ratings').select('release_id, elo_score').eq('user_id', session.user.id).not('elo_score', 'is', null);
      const items = (data ?? []).map((r: any) => ({ id: r.release_id as string, elo: Number(r.elo_score) }));
      const sorted = [...items].sort((a, b) => b.elo - a.elo);
      const idx = sorted.findIndex((i) => i.id === releaseId);
      setInstinctTotal(items.length);
      setInstinctRated(idx >= 0);
      setInstinctRank(idx >= 0 ? idx + 1 : null);
      setInstinctScore(idx >= 0 ? scoreFromRank(idx, items.length) : null);
    } else {
      const { data } = await supabase
        .from('ratings').select('score').eq('user_id', session.user.id).eq('release_id', releaseId).maybeSingle();
      setManualScore(data?.score != null ? Number(data.score) : null);
    }
  }, [session, releaseId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const albumInfo = {
    id: releaseId, title: releaseTitle, artist: releaseArtist,
    coverUrl: coverUrl ?? null, date: releaseDate, releaseType, genres,
  };

  const openModal = () => { if (session) setOpen(true); else setShowLogin(true); };

  const hasRating = ratingMode === 'instinct' ? instinctRated : manualScore !== null;

  return (
    <div className="relative flex items-center gap-4">
      {/* Current rating display */}
      {ratingMode === 'instinct' ? (
        instinctRated ? (
          instinctTotal >= INSTINCT_REVEAL_THRESHOLD && instinctScore !== null ? (
            <div className="flex items-baseline gap-2">
              <span className="text-[28px] font-extrabold text-[#E8A020] tabular-nums leading-none">{instinctScore.toFixed(1)}</span>
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

      {/* Add / Edit button */}
      <button
        onClick={openModal}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] text-[13px] font-bold hover:opacity-80 transition"
      >
        {hasRating ? <><Pencil size={13} /> Edit</> : <><Plus size={14} /> Add</>}
      </button>

      {open && <AddModal album={albumInfo} onClose={() => setOpen(false)} onSaved={() => void refresh()} />}

      {showLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowLogin(false)}>
          <div className="rounded-2xl bg-page p-8 shadow-xl w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-ink">Sign in to rate</h2>
            <p className="mt-2 text-sm text-muted">Create an account or sign in to save your ratings.</p>
            <div className="mt-6 flex flex-col gap-3">
              <a href="/login" className="w-full rounded-lg bg-ink px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-80 transition">Sign in</a>
              <button onClick={() => setShowLogin(false)} className="w-full rounded-lg border border-divider px-4 py-2.5 text-sm font-semibold text-mid hover:bg-surface transition">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
