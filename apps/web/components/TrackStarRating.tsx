'use client';

import { useEffect, useId, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

const STAR_PATH = 'M6 1 L7.3 4.1 L10.8 4.1 L8.0 6.2 L9.0 9.5 L6 7.5 L3.0 9.5 L4.0 6.2 L1.2 4.1 L4.7 4.1 Z';
const GOLD = '#E8A020';
const EMPTY = '#E5E5E0';

function MiniStar({ n, full, half, size }: { n: number; full: boolean; half: boolean; size: number }) {
  const baseId = useId();
  const clipId = `${baseId}-t-${n}`;

  if (full) {
    return (
      <svg width={size} height={size} viewBox="0 0 12 12">
        <path d={STAR_PATH} fill={GOLD} />
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
    <svg width={size} height={size} viewBox="0 0 12 12">
      <defs>
        <clipPath id={clipId}><rect x="0" y="0" width="6" height="12" /></clipPath>
      </defs>
      <path d={STAR_PATH} fill={EMPTY} />
      <path d={STAR_PATH} fill={GOLD} clipPath={`url(#${clipId})`} />
    </svg>
  );
}

interface Props {
  releaseId: string;
  trackPosition: number;
  trackTitle: string;
}

export default function TrackStarRating({ releaseId, trackPosition, trackTitle }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [savedScore, setSavedScore] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  useEffect(() => {
    if (!session || !supabase) return;
    Promise.resolve(
      supabase
        .from('track_ratings')
        .select('score')
        .eq('release_id', releaseId)
        .eq('track_position', trackPosition)
        .eq('user_id', session.user.id)
        .maybeSingle()
    ).then(({ data }) => { if (data) setSavedScore(data.score); }).catch(() => {});
  }, [session, releaseId, trackPosition]);

  const handleRate = async (star: number) => {
    if (!session || !supabase) return;

    if (savedScore === star) {
      setSaving(true);
      await supabase.from('track_ratings').delete()
        .eq('user_id', session.user.id)
        .eq('release_id', releaseId)
        .eq('track_position', trackPosition);
      setSavedScore(null);
      setSaving(false);
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('track_ratings').upsert(
      {
        user_id: session.user.id,
        release_id: releaseId,
        track_position: trackPosition,
        track_title: trackTitle,
        score: star,
      },
      { onConflict: 'user_id,release_id,track_position' }
    );
    if (!error) setSavedScore(star);
    setSaving(false);
  };

  const display = hovered ?? savedScore ?? 0;

  return (
    <div className="flex gap-[2px] items-center" onMouseLeave={() => setHovered(null)}>
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
            disabled={saving || !session}
            className="transition-transform hover:scale-110 disabled:cursor-default"
            title={`Rate ${n}`}
          >
            <MiniStar n={n} full={full} half={half} size={14} />
          </button>
        );
      })}
      {savedScore !== null && (
        <span className="text-[10px] text-amber-600 font-bold ml-1 tabular-nums">{savedScore.toFixed(1)}</span>
      )}
    </div>
  );
}
