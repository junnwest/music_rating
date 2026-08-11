'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Flame, ListMusic, UserPlus } from 'lucide-react';
import Avatar from '../../components/sj/Avatar';
import { useContextMenuFor, openInNewTab } from '../../components/sj/ContextMenu';
import FeedCard from '../../components/sj/FeedCard';
import TitleTabs from '../../components/sj/TitleTabs';
import AlbumPeek from '../../components/sj/AlbumPeek';
import Cover from '../../components/sj/Cover';
import { SkeletonBlock } from '../../components/sj/Loading';
import { useSession } from '../../components/sj/SessionContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { FEED_SELECT, type FeedItemRow } from '../../lib/sj/data';
import { fetchFeed, fetchChartsSummary } from '../../lib/sj/apiClient';
import { fetchNotInterestedIds, markNotInterested } from '../../lib/sj/notInterested';
import { displayName } from '../../lib/sj/display';
import type { ChartTrendingRPC, SuggestedUserRPC } from '../../lib/db/types';

type FeedTab = 'explore' | 'following';

/**
 * Home — the social feed (web sibling of iOS HomeView). Explore = ranked
 * global pool; Following = people you follow. Desktop adds a right rail
 * (find-people + trending) instead of burying them behind navigation.
 */
export default function HomePage() {
  const { t } = useLanguage();
  const { userId, ready, requireAuth } = useSession();
  const [tab, setTab] = useState<FeedTab>('explore');
  const [exploreItems, setExploreItems] = useState<FeedItemRow[]>([]);
  const [followingItems, setFollowingItems] = useState<FeedItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [notInterested, setNotInterested] = useState<Set<string>>(new Set());
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // The global explore pool + its like/comment counts come from the cached
    // /api/feed route (service role + Redis/CDN) — started first so it races
    // the per-user signal queries below. Falls back to the direct query if
    // the route is down.
    const cachedFeedPromise = fetchFeed().catch(() => null);

    // Personalization signals (must resolve before ranking)
    let followingIds = new Set<string>();
    let likedArtists = new Set<string>();
    let blocked = new Set<string>();
    let dismissed = new Set<string>();
    if (userId) {
      const [followsRes, artistsRes, blockedRes, dismissedIds] = await Promise.all([
        supabase.from('follows').select('following_id').eq('follower_id', userId),
        supabase
          .from('ratings')
          .select('release_groups(artist_display)')
          .eq('user_id', userId)
          .gte('score', 4.0),
        supabase.from('blocked_users').select('blocked_id').eq('blocker_id', userId),
        fetchNotInterestedIds(userId),
      ]);
      followingIds = new Set(
        ((followsRes.data as { following_id: string }[] | null) ?? []).map((r) => r.following_id),
      );
      likedArtists = new Set(
        ((artistsRes.data as any[] | null) ?? [])
          .map((r) => r.release_groups?.artist_display)
          .filter(Boolean),
      );
      blocked = new Set(
        ((blockedRes.data as { blocked_id: string }[] | null) ?? []).map((r) => r.blocked_id),
      );
      dismissed = dismissedIds;
      setNotInterested(dismissed);
    }

    // Explore pool. A failed query is an error state, NOT an empty catalog —
    // don't let a timeout masquerade as "no ratings yet".
    const cachedFeed = await cachedFeedPromise;
    const lCounts: Record<string, number> = {};
    const cCounts: Record<string, number> = {};
    let pool: FeedItemRow[];
    let poolFailed = false;
    if (cachedFeed) {
      pool = cachedFeed.items.filter((i) => !blocked.has(i.user_id));
      Object.assign(lCounts, cachedFeed.likeCounts);
      Object.assign(cCounts, cachedFeed.commentCounts);
    } else {
      const { data: poolData, error: poolError } = await supabase
        .from('ratings')
        .select(FEED_SELECT)
        .order('created_at', { ascending: false })
        .limit(150);
      poolFailed = !!poolError && !poolData;
      pool = ((poolData as unknown as FeedItemRow[] | null) ?? []).filter(
        (i) => !blocked.has(i.user_id),
      );
    }
    setLoadFailed(poolFailed);

    // Albums the user marked "Not interested" never come back in explore. The
    // Following feed is deliberately left alone — that's people you chose to
    // follow, not a recommendation.
    if (dismissed.size > 0) pool = pool.filter((i) => !dismissed.has(i.release_groups.id));

    // Following feed
    let following: FeedItemRow[] = [];
    if (followingIds.size > 0) {
      const { data: fData } = await supabase
        .from('ratings')
        .select(FEED_SELECT)
        .in('user_id', Array.from(followingIds))
        .order('created_at', { ascending: false })
        .limit(60);
      following = ((fData as unknown as FeedItemRow[] | null) ?? []).filter(
        (i) => !blocked.has(i.user_id),
      );
    }

    // Social data. The cached payload already carries counts for the pool —
    // only items it doesn't cover (following feed; whole pool on fallback)
    // need a live count query. My-likes/saves are always per-user.
    const allItems = [...pool, ...following];
    const ratingIds = Array.from(new Set(allItems.map((i) => i.id)));
    const liveCountIds = Array.from(
      new Set([...(cachedFeed ? [] : pool.map((i) => i.id)), ...following.map((i) => i.id)]),
    );
    const liked = new Set<string>();
    if (ratingIds.length > 0) {
      const [likesRes, commentsRes, myLikesRes] = await Promise.all([
        liveCountIds.length > 0
          ? supabase.from('rating_likes').select('rating_id').in('rating_id', liveCountIds)
          : Promise.resolve({ data: null }),
        liveCountIds.length > 0
          ? supabase.from('rating_comments').select('rating_id').in('rating_id', liveCountIds)
          : Promise.resolve({ data: null }),
        userId
          ? supabase
              .from('rating_likes')
              .select('rating_id')
              .eq('user_id', userId)
              .in('rating_id', ratingIds)
          : Promise.resolve({ data: null }),
      ]);
      // Live counts overwrite (not add to) any cached values for the same ids
      const freshL: Record<string, number> = {};
      const freshC: Record<string, number> = {};
      for (const r of (likesRes.data as { rating_id: string }[] | null) ?? []) {
        freshL[r.rating_id] = (freshL[r.rating_id] ?? 0) + 1;
      }
      for (const r of (commentsRes.data as { rating_id: string }[] | null) ?? []) {
        freshC[r.rating_id] = (freshC[r.rating_id] ?? 0) + 1;
      }
      for (const id of liveCountIds) {
        lCounts[id] = freshL[id] ?? 0;
        cCounts[id] = freshC[id] ?? 0;
      }
      for (const r of (myLikesRes.data as { rating_id: string }[] | null) ?? []) {
        liked.add(r.rating_id);
      }
    }

    // Rank explore (mirrors iOS HomeViewModel.ranked)
    const ranked = pool
      .map((item) => {
        let s = 0;
        if (followingIds.has(item.user_id)) s += 8;
        if (likedArtists.has(item.release_groups.artist_display)) s += 5;
        s += Math.log((lCounts[item.id] ?? 0) + 1) * 5;
        s += Math.log((cCounts[item.id] ?? 0) + 1) * 3;
        const ageHours = (Date.now() - new Date(item.created_at).getTime()) / 3.6e6;
        if (ageHours < 12) s += 3;
        else if (ageHours < 72) s += 1.5;
        else if (ageHours < 336) s += 0.5;
        return [item, s] as const;
      })
      .sort((a, b) => b[1] - a[1])
      .map(([item]) => item)
      .slice(0, 60);

    setExploreItems(ranked);
    setFollowingItems(following);
    setLikeCounts(lCounts);
    setCommentCounts(cCounts);
    setLikedIds(liked);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  async function toggleLike(item: FeedItemRow) {
    if (!supabase) return;
    if (!requireAuth() || !userId) return;
    const wasLiked = likedIds.has(item.id);
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    setLikeCounts((prev) => ({
      ...prev,
      [item.id]: Math.max(0, (prev[item.id] ?? 0) + (wasLiked ? -1 : 1)),
    }));
    if (wasLiked) {
      await supabase
        .from('rating_likes')
        .delete()
        .eq('user_id', userId)
        .eq('rating_id', item.id);
    } else {
      await supabase.from('rating_likes').insert({ user_id: userId, rating_id: item.id });
    }
  }

  async function notInterestedAlbum(releaseGroupId: string) {
    if (!userId) return;
    setNotInterested((prev) => new Set(prev).add(releaseGroupId));
    await markNotInterested(userId, releaseGroupId);
  }

  async function blockUser(blockedUserId: string) {
    if (!supabase || !userId || blockedUserId === userId) return;
    setExploreItems((items) => items.filter((i) => i.user_id !== blockedUserId));
    setFollowingItems((items) => items.filter((i) => i.user_id !== blockedUserId));
    await supabase
      .from('blocked_users')
      .insert({ blocker_id: userId, blocked_id: blockedUserId });
  }

  // Explore drops dismissed albums immediately (the load-time filter only sees
  // what was already persisted when the feed was fetched).
  const items =
    tab === 'explore'
      ? exploreItems.filter((i) => !notInterested.has(i.release_groups.id))
      : followingItems;

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-5 flex gap-8">
      {/* ── Feed column ── */}
      <div className="flex-1 min-w-0 max-w-2xl">
        <div className="mb-4">
          <TitleTabs
            tabs={[
              { key: 'explore' as FeedTab, label: t('sj.home.explore') },
              { key: 'following' as FeedTab, label: t('sj.home.following') },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>

        {loading ? (
          <FeedSkeleton />
        ) : loadFailed && items.length === 0 ? (
          <div className="py-24 flex flex-col items-center gap-4 text-center">
            <ListMusic size={40} className="text-divider" />
            <p className="text-[15px] text-muted max-w-[280px]">{t('sj.common.loadError')}</p>
            <button
              onClick={() => load()}
              className="px-4 py-2 rounded-[10px] bg-accent text-white text-[13.5px] font-semibold hover:opacity-90 transition"
            >
              {t('sj.common.retry')}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="py-24 flex flex-col items-center gap-4 text-center">
            <ListMusic size={40} className="text-divider" />
            <p className="text-[15px] text-muted max-w-[260px]">
              {tab === 'explore' ? t('sj.home.emptyExplore') : t('sj.home.emptyFollowing')}
            </p>
            {tab === 'explore' ? (
              <Link
                href="/search"
                className="px-4 py-2 rounded-[10px] bg-accent text-white text-[13.5px] font-semibold hover:opacity-90 transition"
              >
                {t('sj.home.emptyExploreCta')}
              </Link>
            ) : (
              <button
                onClick={() => setTab('explore')}
                className="px-4 py-2 rounded-[10px] bg-accent text-white text-[13.5px] font-semibold hover:opacity-90 transition"
              >
                {t('sj.home.emptyFollowingCta')}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5 pb-10">
            {items.map((item) => (
              <FeedCard
                key={item.id}
                item={item}
                currentUserId={userId ?? null}
                isLiked={likedIds.has(item.id)}
                likesCount={likeCounts[item.id] ?? 0}
                commentsCount={commentCounts[item.id] ?? 0}
                onLike={() => toggleLike(item)}
                onBlock={() => blockUser(item.user_id)}
                onNotInterested={
                  tab === 'explore' && userId
                    ? () => notInterestedAlbum(item.release_groups.id)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Right rail (desktop) ── */}
      <aside className="hidden lg:flex w-[300px] shrink-0 flex-col gap-5 pt-11">
        <TrendingRail />
        <SuggestedRail />
      </aside>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {Array.from({ length: 4 }).map((_, i) => (
        <SkeletonBlock key={i} className="h-[150px] border border-divider/60" />
      ))}
    </div>
  );
}

function TrendingRail() {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<ChartTrendingRPC[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Cached charts bundle; falls back to the direct RPC if the route is down
    fetchChartsSummary()
      .then((s) => {
        if (!cancelled) setEntries(s.trending);
      })
      .catch(() => {
        if (!supabase) return;
        supabase
          .rpc('get_charts_trending', { p_limit: 5 })
          .then(({ data }) => {
            if (!cancelled) setEntries((data as ChartTrendingRPC[] | null) ?? []);
          });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <section className="rounded-2xl bg-surface border border-divider/60 p-4">
      <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink mb-3">
        <Flame size={14} className="text-accent" />
        {t('sj.home.trending')}
      </h2>
      <ol className="flex flex-col gap-2.5">
        {entries.map((e, i) => (
          <li key={e.release_id}>
            <AlbumPeek
              releaseId={e.release_id}
              title={displayName(e.title, e.native_title)}
              artist={displayName(e.artist, e.artist_native)}
              coverUrl={e.cover_url}
            >
              <Link
                href={`/album/${e.release_id}`}
                className="flex items-center gap-2.5 group"
              >
                <span className="w-4 text-[12px] font-bold text-muted text-right">{i + 1}</span>
                <Cover url={e.cover_url} className="w-10 h-10" rounded="rounded-md" />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold text-ink truncate group-hover:underline">
                    {displayName(e.title, e.native_title)}
                  </span>
                  <span className="block text-[11px] text-muted truncate">
                    {displayName(e.artist, e.artist_native)}
                    {e.new_count != null && ` · +${e.new_count}`}
                  </span>
                </span>
              </Link>
            </AlbumPeek>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SuggestedRail() {
  const { t } = useLanguage();
  const { userId } = useSession();
  const [users, setUsers] = useState<SuggestedUserRPC[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase || !userId) return;
    supabase
      .rpc('get_suggested_users', { p_user_id: userId })
      .then(({ data }) => setUsers(((data as SuggestedUserRPC[] | null) ?? []).slice(0, 5)));
  }, [userId]);

  async function toggleFollow(id: string) {
    if (!supabase || !userId) return;
    const isFollowed = followed.has(id);
    setFollowed((prev) => {
      const next = new Set(prev);
      if (isFollowed) next.delete(id);
      else next.add(id);
      return next;
    });
    if (isFollowed) {
      await supabase
        .from('follows')
        .delete()
        .eq('follower_id', userId)
        .eq('following_id', id);
    } else {
      await supabase.from('follows').insert({ follower_id: userId, following_id: id });
    }
  }

  // Right-click on a person mirrors the album rows' "open in new tab".
  const { onContextMenu: onUserContextMenu, menu: userContextMenu } =
    useContextMenuFor<SuggestedUserRPC>((u) => [
      {
        key: 'open-new-tab',
        label: t('sj.context.openNewTab'),
        icon: <ExternalLink size={15} />,
        onSelect: () => openInNewTab(`/profile/${u.username ?? ''}`),
      },
    ]);

  if (!userId || users.length === 0) return null;

  return (
    <section className="rounded-2xl bg-surface border border-divider/60 p-4">
      <h2 className="flex items-center gap-1.5 text-[14px] font-bold text-ink mb-3">
        <UserPlus size={14} className="text-accent" />
        {t('sj.home.findPeople')}
      </h2>
      {userContextMenu}
      <ul className="flex flex-col gap-3">
        {users.map((u) => {
          const handle = u.username ?? u.display_name ?? 'user';
          const isFollowed = followed.has(u.id);
          return (
            <li
              key={u.id}
              className="flex items-center gap-2.5"
              onContextMenu={(e) => onUserContextMenu(e, u)}
            >
              <Link
                href={`/profile/${u.username ?? ''}`}
                className="flex items-center gap-2.5 min-w-0 flex-1 group"
              >
                <Avatar url={u.avatar_url} size={36} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-ink truncate group-hover:underline">
                    {u.display_name ?? handle}
                  </span>
                  <span className="block text-[11px] text-muted truncate">
                    @{handle} · {t('sj.home.ratingsCount').replace('{n}', String(u.rating_count))}
                  </span>
                </span>
              </Link>
              <button
                onClick={() => toggleFollow(u.id)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition shrink-0 ${
                  isFollowed
                    ? 'bg-divider/50 text-muted'
                    : 'bg-accent text-white hover:opacity-90'
                }`}
              >
                {isFollowed ? t('sj.common.followingBtn') : t('sj.common.followBtn')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
