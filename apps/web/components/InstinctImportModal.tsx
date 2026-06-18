'use client';

import { useLanguage } from '../lib/i18n';

/**
 * Shown when a user switches Manual → Instinct and has existing star ratings.
 * Lets them carry those ratings over as Elo seeds ("Use my ratings") or begin
 * with a clean slate ("Start fresh"). Cancel leaves them in Manual mode.
 * Logic lives in the settings page; this is presentational.
 */
export default function InstinctImportModal({
  count,
  busy,
  error,
  onUse,
  onFresh,
  onCancel,
}: {
  count: number;
  busy: boolean;
  error: string | null;
  onUse: () => void;
  onFresh: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!busy) onCancel(); }}
    >
      <div className="rounded-2xl bg-page p-6 shadow-xl w-[400px] mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[15px] font-bold text-ink">{t('settings.preferences.importTitle')}</h2>
        <p className="mt-2 text-[13px] text-muted leading-relaxed">
          {t('settings.preferences.importDesc').replace('{count}', String(count))}
        </p>

        {error && <p className="mt-3 text-[12px] text-red-500">{error}</p>}

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            onClick={onUse}
            disabled={busy}
            className="w-full rounded-xl bg-ink text-white dark:bg-[#F0F0EE] dark:text-[#111111] px-4 py-2.5 text-[13px] font-bold hover:opacity-80 transition disabled:opacity-50"
          >
            {busy ? t('settings.preferences.importBusy') : t('settings.preferences.importUse')}
          </button>
          <button
            onClick={onFresh}
            disabled={busy}
            className="w-full rounded-xl border border-divider px-4 py-2.5 text-[13px] font-semibold text-ink hover:bg-surface transition disabled:opacity-50"
          >
            {t('settings.preferences.importFresh')}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="w-full px-4 py-2 text-[12px] font-semibold text-muted hover:text-ink transition disabled:opacity-50"
          >
            {t('settings.account.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
