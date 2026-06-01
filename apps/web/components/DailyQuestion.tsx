'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import type { AlbumRelease } from '../types';

interface Question {
  id: string;
  question_text: string;
  question_date: string;
}

interface AnswerRelease {
  title: string;
  artist: string;
  cover_url: string | null;
}

interface UserAnswer {
  id: string;
  release_id: string;
  note: string | null;
  release: AnswerRelease | null;
}

type Phase =
  | 'loading'
  | 'no_question'   // no question seeded for today
  | 'guest'         // not logged in
  | 'unanswered'    // logged in, not yet answered
  | 'searching'     // search box open
  | 'answered';     // has answered

export default function DailyQuestion() {
  const [phase, setPhase]               = useState<Phase>('loading');
  const [question, setQuestion]         = useState<Question | null>(null);
  const [userAnswer, setUserAnswer]     = useState<UserAnswer | null>(null);
  const [totalAnswers, setTotalAnswers] = useState(0);
  const [userId, setUserId]             = useState<string | null>(null);
  const [username, setUsername]         = useState<string>('');
  const [accessToken, setAccessToken]   = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AlbumRelease[]>([]);
  const [searching, setSearching]     = useState(false);
  const [pendingRelease, setPendingRelease] = useState<AlbumRelease | null>(null);
  const [submitting, setSubmitting]   = useState(false);
  const [cardFormat, setCardFormat]   = useState<'story' | 'square'>('story');
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load question + user answer
  useEffect(() => {
    if (!supabase) { setPhase('guest'); return; }

    (async () => {
      const { data: { session } } = await supabase!.auth.getSession();
      const uid = session?.user?.id ?? null;
      const token = session?.access_token ?? null;
      setUserId(uid);
      setAccessToken(token);

      if (uid) {
        const { data: profile } = await supabase!
          .from('profiles')
          .select('username, display_name')
          .eq('id', uid)
          .maybeSingle();
        setUsername(profile?.display_name ?? profile?.username ?? session?.user?.email?.split('@')[0] ?? '');
      }

      const params = uid ? `?userId=${uid}` : '';
      const res = await fetch(`/api/daily-question${params}`);
      if (!res.ok) { setPhase('no_question'); return; }

      const data = await res.json();
      if (!data.question) { setPhase('no_question'); return; }

      setQuestion(data.question);
      setTotalAnswers(data.totalAnswers ?? 0);

      if (!session) {
        setPhase('guest');
        return;
      }

      if (data.userAnswer) {
        setUserAnswer(data.userAnswer);
        setPhase('answered');
      } else {
        setPhase('unanswered');
      }
    })();
  }, []);

  // Debounced search
  useEffect(() => {
    if (phase !== 'searching') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) { setSearchResults([]); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(searchQuery)}&type=releases`);
        const data = await res.json();
        setSearchResults((data.releases ?? []).slice(0, 9));
      } catch { /* ignore */ }
      setSearching(false);
    }, 350);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, phase]);

  const openSearch = () => {
    setPhase('searching');
    setPendingRelease(null);
    setSearchQuery('');
    setSearchResults([]);
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  const cancelSearch = () => {
    setPhase(userAnswer ? 'answered' : 'unanswered');
    setPendingRelease(null);
  };

  const selectRelease = (r: AlbumRelease) => {
    setPendingRelease(r);
  };

  const submitAnswer = async () => {
    if (!pendingRelease || !question || !accessToken || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/daily-question/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionId: question.id,
          releaseId: pendingRelease.id,
          accessToken,
        }),
      });
      if (!res.ok) throw new Error('Failed to save');
      const data = await res.json();

      setUserAnswer({
        id: data.answer.id,
        release_id: pendingRelease.id,
        note: data.answer.note ?? null,
        release: {
          title: pendingRelease.title,
          artist: pendingRelease.artist,
          cover_url: pendingRelease.coverUrl ?? null,
        },
      });
      setTotalAnswers((n) => n + 1);
      setPhase('answered');
    } catch (err) {
      console.error('[DailyQuestion] submit error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const cardUrl = (fmt: 'story' | 'square') => {
    if (!question || !userAnswer?.release) return '#';
    const p = new URLSearchParams({
      question: question.question_text,
      title:    userAnswer.release.title,
      artist:   userAnswer.release.artist,
      cover:    userAnswer.release.cover_url ?? '',
      username,
      date:     new Date(question.question_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      format:   fmt,
    });
    return `/api/daily-question/card?${p}`;
  };

  const formattedDate = question
    ? new Date(question.question_date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      })
    : '';

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="mb-11 rounded-2xl border border-divider bg-surface overflow-hidden animate-pulse" style={{ minHeight: 160 }}>
        <div className="h-1.5 w-full" style={{ background: '#E8A020' }} />
        <div className="p-6 space-y-3">
          <div className="h-3 bg-divider rounded w-32" />
          <div className="h-5 bg-divider rounded w-4/5" />
        </div>
      </div>
    );
  }

  // ── No question for today ─────────────────────────────────────────────────
  if (phase === 'no_question') return null;

  // ── Shared header used in all non-loading states ──────────────────────────
  const header = (
    <div className="flex items-center gap-2 mb-4">
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
        style={{ background: '#FEF3DC', color: '#B87010', border: '1.5px solid #E8A020' }}
      >
        🎵 Daily Question
      </span>
      <span className="text-[12px] text-muted">{formattedDate}</span>
      {totalAnswers > 0 && (
        <span className="ml-auto text-[12px] text-muted">
          {totalAnswers} {totalAnswers === 1 ? 'answer' : 'answers'}
        </span>
      )}
    </div>
  );

  const questionText = (
    <h2 className="text-[22px] md:text-[26px] font-extrabold text-ink leading-tight mb-5" style={{ letterSpacing: '-0.5px' }}>
      {question?.question_text}
    </h2>
  );

  // ── Guest view ────────────────────────────────────────────────────────────
  if (phase === 'guest') {
    return (
      <div className="mb-11 rounded-2xl border border-divider bg-surface overflow-hidden">
        <div className="h-1.5 w-full" style={{ background: '#E8A020' }} />
        <div className="p-6">
          {header}
          {questionText}
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition"
            style={{ background: '#E8A020' }}
          >
            Sign in to answer
          </Link>
        </div>
      </div>
    );
  }

  // ── Searching ─────────────────────────────────────────────────────────────
  if (phase === 'searching') {
    return (
      <div className="mb-11 rounded-2xl border border-divider bg-surface overflow-hidden">
        <div className="h-1.5 w-full" style={{ background: '#E8A020' }} />
        <div className="p-6">
          {header}
          {questionText}

          {/* Search input */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex-1 bg-page border border-divider rounded-xl px-4 py-2.5 flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted flex-shrink-0">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for an album…"
                className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-placeholder"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="text-muted hover:text-ink text-lg leading-none">×</button>
              )}
            </div>
            <button
              onClick={cancelSearch}
              className="px-4 py-2.5 rounded-xl text-[13px] text-muted border border-divider hover:bg-page transition"
            >
              Cancel
            </button>
          </div>

          {/* Pending selection confirmation */}
          {pendingRelease && (
            <div
              className="flex items-center gap-3 mb-5 p-3 rounded-xl border"
              style={{ background: '#FEF3DC', borderColor: '#E8A020' }}
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-divider">
                {pendingRelease.coverUrl
                  ? <img src={pendingRelease.coverUrl} alt={pendingRelease.title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-surface" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink truncate">{pendingRelease.title}</div>
                <div className="text-[12px] text-muted truncate">{pendingRelease.artist}</div>
              </div>
              <button
                onClick={submitAnswer}
                disabled={submitting}
                className="flex-shrink-0 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition disabled:opacity-60"
                style={{ background: '#E8A020' }}
              >
                {submitting ? 'Saving…' : 'This one ✓'}
              </button>
            </div>
          )}

          {/* Search results grid */}
          {searching && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <div className="aspect-square rounded-lg bg-divider animate-pulse" />
                  <div className="mt-2 h-2.5 bg-divider animate-pulse rounded w-4/5" />
                </div>
              ))}
            </div>
          )}

          {!searching && searchResults.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
              {searchResults.map((r) => {
                const selected = pendingRelease?.id === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => selectRelease(r)}
                    className="text-left group"
                  >
                    <div
                      className="relative aspect-square rounded-lg overflow-hidden transition"
                      style={{
                        outline: selected ? '3px solid #E8A020' : '3px solid transparent',
                        outlineOffset: 2,
                      }}
                    >
                      {r.coverUrl
                        ? <img src={r.coverUrl} alt={r.title} className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-divider" />
                      }
                      {selected && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <span className="text-white text-2xl">✓</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-1.5 text-[11px] font-semibold text-ink truncate leading-tight">{r.title}</div>
                    <div className="text-[10px] text-muted truncate">{r.artist}</div>
                  </button>
                );
              })}
            </div>
          )}

          {!searching && searchQuery && searchResults.length === 0 && (
            <p className="text-[13px] text-muted py-4">No results for &ldquo;{searchQuery}&rdquo;</p>
          )}

          {!searching && !searchQuery && (
            <p className="text-[13px] text-muted py-2">Type to search the catalog…</p>
          )}
        </div>
      </div>
    );
  }

  // ── Unanswered ────────────────────────────────────────────────────────────
  if (phase === 'unanswered') {
    return (
      <div className="mb-11 rounded-2xl border border-divider bg-surface overflow-hidden">
        <div className="h-1.5 w-full" style={{ background: '#E8A020' }} />
        <div className="p-6">
          {header}
          {questionText}
          <button
            onClick={openSearch}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition hover:opacity-90"
            style={{ background: '#E8A020' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            Pick an album to answer
          </button>
        </div>
      </div>
    );
  }

  // ── Answered ──────────────────────────────────────────────────────────────
  const rel = userAnswer?.release;
  return (
    <div className="mb-11 rounded-2xl border border-divider bg-surface overflow-hidden">
      <div className="h-1.5 w-full" style={{ background: '#E8A020' }} />
      <div className="p-6">
        {header}
        {questionText}

        <div className="flex items-start gap-4">
          {/* Album cover */}
          <Link
            href={userAnswer ? `/album/${userAnswer.release_id}` : '#'}
            className="flex-shrink-0 w-[88px] h-[88px] rounded-xl overflow-hidden bg-divider border border-divider hover:opacity-90 transition"
          >
            {rel?.cover_url
              ? <img src={rel.cover_url} alt={rel.title} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-surface flex items-center justify-center text-2xl text-muted">♪</div>
            }
          </Link>

          {/* Album info + actions */}
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-ink truncate">{rel?.title ?? '—'}</div>
            <div className="text-[13px] text-muted mt-0.5 truncate">{rel?.artist ?? '—'}</div>

            <div className="flex flex-wrap gap-2 mt-3">
              {/* Change answer */}
              <button
                onClick={openSearch}
                className="px-3.5 py-1.5 rounded-lg text-[12px] font-semibold border border-divider text-muted hover:text-ink hover:bg-page transition"
              >
                Change
              </button>

              {/* Export story */}
              <a
                href={cardUrl('story')}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setCardFormat('story')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold text-white transition hover:opacity-85"
                style={{ background: '#1A1A18' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Story card
              </a>

              {/* Export square */}
              <a
                href={cardUrl('square')}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setCardFormat('square')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold border border-divider text-ink hover:bg-page transition"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
                Square card
              </a>
            </div>

            <p className="text-[11px] text-muted mt-2.5">
              Opens a 1080×1920 or 1080×1080 image — save it and share anywhere.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
