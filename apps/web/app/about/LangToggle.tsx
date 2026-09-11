'use client';

import { useLanguage } from '../../lib/i18n';

/** Small EN/KO switch, local to the /about explorations — reuses the app's
 *  real language state (useLanguage) rather than a page-local toggle. */
export default function LangToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLanguage();
  return (
    <div className={`inline-flex items-center rounded-full border border-divider p-0.5 text-[12px] font-semibold ${className}`}>
      {(['en', 'ko'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1 rounded-full transition ${
            lang === l ? 'bg-ink text-page' : 'text-muted hover:text-ink'
          }`}
        >
          {l === 'en' ? 'EN' : 'KO'}
        </button>
      ))}
    </div>
  );
}
