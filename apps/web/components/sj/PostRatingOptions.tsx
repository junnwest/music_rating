'use client';

import { useState } from 'react';
import { MessageSquare, PlusSquare, ChevronUp, ChevronDown, ChevronRight } from 'lucide-react';
import MixPickerModal from './MixPickerModal';
import Cover from './Cover';
import { useLanguage } from '../../lib/i18n';
import { releaseDisplayArtist, releaseDisplayTitle, type SJRelease } from '../../lib/sj/data';
import { typeLabelKey } from '../../lib/sj/display';

/**
 * Post-rating step shared by Manual and Instinct flows — mirrors iOS
 * PostRatingOptionsView: inline comment + "Add to a list", then Continue.
 */
export default function PostRatingOptions({
  release,
  continueLabel,
  onBack,
  onContinue,
}: {
  release: SJRelease;
  continueLabel?: string;
  onBack?: () => void;
  onContinue: (reviewText: string | null) => void;
}) {
  const { t } = useLanguage();
  const [addingComment, setAddingComment] = useState(false);
  const [comment, setComment] = useState('');
  const [showMixPicker, setShowMixPicker] = useState(false);

  return (
    <div className="flex flex-col">
      {/* Album header */}
      <div className="flex items-center gap-3 px-5 pt-4">
        <Cover url={release.coverUrl} className="w-11 h-11" rounded="rounded-lg" />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-ink truncate">
            {releaseDisplayTitle(release)}
          </p>
          <p className="flex items-center gap-1.5 text-[12px] text-muted truncate">
            <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[10px] font-medium">
              {t(typeLabelKey(release.releaseType))}
            </span>
            {releaseDisplayArtist(release)}
          </p>
        </div>
      </div>

      <div className="h-px bg-divider my-3" />

      {/* Comment row */}
      <button
        onClick={() => setAddingComment((v) => !v)}
        className="flex items-center gap-3.5 px-5 py-3 text-left hover:bg-surface transition"
      >
        <MessageSquare size={17} className="text-ink shrink-0" />
        <span className="flex-1 text-[14.5px] text-ink">{t('sj.rate.addComment')}</span>
        {addingComment ? (
          <ChevronUp size={15} className="text-muted" />
        ) : (
          <ChevronDown size={15} className="text-muted" />
        )}
      </button>
      {addingComment && (
        <div className="px-5 pb-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('sj.rate.commentPlaceholder')}
            rows={3}
            className="w-full px-3.5 py-2.5 rounded-[10px] bg-surface border border-divider text-[14px] text-ink placeholder-placeholder outline-none focus:border-accent/60 resize-none transition"
          />
        </div>
      )}

      <div className="h-px bg-divider mx-5" />

      {/* Add to list row */}
      <button
        onClick={() => setShowMixPicker(true)}
        className="flex items-center gap-3.5 px-5 py-3 text-left hover:bg-surface transition"
      >
        <PlusSquare size={17} className="text-ink shrink-0" />
        <span className="flex-1 text-[14.5px] text-ink">{t('sj.rate.addToList')}</span>
        <ChevronRight size={15} className="text-muted" />
      </button>

      <div className="h-px bg-divider mx-5" />

      {/* Bottom buttons */}
      <div className="px-5 pt-4 pb-5 flex flex-col gap-2">
        <button
          onClick={() => {
            const text = comment.trim();
            onContinue(text === '' ? null : text);
          }}
          className="w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold hover:opacity-90 transition"
        >
          {continueLabel ?? t('sj.rate.continue')}
        </button>
        {onBack && (
          <button
            onClick={onBack}
            className="py-1 text-[13px] text-muted hover:text-ink transition"
          >
            ← {t('sj.common.back')}
          </button>
        )}
      </div>

      <MixPickerModal
        open={showMixPicker}
        onClose={() => setShowMixPicker(false)}
        releaseGroupId={release.id}
      />
    </div>
  );
}
