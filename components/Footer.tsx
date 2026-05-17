'use client';

import Link from 'next/link';
import { useLanguage } from '../lib/i18n';

export default function Footer({ className }: { className?: string }) {
  const { t } = useLanguage();
  const year = new Date().getFullYear();

  return (
    <footer className={`border-t border-divider bg-page mt-auto${className ? ` ${className}` : ''}`}>
      <div className="max-w-[1440px] mx-auto px-5 py-10">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-8">

          {/* Brand */}
          <div className="flex-shrink-0">
            <img src="/logo-flower.svg" alt="sillajuku" className="h-[56px] w-auto mb-3" />
            <p className="text-[12px] text-muted">{t('footer.tagline')}</p>
            <p className="text-[11px] text-placeholder mt-3">
              {t('footer.poweredBy')}{' '}
              <a
                href="https://spotify.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-muted transition"
              >
                Spotify
              </a>
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-wrap gap-x-12 gap-y-6">
            <div>
              <p className="text-[11px] font-semibold text-ink uppercase tracking-wide mb-3">{t('footer.navigate')}</p>
              <div className="flex flex-col gap-2">
                <Link href="/" className="text-[13px] text-muted hover:text-ink transition">{t('footer.home')}</Link>
                <Link href="/activity" className="text-[13px] text-muted hover:text-ink transition">{t('footer.activity')}</Link>
                <Link href="/explore" className="text-[13px] text-muted hover:text-ink transition">{t('footer.explore')}</Link>
                <Link href="/help" className="text-[13px] text-muted hover:text-ink transition">{t('footer.helpFeedback')}</Link>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold text-ink uppercase tracking-wide mb-3">{t('footer.legal')}</p>
              <div className="flex flex-col gap-2">
                <Link href="/privacy" className="text-[13px] text-muted hover:text-ink transition">{t('footer.privacy')}</Link>
                <Link href="/terms" className="text-[13px] text-muted hover:text-ink transition">{t('footer.terms')}</Link>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-divider mt-8 pt-6">
          <p className="text-[11px] text-placeholder">© {year} sillajuku. {t('footer.copyright')}</p>
        </div>
      </div>
    </footer>
  );
}
