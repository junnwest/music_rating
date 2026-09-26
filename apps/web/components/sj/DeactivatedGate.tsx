'use client';

import { useState } from 'react';
import { Moon } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useLanguage } from '../../lib/i18n';

/** Replaces the app when a deactivated account is signed in (migration
 *  20260926000002). Nothing comes back until the user picks Reactivate —
 *  web sibling of iOS DeactivatedAccountView. */
export default function DeactivatedGate({
  onReactivated,
  onSignOut,
}: {
  onReactivated: () => Promise<void>;
  onSignOut: () => Promise<void>;
}) {
  const { t } = useLanguage();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reactivate() {
    if (!supabase) return;
    setWorking(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('reactivate_my_account');
    if (rpcError) {
      setError(t('sj.settings.reactivateFailed'));
      setWorking(false);
      return;
    }
    await onReactivated();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-page">
      <div className="w-full max-w-sm flex flex-col items-center text-center gap-3">
        <span className="flex w-12 h-12 rounded-full bg-accent-soft text-accent-deep items-center justify-center">
          <Moon size={22} />
        </span>
        <h1 className="text-[20px] font-bold text-ink">{t('sj.settings.deactivatedTitle')}</h1>
        <p className="text-[14px] text-muted">{t('sj.settings.deactivatedBody')}</p>
        {error && <p className="text-[12.5px] text-red-500">{error}</p>}
        <button
          onClick={reactivate}
          disabled={working}
          className="mt-3 w-full py-3 rounded-xl bg-accent text-white text-[15px] font-semibold hover:opacity-90 disabled:opacity-50 transition"
        >
          {working ? '…' : t('sj.settings.reactivate')}
        </button>
        <button
          onClick={onSignOut}
          disabled={working}
          className="w-full py-2.5 text-[14px] font-medium text-muted hover:text-ink transition"
        >
          {t('sj.settings.signOut')}
        </button>
      </div>
    </div>
  );
}
