'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Settings,
  LayoutGrid,
  ListMusic,
  BarChart3,
  Clock,
  Globe,
  ChevronRight,
  Trash2,
  Newspaper,
  List as ListIcon,
  Plus,
  ExternalLink,
} from 'lucide-react';
import Modal from './Modal';
import { useContextMenuFor, openInNewTab } from './ContextMenu';
import Avatar from './Avatar';
import { Skeleton, SkeletonLine, SkeletonRows } from './Loading';
import ProfilePostCard from './ProfilePostCard';
import ProfileSongPostCard from './ProfileSongPostCard';
import ProfileStats from './ProfileStats';
import { useSession } from './SessionContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { displayName } from '../../lib/sj/display';
import ProfileRatedList, {
  FULL_RANGE,
  RatedFilterBar,
  effectiveScore,
  kindOf,
  type KindFilter,
  type RatedSortCol,
  type ScoreRange,
} from './ProfileRatedList';
import { RG_EMBED_NATIVE } from '../../lib/sj/data';
import type { MixRow } from '../../lib/db/types';

const SKIP_DELETE_CONFIRM_KEY = 'sj:skipDeleteRatingConfirm';

export interface ProfileRatingItem {
  ratingId: string;
  key: string;
  isSong: boolean;
  recordingId: string | null;
  releaseGroupId: string | null;
  title: string;
  artistLine: string;
  coverUrl: string | null;
  releaseType: string | null;
  score: number | null;
  reviewText: string | null;
  createdAt: string | null;
  releaseTitle: string;
  releaseArtist: string;
}

type ProfileTab = 'rated' | 'lists' | 'stats';

/**
 * Profile — shared by the own-profile page and /profile/[username].
 * Mirrors iOS ProfileView (self) and UserProfileView (other): header stats,
 * Rated (list/posts) · Lists · Stats tabs, follow/unfollow, follow lists.
 */
export default function ProfileView({ username }: { username?: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { userId: myId, profile: myProfile, ready, signOut, requireAuth } = useSession();

  const isSelf = !username;

  const [targetId, setTargetId] = useState<string | null>(null);
  const [display, setDisplay] = useState<{
    username: string | null;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
  } | null>(null);
  const [items, setItems] = useState<ProfileRatingItem[]>([]);
  // Exact ratings total for the header stat. `items` is a page (60 albums +
  // 60 songs), so its length undercounts heavy raters — and disagreed with the
  // Taste page's "rated" figure, which counts everything.
  const [ratedTotal, setRatedTotal] = useState<number | null>(null);
  const [followerCount, setFollowerCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [likeCounts, setLikeCounts] = useState<Record<string, number>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [tab, setTab] = useState<ProfileTab>('rated');
  const [kind, setKind] = useState<KindFilter>('all');
  const [range, setRange] = useState<ScoreRange>(FULL_RANGE);
  const [sortCol, setSortCol] = useState<RatedSortCol>('date');
  const [sortDesc, setSortDesc] = useState(true);
  // The table mode is gone — list and table were the same rows at two widths,
  // so they merged into one responsive view (see ProfileRatedList).
  const [displayMode, setDisplayMode] = useState<'list' | 'posts'>('list');
  const [followModal, setFollowModal] = useState<null | 'following' | 'followers'>(null);
  const [pendingDelete, setPendingDelete] = useState<ProfileRatingItem | null>(null);
  const [skipDeleteConfirmChecked, setSkipDeleteConfirmChecked] = useState(false);

  /** Opens the delete-confirm modal, unless the user previously checked
   *  "Don't ask again" for it (persisted per-browser, not per-account, since
   *  it's a local UI preference rather than data). */
  const requestDeleteRating = useCallback((item: ProfileRatingItem) => {
    if (typeof window !== 'undefined' && localStorage.getItem(SKIP_DELETE_CONFIRM_KEY) === '1') {
      deleteRating(item);
      return;
    }
    setPendingDelete(item);
  }, []);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);

    // Resolve target user
    let uid: string | null = null;
    if (isSelf) {
      uid = myId ?? null;
      if (uid && myProfile) {
        setDisplay({
          username: myProfile.username,
          displayName: myProfile.display_name,
          bio: myProfile.bio,
          avatarUrl: myProfile.avatar_url,
        });
      }
    } else {
      const { data } = await supabase
        .from('profiles')
        .select('id, username, display_name, bio, avatar_url')
        .eq('username', username)
        .maybeSingle();
      const p = data as any;
      if (!p) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      uid = p.id;
      setDisplay({
        username: p.username,
        displayName: p.display_name,
        bio: p.bio,
        avatarUrl: p.avatar_url,
      });
    }
    if (!uid) {
      setLoading(false);
      return;
    }
    setTargetId(uid);

    // Album ratings
    const albumP = supabase
      .from('ratings')
      .select(`id, score, review_text, created_at, ${RG_EMBED_NATIVE}`)
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(60);

    // Song ratings (recordings + covers via canonical release)
    const songP = (async (): Promise<ProfileRatingItem[]> => {
      const { data: raw } = await supabase!
        .from('track_ratings')
        .select(
          'id, recording_id, score, review_text, created_at, recordings(id, title, artist_display)',
        )
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(60);
      const rows = (raw as any[] | null) ?? [];
      if (rows.length === 0) return [];
      const { data: coverRows } = await supabase!
        .from('release_tracks')
        .select(
          'recording_id, releases(is_canonical, release_groups(id, title, artist_display, cover_url))',
        )
        .in('recording_id', rows.map((r) => r.recording_id));
      const rgMap: Record<string, any> = {};
      for (const row of (coverRows as any[] | null) ?? []) {
        const rg = row.releases?.release_groups;
        if (!rg) continue;
        if (row.releases?.is_canonical || !rgMap[row.recording_id]) rgMap[row.recording_id] = rg;
      }
      return rows.map((r) => {
        const rg = rgMap[r.recording_id];
        return {
          ratingId: r.id,
          key: `s-${r.recording_id}`,
          isSong: true,
          recordingId: r.recording_id,
          releaseGroupId: rg?.id ?? null,
          title: r.recordings?.title ?? 'Unknown Track',
          artistLine: `${rg?.title ?? ''} · ${rg?.artist_display ?? r.recordings?.artist_display ?? ''}`,
          coverUrl: rg?.cover_url ?? null,
          releaseType: null,
          score: r.score,
          reviewText: r.review_text,
          createdAt: r.created_at,
          releaseTitle: rg?.title ?? '',
          releaseArtist: rg?.artist_display ?? '',
        };
      });
    })();

    // Follow counts + exact rating totals (+ my relation for other profiles)
    const countsP = Promise.all([
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', uid),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', uid),
      supabase.from('ratings').select('*', { count: 'exact', head: true }).eq('user_id', uid),
      supabase
        .from('track_ratings')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', uid),
      !isSelf && myId
        ? supabase
            .from('follows')
            .select('follower_id')
            .eq('follower_id', myId)
            .eq('following_id', uid)
        : Promise.resolve({ data: null }),
      !isSelf && myId
        ? supabase
            .from('blocked_users')
            .select('blocked_id')
            .eq('blocker_id', myId)
            .eq('blocked_id', uid)
        : Promise.resolve({ data: null }),
    ]);

    const [
      { data: albumRows },
      songItems,
      [followingRes, followerRes, albumTotalRes, songTotalRes, relRes, blockRes],
    ] = await Promise.all([albumP, songP, countsP]);

    const albumItems: ProfileRatingItem[] = ((albumRows as any[] | null) ?? []).map((r) => {
      const rg = r.release_groups;
      return {
        ratingId: r.id,
        key: `a-${r.id}`,
        isSong: false,
        recordingId: null,
        releaseGroupId: rg?.id ?? null,
        title: rg ? displayName(rg.title, rg.native_title) : '',
        artistLine: rg ? displayName(rg.artist_display, rg.artists?.name_native) : '',
        coverUrl: rg?.cover_url ?? null,
        releaseType: rg?.release_group_type ?? null,
        score: r.score,
        reviewText: r.review_text,
        createdAt: r.created_at,
        releaseTitle: rg?.title ?? '',
        releaseArtist: rg?.artist_display ?? '',
      };
    });

    setItems([...albumItems, ...songItems]);
    setRatedTotal(
      ((albumTotalRes as any).count ?? albumItems.length) +
        ((songTotalRes as any).count ?? songItems.length),
    );
    setFollowingCount((followingRes as any).count ?? 0);
    setFollowerCount((followerRes as any).count ?? 0);
    setIsFollowing((((relRes as any).data as any[] | null) ?? []).length > 0);
    setIsBlocked((((blockRes as any).data as any[] | null) ?? []).length > 0);

    // Like/comment counts for posts mode -- albums (rating_id) and songs (track_rating_id)
    // merged into the same dicts, keyed by item.ratingId either way. Safe to merge: album
    // ratingIds and song ratingIds come from two different tables' own uuid PKs, so collision
    // isn't possible.
    const ratingIds = albumItems.map((i) => i.ratingId);
    const songRatingIds = songItems.map((i) => i.ratingId);
    const lc: Record<string, number> = {};
    const cc: Record<string, number> = {};
    const liked = new Set<string>();

    const albumCountsP =
      ratingIds.length > 0
        ? Promise.all([
            supabase.from('rating_likes').select('rating_id').in('rating_id', ratingIds),
            supabase.from('rating_comments').select('rating_id').in('rating_id', ratingIds),
            myId
              ? supabase
                  .from('rating_likes')
                  .select('rating_id')
                  .eq('user_id', myId)
                  .in('rating_id', ratingIds)
              : Promise.resolve({ data: null }),
          ])
        : null;
    const songCountsP =
      songRatingIds.length > 0
        ? Promise.all([
            supabase.from('track_rating_likes').select('track_rating_id').in('track_rating_id', songRatingIds),
            supabase
              .from('track_rating_comments')
              .select('track_rating_id')
              .in('track_rating_id', songRatingIds),
            myId
              ? supabase
                  .from('track_rating_likes')
                  .select('track_rating_id')
                  .eq('user_id', myId)
                  .in('track_rating_id', songRatingIds)
              : Promise.resolve({ data: null }),
          ])
        : null;

    const [albumCounts, songCounts] = await Promise.all([albumCountsP, songCountsP]);
    if (albumCounts) {
      const [likesRes, commentsRes, myLikesRes] = albumCounts;
      for (const r of (likesRes.data as any[] | null) ?? []) lc[r.rating_id] = (lc[r.rating_id] ?? 0) + 1;
      for (const r of (commentsRes.data as any[] | null) ?? []) cc[r.rating_id] = (cc[r.rating_id] ?? 0) + 1;
      for (const r of (myLikesRes.data as any[] | null) ?? []) liked.add(r.rating_id);
    }
    if (songCounts) {
      const [likesRes, commentsRes, myLikesRes] = songCounts;
      for (const r of (likesRes.data as any[] | null) ?? [])
        lc[r.track_rating_id] = (lc[r.track_rating_id] ?? 0) + 1;
      for (const r of (commentsRes.data as any[] | null) ?? [])
        cc[r.track_rating_id] = (cc[r.track_rating_id] ?? 0) + 1;
      for (const r of (myLikesRes.data as any[] | null) ?? []) liked.add(r.track_rating_id);
    }
    setLikeCounts(lc);
    setCommentCounts(cc);
    setLikedIds(liked);
    setLoading(false);
  }, [isSelf, myId, myProfile, username]);

  useEffect(() => {
    if (ready) {
      if (isSelf && !myId) {
        router.replace('/login');
        return;
      }
      load();
    }
  }, [ready, isSelf, myId, load, router]);

  /** Per-bucket totals, so the filter bar can hide buckets nobody has. */
  const kindCounts = useMemo(() => {
    const c: Record<KindFilter, number> = { all: items.length, albums: 0, eps: 0, singles: 0, songs: 0 };
    for (const i of items) c[kindOf(i)] += 1;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const rangeActive = range[0] !== FULL_RANGE[0] || range[1] !== FULL_RANGE[1];
    const base = items.filter((i) => {
      if (kind !== 'all' && kindOf(i) !== kind) return false;
      if (rangeActive) {
        const s = effectiveScore(i);
        // An unscored row has no place on a score range — narrowing the range
        // is an explicit "show me things in this band".
        if (s == null || s < range[0] || s > range[1]) return false;
      }
      return true;
    });
    const dir = sortDesc ? -1 : 1;
    return base.sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'title') cmp = a.title.localeCompare(b.title);
      else if (sortCol === 'artist') cmp = a.artistLine.localeCompare(b.artistLine);
      else if (sortCol === 'type') cmp = kindOf(a).localeCompare(kindOf(b));
      else if (sortCol === 'score')
        cmp = (effectiveScore(a) ?? -1) - (effectiveScore(b) ?? -1);
      else cmp = (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
      return cmp * dir;
    });
  }, [items, kind, range, sortCol, sortDesc]);

  async function toggleFollow() {
    if (!supabase || !myId || !targetId) return;
    if (isFollowing) {
      setIsFollowing(false);
      setFollowerCount((c) => Math.max(0, c - 1));
      await supabase
        .from('follows')
        .delete()
        .eq('follower_id', myId)
        .eq('following_id', targetId);
    } else {
      setIsFollowing(true);
      setFollowerCount((c) => c + 1);
      await supabase.from('follows').insert({ follower_id: myId, following_id: targetId });
    }
  }

  async function toggleBlock() {
    if (!supabase || !myId || !targetId) return;
    if (isBlocked) {
      setIsBlocked(false);
      await supabase
        .from('blocked_users')
        .delete()
        .eq('blocker_id', myId)
        .eq('blocked_id', targetId);
    } else {
      setIsBlocked(true);
      await supabase
        .from('blocked_users')
        .insert({ blocker_id: myId, blocked_id: targetId });
    }
  }

  async function deleteRating(item: ProfileRatingItem) {
    if (!supabase || !myId) return;
    setItems((prev) => prev.filter((i) => i.key !== item.key));
    setRatedTotal((n) => (n == null ? n : Math.max(0, n - 1)));
    if (item.isSong && item.recordingId) {
      await supabase
        .from('track_ratings')
        .delete()
        .eq('user_id', myId)
        .eq('recording_id', item.recordingId);
    } else {
      await supabase.from('ratings').delete().eq('id', item.ratingId);
    }
  }

  async function toggleLike(ratingId: string) {
    if (!supabase) return;
    if (!requireAuth() || !myId) return;
    const wasLiked = likedIds.has(ratingId);
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(ratingId);
      else next.add(ratingId);
      return next;
    });
    setLikeCounts((prev) => ({
      ...prev,
      [ratingId]: Math.max(0, (prev[ratingId] ?? 0) + (wasLiked ? -1 : 1)),
    }));
    if (wasLiked) {
      await supabase
        .from('rating_likes')
        .delete()
        .eq('user_id', myId)
        .eq('rating_id', ratingId);
    } else {
      await supabase.from('rating_likes').insert({ user_id: myId, rating_id: ratingId });
    }
  }

  async function toggleSongLike(trackRatingId: string) {
    if (!supabase) return;
    if (!requireAuth() || !myId) return;
    const wasLiked = likedIds.has(trackRatingId);
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(trackRatingId);
      else next.add(trackRatingId);
      return next;
    });
    setLikeCounts((prev) => ({
      ...prev,
      [trackRatingId]: Math.max(0, (prev[trackRatingId] ?? 0) + (wasLiked ? -1 : 1)),
    }));
    if (wasLiked) {
      await supabase
        .from('track_rating_likes')
        .delete()
        .eq('user_id', myId)
        .eq('track_rating_id', trackRatingId);
    } else {
      await supabase
        .from('track_rating_likes')
        .insert({ user_id: myId, track_rating_id: trackRatingId });
    }
  }

  if (notFound) {
    return (
      <div className="py-32 text-center text-muted text-[15px]">{t('sj.profile.notFound')}</div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 md:px-6 py-7">
        <div className="flex items-center gap-6">
          <Skeleton className="h-[76px] w-[76px] rounded-full bg-surface" />
          <div className="flex-1 grid grid-cols-3 gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <SkeletonLine w="w-8" h="h-4" />
                <SkeletonLine w="w-12" h="h-2.5" />
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <SkeletonLine w="w-32" h="h-4" />
          <SkeletonLine w="w-24" h="h-2.5" />
        </div>
        <div className="mt-6 border-b border-divider pb-3">
          <SkeletonLine w="w-full" h="h-4" />
        </div>
        <SkeletonRows className="mt-4" count={6} />
      </div>
    );
  }

  const handle = display?.username ?? '';
  // Everything the user saves lives in Mixes now — the separate "Library"
  // (saved-to-listen-later) tab was removed and unified into Mix.
  const tabs: { key: ProfileTab; icon: typeof LayoutGrid; label: string }[] = [
    { key: 'rated', icon: LayoutGrid, label: t('sj.profile.rated') },
    { key: 'lists', icon: ListMusic, label: t('sj.profile.mixes') },
    { key: 'stats', icon: BarChart3, label: t('sj.profile.stats') },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 md:px-6 py-7">
      {/* Header */}
      <div className="flex items-center gap-6">
        <Avatar url={display?.avatarUrl} size={76} />
        <div className="flex-1 flex items-center gap-2">
          <StatCell value={ratedTotal ?? items.length} label={t('sj.profile.ratedStat')} />
          <button onClick={() => setFollowModal('following')} className="flex-1">
            <StatCell value={followingCount} label={t('sj.profile.following')} />
          </button>
          <button onClick={() => setFollowModal('followers')} className="flex-1">
            <StatCell value={followerCount} label={t('sj.profile.followers')} />
          </button>
        </div>
        {isSelf && (
          <Link
            href="/settings"
            aria-label={t('sj.nav.settings')}
            className="p-2 rounded-lg text-ink hover:bg-surface transition self-start"
          >
            <Settings size={18} />
          </Link>
        )}
      </div>

      {/* Name / bio / actions */}
      <div className="mt-4">
        {/* The handle is the identity — the display name is a freeform label,
            so it reads as the secondary line (see also FollowListModal). */}
        <p className="text-[16px] font-semibold text-ink">@{handle}</p>
        {display?.displayName && (
          <p className="text-[13px] text-muted">{display.displayName}</p>
        )}
        {display?.bio && <p className="mt-1 text-[13.5px] text-muted">{display.bio}</p>}
        {!isSelf && myId && myId !== targetId && (
          <div className="mt-3">
            {isBlocked ? (
              <button
                onClick={toggleBlock}
                className="px-6 py-2 rounded-full bg-red-500/80 text-white text-[13.5px] font-semibold hover:opacity-90 transition"
              >
                {t('sj.profile.unblock')}
              </button>
            ) : (
              <button
                onClick={toggleFollow}
                className={`px-6 py-2 rounded-full text-[13.5px] font-semibold transition ${
                  isFollowing
                    ? 'bg-divider/50 text-ink'
                    : 'bg-accent text-white hover:opacity-90'
                }`}
              >
                {isFollowing ? t('sj.common.followingBtn') : t('sj.common.followBtn')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex border-b border-divider mt-6">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            aria-label={label}
            className={`flex-1 flex items-center justify-center gap-2 py-3 border-b-2 -mb-px transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
              tab === key
                ? 'border-accent text-ink'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            <Icon size={18} />
            <span className="hidden sm:inline text-[12.5px] font-semibold">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Rated tab ── */}
      {tab === 'rated' && (
        <div className="mt-3">
          {items.length === 0 ? (
            <Empty label={t('sj.profile.noRatings')} />
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {isSelf && (
                  <span className="flex gap-0.5 order-last sm:order-none">
                    <button
                      onClick={() => setDisplayMode('list')}
                      aria-label={t('sj.profile.listView')}
                      className={`p-1.5 rounded-md transition ${
                        displayMode === 'list' ? 'bg-accent/10 text-accent' : 'text-muted'
                      }`}
                    >
                      <ListIcon size={15} />
                    </button>
                    <button
                      onClick={() => setDisplayMode('posts')}
                      aria-label={t('sj.profile.postView')}
                      className={`p-1.5 rounded-md transition ${
                        displayMode === 'posts' ? 'bg-accent/10 text-accent' : 'text-muted'
                      }`}
                    >
                      <Newspaper size={15} />
                    </button>
                  </span>
                )}
                {/* Filters apply to both modes — they describe *which* ratings
                    you're looking at, not how they're drawn. */}
                <span className="flex-1 min-w-0">
                  <RatedFilterBar
                    kind={kind}
                    onKind={setKind}
                    range={range}
                    onRange={setRange}
                    sortCol={sortCol}
                    sortDesc={sortDesc}
                    onSort={(c, d) => {
                      setSortCol(c);
                      setSortDesc(d);
                    }}
                    counts={kindCounts}
                  />
                </span>
              </div>

              {filtered.length === 0 ? (
                <Empty label={t('sj.profile.noneOfType')} />
              ) : displayMode === 'posts' && isSelf ? (
                <div className="mt-3 flex flex-col gap-2.5">
                  {filtered.map((item) =>
                    item.isSong ? (
                      <ProfileSongPostCard
                        key={item.key}
                        item={item}
                        likesCount={likeCounts[item.ratingId] ?? 0}
                        commentsCount={commentCounts[item.ratingId] ?? 0}
                        isLiked={likedIds.has(item.ratingId)}
                        onLike={() => toggleSongLike(item.ratingId)}
                        onDelete={() => requestDeleteRating(item)}
                      />
                    ) : (
                      <ProfilePostCard
                        key={item.key}
                        item={item}
                        likesCount={likeCounts[item.ratingId] ?? 0}
                        commentsCount={commentCounts[item.ratingId] ?? 0}
                        isLiked={likedIds.has(item.ratingId)}
                        onLike={() => toggleLike(item.ratingId)}
                        onDelete={() => requestDeleteRating(item)}
                      />
                    ),
                  )}
                </div>
              ) : (
                <ProfileRatedList
                  items={filtered}
                  showScores={isSelf}
                  sortCol={sortCol}
                  sortDesc={sortDesc}
                  onSort={(c, d) => {
                    setSortCol(c);
                    setSortDesc(d);
                  }}
                  onDelete={isSelf ? (item) => requestDeleteRating(item) : undefined}
                  canExport={isSelf}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ── Mix tab ── */}
      {tab === 'lists' && targetId && <MixLibrary userId={targetId} isSelf={isSelf} />}

      {/* ── Stats tab ── */}
      {tab === 'stats' && <ProfileStats items={items} />}

      {/* Follow list modal */}
      {followModal && targetId && (
        <FollowListModal
          open
          onClose={() => setFollowModal(null)}
          userId={targetId}
          initialTab={followModal}
        />
      )}

      {/* Delete confirm */}
      <Modal
        open={pendingDelete != null}
        onClose={() => {
          setPendingDelete(null);
          setSkipDeleteConfirmChecked(false);
        }}
        title={t('sj.profile.deleteRatingTitle')}
        maxWidth="max-w-sm"
      >
        <div className="px-5 pb-5">
          <p className="text-[13.5px] text-muted">{t('sj.profile.deleteRatingDesc')}</p>
          <label className="mt-3 flex items-center gap-2 text-[12.5px] text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={skipDeleteConfirmChecked}
              onChange={(e) => setSkipDeleteConfirmChecked(e.target.checked)}
              className="rounded border-divider accent-red-500"
            />
            {t('sj.profile.deleteRatingDontAskAgain')}
          </label>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => {
                setPendingDelete(null);
                setSkipDeleteConfirmChecked(false);
              }}
              className="px-4 py-2 rounded-[10px] text-[13.5px] font-medium text-muted hover:text-ink transition"
            >
              {t('sj.common.cancel')}
            </button>
            <button
              onClick={() => {
                if (pendingDelete) deleteRating(pendingDelete);
                if (skipDeleteConfirmChecked) localStorage.setItem(SKIP_DELETE_CONFIRM_KEY, '1');
                setPendingDelete(null);
                setSkipDeleteConfirmChecked(false);
              }}
              className="px-4 py-2 rounded-[10px] bg-red-500 text-white text-[13.5px] font-semibold hover:opacity-90 transition"
            >
              {t('sj.common.delete')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex-1 flex flex-col items-center">
      <span className="text-[18px] font-bold text-ink tabular-nums">{value}</span>
      <span className="text-[10.5px] text-muted">{label}</span>
    </span>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="py-16 text-center text-[14px] text-muted">{label}</p>;
}

// ── Mixes (Lists tab) ───────────────────────────────────────────────────────

function MixLibrary({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const { t } = useLanguage();
  const [mixes, setMixes] = useState<MixRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    let q = supabase
      .from('mixes')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (!isSelf) q = q.eq('is_public', true);
    const { data } = await q;
    const loaded = (data as MixRow[] | null) ?? [];
    setMixes(loaded);
    if (loaded.length > 0) {
      const { data: itemRows } = await supabase
        .from('mix_items')
        .select('mix_id')
        .in('mix_id', loaded.map((m) => m.id));
      const c: Record<string, number> = {};
      for (const r of (itemRows as { mix_id: string }[] | null) ?? []) {
        c[r.mix_id] = (c[r.mix_id] ?? 0) + 1;
      }
      setCounts(c);
    }
    setLoading(false);
  }, [userId, isSelf]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!supabase || name.trim() === '') return;
    setSaving(true);
    await supabase
      .from('mixes')
      .insert({ user_id: userId, name: name.trim(), is_public: isPublic, is_default: false });
    setSaving(false);
    setShowCreate(false);
    setName('');
    setIsPublic(false);
    load();
  }

  // Right-click on a mix row — same "open in new tab" the rated rows have.
  const { onContextMenu: onMixContextMenu, menu: mixContextMenu } =
    useContextMenuFor<MixRow>((mix) => [
      {
        key: 'open-new-tab',
        label: t('sj.context.openNewTab'),
        icon: <ExternalLink size={15} />,
        onSelect: () => openInNewTab(`/mix/${mix.id}`),
      },
    ]);

  if (loading) return <SkeletonRows className="mt-4" count={4} />;

  return (
    <div className="mt-3">
      {mixContextMenu}
      {isSelf && (
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-1 py-3 text-[13.5px] font-semibold text-accent hover:opacity-80 transition"
        >
          <Plus size={15} />
          {t('sj.mix.create')}
        </button>
      )}
      {mixes.length === 0 ? (
        <Empty label={t('sj.mix.none')} />
      ) : (
        <ul className="divide-y divide-divider">
          {mixes.map((mix) => (
            <li key={mix.id} onContextMenu={(e) => onMixContextMenu(e, mix)}>
              <Link
                href={`/mix/${mix.id}`}
                className="flex items-center gap-3.5 py-3 px-1 hover:bg-surface/60 rounded-lg transition"
              >
                <span className="flex w-[52px] h-[52px] rounded-[10px] bg-accent/[0.12] items-center justify-center shrink-0">
                  {mix.is_default ? (
                    <Clock size={19} className="text-accent" />
                  ) : (
                    <ListMusic size={19} className="text-accent" />
                  )}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14.5px] font-semibold text-ink truncate">
                    {mix.name}
                  </span>
                  <span className="flex items-center gap-1.5 text-[12px] text-muted">
                    {(counts[mix.id] ?? 0) === 1
                      ? t('sj.search.oneRelease')
                      : t('sj.search.nReleases').replace('{n}', String(counts[mix.id] ?? 0))}
                    {mix.is_public && (
                      <>
                        <span className="text-divider">·</span>
                        <Globe size={10} />
                        {t('sj.mix.public')}
                      </>
                    )}
                  </span>
                </span>
                <ChevronRight size={13} className="text-divider" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={t('sj.mix.newMix')}
        maxWidth="max-w-sm"
      >
        <div className="px-5 pb-5 pt-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('sj.mix.namePlaceholder')}
            className="w-full px-3.5 py-2.5 rounded-[10px] bg-surface border border-divider text-[14px] text-ink placeholder-placeholder outline-none focus:border-accent/60 transition"
          />
          <label className="flex items-center justify-between mt-4 cursor-pointer">
            <span className="text-[14px] text-ink">{t('sj.mix.public')}</span>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="w-4 h-4 accent-[#2979B7]"
            />
          </label>
          <p className="mt-1.5 text-[12px] text-muted">
            {isPublic ? t('sj.mix.publicDesc') : t('sj.mix.privateDesc')}
          </p>
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={() => setShowCreate(false)}
              className="px-4 py-2 rounded-[10px] text-[13.5px] font-medium text-muted hover:text-ink transition"
            >
              {t('sj.common.cancel')}
            </button>
            <button
              onClick={create}
              disabled={saving || name.trim() === ''}
              className="px-4 py-2 rounded-[10px] bg-accent text-white text-[13.5px] font-semibold hover:opacity-90 disabled:opacity-50 transition"
            >
              {t('sj.mix.createBtn')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Follow list modal ───────────────────────────────────────────────────────

function FollowListModal({
  open,
  onClose,
  userId,
  initialTab,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  initialTab: 'following' | 'followers';
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState(initialTab);
  const [following, setFollowing] = useState<any[]>([]);
  const [followers, setFollowers] = useState<any[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !supabase) return;
    let cancelled = false;
    (async () => {
      async function loadList(mode: 'following' | 'followers') {
        const col = mode === 'following' ? 'following_id' : 'follower_id';
        const filter = mode === 'following' ? 'follower_id' : 'following_id';
        const { data: rows } = await supabase!
          .from('follows')
          .select(col)
          .eq(filter, userId);
        const ids = ((rows as any[] | null) ?? []).map((r) => r[col]);
        if (ids.length === 0) return [];
        const { data: profiles } = await supabase!
          .from('profiles')
          .select('id, username, display_name, avatar_url')
          .in('id', ids);
        return (profiles as any[] | null) ?? [];
      }
      const [f, r] = await Promise.all([loadList('following'), loadList('followers')]);
      if (!cancelled) {
        setFollowing(f);
        setFollowers(r);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  const list = (tab === 'following' ? following : followers).filter((p) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      p.username?.toLowerCase().includes(q) || p.display_name?.toLowerCase().includes(q)
    );
  });

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-md">
      <div className="px-4 pb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('sj.common.search')}
          className="w-full px-3.5 py-2 rounded-[10px] bg-divider/25 text-[14px] text-ink placeholder-placeholder outline-none"
        />
        <div className="flex mt-2 border-b border-divider">
          {(['following', 'followers'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setTab(m)}
              className={`flex-1 py-2.5 text-[13.5px] border-b-2 -mb-px transition ${
                tab === m
                  ? 'border-accent text-ink font-semibold'
                  : 'border-transparent text-muted'
              }`}
            >
              {m === 'following' ? t('sj.profile.following') : t('sj.profile.followers')}{' '}
              {(m === 'following' ? following : followers).length > 0 && (
                <span className="text-accent text-[11px] font-semibold">
                  {(m === 'following' ? following : followers).length}
                </span>
              )}
            </button>
          ))}
        </div>
        {loading ? (
          <SkeletonRows className="py-4" count={4} />
        ) : list.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">
            {tab === 'following' ? t('sj.profile.noneFollowing') : t('sj.profile.noFollowers')}
          </p>
        ) : (
          <ul className="divide-y divide-divider max-h-80 overflow-y-auto">
            {list.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/profile/${p.username ?? ''}`}
                  onClick={onClose}
                  className="flex items-center gap-3 py-2.5 hover:bg-surface/60 rounded-lg px-1 transition"
                >
                  <Avatar url={p.avatar_url} size={40} />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold text-ink truncate">
                      @{p.username ?? p.display_name ?? '—'}
                    </span>
                    {p.username && p.display_name && (
                      <span className="block text-[12.5px] text-muted truncate">
                        {p.display_name}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
