'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Flame, ListMusic, UserPlus } from 'lucide-react';
import Avatar from '../../components/sj/Avatar';
import { useContextMenuFor, openInNewTab } from '../../components/sj/ContextMenu';
import FeedCard from '../../components/sj/FeedCard';
import MixPostCard from '../../components/sj/MixPostCard';
import TitleTabs from '../../components/sj/TitleTabs';
import AlbumPeek from '../../components/sj/AlbumPeek';
import Cover from '../../components/sj/Cover';
import { SkeletonBlock } from '../../components/sj/Loading';
import { useSession } from '../../components/sj/SessionContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import type { FeedItemRow } from '../../lib/sj/data';
import { entryKey, type FeedEntry, type FeedTab, type HomeFeedPage } from '../../lib/feed/types';
import FeedImpression from '../../components/sj/FeedImpression';
import { fetchHomeFeed, fetchChartsSummary } from '../../lib/sj/apiClient';
import { markNotInterested } from '../../lib/sj/notInterested';
import { displayName } from '../../lib/sj/display';
import {
  setMixShareLike,
  type MixSharePost,
} from '../../lib/sj/mixShares';
import type { ChartTrendingRPC, SuggestedUserRPC } from '../../lib/db/types';

export default function HomePage() {
  const { t } = useLanguage();
  const { userId, ready, requireAuth } = useSession();
  const [tab, setTab] = useState<FeedTab>('explore');
  const [exploreItems, setExploreItems] = useState<FeedEntry[]>([]);
  const [followingItems, setFollowingItems] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pages, setPages] = useState<Partial<Record<FeedTab, HomeFeedPage>>>({});
  const [postSessions, setPostSessions] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const loadedTabs = useRef(new Set<FeedTab>());

  const [notInterested, setNotInterested] = useState<Set<string>>(new Set());
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  // Mix posts keep their own like/comment maps — their ids live in another table.
  const [likedShareIds, setLikedShareIds] = useState<Set<string>>(new Set());
  const [shareLikes, setShareLikes] = useState<Record<string, number>>({});
  const [shareComments, setShareComments] = useState<Record<string, number>>({});

  const applyPage = useCallback((feedTab: FeedTab, page: HomeFeedPage, append: boolean) => {
    loadedTabs.current.add(feedTab);
    const merge = (previous: FeedEntry[]) => append
      ? [...new Map([...previous, ...page.entries].map(e => [entryKey(e), e])).values()]
      : page.entries;
    (feedTab === 'explore' ? setExploreItems : setFollowingItems)(merge);
    setPages(previous => ({ ...previous, [feedTab]: page }));
    setPostSessions(previous => ({ ...previous, ...Object.fromEntries(page.entries.map(e => [feedTab + ':' + entryKey(e), page.sessionId])) }));
    const ratingLikes: Record<string, number> = {}, ratingComments: Record<string, number> = {};
    const mixLikes: Record<string, number> = {}, mixComments: Record<string, number> = {};
    for (const entry of page.entries) {
      const key = entryKey(entry);
      const id = entry.kind === 'rating' ? entry.item.id : entry.post.id;
      (entry.kind === 'rating' ? ratingLikes : mixLikes)[id] = page.likeCounts[key] ?? 0;
      (entry.kind === 'rating' ? ratingComments : mixComments)[id] = page.commentCounts[key] ?? 0;
    }
    setLikeCounts(previous => ({ ...previous, ...ratingLikes }));
    setCommentCounts(previous => ({ ...previous, ...ratingComments }));
    setShareLikes(previous => ({ ...previous, ...mixLikes }));
    setShareComments(previous => ({ ...previous, ...mixComments }));
    setLikedIds(previous => {
      const next = new Set(previous);
      for (const e of page.entries) if (e.kind === 'rating') {
        if (page.likedKeys.includes(entryKey(e))) next.add(e.item.id); else next.delete(e.item.id);
      }
      return next;
    });
    setLikedShareIds(previous => {
      const next = new Set(previous);
      for (const e of page.entries) if (e.kind === 'mix') {
        if (page.likedKeys.includes(entryKey(e))) next.add(e.post.id); else next.delete(e.post.id);
      }
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setLoadingMore(false);
    setLoadFailed(false);
    try {
      const page = await fetchHomeFeed(tab);
      if (request !== generation.current) return;
      applyPage(tab, page, false);
    } catch {
      if (request === generation.current) setLoadFailed(true);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [tab, applyPage]);

  useEffect(() => {
    loadedTabs.current.clear();
    setExploreItems([]); setFollowingItems([]); setPages({}); setPostSessions({});
    setNotInterested(new Set()); setLikedIds(new Set()); setLikedShareIds(new Set());
  }, [userId]);
  useEffect(() => {
    const currentGeneration = generation;
    if (ready && !loadedTabs.current.has(tab)) void load();
    else { setLoading(false); setLoadingMore(false); setLoadFailed(false); }
    return () => { currentGeneration.current++; };
  }, [ready, load, userId, tab]);

  async function loadMore() {
    const cursor = pages[tab]?.nextCursor;
    if (!cursor || loadingMore) return;
    const request = generation.current;
    setLoadingMore(true);
    setLoadFailed(false);
    try {
      const page = await fetchHomeFeed(tab, cursor);
      if (request === generation.current) applyPage(tab, page, true);
    } catch (error) {
      if (request !== generation.current) return;
      if (error instanceof Error && error.message === 'feed 410') await load();
      else setLoadFailed(true);
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  }

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

  async function toggleShareLike(post: MixSharePost) {
    if (!requireAuth() || !userId) return;
    const wasLiked = likedShareIds.has(post.id);
    const flip = (like: boolean) => {
      setLikedShareIds((prev) => {
        const next = new Set(prev);
        if (like) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      setShareLikes((prev) => ({
        ...prev,
        [post.id]: Math.max(0, (prev[post.id] ?? 0) + (like ? 1 : -1)),
      }));
    };
    flip(!wasLiked);
    const { error } = await setMixShareLike(userId, post.id, !wasLiked);
    if (error) flip(wasLiked);
  }

  async function deleteShare(post: MixSharePost) {
    if (!supabase || !userId) return;
    const drop = (list: FeedEntry[]) =>
      list.filter((e) => !(e.kind === 'mix' && e.post.id === post.id));
    setExploreItems(drop);
    setFollowingItems(drop);
    const { error } = await supabase.from('mix_shares').delete().eq('id', post.id);
    if (error) {
      console.error('[home] delete mix post failed:', error.message);
      load();
    }
  }

  async function notInterestedAlbum(releaseGroupId: string) {
    if (!userId) return;
    setNotInterested((prev) => new Set(prev).add(releaseGroupId));
    await markNotInterested(userId, releaseGroupId);
  }

  async function blockUser(blockedUserId: string) {
    if (!supabase || !userId || blockedUserId === userId) return;
    const keep = (e: FeedEntry) =>
      (e.kind === 'rating' ? e.item.user_id : e.post.userId) !== blockedUserId;
    setExploreItems((items) => items.filter(keep));
    setFollowingItems((items) => items.filter(keep));
    await supabase
      .from('blocked_users')
      .insert({ blocker_id: userId, blocked_id: blockedUserId });
  }

  // Explore drops dismissed albums immediately (the load-time filter only sees
  // what was already persisted when the feed was fetched).
  const items =
    tab === 'explore'
      ? exploreItems.filter(
          (e) => e.kind !== 'rating' || !notInterested.has(e.item.release_groups.id),
        )
      : followingItems;

  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6 py-5 flex gap-8">
      {/* ── Feed column ── */}
      <div className="flex-1 min-w-0 max-w-2xl">
        <div className="mb-4 flex items-center justify-between gap-4">
          <TitleTabs
            tabs={[
              { key: 'explore' as FeedTab, label: t('sj.home.explore') },
              { key: 'following' as FeedTab, label: t('sj.home.following') },
            ]}
            value={tab}
            onChange={setTab}
          />
          <button onClick={() => void load()} disabled={loading} className="text-xs text-muted hover:text-ink disabled:opacity-50">
            {t('sj.home.refresh')}
          </button>
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
            {items.map((entry) => (
              <FeedImpression key={entryKey(entry)} postKey={entryKey(entry)} sessionId={postSessions[tab + ':' + entryKey(entry)]} enabled={!!userId}>
              {entry.kind === 'mix' ? (
                <MixPostCard
                  key={`mix:${entry.post.id}`}
                  post={entry.post}
                  currentUserId={userId ?? null}
                  isLiked={likedShareIds.has(entry.post.id)}
                  likesCount={shareLikes[entry.post.id] ?? 0}
                  commentsCount={shareComments[entry.post.id] ?? 0}
                  onLike={() => toggleShareLike(entry.post)}
                  onBlock={() => blockUser(entry.post.userId)}
                  onDelete={() => deleteShare(entry.post)}
                />
              ) : (
                <FeedCard
                  key={entry.item.id}
                  item={entry.item}
                  currentUserId={userId ?? null}
                  isLiked={likedIds.has(entry.item.id)}
                  likesCount={likeCounts[entry.item.id] ?? 0}
                  commentsCount={commentCounts[entry.item.id] ?? 0}
                  onLike={() => toggleLike(entry.item)}
                  onBlock={() => blockUser(entry.item.user_id)}
                  onNotInterested={
                    tab === 'explore' && userId
                      ? () => notInterestedAlbum(entry.item.release_groups.id)
                      : undefined
                  }
                />
              )}
              </FeedImpression>
            ))}
          </div>
        )}
        {!loading && pages[tab]?.nextCursor && (
          <button onClick={() => void loadMore()} disabled={loadingMore} className="w-full py-4 text-sm text-muted hover:text-ink disabled:opacity-50">
            {loadingMore ? t('sj.common.loading') : loadFailed ? t('sj.common.retry') : t('sj.home.loadMore')}
          </button>
        )}
        {!loading && !loadFailed && items.length > 0 && !pages[tab]?.nextCursor && (
          <p className="py-6 text-center text-sm text-muted">{t('sj.home.caughtUp')}</p>
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
  const [requested, setRequested] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase || !userId) return;
    supabase
      .rpc('get_suggested_users', { p_user_id: userId })
      .then(({ data }) => setUsers(((data as SuggestedUserRPC[] | null) ?? []).slice(0, 5)));
  }, [userId]);

  const setIn = (setter: typeof setFollowed, id: string, on: boolean) =>
    setter((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // A follow on a private account becomes a request (DB trigger); check which
  // one happened so the button can say "Requested".
  async function toggleFollow(id: string) {
    if (!supabase || !userId) return;
    if (followed.has(id) || requested.has(id)) {
      setIn(setFollowed, id, false);
      setIn(setRequested, id, false);
      await Promise.all([
        supabase.from('follows').delete().eq('follower_id', userId).eq('following_id', id),
        supabase.from('follow_requests').delete().eq('requester_id', userId).eq('target_id', id),
      ]);
      return;
    }
    setIn(setFollowed, id, true);
    await supabase.from('follows').insert({ follower_id: userId, following_id: id });
    const { data } = await supabase
      .from('follows')
      .select('follower_id')
      .eq('follower_id', userId)
      .eq('following_id', id)
      .maybeSingle();
    if (!data) {
      setIn(setFollowed, id, false);
      setIn(setRequested, id, true);
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
          const isRequested = requested.has(u.id);
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
                  isFollowed || isRequested
                    ? 'bg-divider/50 text-muted'
                    : 'bg-accent text-white hover:opacity-90'
                }`}
              >
                {isFollowed
                  ? t('sj.common.followingBtn')
                  : isRequested
                    ? t('sj.common.requestedBtn')
                    : t('sj.common.followBtn')}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
