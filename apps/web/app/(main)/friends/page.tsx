'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, UserPlus, UserCheck, Users } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';
import UserAvatar from '../../../components/UserAvatar';
import { useLanguage } from '../../../lib/i18n';

interface UserRow {
  id: string;
  username: string | null;
  displayName: string | null;
  bio: string | null;
}

type Tab = 'following' | 'followers' | 'discover';

const COLORS = [
  'bg-rose-100 text-rose-600 border-rose-200',
  'bg-blue-100 text-blue-600 border-blue-200',
  'bg-violet-100 text-violet-600 border-violet-200',
  'bg-amber-100 text-amber-600 border-amber-200',
  'bg-amber-100 text-amber-600 border-amber-200',
  'bg-sky-100 text-sky-600 border-sky-200',
  'bg-orange-100 text-orange-600 border-orange-200',
  'bg-pink-100 text-pink-600 border-pink-200',
  'bg-blue-100 text-blue-600 border-blue-200',
  'bg-indigo-100 text-indigo-600 border-indigo-200',
];

function getColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) & 0xffffffff;
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function FriendsPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('following');
  const [followingUsers, setFollowingUsers] = useState<UserRow[]>([]);
  const [followerUsers, setFollowerUsers] = useState<UserRow[]>([]);
  const [discoverUsers, setDiscoverUsers] = useState<UserRow[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id ?? null;
      setMyId(uid);
      if (uid) await loadFriends(uid);
      setLoading(false);
    });
  }, []);

  const loadFriends = async (uid: string) => {
    if (!supabase) return;

    const [followingRes, followerRes] = await Promise.all([
      supabase.from('follows').select('following_id').eq('follower_id', uid),
      supabase.from('follows').select('follower_id').eq('following_id', uid),
    ]);

    const fIds = (followingRes.data ?? []).map((r: any) => r.following_id) as string[];
    const followerIds = (followerRes.data ?? []).map((r: any) => r.follower_id) as string[];
    const fSet = new Set<string>(fIds);
    setFollowingIds(fSet);

    const excludeSet = new Set([uid, ...fIds]);
    const excludeStr = `(${[uid, ...fIds].join(',')})`;

    let fofIds: string[] = [];
    if (fIds.length > 0) {
      const { data: fofRows } = await supabase
        .from('follows')
        .select('follower_id')
        .in('following_id', fIds)
        .not('follower_id', 'in', excludeStr)
        .limit(100);
      fofIds = [...new Set((fofRows ?? []).map((r: any) => r.follower_id as string))].slice(0, 10);
    }

    const { data: popularRows } = await supabase
      .from('follows')
      .select('following_id')
      .limit(500);

    const followerCount = new Map<string, number>();
    for (const r of popularRows ?? []) {
      followerCount.set(r.following_id, (followerCount.get(r.following_id) ?? 0) + 1);
    }
    const popularIds = [...followerCount.entries()]
      .filter(([id]) => !excludeSet.has(id) && !fofIds.includes(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);

    const discoverIds = [...fofIds, ...popularIds].slice(0, 20);

    const [fProfiles, followerProfiles, discoverProfiles] = await Promise.all([
      fIds.length > 0
        ? supabase.from('profiles').select('id, username, display_name, bio').in('id', fIds)
        : Promise.resolve({ data: [] as any[] }),
      followerIds.length > 0
        ? supabase.from('profiles').select('id, username, display_name, bio').in('id', followerIds)
        : Promise.resolve({ data: [] as any[] }),
      discoverIds.length > 0
        ? supabase.from('profiles').select('id, username, display_name, bio').in('id', discoverIds)
        : supabase.from('profiles').select('id, username, display_name, bio').not('id', 'in', excludeStr).limit(20),
    ]);

    const toRow = (p: any): UserRow => ({
      id: p.id,
      username: p.username ?? null,
      displayName: p.display_name ?? null,
      bio: p.bio ?? null,
    });

    setFollowingUsers((fProfiles.data ?? []).map(toRow));
    setFollowerUsers((followerProfiles.data ?? []).map(toRow));
    setDiscoverUsers((discoverProfiles.data ?? []).map(toRow));
  };

  const toggleFollow = async (targetId: string) => {
    if (!myId || !supabase || actionLoading === targetId) return;
    setActionLoading(targetId);
    const isCurrentlyFollowing = followingIds.has(targetId);
    try {
      await fetch('/api/follow', {
        method: isCurrentlyFollowing ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followerId: myId, followingId: targetId }),
      });
      setFollowingIds(prev => {
        const next = new Set(prev);
        if (isCurrentlyFollowing) next.delete(targetId);
        else next.add(targetId);
        return next;
      });
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!searchQuery.trim() || !supabase || !myId) { setSearchResults([]); return; }

    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const q = searchQuery.trim();
      const { data } = await supabase!
        .from('profiles')
        .select('id, username, display_name, bio')
        .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
        .neq('id', myId)
        .limit(20);

      const toRow = (p: any): UserRow => ({
        id: p.id, username: p.username ?? null,
        displayName: p.display_name ?? null, bio: p.bio ?? null,
      });
      setSearchResults((data ?? []).map(toRow));
      setSearching(false);
    }, 300);
  }, [searchQuery, myId]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'following', label: t('friends.following') },
    { key: 'followers', label: t('friends.followers') },
    { key: 'discover', label: t('friends.discover') },
  ];

  const displayUsers =
    activeTab === 'following' ? followingUsers :
    activeTab === 'followers' ? followerUsers :
    discoverUsers;

  const counts = {
    following: followingUsers.length,
    followers: followerUsers.length,
    discover: discoverUsers.length,
  };

  const hero = (
    <div className="bg-surface border-b border-divider">
      <div className="max-w-[1440px] mx-auto px-5 py-12">
        <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
          {t('friends.people')}
        </p>
        <h1 className="text-[38px] font-extrabold text-ink leading-[1.06]" style={{ letterSpacing: '-1.2px' }}>
          {t('friends.title')}
        </h1>
        <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
          {t('friends.subtitle')}
        </p>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="bg-page min-h-screen">
        {hero}
        <div className="max-w-[720px] mx-auto px-5 py-10 pb-16 text-center">
          <p className="text-sm text-muted">{t('friends.loading')}</p>
        </div>
      </div>
    );
  }

  if (!myId) {
    return (
      <div className="bg-page min-h-screen">
        {hero}
        <div className="max-w-[720px] mx-auto px-5 py-10 pb-16 text-center">
          <Users size={32} className="text-subtle mx-auto mb-4" />
          <p className="text-[14px] text-ink font-semibold mb-1">{t('friends.signIn')}</p>
          <p className="text-[13px] text-muted mb-6">{t('friends.signInDesc')}</p>
          <Link
            href="/login"
            className="bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] text-[13px] font-bold px-5 py-2.5 rounded-lg hover:opacity-80 transition inline-block"
          >
            {t('friends.signInBtn')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-page min-h-screen">
      {hero}

      <div className="max-w-[720px] mx-auto px-5 py-10 pb-16 w-full">
        <div className="relative mb-6">
          <div className="bg-surface border border-divider rounded-xl px-4 py-2.5 flex items-center gap-2">
            <Search size={15} className="text-muted flex-shrink-0" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') { setSearchQuery(''); return; }
                if (e.key === 'Enter' && searchResults.length > 0) {
                  const top = searchResults[0];
                  router.push(`/profile/${top.username ?? top.id}`);
                  setSearchQuery('');
                }
              }}
              placeholder={t('friends.searchPlaceholder')}
              className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-muted hover:text-ink text-[16px] leading-none">×</button>
            )}
          </div>

          {searchQuery.trim() && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-page border border-divider rounded-xl shadow-lg z-20 overflow-hidden">
              {searching ? (
                <p className="text-[13px] text-muted px-4 py-3">{t('friends.searching')}</p>
              ) : searchResults.length === 0 ? (
                <p className="text-[13px] text-muted px-4 py-3">{t('friends.noUsersFound')}</p>
              ) : (
                <div className="max-h-[360px] overflow-y-auto">
                  {searchResults.map(user => {
                    const name = user.displayName ?? user.username ?? 'Unknown';
                    const isFollowing = followingIds.has(user.id);
                    return (
                      <div key={user.id} className="flex items-center gap-3 px-4 py-3 hover:bg-surface transition border-b border-divider last:border-0">
                        <Link href={`/profile/${user.username ?? user.id}`} onClick={() => setSearchQuery('')} className="flex-shrink-0">
                          <UserAvatar size={36} />
                        </Link>
                        <div className="flex-1 min-w-0">
                          <Link href={`/profile/${user.username ?? user.id}`} onClick={() => setSearchQuery('')} className="text-[13px] font-semibold text-ink hover:text-mid transition block truncate">
                            {name}
                          </Link>
                          {user.username && <p className="text-[11px] text-muted truncate">@{user.username}</p>}
                        </div>
                        {user.id !== myId && (
                          <button
                            onClick={() => toggleFollow(user.id)}
                            disabled={actionLoading === user.id}
                            className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition disabled:opacity-50 ${
                              isFollowing
                                ? 'bg-surface text-ink border border-divider hover:border-red-300 hover:text-red-500'
                                : 'bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] hover:opacity-80'
                            }`}
                          >
                            {isFollowing ? <><UserCheck size={12} /> {t('friends.followingBtn')}</> : <><UserPlus size={12} /> {t('friends.followBtn')}</>}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-1 mb-6 border-b border-divider">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                activeTab === key ? 'text-ink border-b-2 border-ink -mb-px' : 'text-muted hover:text-ink'
              }`}
            >
              {label} <span className="text-[11px] text-muted ml-0.5">{counts[key]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {displayUsers.map(user => {
            const name = user.displayName ?? user.username ?? 'Unknown';
            const handle = user.username ? `@${user.username}` : '';
            const isFollowing = followingIds.has(user.id);

            return (
              <div
                key={user.id}
                className="flex items-start gap-4 border border-divider rounded-xl p-4 bg-page hover:border-mid transition"
              >
                <Link href={`/profile/${user.username ?? user.id}`} className="flex-shrink-0 hover:opacity-80 transition">
                  <UserAvatar size={44} />
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/profile/${user.username ?? user.id}`} className="text-[14px] font-bold text-ink hover:text-mid transition">
                        {name}
                      </Link>
                      {handle && <p className="text-[12px] text-muted">{handle}</p>}
                      {user.bio && <p className="text-[13px] text-mid mt-1.5 leading-relaxed">{user.bio}</p>}
                    </div>
                    {user.id !== myId && (
                      <button
                        onClick={() => toggleFollow(user.id)}
                        disabled={actionLoading === user.id}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold transition disabled:opacity-50 ${
                          isFollowing
                            ? 'bg-surface text-ink border border-divider hover:border-red-300 hover:text-red-500'
                            : 'bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] hover:opacity-80'
                        }`}
                      >
                        {isFollowing ? (
                          <><UserCheck size={14} /> {t('friends.followingBtn')}</>
                        ) : (
                          <><UserPlus size={14} /> {t('friends.followBtn')}</>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {displayUsers.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <Users size={32} className="text-subtle mb-3" />
              <p className="text-[14px] text-muted">
                {activeTab === 'following'
                  ? t('friends.notFollowingAnyone')
                  : activeTab === 'followers'
                  ? t('friends.noFollowers')
                  : t('friends.noDiscover')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
