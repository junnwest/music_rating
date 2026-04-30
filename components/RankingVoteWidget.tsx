'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabaseClient';

export interface LeaderboardEntry {
  rank: number;
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  voteCount: number;
}

interface SearchResult {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseType: string;
}

export default function RankingVoteWidget({
  categoryId,
  leaderboard,
  totalVotes,
}: {
  categoryId: string;
  leaderboard: LeaderboardEntry[];
  totalVotes: number;
}) {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [myVoteId, setMyVoteId] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setUserId(uid);
      if (!uid) return;
      const { data: vote } = await supabase!
        .from('ranking_votes')
        .select('release_id')
        .eq('user_id', uid)
        .eq('category_id', categoryId)
        .maybeSingle();
      setMyVoteId(vote?.release_id ?? null);
    });
  }, [categoryId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?query=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        setSearchResults(
          (json.releases ?? []).map((r: any) => ({
            id: r.id,
            title: r.title,
            artist: r.artist,
            coverUrl: r.coverUrl,
            releaseType: r.releaseType ?? 'Album',
          }))
        );
      } catch {}
      setSearching(false);
    }, 350);
  }, [query]);

  const castVote = async (r: { id: string; title: string; artist: string; coverUrl: string | null; releaseType?: string }) => {
    if (!userId || voting) return;
    setVoting(true);
    try {
      await fetch('/api/rankings/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          categoryId,
          releaseId: r.id,
          releaseTitle: r.title,
          releaseArtist: r.artist,
          releaseCoverUrl: r.coverUrl,
          releaseType: r.releaseType ?? 'Album',
        }),
      });
      setMyVoteId(r.id);
      setQuery('');
      setSearchResults([]);
      router.refresh();
    } catch {}
    setVoting(false);
  };

  const removeVote = async () => {
    if (!userId || voting) return;
    setVoting(true);
    try {
      await fetch('/api/rankings/vote', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, categoryId }),
      });
      setMyVoteId(null);
      router.refresh();
    } catch {}
    setVoting(false);
  };

  const maxVotes = leaderboard[0]?.voteCount ?? 1;

  return (
    <div>
      {/* Leaderboard */}
      <div className="mb-10">
        {leaderboard.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[14px] text-muted">No votes yet. Be the first to cast one.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-[2px]">
            {leaderboard.map((entry) => {
              const isMyPick = entry.releaseId === myVoteId;
              const barPct = Math.max((entry.voteCount / maxVotes) * 100, 2);

              return (
                <div
                  key={entry.releaseId}
                  className={`flex items-center gap-4 rounded-[10px] px-4 py-3 transition ${
                    isMyPick ? 'bg-mint-bg' : 'hover:bg-surface'
                  }`}
                >
                  {/* Rank */}
                  <div
                    className="w-[28px] text-right flex-shrink-0 font-bold text-ink tabular-nums"
                    style={{ fontSize: entry.rank <= 3 ? 18 : 14 }}
                  >
                    {String(entry.rank).padStart(2, '0')}
                  </div>

                  {/* Cover */}
                  <div className="w-[48px] h-[48px] rounded-[6px] overflow-hidden flex-shrink-0 border border-[#EBEBEB] bg-surface">
                    {entry.coverUrl ? (
                      <img src={entry.coverUrl} alt={entry.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-surface" />
                    )}
                  </div>

                  {/* Info + bar */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-bold text-ink truncate">{entry.title}</span>
                      {isMyPick && (
                        <span
                          className="flex-shrink-0 text-[10px] font-bold px-[7px] py-[2px] rounded-full"
                          style={{ background: '#3DFFD1', color: '#00453A' }}
                        >
                          Your pick
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted mb-[6px]">{entry.artist}</div>
                    <div className="h-[3px] bg-[#EBEBEB] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${barPct}%`, background: isMyPick ? '#3DFFD1' : '#DDDDD8' }}
                      />
                    </div>
                  </div>

                  {/* Vote count + button */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[12px] font-semibold text-muted tabular-nums w-[32px] text-right">
                      {entry.voteCount}
                    </span>
                    {userId && !isMyPick && (
                      <button
                        onClick={() => castVote({ id: entry.releaseId, title: entry.title, artist: entry.artist, coverUrl: entry.coverUrl })}
                        disabled={voting}
                        className="text-[12px] font-semibold text-ink border border-[#EBEBEB] rounded-lg px-3 py-[5px] hover:bg-surface transition disabled:opacity-50"
                      >
                        Vote
                      </button>
                    )}
                    {userId && isMyPick && (
                      <button
                        onClick={removeVote}
                        disabled={voting}
                        className="text-[11px] font-medium text-muted hover:text-ink transition disabled:opacity-50 w-[52px] text-center"
                      >
                        Remove
                      </button>
                    )}
                    {!userId && (
                      <div className="w-[52px]" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Search to vote */}
      {userId ? (
        <div>
          <div
            className="text-[13px] font-bold text-ink mb-3"
            style={{ letterSpacing: '-0.3px' }}
          >
            {myVoteId ? 'Change your vote' : 'Cast your vote'}
          </div>
          <p className="text-[12px] text-muted mb-3">
            {myVoteId
              ? 'Search for a different album to update your pick.'
              : "Don't see it? Search for any album to vote."}
          </p>
          <input
            type="text"
            placeholder="Search for an album…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-surface border border-[#EBEBEB] rounded-lg px-4 py-[10px] text-[14px] text-ink placeholder:text-muted outline-none focus:border-ink transition"
          />
          {searching && (
            <p className="text-[12px] text-muted mt-2">Searching…</p>
          )}
          {searchResults.length > 0 && (
            <div className="mt-2 border border-[#EBEBEB] rounded-[10px] overflow-hidden">
              {searchResults.map((r) => (
                <button
                  key={r.id}
                  onClick={() => castVote(r)}
                  disabled={voting}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface transition border-b border-[#EBEBEB] last:border-b-0 text-left disabled:opacity-50"
                >
                  <div className="w-[40px] h-[40px] rounded-[5px] overflow-hidden flex-shrink-0 border border-[#EBEBEB] bg-surface">
                    {r.coverUrl ? (
                      <img src={r.coverUrl} alt={r.title} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-surface" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink truncate">{r.title}</div>
                    <div className="text-[11px] text-muted truncate">{r.artist}</div>
                  </div>
                  <span className="text-[12px] font-semibold text-ink flex-shrink-0">Vote →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="border border-[#EBEBEB] rounded-[10px] p-5 text-center">
          <p className="text-[13px] text-muted mb-3">Sign in to cast your vote</p>
          <a
            href="/login"
            className="inline-flex rounded-lg bg-ink px-5 py-[9px] text-[13px] font-semibold text-white hover:opacity-80 transition"
          >
            Log in →
          </a>
        </div>
      )}
    </div>
  );
}
