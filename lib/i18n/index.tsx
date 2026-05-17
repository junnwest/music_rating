'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import en from './en';
import ko from './ko';
import type { Translations } from './en';

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
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (stored === 'en' || stored === 'ko') {
      setLangState(stored);
      document.cookie = `sj-lang=${stored}; path=/; max-age=31536000; SameSite=Lax`;
    }
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    document.cookie = `sj-lang=${l}; path=/; max-age=31536000; SameSite=Lax`;
  }

  const t = (key: string) => lookup(dicts[lang], key);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
