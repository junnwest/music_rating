'use client';

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import type { AlbumRelease, RatingStatus } from '../types';
import type { Session } from '@supabase/supabase-js';

const ratingOptions = Array.from({ length: 5 }, (_, index) => index + 1);
const statusOptions: RatingStatus[] = ['Listened', 'Listening', 'WantToListen', 'ReListening'];

interface RatingFormProps {
  release: AlbumRelease;
}

interface SavedRating {
  id: string;
  score: number;
  status: RatingStatus;
  note: string | null;
}

export default function RatingForm({ release }: RatingFormProps) {
  const [session, setSession] = useState<Session | null>(null);
  const [savedRating, setSavedRating] = useState<SavedRating | null>(null);
  const [score, setScore] = useState(3);
  const [status, setStatus] = useState<RatingStatus>('Listened');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
  }, []);

  useEffect(() => {
    if (!session || !supabase) return;

    const client = supabase;

    const fetchRating = async () => {
      const { data, error } = await client
        .from('ratings')
        .select('id, score, status, note')
        .eq('release_id', release.id)
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        setMessage('Failed to fetch saved rating.');
        return;
      }

      if (data) {
        setSavedRating(data as SavedRating);
        setScore(data.score);
        setStatus(data.status as RatingStatus);
        setNote(data.note ?? '');
      }
    };

    fetchRating();
  }, [release.id, session]);

  const handleSave = async () => {
    if (!supabase) {
      setMessage('Supabase is not configured.');
      return;
    }

    if (!session) {
      setMessage('Sign in to save your rating.');
      return;
    }

    setSaving(true);
    setMessage(null);

    const coverRes = await fetch(`/api/cover?mbid=${release.id}`);
    const { url: coverUrl } = coverRes.ok ? await coverRes.json() : { url: null };

    const releasePayload = {
      id: release.id,
      title: release.title,
      artist: release.artist,
      release_date: release.date,
      country: release.country,
      release_type: release.releaseType,
      cover_url: coverUrl ?? null,
    };

    const { error: releaseError } = await supabase
      .from('releases')
      .upsert(releasePayload, { onConflict: 'id' });

    if (releaseError) {
      setMessage('Failed to save release metadata.');
      setSaving(false);
      return;
    }

    const ratingPayload = {
      user_id: session.user.id,
      release_id: release.id,
      score,
      status,
      note: note.trim() || null
    };

    const { error: ratingError, data } = await supabase
      .from('ratings')
      .upsert(ratingPayload, { onConflict: 'user_id,release_id' });

    if (ratingError) {
      setMessage('Failed to save your rating.');
    } else {
      const saved = Array.isArray(data) ? data[0] : (data as any);
      setSavedRating({
        id: saved?.id ?? release.id,
        score,
        status,
        note: note.trim() || null
      });
      setMessage('Rating saved successfully.');
    }

    setSaving(false);
  };

  if (!session) {
    return (
      <div className="rounded-3xl border border-slate-700 bg-slate-950/80 p-4 text-slate-300">
        <p className="mb-3 text-sm">Sign in to rate this release and save it to your profile.</p>
        <a href="/login" className="inline-flex rounded-full border border-brand-500 bg-brand-500/10 px-4 py-2 text-sm font-semibold text-brand-200 hover:bg-brand-500/20">
          Sign in
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-700 bg-slate-950/80 p-4 text-slate-200">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="rounded-full bg-slate-900 px-3 py-1 text-xs uppercase tracking-[0.3em] text-brand-300">Rate this release</div>
        {savedRating ? (
          <span className="text-sm text-slate-400">Saved: {savedRating.score}/5 • {savedRating.status}</span>
        ) : (
          <span className="text-sm text-slate-400">No rating saved yet.</span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-300">
          Score
          <select
            value={score}
            onChange={(event) => setScore(Number(event.target.value))}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-slate-100 outline-none"
          >
            {ratingOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>

        <label className="space-y-2 text-sm text-slate-300">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as RatingStatus)}
            className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-slate-100 outline-none"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>{option.replace(/([A-Z])/g, ' $1')}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-4 block text-sm text-slate-300">
        Notes <span className="text-slate-500">(optional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-slate-100 outline-none"
          placeholder="Add a quick comment about the release"
        />
      </label>

      {message && <p className="mt-4 text-sm text-slate-300">{message}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="mt-4 inline-flex items-center justify-center rounded-2xl bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save rating'}
      </button>
    </div>
  );
}
