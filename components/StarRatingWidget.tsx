'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

const STAR_PATH = 'M6 1 L7.3 4.1 L10.8 4.1 L8.0 6.2 L9.0 9.5 L6 7.5 L3.0 9.5 L4.0 6.2 L1.2 4.1 L4.7 4.1 Z';
const MINT = '#3DFFD1';
const EMPTY = '#E5E5E0';

function Star({ n, full, half, size }: { n: number; full: boolean; half: boolean; size: number }) {
  const baseId = useId();
  const clipId = `${baseId}-${n}`;

  if (full) {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12" style={{ transition: 'fill 100ms ease' }}>
        <path d={STAR_PATH} fill={MINT} />
      </svg>
    );
  }
  if (!half) {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12">
        <path d={STAR_PATH} fill={EMPTY} />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" style={{ transition: 'fill 100ms ease' }}>
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="6" height="12" />
        </clipPath>
      </defs>
      <path d={STAR_PATH} fill={EMPTY} />
      <path d={STAR_PATH} fill={MINT} clipPath={`url(#${clipId})`} />
    </svg>
  );
}

interface StarRatingWidgetProps {
  releaseId: string;
  releaseTitle: string;
  releaseArtist: string;
  releaseDate: string | null;
  releaseCountry: string | null;
  releaseType: string;
  coverUrl: string | null;
}

export default function StarRatingWidget({
  releaseId,
  releaseTitle,
  releaseArtist,
  releaseDate,
  releaseCountry,
  releaseType,
  coverUrl,
}: StarRatingWidgetProps) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [savedScore, setSavedScore] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showLoginPopup, setShowLoginPopup] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  useEffect(() => {
    if (!session || !supabase) return;
    supabase
      .from('ratings')
      .select('score')
      .eq('release_id', releaseId)
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setSavedScore(data.score); });
  }, [session, releaseId]);

  const handleRate = async (star: number) => {
    if (!session) { setShowLoginPopup(true); return; }
    if (!supabase) return;

    if (savedScore === star) {
      setSaving(true);
      await supabase.from('ratings').delete()
        .eq('user_id', session.user.id).eq('release_id', releaseId);
      setSavedScore(null);
      setSaving(false);
      router.refresh();
      return;
    }

    setSaving(true);
    await supabase.from('releases').upsert(
      { id: releaseId, title: releaseTitle, artist: releaseArtist, release_date: releaseDate, country: releaseCountry, release_type: releaseType, cover_url: coverUrl },
      { onConflict: 'id' }
    );
    const { error } = await supabase.from('ratings').upsert(
      { user_id: session.user.id, release_id: releaseId, score: star, status: 'Listened' },
      { onConflict: 'user_id,release_id' }
    );
    if (!error) {
      setSavedScore(star);
      router.refresh();
    }
    setSaving(false);
  };

  const display = hovered ?? savedScore ?? 0;

  return (
    <div className="relative">
      <div className="flex gap-1" onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((n) => {
          const full = display >= n;
          const half = !full && display >= n - 0.5;
          return (
            <button
              key={n}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setHovered(e.clientX - rect.left < rect.width / 2 ? n - 0.5 : n);
              }}
              onClick={() => handleRate(hovered ?? n)}
              disabled={saving}
              className="transition-transform hover:scale-110 disabled:cursor-wait"
              aria-label={`Rate ${n} stars`}
            >
              <Star n={n} full={full} half={half} size={30} />
            </button>
          );
        })}
      </div>

      <p className="mt-1.5 text-[12px] text-muted">
        {savedScore !== null && hovered === null
          ? <>Your rating: {savedScore} / 5 · <button onClick={() => handleRate(savedScore)} className="underline hover:text-mid">Clear</button></>
          : 'Tap to rate · half-steps supported'}
      </p>

      {/* Login popup */}
      {showLoginPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowLoginPopup(false)}
        >
          <div className="rounded-2xl bg-white p-8 shadow-xl w-80" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-ink">Sign in to rate</h2>
            <p className="mt-2 text-sm text-muted">Create an account or sign in to save your ratings.</p>
            <div className="mt-6 flex flex-col gap-3">
              <a href="/login" className="w-full rounded-lg bg-ink px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-80 transition">
                Sign in
              </a>
              <button onClick={() => setShowLoginPopup(false)} className="w-full rounded-lg border border-[#EBEBEB] px-4 py-2.5 text-sm font-semibold text-mid hover:bg-surface transition">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
