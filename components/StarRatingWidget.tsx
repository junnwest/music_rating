'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

type StarState = 'empty' | 'half-hover' | 'full-hover' | 'half-filled' | 'filled';

const POINTS = '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2';

function Star({ state, index }: { state: StarState; index: number }) {
  const clipId = `star-clip-${index}`;

  if (state === 'filled') {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="#EAB308" stroke="#EAB308" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points={POINTS} />
      </svg>
    );
  }

  if (state === 'full-hover') {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="#94A3B8" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points={POINTS} />
      </svg>
    );
  }

  if (state === 'empty') {
    return (
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points={POINTS} />
      </svg>
    );
  }

  // half-filled or half-hover
  const color = state === 'half-filled' ? '#EAB308' : '#94A3B8';

  return (
    <svg width="32" height="32" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="12" height="24" />
        </clipPath>
      </defs>
      {/* Left half filled */}
      <polygon points={POINTS} fill={color} clipPath={`url(#${clipId})`} />
      {/* Full outline */}
      <polygon points={POINTS} fill="none" stroke={color} strokeWidth="1.5" />
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
      .then(({ data }) => {
        if (data) setSavedScore(data.score);
      });
  }, [session, releaseId]);

  const handleRate = async (star: number) => {
    if (!session) {
      setShowLoginPopup(true);
      return;
    }
    if (!supabase) return;
    setSaving(true);

    await supabase.from('releases').upsert(
      {
        id: releaseId,
        title: releaseTitle,
        artist: releaseArtist,
        release_date: releaseDate,
        country: releaseCountry,
        release_type: releaseType,
        cover_url: coverUrl,
      },
      { onConflict: 'id' }
    );

    const { error } = await supabase.from('ratings').upsert(
      {
        user_id: session.user.id,
        release_id: releaseId,
        score: star,
        status: 'Listened',
      },
      { onConflict: 'user_id,release_id' }
    );

    if (!error) setSavedScore(star);
    setSaving(false);
  };

  const getStarState = (n: number): StarState => {
    const isHovering = hovered !== null;
    const score = hovered ?? savedScore ?? 0;

    if (score >= n) return isHovering ? 'full-hover' : 'filled';
    if (score >= n - 0.5) return isHovering ? 'half-hover' : 'half-filled';
    return 'empty';
  };

  return (
    <div className="relative">
      <div className="flex gap-1" onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setHovered(e.clientX - rect.left < rect.width / 2 ? n - 0.5 : n);
            }}
            onClick={() => handleRate(hovered ?? n)}
            disabled={saving}
            className="transition-transform hover:scale-110 disabled:cursor-wait"
            aria-label={`Rate ${n - 0.5} or ${n} stars`}
          >
            <Star state={getStarState(n)} index={n} />
          </button>
        ))}
      </div>


      {showLoginPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setShowLoginPopup(false)}
        >
          <div
            className="rounded-2xl bg-white p-8 shadow-xl w-80"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900">Sign in to rate</h2>
            <p className="mt-2 text-sm text-slate-500">Create an account or sign in to save your ratings.</p>
            <div className="mt-6 flex flex-col gap-3">
              <a
                href="/login"
                className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-slate-700 transition"
              >
                Sign in
              </a>
              <button
                onClick={() => setShowLoginPopup(false)}
                className="w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
