'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

export default function ProfilePanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [ratings, setRatings] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [ratingsCount, setRatingsCount] = useState(0);
  const [averageRating, setAverageRating] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);

      if (data.session?.user) {
        fetchRatings(data.session.user.id);
      } else {
        setLoading(false);
      }
    });
  }, []);

  const fetchRatings = async (userId: string) => {
    if (!supabase) {
      setMessage('Supabase is not configured.');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('ratings')
      .select('id, score, status, note, created_at, releases(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      setMessage('Unable to load saved ratings.');
    } else {
      const ratingsData = data ?? [];
      setRatings(ratingsData);
      setRatingsCount(ratingsData.length);
      
      if (ratingsData.length > 0) {
        const avgScore = ratingsData.reduce((sum: number, r: any) => sum + (r.score || 0), 0) / ratingsData.length;
        setAverageRating(Math.round(avgScore * 10) / 10);
      }
    }

    setLoading(false);
  };

  if (loading) {
    return <p className="text-slate-300">Loading your profile…</p>;
  }

  if (!session?.user) {
    return (
      <div className="rounded-2xl border border-slate-300 bg-white p-8 text-center text-slate-600">
        <p className="mb-4 text-lg font-semibold text-slate-900">Sign in to view your profile</p>
        <p className="mb-6 text-slate-600">Track your album ratings, build your music catalog, and discover new recommendations.</p>
        <Link href="/login" className="inline-flex rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-700">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Profile Card */}
      <div className="rounded-2xl border border-slate-300 bg-white p-8">
        <div className="flex flex-col items-center text-center sm:flex-row sm:text-left">
          {/* Avatar */}
          <div className="mb-6 sm:mb-0 sm:mr-8">
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-200 to-blue-400 text-white text-4xl font-bold">
              {session.user.email?.[0].toUpperCase()}
            </div>
          </div>
          
          {/* User Info */}
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-slate-900">{session.user.email?.split('@')[0]}</h1>
            <p className="mt-1 text-slate-600">{session.user.email}</p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:gap-6">
              <button className="rounded-lg border border-slate-300 bg-white px-6 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Edit profile
              </button>
              <button className="rounded-lg border border-slate-300 bg-white px-6 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50">
                Share profile
              </button>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-8 grid grid-cols-3 gap-6 border-t border-slate-200 pt-8 text-center">
          <div>
            <p className="text-2xl font-bold text-slate-900">{ratingsCount}</p>
            <p className="text-sm text-slate-600">Ratings</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{averageRating}</p>
            <p className="text-sm text-slate-600">Average</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">0</p>
            <p className="text-sm text-slate-600">Collections</p>
          </div>
        </div>
      </div>

      {/* Recent Ratings Section */}
      <div>
        <h2 className="mb-6 text-xl font-bold text-slate-900">Recent Ratings</h2>
        
        {message && <p className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-600">{message}</p>}
        
        {!ratings || ratings.length === 0 ? (
          <div className="rounded-2xl border border-slate-300 bg-white p-8 text-center">
            <p className="text-slate-600">No saved ratings yet. Search albums and rate them to build your catalog.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ratings.slice(0, 6).map((rating) => (
              <div key={rating.id} className="overflow-hidden rounded-lg border border-slate-300 bg-white transition hover:shadow-md">
                <div className="flex h-full flex-col p-4">
                  <p className="text-xs font-semibold uppercase text-slate-500">{rating.releases?.release_type ?? 'Release'}</p>
                  <h3 className="mt-2 line-clamp-2 font-semibold text-slate-900">{rating.releases?.title ?? rating.release_id}</h3>
                  <p className="mt-1 text-sm text-slate-600">{rating.releases?.artist ?? 'Unknown'}</p>
                  <div className="mt-auto pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-bold text-blue-600">{rating.score}/10</span>
                      <span className="text-xs text-slate-500">{rating.status.replace(/([A-Z])/g, ' $1').trim()}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {ratings && ratings.length > 6 && (
          <div className="mt-6 text-center">
            <button className="text-blue-600 hover:underline">View all ratings →</button>
          </div>
        )}
      </div>
    </div>
  );
}
