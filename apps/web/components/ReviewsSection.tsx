'use client';

import { useEffect, useRef, useState } from 'react';
import { Heart, Globe, Users, Lock, Star, ChevronDown, Check, ArrowUpDown } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import UserAvatar from './UserAvatar';

type SortOrder = 'newest' | 'oldest' | 'most-liked';
type FilterMode = 'all' | 'public' | 'friends';

type Visibility = 'public' | 'friends' | 'private';

interface Comment {
  id: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
  visibility: Visibility;
  score: number | null;
  likeCount: number;
  liked: boolean;
}

function StarDisplay({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-[1.5px]">
      {[1, 2, 3, 4, 5].map(i => {
        const fill = score >= i ? 1 : score >= i - 0.5 ? 0.5 : 0;
        return (
          <span key={i} className="relative inline-block" style={{ width: 11, height: 11 }}>
            <Star size={11} strokeWidth={1.5} className="text-[#C8C8C5]" />
            {fill > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: fill === 1 ? '100%' : '50%' }}
              >
                <Star size={11} strokeWidth={1.5} fill="#E8A020" className="text-[#E8A020]" />
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string; icon: React.ElementType }[] = [
  { value: 'public', label: 'Public', icon: Globe },
  { value: 'friends', label: 'Friends', icon: Users },
  { value: 'private', label: 'Private', icon: Lock },
];

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

function VisibilitySelect({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = VISIBILITY_OPTIONS.find(o => o.value === value)!;
  const CurrentIcon = current.icon;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 bg-surface border border-divider rounded-lg px-3 py-[7px] text-[12px] font-semibold text-muted hover:border-mid transition"
      >
        <CurrentIcon size={11} />
        {current.label}
        <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-page border border-divider rounded-xl shadow-lg z-20 py-1 min-w-[130px]">
          {VISIBILITY_OPTIONS.map(({ value: v, label, icon: Icon }) => (
            <button
              key={v}
              type="button"
              onClick={() => { onChange(v); setOpen(false); }}
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] font-semibold text-muted hover:text-ink hover:bg-surface transition"
            >
              <Icon size={12} />
              <span className="flex-1 text-left">{label}</span>
              {v === value && <Check size={11} className="text-ink" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ReviewsSection({ releaseId }: { releaseId: string }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');

  useEffect(() => {
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        setSession(data.session);
        fetchComments(data.session?.user?.id ?? null);
      });
    } else {
      fetchComments(null);
    }
  }, [releaseId]);

  const fetchComments = async (viewerId: string | null) => {
    const params = new URLSearchParams({ releaseId });
    if (viewerId) params.set('viewerId', viewerId);
    const res = await fetch(`/api/reviews?${params}`);
    const data = await res.json();
    setComments(data.reviews ?? []);
    setLoading(false);
  };

  const myComment = session ? comments.find(c => c.user_id === session.user.id) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !session || !body.trim()) return;
    setSubmitting(true);
    setError(null);

    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', session.user.id)
      .maybeSingle();
    const username = profile?.username ?? session.user.email?.split('@')[0] ?? 'user';

    const { error: err } = await supabase.from('reviews').insert({
      release_id: releaseId,
      user_id: session.user.id,
      username,
      body: body.trim(),
      visibility,
    });

    if (err) {
      setError(err.message);
    } else {
      setBody('');
      await fetchComments(session.user.id);
    }
    setSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!supabase || !session) return;
    await supabase.from('reviews').delete().eq('id', id).eq('user_id', session.user.id);
    setComments(prev => prev.filter(c => c.id !== id));
  };

  const toggleLike = async (comment: Comment) => {
    if (!supabase || !session) return;
    const optimistic = comments.map(c => {
      if (c.id !== comment.id) return c;
      return { ...c, liked: !c.liked, likeCount: c.liked ? c.likeCount - 1 : c.likeCount + 1 };
    });
    setComments(optimistic);

    if (comment.liked) {
      await supabase.from('comment_likes').delete().eq('user_id', session.user.id).eq('comment_id', comment.id);
    } else {
      await supabase.from('comment_likes').insert({ user_id: session.user.id, comment_id: comment.id });
    }
  };

  // Sort + filter derived list
  const displayedComments = (() => {
    let list = [...comments];
    if (filterMode === 'public') list = list.filter(c => c.visibility === 'public');
    else if (filterMode === 'friends') list = list.filter(c => c.visibility === 'friends' || c.visibility === 'public');
    if (sortOrder === 'newest') list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    else if (sortOrder === 'oldest') list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    else if (sortOrder === 'most-liked') list.sort((a, b) => b.likeCount - a.likeCount);
    return list;
  })();

  return (
    <div>
      <h2 className="text-[17px] font-bold text-ink mb-[18px]">
        Comments
        {comments.length > 0 && (
          <span className="ml-2 text-[13px] font-normal text-muted">{comments.length}</span>
        )}
      </h2>

      {session && !myComment && (
        <form onSubmit={handleSubmit} className="mb-7">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Leave a comment…"
            rows={3}
            className="w-full rounded-[10px] border border-divider bg-surface px-4 py-3 text-[13px] text-ink placeholder:text-placeholder outline-none focus:border-ink transition resize-none"
          />
          {error && <p className="mt-1 text-[12px] text-red-500">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <VisibilitySelect value={visibility} onChange={setVisibility} />
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="ml-auto rounded-lg bg-ink px-5 py-[7px] text-[13px] font-semibold text-white dark:bg-[#F0F0EE] dark:text-[#111111] hover:opacity-80 transition disabled:opacity-40"
            >
              {submitting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </form>
      )}

      {!loading && comments.length > 1 && (
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <ArrowUpDown size={13} className="text-muted flex-shrink-0" />
          <div className="flex gap-1">
            {(['newest', 'oldest', 'most-liked'] as SortOrder[]).map(s => (
              <button
                key={s}
                onClick={() => setSortOrder(s)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${sortOrder === s ? 'bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111]' : 'text-muted hover:bg-surface border border-divider'}`}
              >
                {s === 'newest' ? 'Newest' : s === 'oldest' ? 'Oldest' : 'Most liked'}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1">
            {(['all', 'public', 'friends'] as FilterMode[]).map(f => (
              <button
                key={f}
                onClick={() => setFilterMode(f)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${filterMode === f ? 'bg-surface text-ink border border-ink/20' : 'text-muted hover:bg-surface border border-divider'}`}
              >
                {f === 'all' ? 'All' : f === 'public' ? 'Public' : 'Friends'}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : displayedComments.length === 0 ? (
        <p className="text-[13px] text-muted">{comments.length === 0 ? 'No comments yet. Rate it first, then share your take.' : 'No comments match this filter.'}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {displayedComments.map(c => {
            const VisIcon = VISIBILITY_OPTIONS.find(o => o.value === c.visibility)?.icon ?? Globe;
            return (
              <div key={c.id} className="border-b border-divider pb-5 last:border-0">
                <div className="flex items-center gap-2 mb-2">
                  <UserAvatar size={28} />
                  {c.username ? (
                    <Link href={`/profile/${c.username}`} className="text-[13px] font-semibold text-ink hover:text-mid transition truncate inline-block max-w-[140px]">
                      {c.username}
                    </Link>
                  ) : (
                    <span className="text-[13px] font-semibold text-ink">Unknown</span>
                  )}
                  {c.score !== null && <StarDisplay score={c.score} />}
                  <span className="text-[11px] text-muted">{timeAgo(c.created_at)}</span>
                  {session?.user.id === c.user_id && (
                    <>
                      <VisIcon size={11} className="text-subtle ml-1" />
                      <button
                        onClick={() => handleDelete(c.id)}
                        className="ml-auto text-[11px] text-muted hover:text-red-500 transition"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
                <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{c.body}</p>
                <button
                  onClick={() => toggleLike(c)}
                  disabled={!session}
                  className={`mt-2 inline-flex items-center gap-1 text-[11px] font-semibold transition disabled:opacity-40 ${
                    c.liked ? 'text-red-500' : 'text-muted hover:text-red-400'
                  }`}
                >
                  <Heart size={12} fill={c.liked ? 'currentColor' : 'none'} />
                  {c.likeCount > 0 && c.likeCount}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
