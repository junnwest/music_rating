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
  Table2,
} from 'lucide-react';
import Cover from './Cover';
import FlowerGlyph from './FlowerGlyph';
import Modal from './Modal';
import ProfilePostCard from './ProfilePostCard';
import { useSession } from './SessionContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { eloToScore, INSTINCT_REVEAL_THRESHOLD } from '../../lib/elo';
import { displayName, formatScore } from '../../lib/sj/display';
import { RatedTable } from './ProfileExtras';
import { RG_EMBED_NATIVE } from '../../lib/sj/data';
import type { MixRow } from '../../lib/db/types';

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
  eloScore: number | null;
  reviewText: string | null;
  createdAt: string | null;
  releaseTitle: string;
  releaseArtist: string;
}

type ProfileTab = 'rated' | 'lists' | 'stats';
type TypeFilter = 'all' | 'albums' | 'songs';
type SortOrder = 'recent' | 'top' | 'bottom' | 'az';

/**
 * Profile — shared by the own-profile page and /profile/[username].
 * Mirrors iOS ProfileView (self) and UserProfileView (other): header stats,
 * Rated (list/posts) · Lists · Stats tabs, follow/unfollow, follow lists.
 */
export default function ProfileView({ username }: { username?: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const { userId: myId, profile: myProfile, ready, signOut } = useSession();

  const isSelf = !username;

  const [targetId, setTargetId] = useState<string | null>(null);
  const [display, setDisplay] = useState<{
    username: string | null;
    displayName: string | null;
    bio: string | null;
    avatarUrl: string | null;
  } | null>(null);
  const [items, setItems] = useState<ProfileRatingItem[]>([]);
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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent');
  const [displayMode, setDisplayMode] = useState<'list' | 'posts' | 'table'>('list');
  const [followModal, setFollowModal] = useState<null | 'following' | 'followers'>(null);
  const [pendingDelete, setPendingDelete] = useState<ProfileRatingItem | null>(null);

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
      .select(`id, score, elo_score, review_text, created_at, ${RG_EMBED_NATIVE}`)
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(60);

    // Song ratings (recordings + covers via canonical release)
    const songP = (async (): Promise<ProfileRatingItem[]> => {
      const { data: raw } = await supabase!
        .from('track_ratings')
        .select('id, recording_id, score, elo_score, created_at, recordings(id, title, artist_display)')
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
          eloScore: r.elo_score,
          reviewText: null,
          createdAt: r.created_at,
          releaseTitle: rg?.title ?? '',
          releaseArtist: rg?.artist_display ?? '',
        };
      });
    })();

    // Follow counts (+ my relation for other profiles)
    const countsP = Promise.all([
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', uid),
      supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', uid),
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

    const [{ data: albumRows }, songItems, [followingRes, followerRes, relRes, blockRes]] =
      await Promise.all([albumP, songP, countsP]);

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
        eloScore: r.elo_score,
        reviewText: r.review_text,
        createdAt: r.created_at,
        releaseTitle: rg?.title ?? '',
        releaseArtist: rg?.artist_display ?? '',
      };
    });

    setItems([...albumItems, ...songItems]);
    setFollowingCount((followingRes as any).count ?? 0);
    setFollowerCount((followerRes as any).count ?? 0);
    setIsFollowing((((relRes as any).data as any[] | null) ?? []).length > 0);
    setIsBlocked((((blockRes as any).data as any[] | null) ?? []).length > 0);

    // Like/comment counts for posts mode (albums only)
    const ratingIds = albumItems.map((i) => i.ratingId);
    if (ratingIds.length > 0) {
      const [likesRes, commentsRes, myLikesRes] = await Promise.all([
        supabase.from('rating_likes').select('rating_id').in('rating_id', ratingIds),
        supabase.from('rating_comments').select('rating_id').in('rating_id', ratingIds),
        myId
          ? supabase
              .from('rating_likes')
              .select('rating_id')
              .eq('user_id', myId)
              .in('rating_id', ratingIds)
          : Promise.resolve({ data: null }),
      ]);
      const lc: Record<string, number> = {};
      for (const r of (likesRes.data as any[] | null) ?? []) {
        lc[r.rating_id] = (lc[r.rating_id] ?? 0) + 1;
      }
      const cc: Record<string, number> = {};
      for (const r of (commentsRes.data as any[] | null) ?? []) {
        cc[r.rating_id] = (cc[r.rating_id] ?? 0) + 1;
      }
      setLikeCounts(lc);
      setCommentCounts(cc);
      setLikedIds(new Set(((myLikesRes.data as any[] | null) ?? []).map((r) => r.rating_id)));
    }
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

  const instinctAlbumCount = useMemo(
    () => items.filter((i) => !i.isSong && i.eloScore != null).length,
    [items],
  );
  const instinctSongCount = useMemo(
    () => items.filter((i) => i.isSong && i.eloScore != null).length,
    [items],
  );

  const itemScore = useCallback((item: ProfileRatingItem) => {
    if (item.score != null) return item.score;
    if (item.eloScore != null) return eloToScore(item.eloScore);
    return 0;
  }, []);

  const filtered = useMemo(() => {
    let base = items;
    if (typeFilter === 'albums') base = items.filter((i) => !i.isSong);
    if (typeFilter === 'songs') base = items.filter((i) => i.isSong);
    const sorted = [...base];
    if (sortOrder === 'top') sorted.sort((a, b) => itemScore(b) - itemScore(a));
    if (sortOrder === 'bottom') sorted.sort((a, b) => itemScore(a) - itemScore(b));
    if (sortOrder === 'az') sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  }, [items, typeFilter, sortOrder, itemScore]);

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
    if (!supabase || !myId) return;
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

  if (notFound) {
    return (
      <div className="py-32 text-center text-muted text-[15px]">{t('sj.profile.notFound')}</div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-8 animate-pulse space-y-5">
        <div className="h-24 rounded-2xl bg-surface" />
        <div className="h-64 rounded-2xl bg-surface" />
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
        {display?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={display.avatarUrl}
            alt=""
            className="w-[76px] h-[76px] rounded-full object-cover shrink-0"
          />
        ) : (
          <span className="flex w-[76px] h-[76px] rounded-full bg-accent-soft text-accent-deep items-center justify-center text-[26px] font-bold shrink-0">
            {(handle || '?').slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex-1 flex items-center gap-2">
          <StatCell value={items.length} label={t('sj.profile.ratedStat')} />
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
        <p className="text-[15px] font-semibold text-ink">
          {display?.displayName || `@${handle}`}
          {display?.displayName && (
            <span className="ml-2 text-[13px] font-normal text-muted">@{handle}</span>
          )}
        </p>
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
              <div className="flex items-center gap-1 flex-wrap">
                {(['all', 'albums', 'songs'] as TypeFilter[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setTypeFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-[12px] transition ${
                      typeFilter === f
                        ? 'bg-accent/10 text-accent font-semibold'
                        : 'text-muted hover:text-ink'
                    }`}
                  >
                    {f === 'all'
                      ? t('sj.profile.filterAll')
                      : f === 'albums'
                        ? t('sj.profile.filterAlbums')
                        : t('sj.profile.filterSongs')}
                  </button>
                ))}
                <span className="flex-1" />
                {isSelf && (
                  <span className="flex gap-0.5">
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
                    <button
                      onClick={() => setDisplayMode('table')}
                      aria-label={t('sj.profile.tableView')}
                      className={`hidden md:inline-flex p-1.5 rounded-md transition ${
                        displayMode === 'table' ? 'bg-accent/10 text-accent' : 'text-muted'
                      }`}
                    >
                      <Table2 size={15} />
                    </button>
                  </span>
                )}
                {displayMode !== 'table' && (
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                    aria-label={t('sj.profile.sort')}
                    className="ml-1 bg-transparent text-[12px] font-medium text-accent outline-none cursor-pointer"
                  >
                    <option value="recent">{t('sj.profile.sortRecent')}</option>
                    <option value="top">{t('sj.profile.sortTop')}</option>
                    <option value="bottom">{t('sj.profile.sortBottom')}</option>
                    <option value="az">{t('sj.profile.sortAz')}</option>
                  </select>
                )}
              </div>

              {filtered.length === 0 ? (
                <Empty label={t('sj.profile.noneOfType')} />
              ) : displayMode === 'table' && isSelf ? (
                <RatedTable items={filtered} />
              ) : displayMode === 'posts' && isSelf ? (
                <div className="mt-3 flex flex-col gap-2.5">
                  {filtered
                    .filter((i) => !i.isSong)
                    .map((item) => (
                      <ProfilePostCard
                        key={item.key}
                        item={item}
                        instinctAlbumCount={instinctAlbumCount}
                        likesCount={likeCounts[item.ratingId] ?? 0}
                        commentsCount={commentCounts[item.ratingId] ?? 0}
                        isLiked={likedIds.has(item.ratingId)}
                        onLike={() => toggleLike(item.ratingId)}
                        onDelete={() => setPendingDelete(item)}
                      />
                    ))}
                </div>
              ) : (
                <ul className="mt-2 divide-y divide-divider">
                  {filtered.map((item) => (
                    <RatedRow
                      key={item.key}
                      item={item}
                      instinctCount={item.isSong ? instinctSongCount : instinctAlbumCount}
                      showScore={isSelf || item.score != null}
                      onDelete={isSelf ? () => setPendingDelete(item) : undefined}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Mix tab ── */}
      {tab === 'lists' && targetId && <MixLibrary userId={targetId} isSelf={isSelf} />}

      {/* ── Stats tab ── */}
      {tab === 'stats' && <StatsTab items={items} instinctCount={instinctAlbumCount} />}

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
        onClose={() => setPendingDelete(null)}
        title={t('sj.profile.deleteRatingTitle')}
        maxWidth="max-w-sm"
      >
        <div className="px-5 pb-5">
          <p className="text-[13.5px] text-muted">{t('sj.profile.deleteRatingDesc')}</p>
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setPendingDelete(null)}
              className="px-4 py-2 rounded-[10px] text-[13.5px] font-medium text-muted hover:text-ink transition"
            >
              {t('sj.common.cancel')}
            </button>
            <button
              onClick={() => {
                if (pendingDelete) deleteRating(pendingDelete);
                setPendingDelete(null);
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

function RatedRow({
  item,
  instinctCount,
  showScore,
  onDelete,
}: {
  item: ProfileRatingItem;
  instinctCount: number;
  showScore: boolean;
  onDelete?: () => void;
}) {
  const { t } = useLanguage();
  const score =
    item.score != null
      ? item.score
      : item.eloScore != null && instinctCount >= INSTINCT_REVEAL_THRESHOLD
        ? eloToScore(item.eloScore)
        : null;
  const pendingReveal =
    item.score == null && item.eloScore != null && instinctCount < INSTINCT_REVEAL_THRESHOLD;
  const href = item.isSong
    ? `/song/${item.recordingId}${item.releaseGroupId ? `?rg=${item.releaseGroupId}` : ''}`
    : `/album/${item.releaseGroupId}`;

  return (
    <li className="group flex items-center gap-3 py-2.5">
      <Link href={href} className="flex items-center gap-3 min-w-0 flex-1">
        <Cover url={item.coverUrl} className="w-[46px] h-[46px]" rounded="rounded-md" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-ink truncate">{item.title}</span>
            {item.isSong ? (
              <span className="px-1.5 py-0.5 rounded bg-accent/[0.12] text-accent text-[9.5px] font-medium shrink-0">
                {t('sj.type.song')}
              </span>
            ) : item.releaseType ? (
              <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[9.5px] font-medium shrink-0">
                {item.releaseType.toLowerCase() === 'ep'
                  ? 'EP'
                  : item.releaseType.charAt(0).toUpperCase() + item.releaseType.slice(1)}
              </span>
            ) : null}
          </span>
          <span className="block text-[12px] text-muted truncate">{item.artistLine}</span>
        </span>
      </Link>
      {showScore && score != null ? (
        <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent shrink-0">
          <FlowerGlyph size={11} />
          <span className="text-[13px] font-bold tabular-nums">{formatScore(score)}</span>
        </span>
      ) : pendingReveal ? (
        <span className="text-[10px] text-muted text-right max-w-[110px] shrink-0">
          {t('sj.instinct.rateMoreToReveal').replace(
            '{n}',
            String(INSTINCT_REVEAL_THRESHOLD - instinctCount),
          )}
        </span>
      ) : (
        <FlowerGlyph size={11} className="text-muted shrink-0" />
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          aria-label={t('sj.profile.deleteRatingTitle')}
          className="p-1.5 text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition shrink-0"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
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

  if (loading) return <p className="py-14 text-center text-[13px] text-muted">…</p>;

  return (
    <div className="mt-3">
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
            <li key={mix.id}>
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

// ── Stats tab ───────────────────────────────────────────────────────────────

function StatsTab({
  items,
  instinctCount,
}: {
  items: ProfileRatingItem[];
  instinctCount: number;
}) {
  const { t } = useLanguage();
  const albums = items.filter((i) => !i.isSong);
  const songs = items.filter((i) => i.isSong);

  if (items.length === 0) return <Empty label={t('sj.profile.noStats')} />;

  const manualScores = items.map((i) => i.score).filter((s): s is number => s != null);
  const avg = manualScores.length
    ? manualScores.reduce((a, b) => a + b, 0) / manualScores.length
    : 0;

  // 0.5 buckets across manual + revealed instinct scores
  const allScores: number[] = [];
  for (const i of items) {
    if (i.score != null) allScores.push(i.score);
    else if (i.eloScore != null && instinctCount >= INSTINCT_REVEAL_THRESHOLD) {
      allScores.push(eloToScore(i.eloScore));
    }
  }
  const buckets = Array.from({ length: 10 }, (_, i) => ({ score: (i + 1) / 2, count: 0 }));
  for (const s of allScores) {
    const b = Math.max(0.5, Math.min(5, Math.round(s * 2) / 2));
    buckets[Math.round(b * 2) - 1].count += 1;
  }
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));

  // Top artists (albums only)
  const artistCounts: Record<string, number> = {};
  for (const i of albums) {
    if (i.releaseArtist) artistCounts[i.releaseArtist] = (artistCounts[i.releaseArtist] ?? 0) + 1;
  }
  const topArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxArtist = topArtists[0]?.[1] ?? 1;

  const manualCount = items.filter((i) => i.score != null).length;
  const instinctTotal = items.filter((i) => i.eloScore != null).length;

  return (
    <div className="mt-5 space-y-8 max-w-lg">
      <div className="flex rounded-xl bg-ink/[0.05] py-3.5">
        <StatCell value={albums.length} label={t('sj.profile.filterAlbums')} />
        <span className="w-px bg-divider" />
        <StatCell value={songs.length} label={t('sj.profile.filterSongs')} />
        <span className="w-px bg-divider" />
        <span className="flex-1 flex flex-col items-center">
          <span className="text-[18px] font-bold text-ink tabular-nums">{avg.toFixed(2)}</span>
          <span className="text-[10.5px] text-muted">{t('sj.profile.avgScore')}</span>
        </span>
      </div>

      <section>
        <h3 className="text-[11px] font-semibold tracking-[0.05em] uppercase text-muted mb-3">
          {t('sj.artist.scoreDistribution')}
        </h3>
        <div className="flex items-end gap-1 h-24">
          {buckets.map((b) => (
            <span key={b.score} className="flex-1 flex flex-col items-center gap-0.5 self-end">
              <span className="text-[8px] text-muted h-3">{b.count > 0 ? b.count : ''}</span>
              <span
                className={`w-full rounded ${b.count > 0 ? 'bg-accent/75' : 'bg-ink/[0.07]'}`}
                style={{ height: Math.max(4, (b.count / maxCount) * 72) }}
              />
            </span>
          ))}
        </div>
        <div className="h-px bg-divider/60 mt-0.5" />
        <div className="flex gap-1 mt-1">
          {buckets.map((b) => (
            <span key={b.score} className="flex-1 text-center text-[9px] text-muted">
              {Number.isInteger(b.score) ? b.score : ''}
            </span>
          ))}
        </div>
      </section>

      {topArtists.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.05em] uppercase text-muted mb-2">
            {t('sj.profile.topArtists')}
          </h3>
          <ul className="divide-y divide-divider">
            {topArtists.map(([artist, count]) => (
              <li key={artist} className="flex items-center gap-2.5 py-2">
                <span className="flex-1 text-[13px] text-ink truncate">{artist}</span>
                <span className="w-20 h-2 rounded bg-transparent">
                  <span
                    className="block h-full rounded bg-accent/30"
                    style={{ width: `${(count / maxArtist) * 100}%` }}
                  />
                </span>
                <span className="w-6 text-right text-[12px] font-semibold text-muted tabular-nums">
                  {count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(instinctTotal > 0 || manualCount > 0) && (
        <section>
          <h3 className="text-[11px] font-semibold tracking-[0.05em] uppercase text-muted mb-3">
            {t('sj.profile.ratingMode')}
          </h3>
          <div className="flex gap-2.5">
            {instinctTotal > 0 && (
              <span className="flex-1 px-3.5 py-3 rounded-[10px] bg-accent/[0.08]">
                <span className="block text-[20px] font-bold text-ink tabular-nums">
                  {instinctTotal}
                </span>
                <span className="block text-[11px] text-muted">
                  {t('sj.onboarding.modeInstinct')}
                </span>
              </span>
            )}
            {manualCount > 0 && (
              <span className="flex-1 px-3.5 py-3 rounded-[10px] bg-accent/[0.08]">
                <span className="block text-[20px] font-bold text-ink tabular-nums">
                  {manualCount}
                </span>
                <span className="block text-[11px] text-muted">
                  {t('sj.onboarding.modeManual')}
                </span>
              </span>
            )}
          </div>
        </section>
      )}
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
          <p className="py-10 text-center text-[13px] text-muted">…</p>
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
                  {p.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.avatar_url}
                      alt=""
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex w-10 h-10 rounded-full bg-accent-soft text-accent-deep items-center justify-center text-[13px] font-bold">
                      {(p.username ?? p.display_name ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="min-w-0">
                    {p.display_name && (
                      <span className="block text-[13.5px] font-semibold text-ink truncate">
                        {p.display_name}
                      </span>
                    )}
                    {p.username && (
                      <span className="block text-[12.5px] text-muted truncate">
                        @{p.username}
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
