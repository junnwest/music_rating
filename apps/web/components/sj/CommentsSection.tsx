'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Flag, Heart, MessageCircle, MoreHorizontal, Pencil } from 'lucide-react';
import Avatar from './Avatar';
import ScoreBadge from './ScoreBadge';
import CommentsModal from './CommentsModal';
import TrackCommentsModal from './TrackCommentsModal';
import ReportModal from './ReportModal';
import { OverflowMenuSurface } from './AlbumOverflowMenu';
import { useSession } from './SessionContext';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { relativeTime } from '../../lib/sj/display';

/**
 * P6 (+ P7) — ranked comments for an album or a song.
 *
 * A comment is a rating with review_text; the ranking, privacy and blocking all
 * happen server-side in `get_album_comments` / `get_song_comments` (migration
 * 20260926000003, which documents the "Top" weights). Sorting is never done by
 * pulling everything to the client. The viewer's own comment is pinned first
 * from the page's own state, with an Edit that jumps to the inline editor.
 */

export type CommentSort = 'top' | 'newest' | 'highest' | 'lowest' | 'following';
const PAGE = 10;

interface CommentRow {
  id: string;
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_verified: boolean;
  score: number | null;
  review_text: string;
  created_at: string;
  likes: number;
  replies: number;
  liked_by_me: boolean;
  total_count: number;
}

export default function CommentsSection({
  kind,
  parentId,
  mine,
}: {
  kind: 'album' | 'song';
  /** release_group id (album) or recording id (song). */
  parentId: string;
  /** The viewer's own comment, pinned first. */
  mine?: { score: number | null; text: string; onEdit: () => void } | null;
}) {
  const { t, lang } = useLanguage();
  const { userId, profile, requireAuth } = useSession();
  const [sort, setSort] = useState<CommentSort>('top');
  const [rows, setRows] = useState<CommentRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [allCount, setAllCount] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  const rpc = kind === 'album' ? 'get_album_comments' : 'get_song_comments';
  const parentArg = kind === 'album' ? 'p_release_group_id' : 'p_recording_id';

  const fetchPage = useCallback(
    async (s: CommentSort, offset: number) => {
      if (!supabase) return null;
      const { data, error } = await supabase.rpc(rpc, {
        [parentArg]: parentId,
        p_sort: s,
        p_limit: PAGE,
        p_offset: offset,
      });
      if (error) {
        console.error(`[comments] ${rpc} failed:`, error.message);
        return null;
      }
      return ((data as any[]) ?? []).map(
        (r): CommentRow => ({
          id: r.rating_id ?? r.track_rating_id,
          user_id: r.user_id,
          username: r.username,
          display_name: r.display_name,
          avatar_url: r.avatar_url,
          is_verified: !!r.is_verified,
          score: r.score == null ? null : Number(r.score),
          review_text: r.review_text,
          created_at: r.created_at,
          likes: Number(r.likes),
          replies: Number(r.replies),
          liked_by_me: !!r.liked_by_me,
          total_count: Number(r.total_count),
        }),
      );
    },
    [rpc, parentArg, parentId],
  );

  useEffect(() => {
    const my = ++seq.current;
    setRows(null);
    setFailed(false);
    fetchPage(sort, 0).then((page) => {
      if (my !== seq.current) return;
      if (!page) {
        setFailed(true);
        setRows([]);
        return;
      }
      setRows(page);
      const n = page[0]?.total_count ?? 0;
      setTotal(n);
      // "Comments (N)" counts everything visible, not the Following subset.
      if (sort !== 'following') setAllCount(n);
    });
  }, [sort, fetchPage]);

  async function more() {
    if (!rows) return;
    setLoadingMore(true);
    const page = await fetchPage(sort, rows.length);
    setLoadingMore(false);
    if (page) setRows((prev) => [...(prev ?? []), ...page.filter((p) => !prev?.some((x) => x.id === p.id))]);
  }

  async function toggleLike(row: CommentRow) {
    if (!requireAuth() || !userId || !supabase) return;
    const like = !row.liked_by_me;
    const patch = (on: boolean) =>
      setRows((prev) =>
        prev?.map((r) =>
          r.id === row.id ? { ...r, liked_by_me: on, likes: Math.max(0, r.likes + (on ? 1 : -1)) } : r,
        ) ?? prev,
      );
    patch(like);
    const table = kind === 'album' ? 'rating_likes' : 'track_rating_likes';
    const col = kind === 'album' ? 'rating_id' : 'track_rating_id';
    const { error } = like
      ? await supabase.from(table).insert({ user_id: userId, [col]: row.id })
      : await supabase.from(table).delete().eq('user_id', userId).eq(col, row.id);
    if (error) {
      console.error('[comments] like failed:', error.message);
      patch(!like);
    }
  }

  const tabs: { key: CommentSort; label: string }[] = [
    { key: 'top', label: t('sj.commentsSection.top') },
    { key: 'newest', label: t('sj.commentsSection.newest') },
    { key: 'highest', label: t('sj.commentsSection.highest') },
    { key: 'lowest', label: t('sj.commentsSection.lowest') },
    ...(userId ? [{ key: 'following' as CommentSort, label: t('sj.commentsSection.following') }] : []),
  ];

  const hasMine = !!mine && mine.text.trim() !== '';
  const count = (allCount ?? 0) + (hasMine ? 1 : 0);

  return (
    <section className="mt-6" aria-labelledby={`comments-${parentId}`}>
      <h2
        id={`comments-${parentId}`}
        className="text-[11px] font-semibold tracking-[0.06em] uppercase text-muted mb-2 px-1"
      >
        {allCount === null
          ? t('sj.commentsSection.title')
          : t('sj.commentsSection.titleN').replace('{n}', String(count))}
      </h2>

      <div className="rounded-2xl bg-surface border border-divider/60 overflow-hidden">
        <div
          role="tablist"
          aria-label={t('sj.commentsSection.sortBy')}
          className="flex gap-1 px-2 pt-2 pb-1.5 border-b border-divider overflow-x-auto shelf-scroll"
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={sort === tab.key}
              onClick={() => setSort(tab.key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-[12.5px] font-semibold transition ${
                sort === tab.key ? 'bg-ink text-page' : 'text-muted hover:text-ink hover:bg-page'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <ul className="divide-y divide-divider">
          {hasMine && sort !== 'following' && (
            <li className="px-4 py-3 bg-accent/[0.04]">
              <div className="flex items-center gap-3">
                <Avatar url={profile?.avatar_url} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink truncate">
                    @{profile?.username ?? ''}{' '}
                    <span className="ml-1 px-1.5 py-px rounded bg-accent/10 text-accent text-[10px] font-semibold align-middle">
                      {t('sj.commentsSection.you')}
                    </span>
                  </span>
                </span>
                {mine!.score != null && <ScoreBadge score={mine!.score} size={28} ringStroke={2} />}
                <button
                  type="button"
                  onClick={mine!.onEdit}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-semibold text-accent hover:bg-accent/10 transition"
                >
                  <Pencil size={12} />
                  {t('sj.common.edit')}
                </button>
              </div>
              <ClampedText text={mine!.text} />
            </li>
          )}

          {rows === null ? (
            Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="px-4 py-3.5" aria-hidden>
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-divider/50 animate-pulse" />
                  <span className="h-3 w-28 rounded bg-divider/50 animate-pulse" />
                </div>
                <span className="block mt-2.5 ml-11 h-3 w-3/4 rounded bg-divider/50 animate-pulse" />
                <span className="block mt-1.5 ml-11 h-3 w-1/2 rounded bg-divider/50 animate-pulse" />
              </li>
            ))
          ) : failed ? (
            <li className="px-4 py-6 text-center text-[13px] text-muted">{t('sj.common.loadError')}</li>
          ) : rows.length === 0 ? (
            hasMine && sort !== 'following' ? null : (
              <li className="px-4 py-8 text-center text-[13px] text-muted">
                {sort === 'following'
                  ? t('sj.commentsSection.emptyFollowing')
                  : kind === 'album'
                    ? t('sj.commentsSection.emptyAlbum')
                    : t('sj.commentsSection.emptySong')}
              </li>
            )
          ) : (
            rows.map((row) => (
              <CommentCard
                key={row.id}
                row={row}
                kind={kind}
                lang={lang}
                onLike={() => toggleLike(row)}
                onReported={() => setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? prev)}
              />
            ))
          )}
        </ul>

        {rows && rows.length < total && (
          <div className="border-t border-divider p-2">
            <button
              type="button"
              onClick={more}
              disabled={loadingMore}
              className="w-full py-2 rounded-xl text-[13px] font-semibold text-accent hover:bg-page disabled:opacity-60 transition"
            >
              {loadingMore ? t('sj.common.loading') : t('sj.commentsSection.showMore')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function ClampedText({ text }: { text: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text]);
  return (
    <div className="mt-2 ml-11">
      <p
        ref={ref}
        className={`text-[13.5px] leading-relaxed text-ink/90 whitespace-pre-wrap break-words ${
          open ? '' : 'line-clamp-4'
        }`}
      >
        {text}
      </p>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-[12px] font-semibold text-muted hover:text-ink"
        >
          {open ? t('sj.commentsSection.less') : t('sj.commentsSection.more')}
        </button>
      )}
    </div>
  );
}

function CommentCard({
  row,
  kind,
  lang,
  onLike,
  onReported,
}: {
  row: CommentRow;
  kind: 'album' | 'song';
  lang: 'en' | 'ko';
  onLike: () => void;
  onReported: () => void;
}) {
  const { t } = useLanguage();
  const { requireAuth } = useSession();
  const [thread, setThread] = useState(false);
  const [replies, setReplies] = useState(row.replies);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [reporting, setReporting] = useState(false);
  const handle = row.username ?? row.display_name ?? t('sj.common.someone');

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Link href={`/profile/${row.username ?? ''}`} className="flex items-center gap-3 min-w-0 flex-1 group">
          <Avatar url={row.avatar_url} size={32} />
          <span className="min-w-0">
            <span className="flex items-center gap-1 text-[13px] font-semibold text-ink truncate group-hover:underline">
              @{handle}
              {/* Role badge slot — verified today; critic etc. once roles exist. */}
              {row.is_verified && (
                <BadgeCheck size={13} className="text-accent shrink-0" aria-label={t('sj.commentsSection.verified')} />
              )}
            </span>
            <span className="block text-[11px] text-muted">{relativeTime(row.created_at, lang)}</span>
          </span>
        </Link>
        {row.score != null && <ScoreBadge score={row.score} size={28} ringStroke={2} />}
        {kind === 'album' && (
          <button
            type="button"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuAt(menuAt ? null : { x: r.right, y: r.bottom + 6 });
            }}
            aria-label={t('sj.common.moreOptions')}
            className="grid place-items-center w-7 h-7 -mr-1.5 rounded-lg text-muted hover:text-ink hover:bg-page transition"
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      </div>
      <ClampedText text={row.review_text} />
      <div className="mt-1.5 ml-11 flex items-center gap-4">
        <button
          type="button"
          onClick={onLike}
          aria-label={row.liked_by_me ? t('sj.feed.unlike') : t('sj.feed.like')}
          aria-pressed={row.liked_by_me}
          className={`inline-flex items-center gap-1 text-[12.5px] font-medium transition ${
            row.liked_by_me ? 'text-red-500' : 'text-muted hover:text-red-500'
          }`}
        >
          <Heart size={15} className={row.liked_by_me ? 'fill-current sj-heart-pop' : ''} />
          {row.likes > 0 && row.likes}
        </button>
        <button
          type="button"
          onClick={() => setThread(true)}
          aria-label={t('sj.feed.viewComments')}
          className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted hover:text-accent transition"
        >
          <MessageCircle size={15} />
          {replies > 0 && replies}
        </button>
      </div>

      {menuAt && (
        <OverflowMenuSurface
          x={menuAt.x}
          y={menuAt.y}
          items={[
            {
              key: 'report',
              label: t('sj.feed.report'),
              icon: <Flag size={15} />,
              destructive: true,
              onSelect: () => requireAuth() && setReporting(true),
            },
          ]}
          onClose={() => setMenuAt(null)}
        />
      )}
      {thread &&
        (kind === 'album' ? (
          <CommentsModal open onClose={() => setThread(false)} ratingId={row.id} onCountChange={setReplies} />
        ) : (
          <TrackCommentsModal
            open
            onClose={() => setThread(false)}
            trackRatingId={row.id}
            onCountChange={setReplies}
          />
        ))}
      {reporting && (
        <ReportModal
          open
          onClose={() => {
            setReporting(false);
          }}
          reportedUserId={row.user_id}
          ratingId={row.id}
          onReported={onReported}
        />
      )}
    </li>
  );
}
