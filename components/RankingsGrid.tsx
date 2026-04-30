'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';

interface Category {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  genre: string | null;
  year: number | null;
}

interface LeaderEntry {
  coverUrl: string | null;
  title: string;
  artist: string;
}

interface Props {
  categories: Category[];
  leaderMap: Record<string, LeaderEntry>;
  voteCountMap: Record<string, number>;
}

type FilterTab = 'All' | 'To Vote' | 'Friends Active';

export default function RankingsGrid({ categories, leaderMap, voteCountMap }: Props) {
  const [activeTab, setActiveTab] = useState<FilterTab>('All');
  const [myVotes, setMyVotes] = useState<Record<string, string>>({});
  const [friendVoteCounts, setFriendVoteCounts] = useState<Record<string, number>>({});
  const [loggedIn, setLoggedIn] = useState(false);
  const [hasFriends, setHasFriends] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      setLoggedIn(true);
      const res = await fetch(`/api/rankings/personalized?userId=${uid}`);
      const json = await res.json();
      setMyVotes(json.myVotes ?? {});
      setFriendVoteCounts(json.friendVoteCounts ?? {});
      setHasFriends(Object.keys(json.friendVoteCounts ?? {}).length > 0);
    });
  }, []);

  const filtered = categories.filter((cat) => {
    if (activeTab === 'To Vote') return !myVotes[cat.id];
    if (activeTab === 'Friends Active') return (friendVoteCounts[cat.id] ?? 0) > 0;
    return true;
  });

  const tabs: FilterTab[] = loggedIn ? ['All', 'To Vote', ...(hasFriends ? ['Friends Active' as FilterTab] : [])] : ['All'];

  return (
    <div>
      {/* Filter tabs — only shown when logged in */}
      {loggedIn && tabs.length > 1 && (
        <div className="flex gap-1 mb-7">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-[7px] rounded-full text-[12px] font-semibold transition ${
                activeTab === tab
                  ? 'bg-ink text-white'
                  : 'bg-surface text-muted hover:text-ink border border-[#EBEBEB]'
              }`}
            >
              {tab}
              {tab === 'To Vote' && (
                <span className="ml-1.5 text-[10px] opacity-70">
                  {categories.filter((c) => !myVotes[c.id]).length}
                </span>
              )}
              {tab === 'Friends Active' && (
                <span className="ml-1.5 text-[10px] opacity-70">
                  {categories.filter((c) => (friendVoteCounts[c.id] ?? 0) > 0).length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-muted">
            {activeTab === 'To Vote'
              ? "You've voted in every category."
              : activeTab === 'Friends Active'
              ? 'No friends have voted yet.'
              : 'No ranking categories yet.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {filtered.map((cat) => {
            const leader = leaderMap[cat.id];
            const voteCount = voteCountMap[cat.id] ?? 0;
            const isVoted = !!myVotes[cat.id];
            const friendCount = friendVoteCounts[cat.id] ?? 0;

            return (
              <Link
                key={cat.id}
                href={`/rankings/${cat.slug}`}
                className="block border border-[#EBEBEB] rounded-[12px] p-5 hover:bg-surface transition group relative"
              >
                {/* Badges */}
                <div className="absolute top-4 right-4 flex gap-1.5">
                  {isVoted && (
                    <span
                      className="text-[10px] font-bold px-[7px] py-[2px] rounded-full"
                      style={{ background: '#3DFFD1', color: '#00453A' }}
                    >
                      Your pick
                    </span>
                  )}
                  {friendCount > 0 && (
                    <span className="text-[10px] font-semibold px-[7px] py-[2px] rounded-full bg-surface border border-[#EBEBEB] text-muted">
                      {friendCount} {friendCount === 1 ? 'friend' : 'friends'}
                    </span>
                  )}
                </div>

                {/* Cover preview */}
                <div className="flex gap-[6px] mb-5">
                  {leader ? (
                    <>
                      <div className="w-[72px] h-[72px] rounded-[7px] overflow-hidden flex-shrink-0 border border-[#EBEBEB]">
                        {leader.coverUrl ? (
                          <img src={leader.coverUrl} alt={leader.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-surface" />
                        )}
                      </div>
                      <div className="flex-1 pt-1">
                        <div className="text-[11px] font-semibold text-muted mb-[3px]">Current #1</div>
                        <div className="text-[13px] font-bold text-ink leading-snug truncate">{leader.title}</div>
                        <div className="text-[11px] text-muted truncate">{leader.artist}</div>
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-[6px]">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="w-[56px] h-[56px] rounded-[6px] border border-dashed border-[#DDDDD8] bg-surface" />
                      ))}
                    </div>
                  )}
                </div>

                {/* Title + description */}
                <div
                  className="text-[16px] font-extrabold text-ink mb-1 pr-6"
                  style={{ letterSpacing: '-0.4px' }}
                >
                  {cat.title}
                </div>
                {cat.description && (
                  <p className="text-[12px] text-muted leading-snug mb-4 line-clamp-2">{cat.description}</p>
                )}

                {/* Footer */}
                <div className="flex items-center justify-between mt-auto">
                  <span className="text-[11px] text-muted">
                    {voteCount === 0 ? 'No votes yet' : `${voteCount.toLocaleString()} vote${voteCount !== 1 ? 's' : ''}`}
                  </span>
                  <span className="text-[12px] font-semibold text-ink">Vote →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
