'use client';

import { useEffect, useState } from 'react';
import Modal from './Modal';
import Cover from './Cover';
import PostRatingOptions from './PostRatingOptions';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';
import { releaseDisplayArtist, releaseDisplayTitle, type SJRelease } from '../../lib/sj/data';
import { typeLabelKey } from '../../lib/sj/display';

/**
 * Manual rating dialog — mirrors iOS ManualRatingSheet / TrackRatingSheet:
 * slider 0.5–5.0 at the user's precision (0.5 or 0.1), then (albums only)
 * the post-rating step (comment + add to list).
 */
export default function ManualRateModal({
  open,
  onClose,
  release,
  track,
  existingScore,
  ratingStep = 0.5,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  release: SJRelease;
  /** When rating a single track instead of the album. */
  track?: { recordingId: string; title: string } | null;
  existingScore: number | null;
  ratingStep?: number;
  /** Persist the score (null = remove). Parent owns the upsert/delete. */
  onSave: (score: number | null) => Promise<void> | void;
}) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<'rating' | 'postRating'>('rating');
  const [draft, setDraft] = useState(existingScore ?? 2.5);
  const [ratingId, setRatingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPhase('rating');
      setDraft(existingScore ?? 2.5);
      setRatingId(null);
    }
  }, [open, existingScore]);

  const isTrack = !!track;
  const title = isTrack ? track!.title : releaseDisplayTitle(release);
  const chipLabel = isTrack ? t('sj.type.song') : t(typeLabelKey(release.releaseType));

  const scoreLabel = Number.isInteger(draft)
    ? `${draft} / 5`
    : `${draft.toFixed(1)} / 5`;

  async function saveAndContinue() {
    await onSave(draft);
    if (isTrack) {
      onClose();
      return;
    }
    // Fetch the rating row id so the post-rating step can attach review_text
    if (supabase) {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (uid) {
        const { data } = await supabase
          .from('ratings')
          .select('id')
          .eq('user_id', uid)
          .eq('release_group_id', release.id)
          .maybeSingle();
        setRatingId((data as { id: string } | null)?.id ?? null);
      }
    }
    setPhase('postRating');
  }

  async function saveReviewAndClose(text: string | null) {
    if (text && ratingId && supabase) {
      await supabase.from('ratings').update({ review_text: text }).eq('id', ratingId);
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} showClose={phase === 'rating'} maxWidth="max-w-sm">
      {phase === 'rating' ? (
        <div className="flex flex-col px-5 pt-4 pb-6">
          {/* Header */}
          <div className="flex items-center gap-3">
            <Cover url={release.coverUrl} className="w-[52px] h-[52px]" rounded="rounded-lg" />
            <div className="min-w-0">
              <p className="text-[14px] font-bold text-ink truncate">{title}</p>
              <p className="flex items-center gap-1.5 text-[12px] text-muted truncate">
                <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium shrink-0">
                  {chipLabel}
                </span>
                {releaseDisplayArtist(release)}
              </p>
            </div>
          </div>

          <div className="h-px bg-divider my-4" />

          <p className="text-center text-[26px] font-bold text-accent tabular-nums">
            {scoreLabel}
          </p>

          <input
            type="range"
            min={0.5}
            max={5}
            step={ratingStep}
            value={draft}
            onChange={(e) => setDraft(parseFloat(e.target.value))}
            className="w-full mt-3 accent-[#2979B7]"
            aria-label={t('sj.rate.yourRating')}
          />
          <div className="flex justify-between text-[10px] text-muted px-0.5 mt-1">
            <span>0.5</span>
            <span>5.0</span>
          </div>

          <button
            onClick={saveAndContinue}
            className="mt-4 w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold hover:opacity-90 transition"
          >
            {t('sj.rate.saveRating')}
          </button>
          {existingScore != null && (
            <button
              onClick={async () => {
                await onSave(null);
                onClose();
              }}
              className="mt-2 py-1 text-[13px] text-muted hover:text-ink transition"
            >
              {t('sj.rate.removeRating')}
            </button>
          )}
        </div>
      ) : (
        <PostRatingOptions
          release={release}
          continueLabel={t('sj.common.done')}
          onBack={() => setPhase('rating')}
          onContinue={(text) => saveReviewAndClose(text)}
        />
      )}
    </Modal>
  );
}
