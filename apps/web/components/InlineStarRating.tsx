'use client';

import { useEffect, useId, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

const STAR_PATH = 'M6 1 L7.3 4.1 L10.8 4.1 L8.0 6.2 L9.0 9.5 L6 7.5 L3.0 9.5 L4.0 6.2 L1.2 4.1 L4.7 4.1 Z';
const GOLD = '#E8A020';
const EMPTY = '#E5E5E0';

function Star({ n, full, half, size }: { n: number; full: boolean; half: boolean; size: number }) {
  const baseId = useId();
  const clipId = `${baseId}-i-${n}`;

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
  releaseTitle: string;
  releaseArtist: string;
  releaseDate: string | null;
  releaseCountry: string | null;
  releaseType: string;
  coverUrl: string | null;
  size?: number;
}

export default function InlineStarRating({
  releaseId,
  releaseTitle,
  releaseArtist,
  releaseDate,
  releaseCountry,
  releaseType,
  coverUrl,
  size = 18,
}: Props) {
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
    supabase
      .from('ratings')
      .select('score')
      .eq('release_id', releaseId)
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data }) => { if (data) setSavedScore(data.score); });
  }, [session, releaseId]);

  const handleRate = async (e: React.MouseEvent, star: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!session || !supabase) return;

    if (savedScore === star) {
      setSaving(true);
      await supabase.from('ratings').delete()
        .eq('user_id', session.user.id).eq('release_id', releaseId);
      setSavedScore(null);
      setSaving(false);
      return;
    }

    setSaving(true);
    await supabase.from('releases').upsert(
      { id: releaseId, title: releaseTitle, artist: releaseArtist, release_date: releaseDate, country: releaseCountry, release_type: releaseType, cover_url: coverUrl },
      { onConflict: 'id' }
    );
    await supabase.from('ratings').delete()
      .eq('user_id', session.user.id).eq('release_id', releaseId);
    const { error } = await supabase.from('ratings').insert(
      { user_id: session.user.id, release_id: releaseId, score: star, status: 'Listened' }
    );
    if (!error) setSavedScore(star);
    setSaving(false);
  };

  const display = hovered ?? savedScore ?? 0;

  return (
    <div
      className="flex items-center gap-[1px]"
      onMouseLeave={() => setHovered(null)}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
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
            onClick={(e) => handleRate(e, hovered ?? n)}
            disabled={saving || !session}
            className="transition-transform hover:scale-110 disabled:cursor-default"
          >
            <Star n={n} full={full} half={half} size={size} />
          </button>
        );
      })}
      {savedScore !== null && (
        <span className="text-[11px] text-amber-600 font-bold ml-1 tabular-nums">{savedScore.toFixed(1)}</span>
      )}
    </div>
  );
}
