// Shared rules for when a search query is worth sending (2026-09-29/30).
// Same as iOS SearchViewModel.isSearchable / normalizedLength.

const CJK = /[가-힣ᄀ-ᇿ㄰-㆏぀-ヿ一-鿿㐀-䶿]/;

/** 2+ characters, or just 1 for Korean / Japanese / Chinese, where a single
 * syllable or character is a whole word ("독", "밤", "夜"). The database's
 * short-query path (migration 20260929000001) makes these fast. */
export function isSearchable(raw: string): boolean {
  const q = raw.trim().normalize('NFC');
  if ([...q].length >= 2) return true;
  return CJK.test(q);
}

/** Letters and digits only -- close enough to SQL normalize_text() to pick the
 * same short-query (< 3) path the server uses. */
export function normalizedLength(raw: string): number {
  return [...raw.normalize('NFC')].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
}
