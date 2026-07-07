'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import Modal from './Modal';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { profileHandle } from '../../lib/sj/data';

interface LikerRow {
  user_id: string;
  profiles: { id: string; username: string | null; display_name: string | null } | null;
}

/** Who liked a rating — mirrors iOS LikersSheetView. */
export default function LikersModal({
  open,
  onClose,
  ratingId,
}: {
  open: boolean;
  onClose: () => void;
  ratingId: string;
}) {
  const { t } = useLanguage();
  const [likers, setLikers] = useState<LikerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !supabase) return;
    setLoading(true);
    supabase
      .from('rating_likes')
      .select('user_id, profiles!rating_likes_user_id_fkey(id, username, display_name)')
      .eq('rating_id', ratingId)
      .then(({ data }) => {
        setLikers((data as unknown as LikerRow[] | null) ?? []);
        setLoading(false);
      });
  }, [open, ratingId]);

  const title = loading
    ? t('sj.likes.title')
    : likers.length === 1
      ? t('sj.likes.one')
      : t('sj.likes.many').replace('{n}', String(likers.length));

  return (
    <Modal open={open} onClose={onClose} title={title}>
      {loading ? (
        <p className="py-12 text-center text-[13px] text-muted">…</p>
      ) : likers.length === 0 ? (
        <div className="py-12 flex flex-col items-center gap-3 text-muted">
          <Heart size={30} className="text-divider" />
          <p className="text-[14px]">{t('sj.likes.empty')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-divider">
          {likers.map((liker, i) => (
            <li key={`${liker.user_id}-${i}`}>
              <Link
                href={`/profile/${liker.profiles?.username ?? ''}`}
                onClick={onClose}
                className="flex items-center gap-3 px-5 py-3 hover:bg-surface transition"
              >
                <span className="flex w-8 h-8 rounded-full bg-accent-soft text-accent-deep items-center justify-center text-[12px] font-bold">
                  {profileHandle(liker.profiles).slice(0, 1).toUpperCase()}
                </span>
                <span className="text-[14px] font-semibold text-ink">
                  @{profileHandle(liker.profiles)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
