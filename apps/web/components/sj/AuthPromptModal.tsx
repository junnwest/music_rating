'use client';

import Link from 'next/link';
import { Heart } from 'lucide-react';
import Modal from './Modal';
import { useLanguage } from '../../lib/i18n';

/** Nudges a signed-out visitor to sign in/up -- triggered wherever a write action (like,
 * comment) would otherwise silently no-op for a signed-out user. See SessionContext's
 * requireAuth(). */
export default function AuthPromptModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-sm" showClose={false}>
      <div className="px-6 pb-6 pt-2 flex flex-col items-center text-center gap-3">
        <span className="flex w-12 h-12 rounded-full bg-accent-soft text-accent-deep items-center justify-center">
          <Heart size={22} className="fill-current" />
        </span>
        <h2 className="text-[16px] font-bold text-ink">{t('sj.auth.promptTitle')}</h2>
        <p className="text-[13.5px] text-muted">{t('sj.auth.promptBody')}</p>
        <Link
          href="/login"
          onClick={onClose}
          className="mt-1 w-full py-2.5 rounded-xl bg-ink text-page text-[14px] font-semibold text-center hover:opacity-90 transition"
        >
          {t('sj.auth.promptCta')}
        </Link>
        <button
          onClick={onClose}
          className="text-[13px] text-muted hover:text-ink transition"
        >
          {t('sj.common.cancel')}
        </button>
      </div>
    </Modal>
  );
}
