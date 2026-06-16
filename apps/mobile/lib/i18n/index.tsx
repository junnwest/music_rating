import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import en from './en';
import ko from './ko';
import type { Translations } from './en';

export type Lang = 'en' | 'ko';

const STORAGE_KEY = 'sj-lang';

const dicts: Record<Lang, Translations> = { en, ko };

function lookup(dict: Translations, key: string): string {
  return key.split('.').reduce((obj: any, k) => obj?.[k], dict) ?? key;
}

/** Read the phone's preferred language. Defaults to English for non-Korean devices. */
export function deviceLang(): Lang {
  const code = getLocales()[0]?.languageCode;
  return code === 'ko' ? 'ko' : 'en';
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
  // Start from the device language so the first paint is already localized.
  const [lang, setLangState] = useState<Lang>(deviceLang());

  useEffect(() => {
    // A saved manual override (from settings) wins over the device language.
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'en' || stored === 'ko') setLangState(stored);
    });
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    AsyncStorage.setItem(STORAGE_KEY, l);
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
