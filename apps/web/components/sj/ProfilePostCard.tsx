'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Heart, MessageCircle, Trash2 } from 'lucide-react';
import Cover from './Cover';
import ScoreBadge from './ScoreBadge';
import CommentsModal from './CommentsModal';
import LikersModal from './LikersModal';
import { useLanguage } from '../../lib/i18n';
import { relativeTime, typeLabelKey } from '../../lib/sj/display';
import type { ProfileRatingItem } from './ProfileView';

/**
 * Posts display mode on the own profile — mirrors iOS ProfilePostCard
 * (cover + score badge + review text + like/comment bar + date).
 */
export default function ProfilePostCard({
  item,
  likesCount,
  commentsCount,
  isLiked,
  onLike,
  onDelete,
}: {
  item: ProfileRatingItem;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  onLike: () => void;
  onDelete: () => void;
}) {
  const { t, lang } = useLanguage();
  const [showComments, setShowComments] = useState(false);
  const [showLikers, setShowLikers] = useState(false);

  const score = item.score;

  return (
    <article className="bg-surface rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-divider/60 group">
      <Link
        href={`/album/${item.releaseGroupId}`}
        className="flex items-center gap-3.5 px-3.5 pt-3.5 pb-2.5"
      >
        <Cover url={item.coverUrl} className="w-20 h-20" />
        <span className="flex-1 min-w-0">
          <span className="block text-[16.5px] font-bold text-ink line-clamp-2">
            {item.title}
          </span>
          <span className="block text-[13.5px] text-muted truncate mt-0.5">
            {t(typeLabelKey(item.releaseType))} · {item.artistLine}
          </span>
        </span>
        {score != null && <ScoreBadge score={score} size={44} />}
      </Link>

      {item.reviewText && (
        <p className="px-3.5 pb-2.5 text-[14px] text-ink whitespace-pre-wrap break-words">
          {item.reviewText}
        </p>
      )}

      <div className="flex items-center gap-4 pl-3.5 pr-2 py-1.5 pb-2.5">
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
            aria-label={t('sj.likes.title')}
            className={`text-[13.5px] font-medium hover:underline ${isLiked ? 'text-red-500' : 'text-muted'}`}
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
          <span className="text-[13.5px] font-medium text-muted">{commentsCount}</span>
        </span>
        <span className="flex-1" />
        {item.createdAt && (
          <span className="text-[12px] text-muted">{relativeTime(item.createdAt, lang)}</span>
        )}
        <button
          onClick={onDelete}
          aria-label={t('sj.profile.deleteRatingTitle')}
          className="p-1.5 text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <CommentsModal
        open={showComments}
        onClose={() => setShowComments(false)}
        ratingId={item.ratingId}
      />
      <LikersModal open={showLikers} onClose={() => setShowLikers(false)} ratingId={item.ratingId} />
    </article>
  );
}
