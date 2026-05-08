'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../lib/supabaseClient';
import Essentials from './Essentials';
import UserAvatar from './UserAvatar';
import CreateListSection from './CreateListSection';
import type { Session } from '@supabase/supabase-js';

type Tab = 'All' | 'Albums' | 'EPs' | 'Singles' | 'Compilations' | 'Lists';
const TABS: Tab[] = ['All', 'Albums', 'EPs', 'Singles', 'Compilations', 'Lists'];

type Collision = {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  myScore: number;
  friendScore: number;
  friendUsername: string;
  diff: number;
};

type Contradiction = {
  releaseId: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  myScore: number;
  communityAvg: number;
  diff: number;
  absDiff: number;
  communityCount: number;
};

interface Props {
  targetUserId?: string;
  targetUsername?: string;
}

function TypePill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-[9px] py-[2px] rounded-full bg-surface border border-[#EBEBEB] text-[11px] font-medium text-muted">
      {children}
    </span>
  );
}

function ScoreBar({ bars }: { bars: number[] }) {
  const max = Math.max(...bars, 1);
  return (
    <div>
      <div className="flex gap-[3px] items-end h-[72px]">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end">
            <div
              className="w-full rounded-[2px_2px_0_0]"
              style={{
                height: `${(h / max) * 72}px`,
                background: i >= 7 ? '#3DFFD1' : '#EBEBEB',
                minHeight: h > 0 ? 2 : 0,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface CommunityStats {
  percentile: number;
  communityAvg: number;
}

function getTasteDNA(ratings: any[]): string[] {
  if (!ratings || ratings.length < 5) return [];

  const scores = ratings.map((r) => r.score).filter(Boolean) as number[];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / scores.length;
  const sd = Math.sqrt(variance);
  const fivePct = scores.filter((s) => s === 5).length / scores.length;

  const genreCount = new Map<string, number>();
  for (const r of ratings) {
    const genreStr = r.releases?.genres as string | null;
    if (!genreStr) continue;
    for (const g of genreStr.split(',')) {
      const g2 = g.trim().toLowerCase();
      if (g2) genreCount.set(g2, (genreCount.get(g2) ?? 0) + 1);
    }
  }
  const topGenre = [...genreCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  let genreTag = '';
  if (topGenre.includes('k-pop') || topGenre.includes('korean pop')) genreTag = 'K-Pop devotee';
  else if (topGenre.includes('k-r&b') || topGenre.includes('korean r&b')) genreTag = 'K-R&B connoisseur';
  else if (topGenre.includes('k-rap') || topGenre.includes('korean hip')) genreTag = 'K-Rap head';
  else if (topGenre.includes('r&b') || topGenre.includes('soul')) genreTag = 'R&B connoisseur';
  else if (topGenre.includes('indie')) genreTag = 'Indie explorer';
  else if (topGenre.includes('rap') || topGenre.includes('hip hop') || topGenre.includes('hip-hop')) genreTag = 'Hip-hop head';
  else if (topGenre.includes('ballad')) genreTag = 'Ballad purist';
  else if (topGenre.includes('jazz')) genreTag = 'Jazz aficionado';
  else if (topGenre.includes('rock')) genreTag = 'Rock loyalist';
  else if (topGenre.includes('electronic') || topGenre.includes('synth')) genreTag = 'Electronic wanderer';
  else if (topGenre.includes('folk') || topGenre.includes('acoustic')) genreTag = 'Folk purist';
  else if (topGenre.includes('classical')) genreTag = 'Classical devotee';
  else if (topGenre.includes('pop')) genreTag = 'Pop enthusiast';

  let behaviorTag = '';
  if (avg < 2.5) behaviorTag = 'Harsh critic';
  else if (avg > 4.3) behaviorTag = 'Eternal optimist';
  else if (fivePct === 0 && scores.length >= 10) behaviorTag = 'Impossible to impress';
  else if (fivePct > 0.35) behaviorTag = 'Generous soul';
  else if (sd > 1.4) behaviorTag = 'All or nothing';
  else if (sd < 0.5 && scores.length >= 10) behaviorTag = 'Measured listener';

  return [genreTag, behaviorTag].filter(Boolean);
}

function formatGenreName(raw: string): string {
  const known: Record<string, string> = {
    'k-pop': 'K-Pop', 'korean pop': 'Korean Pop',
    'k-r&b': 'K-R&B', 'korean r&b': 'Korean R&B',
    'k-rap': 'K-Rap', 'k-indie': 'K-Indie',
    'korean hip hop': 'Korean Hip Hop', 'korean hip-hop': 'Korean Hip Hop',
    'r&b': 'R&B', 'hip hop': 'Hip Hop', 'hip-hop': 'Hip Hop',
    'rnb': 'R&B', 'lo-fi': 'Lo-Fi', 'lo fi': 'Lo-Fi',
    'j-pop': 'J-Pop', 'j-rock': 'J-Rock', 'city pop': 'City Pop',
    'alt-rock': 'Alt-Rock', 'alt rock': 'Alt-Rock',
    'indie rock': 'Indie Rock', 'indie pop': 'Indie Pop',
    'singer-songwriter': 'Singer-Songwriter',
    'post-punk': 'Post-Punk', 'post-rock': 'Post-Rock',
    'bedroom pop': 'Bedroom Pop', 'dream pop': 'Dream Pop',
    'shoegaze': 'Shoegaze', 'emo': 'Emo',
  };
  return known[raw] ?? raw.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getTopGenres(ratings: any[]): { name: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const r of ratings) {
    const genreStr = r.releases?.genres as string | null;
    if (!genreStr) continue;
    for (const g of genreStr.split(',')) {
      const g2 = g.trim().toLowerCase();
      if (g2) tally.set(g2, (tally.get(g2) ?? 0) + 1);
    }
  }
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([raw, count]) => ({ name: formatGenreName(raw), count }));
}

interface MonthlyCapsule {
  monthLabel: string;
  count: number;
  topGenre: string | null;
  highest: { title: string; score: number } | null;
  lowest: { title: string; score: number } | null;
}

function getMonthlyCapsule(ratings: any[]): MonthlyCapsule | null {
  if (!ratings || ratings.length === 0) return null;

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();

  let monthRatings = ratings.filter((r) => {
    const d = new Date(r.created_at);
    return d.getFullYear() === year && d.getMonth() === month;
  });

  if (monthRatings.length === 0) {
    month = month === 0 ? 11 : month - 1;
    if (month === 11) year -= 1;
    monthRatings = ratings.filter((r) => {
      const d = new Date(r.created_at);
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }

  if (monthRatings.length === 0) return null;

  const monthLabel = new Date(year, month).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const scored = monthRatings.filter((r) => r.score);
  const highest = scored.length > 0 ? scored.reduce((a: any, b: any) => a.score > b.score ? a : b) : null;
  const lowest = scored.length > 0 ? scored.reduce((a: any, b: any) => a.score < b.score ? a : b) : null;

  const genreCount = new Map<string, number>();
  for (const r of monthRatings) {
    const genreStr = r.releases?.genres as string | null;
    if (!genreStr) continue;
    for (const g of genreStr.split(',')) {
      const g2 = g.trim().toLowerCase();
      if (g2) genreCount.set(g2, (genreCount.get(g2) ?? 0) + 1);
    }
  }
  const topGenreRaw = [...genreCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topGenre = topGenreRaw
    ? topGenreRaw.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : null;

  return {
    monthLabel,
    count: monthRatings.length,
    topGenre,
    highest: highest ? { title: highest.releases?.title ?? '—', score: highest.score } : null,
    lowest: lowest && lowest.release_id !== highest?.release_id ? { title: lowest.releases?.title ?? '—', score: lowest.score } : null,
  };
}

function getRatingInsights(ratings: any[], communityStats: CommunityStats | null): string[] {
  const scores = (ratings ?? []).map((r) => r.score).filter(Boolean) as number[];
  if (scores.length < 3) return [];

  const insights: string[] = [];
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  if (communityStats && scores.length >= 5) {
    const p = communityStats.percentile;
    if (p <= 25) insights.push(`You rate harder than ${100 - p}% of users`);
    else if (p >= 75) insights.push(`You're more generous than ${p}% of users`);
    else insights.push(`Your ratings land close to the community average`);
  }

  const fiveCount = scores.filter((s) => s === 5).length;
  const fivePct = fiveCount / scores.length;
  if (fiveCount === 0) insights.push(`You've never given a perfect score`);
  else if (fivePct < 0.05) insights.push(`Perfect scores are rare for you — only ${fiveCount} given`);
  else if (fivePct > 0.3) insights.push(`${Math.round(fivePct * 100)}% of your ratings are perfect scores`);

  const lowCount = scores.filter((s) => s <= 2).length;
  const lowPct = lowCount / scores.length;
  if (lowPct > 0.25) insights.push(`You're not afraid to rate low — ${Math.round(lowPct * 100)}% are 2★ or below`);

  if (scores.length >= 10) {
    const variance = scores.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / scores.length;
    const sd = Math.sqrt(variance);
    if (sd > 1.4) insights.push(`Your taste is polarizing — you love or hate almost everything`);
    else if (sd < 0.6) insights.push(`You're a measured rater — rarely surprised or disappointed`);
  }

  return insights.slice(0, 3);
}

export default function ProfilePanel({ targetUserId, targetUsername }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [ratings, setRatings] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('All');
  const [communityStats, setCommunityStats] = useState<CommunityStats | null>(null);
  const [lists, setLists] = useState<any[]>([]);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [usernameFromProfile, setUsernameFromProfile] = useState<string | null>(null);
  const [bioText, setBioText] = useState<string | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [commentCount, setCommentCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [collisions, setCollisions] = useState<Collision[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [sortOrder, setSortOrder] = useState<'recent' | 'score-high' | 'score-low' | 'alpha'>('recent');
  const [showSortMenu, setShowSortMenu] = useState(false);

  const ratingsCount = ratings?.length ?? 0;
  const averageRating =
    ratingsCount > 0
      ? Math.round((ratings!.reduce((s: number, r: any) => s + (r.score || 0), 0) / ratingsCount) * 10) / 10
      : 0;

  const bars = Array.from({ length: 10 }, (_, i) => {
    const target = (i + 1) * 0.5;
    return ratings?.filter((r) => r.score === target).length ?? 0;
  });

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      const effectiveId = targetUserId ?? data.session?.user?.id;
      if (effectiveId) {
        fetchData(effectiveId, data.session?.user?.id ?? null, data.session?.user?.email ?? null);
      } else {
        setLoading(false);
      }
    });
  }, [targetUserId]);


  const fetchData = async (userId: string, currentUserId: string | null, currentUserEmail: string | null = null) => {
    if (!supabase) { setLoading(false); return; }

    const isOwn = !targetUserId || userId === currentUserId;

    const [profileRes, ratingsRes, allRatingsRes, listsRes, followersRes, followingRes, commentsRes] = await Promise.all([
      supabase.from('profiles').select('display_name, username, bio').eq('id', userId).maybeSingle(),
      supabase
        .from('ratings')
        .select('id, score, status, note, created_at, release_id, releases(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('ratings')
        .select('user_id, score'),
      supabase
        .from('lists')
        .select('id, title, description, created_at, list_items(count)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('following_id', userId),
      supabase
        .from('follows')
        .select('*', { count: 'exact', head: true })
        .eq('follower_id', userId),
      supabase
        .from('reviews')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);

    const prof = profileRes.data;
    if (prof?.display_name) setDisplayName(prof.display_name);
    if (prof?.username) setUsernameFromProfile(prof.username);
    if (prof?.bio) setBioText(prof.bio);

    setLists(listsRes.data ?? []);
    setRatings(ratingsRes.data ?? []);
    setFollowerCount(followersRes.count ?? 0);
    setFollowingCount(followingRes.count ?? 0);
    setCommentCount(commentsRes.count ?? 0);

    if (!isOwn && currentUserId) {
      const { data: followCheck } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('follower_id', currentUserId)
        .eq('following_id', userId)
        .maybeSingle();
      setIsFollowing(!!followCheck);
    }

    // Compute percentile
    const allRatings = allRatingsRes.data;
    if (allRatings && allRatings.length > 0) {
      const userMap = new Map<string, number[]>();
      for (const r of allRatings) {
        if (!r.score) continue;
        if (!userMap.has(r.user_id)) userMap.set(r.user_id, []);
        userMap.get(r.user_id)!.push(r.score);
      }
      const userAvgs = [...userMap.entries()].map(([id, scores]) => ({
        id,
        avg: scores.reduce((a: number, b: number) => a + b, 0) / scores.length,
      }));
      const currentAvg = userAvgs.find((u) => u.id === userId)?.avg ?? null;
      const allScores = allRatings.map((r: any) => r.score).filter(Boolean) as number[];
      const communityAvg = allScores.reduce((a: number, b: number) => a + b, 0) / allScores.length;

      if (currentAvg !== null && userAvgs.length > 1) {
        const below = userAvgs.filter((u) => u.avg < currentAvg).length;
        const percentile = Math.round((below / (userAvgs.length - 1)) * 100);
        setCommunityStats({ percentile, communityAvg: Math.round(communityAvg * 10) / 10 });
      }
    }

    // Fetch taste collisions and contradictions (own profile only)
    if (isOwn) {
      fetch(`/api/collisions?userId=${userId}`)
        .then((r) => r.json())
        .then((json) => setCollisions(json.collisions ?? []))
        .catch(() => {});
      fetch(`/api/contradictions?userId=${userId}`)
        .then((r) => r.json())
        .then((json) => setContradictions(json.contradictions ?? []))
        .catch(() => {});
    }

    setLoading(false);
  };

  const handleFollow = async () => {
    if (!session?.user || !targetUserId || followLoading) return;
    setFollowLoading(true);
    try {
      await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followerId: session.user.id, followingId: targetUserId }),
      });
      setIsFollowing(true);
      setFollowerCount((c) => c + 1);
    } finally {
      setFollowLoading(false);
    }
  };

  const handleUnfollow = async () => {
    if (!session?.user || !targetUserId || followLoading) return;
    setFollowLoading(true);
    try {
      await fetch('/api/follow', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followerId: session.user.id, followingId: targetUserId }),
      });
      setIsFollowing(false);
      setFollowerCount((c) => Math.max(0, c - 1));
    } finally {
      setFollowLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white">
        <div className="bg-white border-b border-[#EBEBEB]">
          <div className="max-w-[1440px] mx-auto px-5 pt-9 pb-8 flex gap-6 items-start">
            <div className="w-[82px] h-[82px] rounded-full bg-surface animate-pulse flex-shrink-0" />
            <div className="flex-1 space-y-3 pt-2">
              <div className="h-5 bg-surface animate-pulse rounded w-40" />
              <div className="flex gap-8 mt-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-5 bg-surface animate-pulse rounded w-8" />
                    <div className="h-3 bg-surface animate-pulse rounded w-16" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="max-w-[1440px] mx-auto px-5 py-9">
          <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i}>
                <div className="aspect-square rounded-[6px] bg-surface animate-pulse" />
                <div className="h-2.5 bg-surface animate-pulse rounded mt-2 w-4/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isOwnProfile = !targetUserId || targetUserId === session?.user?.id;

  if (!isOwnProfile && !targetUserId) {
    return (
      <div className="max-w-[1440px] mx-auto px-5 py-16 text-center">
        <p className="text-xl font-bold text-ink mb-2">User not found</p>
      </div>
    );
  }

  if (isOwnProfile && !session?.user) {
    return (
      <div className="max-w-[1440px] mx-auto px-5 py-16 text-center">
        <p className="text-xl font-bold text-ink mb-2">Sign in to view your profile</p>
        <p className="text-sm text-muted mb-8">Track your album ratings, build your music catalog, and discover new recommendations.</p>
        <Link
          href="/login"
          className="inline-flex rounded-lg bg-ink px-6 py-3 text-sm font-semibold text-white hover:opacity-80 transition"
        >
          Go to login
        </Link>
      </div>
    );
  }

  const effectiveUserId = targetUserId ?? session!.user.id;
  const username = targetUsername ?? usernameFromProfile ?? session?.user?.email?.split('@')[0] ?? '—';
  const profileDisplayName = displayName ?? username;
  const initial = profileDisplayName[0]?.toUpperCase() ?? '?';

  const filteredRatings = (ratings ?? []).filter((r) => {
    if (activeTab === 'All') return true;
    const type = r.releases?.release_type ?? '';
    if (activeTab === 'Albums') return type === 'Album';
    if (activeTab === 'EPs') return type === 'EP';
    if (activeTab === 'Singles') return type === 'Single';
    if (activeTab === 'Compilations') return type === 'Compilation';
    return true;
  }).sort((a, b) => {
    if (sortOrder === 'score-high') return (b.score ?? 0) - (a.score ?? 0);
    if (sortOrder === 'score-low') return (a.score ?? 0) - (b.score ?? 0);
    if (sortOrder === 'alpha') return (a.releases?.title ?? '').localeCompare(b.releases?.title ?? '');
    return 0;
  });

  const SORT_LABELS = { recent: 'Recently rated', 'score-high': 'Highest rated', 'score-low': 'Lowest rated', alpha: 'A–Z' } as const;

  const tasteDNA = getTasteDNA(ratings ?? []);
  const capsule = getMonthlyCapsule(ratings ?? []);
  const topGenres = getTopGenres(ratings ?? []);

  return (
    <div className="bg-white">
      {/* ── HEADER ─────────────────────────────────────────── */}
      <div className="bg-white border-b border-[#EBEBEB]">
        <div className="max-w-[1440px] mx-auto px-5 pt-9 pb-8 flex gap-6 items-start">
          {/* Avatar */}
          <UserAvatar size={82} />

          {/* Info */}
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <h1
                className="text-[24px] font-extrabold text-ink"
                style={{ letterSpacing: '-0.6px' }}
              >
                @{username}
              </h1>
              {displayName && displayName !== username && (
                <p className="text-[13px] text-muted">{displayName}</p>
              )}
            </div>

            {/* Stats */}
            <div className="flex gap-8 mt-[18px]">
              {[
                [ratingsCount, 'albums rated'],
                [followerCount, 'followers'],
                [followingCount, 'following'],
              ].map(([val, label]) => (
                <div key={label as string}>
                  <div className="text-[20px] font-bold text-ink">{val}</div>
                  <div className="text-[12px] text-muted mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            {bioText && (
              <p className="text-[13px] text-muted mt-1 max-w-[480px] leading-relaxed">{bioText}</p>
            )}
            {tasteDNA.length > 0 && (
              <div className="flex gap-2 mt-3 flex-wrap">
                {tasteDNA.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-[10px] py-[3px] rounded-full text-[11px] font-semibold"
                    style={{ background: '#EDFFF9', border: '1.5px solid #3DFFD1', color: '#00453A' }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {isOwnProfile ? (
              <Link href="/settings" className="border border-[#EBEBEB] rounded-lg px-[18px] py-[9px] text-[13px] font-semibold text-ink hover:bg-surface transition">
                Edit profile
              </Link>
            ) : session?.user ? (
              <button
                onClick={isFollowing ? handleUnfollow : handleFollow}
                disabled={followLoading}
                className={`rounded-lg px-[18px] py-[9px] text-[13px] font-semibold transition ${
                  isFollowing
                    ? 'border border-[#EBEBEB] text-ink hover:bg-surface'
                    : 'bg-ink text-white hover:opacity-80'
                } disabled:opacity-50`}
              >
                {followLoading ? '…' : isFollowing ? 'Following' : 'Follow'}
              </button>
            ) : null}
          </div>
        </div>

      </div>

      {/* ── BODY ─────────────────────────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-5 py-9 pb-14">
        <div className="flex flex-col md:flex-row gap-8">

          {/* LEFT: stats sidebar */}
          <div className="w-full md:w-[220px] flex-shrink-0 flex flex-row md:flex-col gap-4 overflow-x-auto md:overflow-visible pb-2 md:pb-0">

            <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 min-w-[140px] md:min-w-0">
              <p className="text-[11px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.6px' }}>Avg Score</p>
              <p className="text-[32px] font-extrabold text-ink tracking-tight">{averageRating > 0 ? averageRating.toFixed(1) : '—'}</p>
              <p className="text-[12px] text-muted">out of 5</p>
            </div>

            <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 min-w-[180px] md:min-w-0">
              <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.6px' }}>Distribution</p>
              <ScoreBar bars={bars} />
            </div>

            <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 min-w-[160px] md:min-w-0">
              <p className="text-[11px] font-semibold text-muted uppercase mb-3" style={{ letterSpacing: '0.6px' }}>Top Genres</p>
              {topGenres.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {topGenres.map(({ name, count }) => (
                    <div key={name}>
                      <div className="flex justify-between items-center mb-[4px]">
                        <span className="text-[12px] font-medium text-ink">{name}</span>
                        <span className="text-[11px] text-muted">{count}</span>
                      </div>
                      <div className="h-[3px] bg-[#EBEBEB] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(count / topGenres[0].count) * 100}%`, background: '#3DFFD1' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-muted">Rate more albums to see your top genres.</p>
              )}
            </div>

            {capsule && (
              <div className="bg-white rounded-xl border border-[#EBEBEB] p-4 min-w-[180px] md:min-w-0">
                <p className="text-[11px] font-semibold text-muted uppercase mb-2" style={{ letterSpacing: '0.6px' }}>Monthly Capsule</p>
                <p className="text-[14px] font-extrabold text-ink mb-3" style={{ letterSpacing: '-0.3px' }}>{capsule.monthLabel}</p>
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between">
                    <span className="text-[12px] text-muted">Albums rated</span>
                    <span className="text-[12px] font-semibold text-ink">{capsule.count}</span>
                  </div>
                  {capsule.topGenre && (
                    <div className="flex justify-between">
                      <span className="text-[12px] text-muted">Top genre</span>
                      <span className="text-[12px] font-semibold text-ink">{capsule.topGenre}</span>
                    </div>
                  )}
                  {capsule.highest && (
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[12px] text-muted flex-shrink-0">Highest</span>
                      <span className="text-[12px] font-semibold text-ink text-right truncate">
                        {capsule.highest.title}<span style={{ color: '#00453A' }}> — {capsule.highest.score}</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* RIGHT: catalog */}
          <div className="flex-1 min-w-0">
            {/* Essentials */}
            <Essentials userId={effectiveUserId} canEdit={isOwnProfile} />

            {/* Tabs + Sort */}
            <div className="flex items-end justify-between mb-6 border-b border-[#EBEBEB]">
              <div className="flex gap-1 overflow-x-auto scrollbar-hide">
                {TABS.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-3 text-[13px] font-semibold whitespace-nowrap transition-colors ${
                      activeTab === tab ? 'text-ink border-b-2 border-ink -mb-px' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              {activeTab !== 'Lists' && (
                <div className="relative pb-2 flex-shrink-0">
                  <button
                    onClick={() => setShowSortMenu(s => !s)}
                    className="text-[12px] font-medium text-muted hover:text-ink transition px-2 py-[13px]"
                  >
                    {SORT_LABELS[sortOrder]} ↓
                  </button>
                  {showSortMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white border border-[#EBEBEB] rounded-[10px] shadow-lg z-20 py-1 min-w-[150px]">
                      {(Object.entries(SORT_LABELS) as [typeof sortOrder, string][]).map(([key, label]) => (
                        <button
                          key={key}
                          onClick={() => { setSortOrder(key); setShowSortMenu(false); }}
                          className={`w-full text-left px-4 py-2 text-[12px] transition ${
                            sortOrder === key ? 'font-semibold text-ink' : 'text-muted hover:text-ink'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Lists content */}
            {activeTab === 'Lists' && (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <p className="text-[13px] text-muted">{lists.length} {lists.length === 1 ? 'list' : 'lists'}</p>
                  {isOwnProfile && <CreateListSection />}
                </div>
                {lists.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-sm text-muted">
                      {isOwnProfile ? 'No lists yet. Create one to organize your albums.' : 'No lists yet.'}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                    {lists.map((list) => (
                      <Link
                        key={list.id}
                        href={`/lists/${list.id}`}
                        className="border border-[#EBEBEB] rounded-[10px] p-4 hover:bg-surface transition block"
                      >
                        <div className="text-[14px] font-bold text-ink truncate">{list.title}</div>
                        {list.description && (
                          <p className="text-[12px] text-muted mt-1 line-clamp-2">{list.description}</p>
                        )}
                        <p className="text-[11px] text-muted mt-3">
                          {list.list_items?.[0]?.count ?? 0} albums
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Album grid */}
            {activeTab !== 'Lists' && (
              <div>
                {filteredRatings.length === 0 ? (
                  <div className="py-16 text-center">
                    <p className="text-sm text-muted">No ratings yet. Search for albums and rate them.</p>
                  </div>
                ) : (
                  <div className="grid gap-[14px]" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
                    {filteredRatings.map((rating) => (
                      <Link key={rating.id} href={`/album/${rating.release_id}`} className="block min-w-0">
                        <div className="relative overflow-hidden rounded-[6px]" style={{ aspectRatio: '1 / 1' }}>
                          {rating.releases?.cover_url ? (
                            <img
                              src={rating.releases.cover_url}
                              alt={rating.releases.title}
                              className="absolute inset-0 w-full h-full object-cover"
                            />
                          ) : (
                            <div className="absolute inset-0 bg-surface border border-[#EBEBEB]" />
                          )}
                          {rating.score && (
                            <div
                              className="absolute bottom-1 right-1 text-[11px] font-bold rounded-[4px] px-[6px] py-[2px]"
                              style={{ background: '#3DFFD1', color: '#00453A' }}
                            >
                              ★ {rating.score}
                            </div>
                          )}
                        </div>
                        <div
                          className="mt-[7px] text-[12px] font-semibold text-ink truncate"
                          title={rating.releases?.title}
                        >
                          {rating.releases?.title ?? rating.release_id}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── TASTE INSIGHTS (own profile, data must exist) ───────── */}
      {isOwnProfile && session?.user && (collisions.length > 0 || contradictions.length > 0) && (
        <div className="max-w-[1440px] mx-auto px-5 pb-14 flex flex-col gap-10">
          <div className="h-px bg-[#EBEBEB]" />

          {/* Taste Collisions */}
          {collisions.length > 0 && (
            <div>
              <h2 className="text-[18px] font-extrabold text-ink" style={{ letterSpacing: '-0.4px' }}>
                Taste Collisions
              </h2>
              <p className="text-[13px] text-muted mt-0.5 mb-5">
                Albums where you and someone you follow strongly disagree
              </p>
              <div className="flex flex-col max-w-[680px]">
                {collisions.map((c, i) => (
                  <div key={`${c.releaseId}-${i}`} className="flex gap-4 py-4 border-b border-[#EBEBEB] last:border-0">
                    <Link href={`/album/${c.releaseId}`} className="flex-shrink-0">
                      {c.coverUrl ? (
                        <img src={c.coverUrl} alt={c.title} className="w-[48px] h-[48px] rounded-[6px] object-cover" />
                      ) : (
                        <div className="w-[48px] h-[48px] rounded-[6px] bg-surface border border-[#EBEBEB]" />
                      )}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <Link href={`/album/${c.releaseId}`}>
                        <p className="text-[13px] font-bold text-ink truncate hover:text-mid transition">{c.title}</p>
                      </Link>
                      <p className="text-[11px] text-muted mt-0.5 truncate">{c.artist}</p>
                      <div className="flex items-center gap-3 mt-2">
                        <span className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px]" style={{ background: '#3DFFD1', color: '#00453A' }}>
                          You ★{c.myScore}
                        </span>
                        <span className="text-[11px] text-muted">vs</span>
                        <span className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px] bg-surface border border-[#EBEBEB] text-ink">
                          {c.friendUsername} ★{c.friendScore}
                        </span>
                        <span className="ml-auto text-[11px] font-semibold" style={{ color: c.diff >= 3 ? '#E53E3E' : c.diff >= 2 ? '#DD6B20' : '#718096' }}>
                          ±{c.diff.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Taste Contradictions */}
          {contradictions.length > 0 && (() => {
            const higher = contradictions.filter((c) => c.diff > 0);
            const lower = contradictions.filter((c) => c.diff < 0);
            return (
              <div>
                <h2 className="text-[18px] font-extrabold text-ink" style={{ letterSpacing: '-0.4px' }}>
                  Taste Contradictions
                </h2>
                <p className="text-[13px] text-muted mt-0.5 mb-5">
                  Albums where your score strongly disagrees with the community
                </p>
                <div className="max-w-[680px]">
                  {higher.length > 0 && (
                    <div className="mb-8">
                      <p className="text-[13px] font-bold text-ink mb-4">You rated higher</p>
                      <div className="flex flex-col">
                        {higher.map((c, i) => (
                          <div key={`${c.releaseId}-h-${i}`} className="flex gap-4 py-4 border-b border-[#EBEBEB] last:border-0">
                            <Link href={`/album/${c.releaseId}`} className="flex-shrink-0">
                              {c.coverUrl ? (
                                <img src={c.coverUrl} alt={c.title} className="w-[48px] h-[48px] rounded-[6px] object-cover" />
                              ) : (
                                <div className="w-[48px] h-[48px] rounded-[6px] bg-surface border border-[#EBEBEB]" />
                              )}
                            </Link>
                            <div className="flex-1 min-w-0">
                              <Link href={`/album/${c.releaseId}`}>
                                <p className="text-[13px] font-bold text-ink truncate hover:text-mid transition">{c.title}</p>
                              </Link>
                              <p className="text-[11px] text-muted mt-0.5 truncate">{c.artist}</p>
                              <div className="flex items-center gap-3 mt-2">
                                <span className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px]" style={{ background: '#3DFFD1', color: '#00453A' }}>
                                  You ★{c.myScore}
                                </span>
                                <span className="text-[11px] text-muted">vs</span>
                                <span className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px] bg-surface border border-[#EBEBEB] text-ink">
                                  Community ★{c.communityAvg}
                                </span>
                                <span className="text-[11px] text-muted">({c.communityCount})</span>
                                <span className="ml-auto text-[11px] font-semibold" style={{ color: c.absDiff >= 3 ? '#E53E3E' : c.absDiff >= 2 ? '#DD6B20' : '#718096' }}>
                                  +{c.diff.toFixed(1)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {lower.length > 0 && (
                    <div>
                      <p className="text-[13px] font-bold text-ink mb-4">You rated lower</p>
                      <div className="flex flex-col">
                        {lower.map((c, i) => (
                          <div key={`${c.releaseId}-l-${i}`} className="flex gap-4 py-4 border-b border-[#EBEBEB] last:border-0">
                            <Link href={`/album/${c.releaseId}`} className="flex-shrink-0">
                              {c.coverUrl ? (
                                <img src={c.coverUrl} alt={c.title} className="w-[48px] h-[48px] rounded-[6px] object-cover" />
                              ) : (
                                <div className="w-[48px] h-[48px] rounded-[6px] bg-surface border border-[#EBEBEB]" />
                              )}
                            </Link>
                            <div className="flex-1 min-w-0">
                              <Link href={`/album/${c.releaseId}`}>
                                <p className="text-[13px] font-bold text-ink truncate hover:text-mid transition">{c.title}</p>
                              </Link>
                              <p className="text-[11px] text-muted mt-0.5 truncate">{c.artist}</p>
                              <div className="flex items-center gap-3 mt-2">
                                <span className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px]" style={{ background: '#3DFFD1', color: '#00453A' }}>
                                  You ★{c.myScore}
                                </span>
                                <span className="text-[11px] text-muted">vs</span>
                                <span className="inline-flex items-center text-[11px] font-bold rounded-[4px] px-[7px] py-[2px] bg-surface border border-[#EBEBEB] text-ink">
                                  Community ★{c.communityAvg}
                                </span>
                                <span className="text-[11px] text-muted">({c.communityCount})</span>
                                <span className="ml-auto text-[11px] font-semibold" style={{ color: c.absDiff >= 3 ? '#E53E3E' : c.absDiff >= 2 ? '#DD6B20' : '#718096' }}>
                                  {c.diff.toFixed(1)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
