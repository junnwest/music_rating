'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Heart,
  MessageCircle,
  MoreHorizontal,
  Bookmark,
  Share2,
  Flag,
  Ban,
  EyeOff,
} from 'lucide-react';
import Avatar from './Avatar';
import Cover from './Cover';
import ScoreBadge from './ScoreBadge';
import AlbumRateButton from './AlbumRateButton';
import AlbumBookmarkButton from './AlbumBookmarkButton';
import AlbumPeek from './AlbumPeek';
import CommentsModal from './CommentsModal';
import LikersModal from './LikersModal';
import ReportModal from './ReportModal';
import MixPickerModal from './MixPickerModal';
import { useLanguage } from '../../lib/i18n';
import {
  profileHandle,
  releaseFromEmbed,
  type FeedItemRow,
} from '../../lib/sj/data';
import { displayName, displayScore, relativeTime, typeLabelKey } from '../../lib/sj/display';

/**
 * A rating post in the feed — mirrors iOS HomeView.FeedCard: header
 * (@handle · time · overflow menu), tappable album row with ScoreBadge,
 * review text, like/comment action bar. Long-press affordances from mobile
 * become an explicit overflow menu + hover states here.
 */
export default function FeedCard({
  item,
  currentUserId,
  isLiked,
  likesCount,
  commentsCount,
  onLike,
  onBlock,
  onNotInterested,
}: {
  item: FeedItemRow;
  currentUserId: string | null;
  isLiked: boolean;
  likesCount: number;
  commentsCount: number;
  onLike: () => void;
  onBlock: () => void;
  /** Down-weight this album for the recommender; the feed drops the card. */
  onNotInterested?: () => void;
}) {
  const { t, lang } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showLikers, setShowLikers] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [showMixPicker, setShowMixPicker] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const rg = item.release_groups;
  const release = releaseFromEmbed(rg);
  const score = displayScore(item.score, item.elo_score);
  const handle = profileHandle(item.profiles);
  const isOwn = currentUserId != null && item.user_id === currentUserId;

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  async function share() {
    const url = `https://sillajuku.com/album/${rg.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `${rg.title} · ${rg.artist_display}`, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user cancelled */
    }
    setMenuOpen(false);
  }

  return (
    <article className="bg-surface rounded-2xl shadow-[0_1px_4px_rgba(0,0,0,0.05)] border border-divider/60">
      {/* Header */}
      <div className="flex items-center gap-2 pl-3.5 pr-1 pt-2.5 pb-1">
        <Link
          href={isOwn ? '/profile' : `/profile/${item.profiles?.username ?? ''}`}
          className="flex items-center gap-2 min-w-0 group"
        >
          <Avatar url={null} size={30} />
          <span className="text-[13.5px] font-semibold text-ink truncate group-hover:underline">
            @{handle}
          </span>
        </Link>
        <span className="text-divider text-[13px]">·</span>
        <span className="text-[12px] text-muted shrink-0">
          {relativeTime(item.created_at, lang)}
        </span>
        <div className="ml-auto relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t('sj.common.moreOptions')}
            className="p-2 rounded-lg text-muted hover:text-ink hover:bg-page transition"
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-20 w-52 py-1.5 rounded-xl bg-surface border border-divider shadow-xl">
              <MenuItem
                icon={<Bookmark size={15} />}
                label={t('sj.mix.saveToMix')}
                onClick={() => {
                  setShowMixPicker(true);
                  setMenuOpen(false);
                }}
              />
              <MenuItem icon={<Share2 size={15} />} label={t('sj.feed.share')} onClick={share} />
              {onNotInterested && (
                <MenuItem
                  icon={<EyeOff size={15} />}
                  label={t('sj.notInterested.action')}
                  onClick={() => {
                    setMenuOpen(false);
                    onNotInterested();
                  }}
                />
              )}
              {!isOwn && (
                <>
                  <div className="h-px bg-divider my-1.5" />
                  <MenuItem
                    icon={<Flag size={15} />}
                    label={t('sj.feed.report')}
                    destructive
                    onClick={() => {
                      setShowReport(true);
                      setMenuOpen(false);
                    }}
                  />
                  <MenuItem
                    icon={<Ban size={15} />}
                    label={t('sj.feed.block')}
                    destructive
                    onClick={() => {
                      setConfirmBlock(true);
                      setMenuOpen(false);
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Album row */}
      <Link
        href={`/album/${rg.id}`}
        className="flex items-center gap-3.5 px-3.5 pb-2.5 hover:opacity-95 transition"
      >
        <AlbumPeek
          releaseId={rg.id}
          title={displayName(rg.title, rg.native_title)}
          artist={displayName(rg.artist_display, rg.artists?.name_native)}
          release={release}
          onNotInterested={onNotInterested}
          className="relative shrink-0 group"
        >
          <Cover url={rg.cover_url} className="w-20 h-20" />
          <AlbumBookmarkButton
            releaseGroupId={rg.id}
            size={24}
            className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
          />
          <AlbumRateButton
            release={release}
            size={26}
            className="absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition"
          />
        </AlbumPeek>
        <div className="flex-1 min-w-0">
          <p className="text-[16.5px] font-bold text-ink line-clamp-2">
            {displayName(rg.title, rg.native_title)}
          </p>
          <p className="text-[13.5px] text-muted truncate mt-0.5">
            {t(typeLabelKey(rg.release_group_type))} ·{' '}
            {displayName(rg.artist_display, rg.artists?.name_native)}
          </p>
        </div>
        {score != null && <ScoreBadge score={score} size={44} />}
      </Link>

      {/* Review text */}
      {item.review_text && (
        <p className="px-3.5 pb-2.5 text-[14px] text-ink whitespace-pre-wrap break-words">
          {item.review_text}
        </p>
      )}

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
          <span className="text-[13.5px] font-medium text-muted">{commentsCount}</span>
        </span>
      </div>

      {/* Block confirm */}
      {confirmBlock && (
        <div className="px-3.5 pb-3">
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-red-500/[0.06] border border-red-500/20">
            <p className="text-[12.5px] text-ink">{t('sj.feed.blockConfirm')}</p>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => setConfirmBlock(false)}
                className="px-2.5 py-1 rounded-lg text-[12px] font-medium text-muted hover:text-ink"
              >
                {t('sj.common.cancel')}
              </button>
              <button
                onClick={() => {
                  setConfirmBlock(false);
                  onBlock();
                }}
                className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[12px] font-semibold hover:opacity-90"
              >
                {t('sj.feed.block')}
              </button>
            </div>
          </div>
        </div>
      )}

      <CommentsModal
        open={showComments}
        onClose={() => setShowComments(false)}
        ratingId={item.id}
      />
      <LikersModal open={showLikers} onClose={() => setShowLikers(false)} ratingId={item.id} />
      <ReportModal
        open={showReport}
        onClose={() => setShowReport(false)}
        reportedUserId={item.user_id}
        ratingId={item.id}
      />
      <MixPickerModal
        open={showMixPicker}
        onClose={() => setShowMixPicker(false)}
        releaseGroupId={rg.id}
      />
    </article>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  destructive = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13.5px] text-left transition hover:bg-page ${
        destructive ? 'text-red-500' : 'text-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
