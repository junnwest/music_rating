'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import { useLanguage } from '../lib/i18n';

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
  const { t } = useLanguage();
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

  const filtered = (() => {
    if (activeTab === 'To Vote') {
      return categories
        .filter((cat) => !myRankings[cat.id])
        .sort((a, b) => (voteCountMap[b.id] ?? 0) - (voteCountMap[a.id] ?? 0))
        .slice(0, 6);
    }
    if (activeTab === 'Friends Active') {
      return categories.filter((cat) => (friendVoteCounts[cat.id] ?? 0) > 0);
    }
    return categories;
  })();

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'All', label: t('rankings.tabAll') },
    ...(loggedIn ? [{ key: 'To Vote' as FilterTab, label: t('rankings.tabToVote') }] : []),
    ...(loggedIn && hasFriends ? [{ key: 'Friends Active' as FilterTab, label: t('rankings.tabFriendsActive') }] : []),
  ];

  return (
    <div>
      {loggedIn && tabs.length > 1 && (
        <div className="flex gap-1 mb-7">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-[7px] rounded-full text-[12px] font-semibold transition ${
                activeTab === key
                  ? 'bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111]'
                  : 'bg-surface text-muted hover:text-ink border border-divider'
              }`}
            >
              {label}
              {key === 'Friends Active' && (
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
              ? t('rankings.votedEvery')
              : activeTab === 'Friends Active'
              ? t('rankings.noFriendsVoted')
              : t('rankings.noCategories')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((cat) => {
            const topAlbums = topAlbumsMap[cat.id] ?? [];
            const voteCount = voteCountMap[cat.id] ?? 0;
            const hasRanked = !!myRankings[cat.id];
            const friendCount = friendVoteCounts[cat.id] ?? 0;

            const voteLabel = voteCount === 0
              ? t('rankings.noRankingsYet')
              : `${voteCount.toLocaleString()} ${voteCount === 1 ? t('rankings.ranking') : t('rankings.rankingPlural')}`;

            return (
              <div
                key={cat.id}
                className="flex flex-col border border-divider rounded-[12px] p-5 transition group relative"
              >
                {friendCount > 0 && (
                  <div className="absolute top-4 right-4">
                    <span className="text-[10px] font-semibold px-[7px] py-[2px] rounded-full bg-surface border border-divider text-muted">
                      {friendCount} {friendCount === 1 ? t('rankings.friend') : t('rankings.friends')}
                    </span>
                  </div>
                )}

                <div className="flex gap-[5px] mb-5">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const album = topAlbums[i];
                    return album?.coverUrl ? (
                      <img
                        key={i}
                        src={album.coverUrl}
                        alt=""
                        className="w-[46px] h-[46px] rounded-[5px] object-cover border border-divider flex-shrink-0"
                      />
                    ) : (
                      <div
                        key={i}
                        className="w-[46px] h-[46px] rounded-[5px] border border-dashed border-[#DDDDD8] bg-surface flex-shrink-0"
                      />
                    );
                  })}
                </div>

                <div
                  className="text-[16px] font-extrabold text-ink mb-1 pr-6"
                  style={{ letterSpacing: '-0.4px' }}
                >
                  {(() => { const k = `rankingTitles.${cat.slug}`; const r = t(k); return r === k ? cat.title : r; })()}
                </div>

                <div className="flex items-center justify-between mt-auto pt-4">
                  <span className="text-[11px] text-muted">{voteLabel}</span>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/leaderboard/${cat.slug}`}
                      className="text-[12px] font-medium text-muted hover:text-ink transition"
                    >
                      {t('rankings.viewRanking')}
                    </Link>
                    <Link
                      href={`/leaderboard/${cat.slug}/rank`}
                      className="text-[12px] font-semibold text-ink border border-[#DDDDD8] rounded-lg px-3 py-1.5 hover:bg-surface transition"
                    >
                      {hasRanked ? t('rankings.reRank') : t('rankings.rank')}
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
