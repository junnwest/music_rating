'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import en from './en';
import ko from './ko';
import type { Translations } from './en';
import { setDisplayLanguage } from '../sj/display';

export type Lang = 'en' | 'ko';

const STORAGE_KEY = 'sj-lang';

const dicts: Record<Lang, Translations> = { en, ko };

function lookup(dict: Translations, key: string): string {
  return key.split('.').reduce((obj: any, k) => obj?.[k], dict) ?? key;
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  /** False until the provider has read the stored / browser language (first effect). */
  settled: boolean;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key) => key,
  settled: false,
});

function browserLang(): Lang {
  return navigator.language.startsWith('ko') ? 'ko' : 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [settled, setSettled] = useState(false);

  // Set during render, not in an effect, so children rendering in this same
  // pass (which call displayName) already see the right language — an effect
  // would lag one render behind on language switch.
  setDisplayLanguage(lang);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored === 'en' || stored === 'ko') {
      setLangState(stored);
      document.cookie = `sj-lang=${stored}; path=/; max-age=31536000; SameSite=Lax`;
    } else {
      // No explicit preference — follow the browser's language.
      // Don't write to localStorage so future browser-language changes are respected.
      const detected = browserLang();
      setLangState(detected);
      document.cookie = `sj-lang=${detected}; path=/; max-age=31536000; SameSite=Lax`;
    }
    setSettled(true);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    document.cookie = `sj-lang=${l}; path=/; max-age=31536000; SameSite=Lax`;
  }

  const t = (key: string) => lookup(dicts[lang], key);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, settled }}>
      {children}
    </LanguageContext.Provider>
  );
}

/**
 * Renders its subtree in the server's language guess (lib/i18n/server.ts:
 * the sj-lang cookie, else Accept-Language) until the provider above has
 * settled, then defers to it. Wraps the album and artist pages (2026-11-12) so
 * their server HTML is Korean for Korean visitors and crawlers instead of
 * always English (the provider can only start at 'en' on the server). The
 * first client render uses the same guess, so hydration matches.
 *
 * Only on routes that already render per request: reading cookies in the root
 * layout instead would make every cached page (home, charts, help) dynamic.
 */
export function ServerLanguage({ lang, children }: { lang: Lang; children: ReactNode }) {
  const parent = useContext(LanguageContext);
  const override = !parent.settled && parent.lang !== lang;
  // Same render-time call as the provider's, for displayName (Hangul vs Latin).
  if (override) setDisplayLanguage(lang);
  // Always the same Provider element (only its value changes): swapping it for a
  // fragment once settled would remount the whole page and drop its state.
  const value = override ? { ...parent, lang, t: (key: string) => lookup(dicts[lang], key) } : parent;
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
