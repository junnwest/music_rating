'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Heart, MessageCircle, MoreHorizontal, Ban, Trash2, ListMusic, ExternalLink } from 'lucide-react';
import Avatar from './Avatar';
import MixMosaic from './MixMosaic';
import CommentsModal from './CommentsModal';
import LikersModal from './LikersModal';
import { OverflowMenuSurface, type OverflowItem } from './AlbumOverflowMenu';
import { useContextMenu, openInNewTab } from './ContextMenu';
import { useMixName } from './MixTargetContext';
import { useLanguage } from '../../lib/i18n';
import { relativeTime } from '../../lib/sj/display';
import type { MixSharePost } from '../../lib/sj/mixShares';

/**
 * A mix post in the feed — web mirror of iOS MixShareCard, built on FeedCard's
 * structure (header · body · like/comment bar) so the two read as siblings.
 */
export default function MixPostCard({
  post,
  currentUserId,
  isLiked,
  likesCount,
  commentsCount,
  onLike,
  onBlock,
  onDelete,
}: {
  post: MixSharePost;
  currentUserId: string | null;
  isLiked: boolean;
  likesCount: number;
  commentsCount: number;
  onLike: () => void;
  onBlock?: () => void;
  onDelete?: () => void;
}) {
  const { t, lang } = useLanguage();
  const mixName = useMixName();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [confirm, setConfirm] = useState<'block' | 'delete' | null>(null);
  const [comments, setComments] = useState<number | null>(null);
  const isOwn = currentUserId != null && post.userId === currentUserId;
  const handle = post.profile?.username ?? post.profile?.display_name ?? t('sj.common.someone');
  const name = mixName({ name: post.mixName, is_default: post.mixIsDefault });

  const items: OverflowItem[] = [
    {
      key: 'open-new-tab',
      label: t('sj.context.openNewTab'),
      icon: <ExternalLink size={15} />,
      onSelect: () => openInNewTab(`/mix/${post.mixId}`),
    },
    ...(isOwn && onDelete
      ? [
          {
            key: 'delete',
            label: t('sj.mixPost.delete'),
            icon: <Trash2 size={15} />,
            destructive: true,
            onSelect: () => setConfirm('delete'),
          },
        ]
      : []),
    ...(!isOwn && onBlock
      ? [
          {
            key: 'block',
            label: t('sj.feed.block'),
            icon: <Ban size={15} />,
            destructive: true,
            onSelect: () => setConfirm('block'),
          },
        ]
      : []),
  ];
  const { onContextMenu, menu: contextMenu } = useContextMenu(items);

  return (
    <article
      onContextMenu={onContextMenu}
      className="bg-surface rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-divider/60"
    >
      {/* Header */}
      <div className="flex items-center gap-2 pl-3.5 pr-1 pt-2.5 pb-1">
        <Link
          href={isOwn ? '/profile' : `/profile/${post.profile?.username ?? ''}`}
          className="flex items-center gap-2 min-w-0 group"
        >
          <Avatar url={null} size={30} />
          <span className="text-[13.5px] font-semibold text-ink truncate group-hover:underline">
            @{handle}
          </span>
        </Link>
        <span className="text-[12px] text-muted shrink-0">{t('sj.mixPost.postedAMix')}</span>
        <span className="text-divider text-[13px]">·</span>
        <span className="text-[12px] text-muted shrink-0">{relativeTime(post.createdAt, lang)}</span>
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt(menuAt ? null : { x: r.right, y: r.bottom + 6 });
          }}
          aria-label={t('sj.common.moreOptions')}
          className="ml-auto p-2 rounded-lg text-muted hover:text-ink hover:bg-page transition"
        >
          <MoreHorizontal size={16} />
        </button>
        {menuAt && (
          <OverflowMenuSurface x={menuAt.x} y={menuAt.y} items={items} onClose={() => setMenuAt(null)} />
        )}
      </div>

      {/* Caption first — it's the poster's voice; the mix is what it's about. */}
      {post.caption && (
        <p className="px-3.5 pb-2 text-[14px] text-ink whitespace-pre-wrap break-words">{post.caption}</p>
      )}

      {/* Mix row */}
      <Link
        href={`/mix/${post.mixId}`}
        className="mx-3.5 mb-2 flex items-center gap-3.5 p-2.5 rounded-xl bg-page/60 border border-divider/60 hover:bg-page transition"
      >
        <MixMosaic
          covers={post.coverUrls}
          isDefault={post.mixIsDefault}
          className="w-[72px] h-[72px]"
          rounded="rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-accent">
            <ListMusic size={12} />
            {t('sj.mixPost.mix')}
          </p>
          <p className="text-[16px] font-bold text-ink truncate">{name}</p>
          {post.mixDescription && (
            <p className="text-[12.5px] text-muted line-clamp-2">{post.mixDescription}</p>
          )}
        </div>
      </Link>

      {/* Action bar */}
      <div className="flex items-center gap-4 pl-3.5 py-1.5 pb-2.5">
        <span className="flex items-center gap-1.5">
          <button
            onClick={onLike}
            aria-label={isLiked ? t('sj.feed.unlike') : t('sj.feed.like')}
            className={`transition ${isLiked ? 'text-red-500' : 'text-ink hover:text-red-500'}`}
          >
            <Heart size={19} className={isLiked ? 'fill-current sj-heart-pop' : ''} strokeWidth={1.9} />
          </button>
          <button
            onClick={() => setShowLikers(true)}
            className={`text-[13.5px] font-medium ${isLiked ? 'text-red-500' : 'text-muted'} hover:underline`}
          >
            {likesCount}
          </button>
        </span>
        <span className="flex items-center gap-1.5">
          <button
            onClick={() => setShowComments(true)}
            aria-label={t('sj.feed.viewComments')}
            className="text-ink hover:text-accent transition"
          >
            <MessageCircle size={19} strokeWidth={1.9} />
          </button>
          <span className="text-[13.5px] font-medium text-muted">{comments ?? commentsCount}</span>
        </span>
      </div>

      {confirm && (
        <div className="px-3.5 pb-3">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-red-500/[0.06] border border-red-500/20">
            <p className="text-[12.5px] text-ink">
              {confirm === 'block' ? t('sj.feed.blockConfirm') : t('sj.mixPost.deleteConfirm')}
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setConfirm(null)}
                className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-muted hover:text-ink"
              >
                {t('sj.common.cancel')}
              </button>
              <button
                onClick={() => {
                  const what = confirm;
                  setConfirm(null);
                  if (what === 'block') onBlock?.();
                  else onDelete?.();
                }}
                className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:opacity-90"
              >
                {confirm === 'block' ? t('sj.feed.block') : t('sj.mixPost.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <CommentsModal
        open={showComments}
        onClose={() => setShowComments(false)}
        mixShareId={post.id}
        onCountChange={setComments}
      />
      <LikersModal open={showLikers} onClose={() => setShowLikers(false)} mixShareId={post.id} />
      {contextMenu}
    </article>
  );
}
