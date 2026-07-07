'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import Modal from './Modal';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';

/**
 * Report a post — mirrors iOS ReportSheet. Reason values match the shared
 * moderation categories (also used by /admin/reports).
 */
export default function ReportModal({
  open,
  onClose,
  reportedUserId,
  ratingId,
}: {
  open: boolean;
  onClose: () => void;
  reportedUserId: string;
  ratingId: string;
}) {
  const { t } = useLanguage();
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasons: { label: string; value: string }[] = [
    { label: t('sj.report.spam'), value: 'Spam' },
    { label: t('sj.report.inappropriate'), value: 'Inappropriate Content' },
    { label: t('sj.report.harassment'), value: 'Harassment' },
    { label: t('sj.report.other'), value: 'Other' },
  ];

  async function submit(reason: string) {
    if (!supabase || submitting) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return;
    setSubmitting(true);
    setError(null);
    const { error: insertError } = await supabase.from('reports').insert({
      reporter_id: uid,
      reported_user_id: reportedUserId,
      rating_id: ratingId,
      reason,
    });
    if (insertError) setError(insertError.message);
    else setSubmitted(true);
    setSubmitting(false);
  }

  function close() {
    setSubmitted(false);
    setError(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title={t('sj.report.title')}>
      {submitted ? (
        <div className="py-12 flex flex-col items-center gap-3 px-6 text-center">
          <CheckCircle2 size={40} className="text-accent" />
          <p className="text-[15px] font-semibold text-ink">{t('sj.report.submitted')}</p>
          <p className="text-[13px] text-muted">{t('sj.report.thanks')}</p>
          <button
            onClick={close}
            className="mt-2 text-[14px] font-semibold text-accent hover:opacity-80"
          >
            {t('sj.common.done')}
          </button>
        </div>
      ) : (
        <div>
          {error && (
            <p className="px-5 pt-3 text-[12.5px] text-red-500">{error}</p>
          )}
          <p className="px-5 py-3 text-[13px] text-muted">{t('sj.report.why')}</p>
          <ul className="divide-y divide-divider border-t border-divider">
            {reasons.map(({ label, value }) => (
              <li key={value}>
                <button
                  onClick={() => submit(value)}
                  disabled={submitting}
                  className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-surface transition disabled:opacity-50"
                >
                  <span className="text-[14.5px] text-ink">{label}</span>
                  <ChevronRight size={14} className="text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
