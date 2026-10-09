'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import Modal from './Modal';
import InlineRatingEditor from './InlineRatingEditor';
import CommentsModal from './CommentsModal';
import { useLanguage } from '../../lib/i18n';
import { supabase } from '../../lib/supabaseClient';
import { songHref } from '../../lib/sj/trackLinks';
import type { ProfileRatingItem } from './ProfileView';

export default function ProfileRatingEditor({
  item, step, onClose, onChange, onDelete,
}: {
  item: ProfileRatingItem | null;
  step: number;
  onClose: () => void;
  onChange: (item: ProfileRatingItem) => void;
  onDelete: (item: ProfileRatingItem) => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReplies, setShowReplies] = useState(false);

  useEffect(() => {
    setDraft(item?.reviewText ?? '');
    setError(null);
    setShowReplies(false);
  }, [item?.ratingId, item?.reviewText]);

  async function saveScore(score: number | null) {
    if (!item || !supabase) return;
    if (score == null) {
      onClose();
      onDelete(item);
      return;
    }
    const table = item.isSong ? 'track_ratings' : 'ratings';
    const { error: updateError } = await supabase.from(table).update({ score }).eq('id', item.ratingId);
    if (updateError) setError(t('sj.onboarding.saveError'));
    else { setError(null); onChange({ ...item, score }); }
  }

  async function saveReview() {
    if (!item || !supabase || saving) return;
    setSaving(true);
    const text = draft.trim() || null;
    const { error: updateError } = await supabase.from('ratings').update({ review_text: text }).eq('id', item.ratingId);
    if (updateError) setError(t('sj.onboarding.saveError'));
    else { setError(null); onChange({ ...item, reviewText: text }); }
    setSaving(false);
  }

  const href = item?.isSong
    ? songHref(item.recordingId!, item.releaseGroupId)
    : `/album/${item?.releaseGroupId}`;

  return <>
    <Modal open={item != null && !showReplies} onClose={onClose} title={item?.title ?? ''} maxWidth="max-w-lg">
      {item && <div className="p-5 space-y-4">
        <InlineRatingEditor score={item.score} step={step} onSave={saveScore} />
        {/* A song rating is a score only -- no comment, no replies (2026-10-06). */}
        {item.isSong ? (
          <>
            {error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}
            <Link href={href} className="inline-block text-[12px] text-muted hover:text-accent hover:underline">{t('sj.context.openAlbum')}</Link>
          </>
        ) : <>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('sj.rate.addComment')}
          rows={4}
          className="w-full px-3.5 py-2.5 rounded-xl bg-page border border-divider text-[13.5px] leading-relaxed text-ink placeholder-placeholder outline-none focus:border-accent/60 resize-y"
        />
        {error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setShowReplies(true)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted hover:text-accent">
            <MessageCircle size={15} /> {t('sj.feed.viewComments')}
          </button>
          <Link href={href} target="_blank" rel="noopener noreferrer" className="text-[12px] text-muted hover:text-accent hover:underline">{t('sj.context.openNewTab')}</Link>
          <span className="flex-1" />
          <button type="button" onClick={saveReview} disabled={saving || draft.trim() === (item.reviewText ?? '')} className="px-4 py-2 rounded-lg bg-accent text-white text-[12px] font-semibold disabled:opacity-50">
            {t('sj.common.save')}
          </button>
        </div>
        </>}
      </div>}
    </Modal>
    {item && !item.isSong && (
      <CommentsModal open={showReplies} onClose={() => setShowReplies(false)} ratingId={item.ratingId} />
    )}
  </>;
}
