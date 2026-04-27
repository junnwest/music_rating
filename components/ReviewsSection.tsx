'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';

interface Review {
  id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function ReviewsSection({ releaseId }: { releaseId: string }) {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchReviews();
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => setSession(data.session));
    }
  }, [releaseId]);

  const fetchReviews = async () => {
    const res = await fetch(`/api/reviews?releaseId=${encodeURIComponent(releaseId)}`);
    const data = await res.json();
    setReviews(data.reviews ?? []);
    setLoading(false);
  };

  const myReview = session ? reviews.find((r) => r.user_id === session.user.id) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !session || !body.trim()) return;
    setSubmitting(true);
    setError(null);

    const username = session.user.email?.split('@')[0] ?? 'user';
    const { error: err } = await supabase.from('reviews').insert({
      release_id: releaseId,
      user_id: session.user.id,
      username,
      body: body.trim(),
    });

    if (err) {
      setError('Could not post review. You may have already written one.');
    } else {
      setBody('');
      await fetchReviews();
      router.refresh();
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!supabase || !session) return;
    await supabase.from('reviews').delete().eq('id', id).eq('user_id', session.user.id);
    await fetchReviews();
    router.refresh();
  };

  return (
    <div>
      <h2 className="text-[17px] font-bold text-ink mb-[18px]">
        Community Reviews
        {reviews.length > 0 && (
          <span className="ml-2 text-[13px] font-normal text-muted">{reviews.length}</span>
        )}
      </h2>

      {/* Write a review */}
      {session && !myReview && (
        <form onSubmit={handleSubmit} className="mb-7">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your thoughts on this album…"
            rows={4}
            className="w-full rounded-[10px] border border-[#EBEBEB] bg-surface px-4 py-3 text-[13px] text-ink placeholder:text-[#C0C0BE] outline-none focus:border-ink transition resize-none"
          />
          {error && <p className="mt-1 text-[12px] text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="mt-2 rounded-lg bg-ink px-5 py-[9px] text-[13px] font-semibold text-white hover:opacity-80 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Posting…' : 'Post review'}
          </button>
        </form>
      )}

      {/* Reviews list */}
      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-muted">No reviews yet. Be the first to write one after rating.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {reviews.map((r) => (
            <div key={r.id} className="border-b border-[#EBEBEB] pb-5 last:border-0">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-mint-bg border border-mint flex items-center justify-center text-[11px] font-bold text-mint-dark flex-shrink-0">
                  {r.username[0].toUpperCase()}
                </div>
                <span className="text-[13px] font-semibold text-ink">{r.username}</span>
                <span className="text-[11px] text-muted">{timeAgo(r.created_at)}</span>
                {session?.user.id === r.user_id && (
                  <button
                    onClick={() => handleDelete(r.id)}
                    className="ml-auto text-[11px] text-muted hover:text-red-500 transition"
                  >
                    Delete
                  </button>
                )}
              </div>
              <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{r.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
