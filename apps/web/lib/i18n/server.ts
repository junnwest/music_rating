import { cookies, headers } from 'next/headers';
import en from './en';
import ko from './ko';

export function getServerT() {
  let lang = 'en';
  try {
    const stored = cookies().get('sj-lang')?.value;
    if (stored === 'en' || stored === 'ko') {
      lang = stored;
    } else {
      // No stored preference — infer from Accept-Language header.
      const acceptLang = headers().get('accept-language') ?? '';
      const primary = acceptLang.split(',')[0]?.split(';')[0]?.trim() ?? '';
      if (primary.startsWith('ko')) lang = 'ko';
    }
  } catch {}
  const dict: Record<string, any> = lang === 'ko' ? ko : en;
  return function t(key: string): string {
    return key.split('.').reduce((obj: any, k) => obj?.[k], dict) ?? key;
  };
}
