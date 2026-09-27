'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Heart, MessageCircle, Pencil, Trash2 } from 'lucide-react';
import Cover from './Cover';
import ArtistLink from './ArtistLink';
import ScoreBadge from './ScoreBadge';
import TrackCommentsModal from './TrackCommentsModal';
import TrackLikersModal from './TrackLikersModal';
import { useLanguage } from '../../lib/i18n';
import { relativeTime } from '../../lib/sj/display';
import type { ProfileRatingItem } from './ProfileView';

/**
 * Posts display mode for song ratings -- mirrors iOS ProfileSongPostCard exactly (same
 * cover + score badge + review text + like/comment bar + date shape as ProfilePostCard, plus
 * a small "Song" badge next to the title). Song ratings only got likes/comments/review_text in
 * the schema recently (track_rating_likes/track_rating_comments) -- this is the first web UI to
 * surface any of it.
 */
export default function ProfileSongPostCard({
  item,
  likesCount,
  commentsCount,
  isLiked,
  onLike,
  onDelete,
  onEdit,
}: {
  item: ProfileRatingItem;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
  onLike: () => void;
  onDelete: () => void;
  onEdit: () => void;
}) {
  const { t, lang } = useLanguage();
  const [showComments, setShowComments] = useState(false);
  const [showLikers, setShowLikers] = useState(false);

  const score = item.score;

  return (
    <article className="bg-surface rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-divider/60 group">
      <div className="flex items-center gap-3.5 px-3.5 pt-3.5 pb-2.5">
        <Link href={`/song/${item.recordingId}${item.releaseGroupId ? `?rg=${item.releaseGroupId}` : ''}`}><Cover url={item.coverUrl} className="w-20 h-20" /></Link>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <Link href={`/song/${item.recordingId}${item.releaseGroupId ? `?rg=${item.releaseGroupId}` : ''}`} className="text-[16.5px] font-bold text-ink line-clamp-2 hover:underline">{item.title}</Link>
            <span className="px-1.5 py-0.5 rounded bg-accent/[0.12] text-accent text-[10px] font-medium shrink-0">
              {t('sj.type.song')}
            </span>
          </span>
          <span className="block text-[13.5px] text-muted truncate mt-0.5">
            {item.releaseTitle ? `${item.releaseTitle} · ` : null}{item.artistId ? (
              <ArtistLink href={`/artist/${item.artistId}`} className="hover:text-accent hover:underline">{item.artistName}</ArtistLink>
            ) : item.artistName}
          </span>
        </span>
        {score != null && <ScoreBadge score={score} size={44} />}
      </div>

      {item.reviewText && (
        <button type="button" onClick={onEdit} aria-label={t('sj.rate.editComment')} className="block w-full px-3.5 pb-2.5 text-[14px] text-ink whitespace-pre-wrap break-words text-left hover:text-accent">
          {item.reviewText}
        </button>
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
        <button onClick={onEdit} aria-label={t('sj.common.edit')} className="p-1.5 text-muted hover:text-accent transition"><Pencil size={14} /></button>
        <button
          onClick={onDelete}
          aria-label={t('sj.profile.deleteRatingTitle')}
          className="p-1.5 text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <TrackCommentsModal
        open={showComments}
        onClose={() => setShowComments(false)}
        trackRatingId={item.ratingId}
      />
      <TrackLikersModal
        open={showLikers}
        onClose={() => setShowLikers(false)}
        trackRatingId={item.ratingId}
      />
    </article>
  );
}
