'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, UserPlus, UserCheck, Users } from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

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
  'bg-emerald-100 text-emerald-600 border-emerald-200',
  'bg-amber-100 text-amber-600 border-amber-200',
  'bg-sky-100 text-sky-600 border-sky-200',
  'bg-orange-100 text-orange-600 border-orange-200',
  'bg-pink-100 text-pink-600 border-pink-200',
  'bg-teal-100 text-teal-600 border-teal-200',
  'bg-indigo-100 text-indigo-600 border-indigo-200',
];

function getColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) & 0xffffffff;
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function FriendsPage() {
  const [myId, setMyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('following');
  const [followingUsers, setFollowingUsers] = useState<UserRow[]>([]);
  const [followerUsers, setFollowerUsers] = useState<UserRow[]>([]);
  const [discoverUsers, setDiscoverUsers] = useState<UserRow[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
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

    const excludeIds = [uid, ...fIds];
    const excludeStr = `(${excludeIds.join(',')})`;

    const [fProfiles, followerProfiles, discoverProfiles] = await Promise.all([
      fIds.length > 0
        ? supabase.from('profiles').select('id, username, display_name, bio').in('id', fIds)
        : Promise.resolve({ data: [] as any[] }),
      followerIds.length > 0
        ? supabase.from('profiles').select('id, username, display_name, bio').in('id', followerIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from('profiles')
        .select('id, username, display_name, bio')
        .not('id', 'in', excludeStr)
        .limit(20),
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

  const filterUsers = (users: UserRow[]) => {
    if (!searchQuery) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(u =>
      (u.displayName ?? '').toLowerCase().includes(q) ||
      (u.username ?? '').toLowerCase().includes(q) ||
      (u.bio ?? '').toLowerCase().includes(q)
    );
  };

  const displayUsers = filterUsers(
    activeTab === 'following' ? followingUsers :
    activeTab === 'followers' ? followerUsers :
    discoverUsers
  );

  const counts = {
    following: followingUsers.length,
    followers: followerUsers.length,
    discover: discoverUsers.length,
  };

  const hero = (
    <div className="bg-surface border-b border-[#EBEBEB]">
      <div className="max-w-[1440px] mx-auto px-5 py-12">
        <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.7px' }}>
          People
        </p>
        <h1 className="text-[38px] font-extrabold text-ink leading-[1.06]" style={{ letterSpacing: '-1.2px' }}>
          Friends
        </h1>
        <p className="text-[15px] text-muted mt-3 max-w-[500px] leading-relaxed">
          Discover people who love the same music you do.
        </p>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="bg-white min-h-screen">
        {hero}
        <div className="max-w-[720px] mx-auto px-5 py-10 pb-16 text-center">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      </div>
    );
  }

  if (!myId) {
    return (
      <div className="bg-white min-h-screen">
        {hero}
        <div className="max-w-[720px] mx-auto px-5 py-10 pb-16 text-center">
          <Users size={32} className="text-subtle mx-auto mb-4" />
          <p className="text-[14px] text-ink font-semibold mb-1">Sign in to see your friends</p>
          <p className="text-[13px] text-muted mb-6">Follow people and discover who shares your taste.</p>
          <Link
            href="/login"
            className="bg-ink text-white text-[13px] font-bold px-5 py-2.5 rounded-lg hover:opacity-80 transition inline-block"
          >
            Sign In
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white min-h-screen">
      {hero}

      <div className="max-w-[720px] mx-auto px-5 py-10 pb-16 w-full">
        <div className="bg-surface border border-divider rounded-xl px-4 py-2.5 flex items-center gap-2 mb-6">
          <Search size={15} className="text-muted flex-shrink-0" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search people…"
            className="flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-placeholder"
          />
        </div>

        <div className="flex gap-1 mb-6 border-b border-divider">
          {(['following', 'followers', 'discover'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors capitalize ${
                activeTab === tab ? 'text-ink border-b-2 border-ink -mb-px' : 'text-muted hover:text-ink'
              }`}
            >
              {tab} <span className="text-[11px] text-muted ml-0.5">{counts[tab]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          {displayUsers.map(user => {
            const name = user.displayName ?? user.username ?? 'Unknown';
            const handle = user.username ? `@${user.username}` : '';
            const initial = name[0]?.toUpperCase() ?? '?';
            const color = getColor(user.id);
            const isFollowing = followingIds.has(user.id);

            return (
              <div
                key={user.id}
                className="flex items-start gap-4 border border-divider rounded-xl p-4 bg-white hover:border-mid transition"
              >
                <Link href={`/profile/${user.username ?? user.id}`} className="flex-shrink-0">
                  <div className={`w-11 h-11 rounded-full border-2 flex items-center justify-center text-[13px] font-bold ${color}`}>
                    {initial}
                  </div>
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
                            : 'bg-ink text-white hover:opacity-80'
                        }`}
                      >
                        {isFollowing ? (
                          <><UserCheck size={14} /> Following</>
                        ) : (
                          <><UserPlus size={14} /> Follow</>
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
                {activeTab === 'discover'
                  ? searchQuery ? 'No users match your search.' : 'No new users to discover yet.'
                  : activeTab === 'following'
                  ? searchQuery ? 'No matches.' : "You're not following anyone yet."
                  : searchQuery ? 'No matches.' : 'No followers yet.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
