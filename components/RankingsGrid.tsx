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

interface Props {
  categories: Category[];
  topAlbumsMap: Record<string, { coverUrl: string | null }[]>;
  voteCountMap: Record<string, number>;
}

type FilterTab = 'All' | 'To Vote' | 'Friends Active';

export default function RankingsGrid({ categories, topAlbumsMap, voteCountMap }: Props) {
  const [activeTab, setActiveTab] = useState<FilterTab>('All');
  const [myRankings, setMyRankings] = useState<Record<string, boolean>>({});
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
      setMyRankings(json.myRankings ?? {});
      setFriendVoteCounts(json.friendVoteCounts ?? {});
      setHasFriends(Object.keys(json.friendVoteCounts ?? {}).length > 0);
    });
  }, []);

  const filtered = categories
    .filter((cat) => {
      if (activeTab === 'To Vote') return !myRankings[cat.id];
      if (activeTab === 'Friends Active') return (friendVoteCounts[cat.id] ?? 0) > 0;
      return true;
    })
    .sort((a, b) => {
      if (activeTab === 'To Vote') return (voteCountMap[b.id] ?? 0) - (voteCountMap[a.id] ?? 0);
      return 0;
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
                  {categories.filter((c) => !myRankings[c.id]).length}
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
            const topAlbums = topAlbumsMap[cat.id] ?? [];
            const voteCount = voteCountMap[cat.id] ?? 0;
            const hasRanked = !!myRankings[cat.id];
            const friendCount = friendVoteCounts[cat.id] ?? 0;

            return (
              <div
                key={cat.id}
                className="flex flex-col border border-[#EBEBEB] rounded-[12px] p-5 transition group relative"
              >
                {/* Friends badge */}
                {friendCount > 0 && (
                  <div className="absolute top-4 right-4">
                    <span className="text-[10px] font-semibold px-[7px] py-[2px] rounded-full bg-surface border border-[#EBEBEB] text-muted">
                      {friendCount} {friendCount === 1 ? 'friend' : 'friends'}
                    </span>
                  </div>
                )}

                {/* Top 5 covers */}
                <div className="flex gap-[5px] mb-5">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const album = topAlbums[i];
                    return album?.coverUrl ? (
                      <img
                        key={i}
                        src={album.coverUrl}
                        alt=""
                        className="w-[46px] h-[46px] rounded-[5px] object-cover border border-[#EBEBEB] flex-shrink-0"
                      />
                    ) : (
                      <div
                        key={i}
                        className="w-[46px] h-[46px] rounded-[5px] border border-dashed border-[#DDDDD8] bg-surface flex-shrink-0"
                      />
                    );
                  })}
                </div>

                {/* Title */}
                <div
                  className="text-[16px] font-extrabold text-ink mb-1 pr-6"
                  style={{ letterSpacing: '-0.4px' }}
                >
                  {cat.title}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between mt-auto pt-4">
                  <span className="text-[11px] text-muted">
                    {voteCount === 0 ? 'No rankings yet' : `${voteCount.toLocaleString()} ${voteCount === 1 ? 'ranking' : 'rankings'}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/rankings/${cat.slug}`}
                      className="text-[12px] font-medium text-muted hover:text-ink transition"
                    >
                      View ranking
                    </Link>
                    <Link
                      href={`/rankings/${cat.slug}/rank`}
                      className="text-[12px] font-semibold text-ink border border-[#DDDDD8] rounded-lg px-3 py-1.5 hover:bg-surface transition"
                    >
                      {hasRanked ? 'Re-rank →' : 'Rank →'}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
