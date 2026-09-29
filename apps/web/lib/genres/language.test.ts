import { describe, expect, it } from 'vitest';
import {
  albumGenreLabels,
  albumLanguage,
  homeFamily,
  isLanguageNeutral,
  primaryOfAlbum,
  qualifiedInfo,
  qualify,
  qualifyAlbum,
  scriptLanguage,
} from './language';

describe('qualify — genre × language', () => {
  it('maps a base genre to its authored localized node', () => {
    expect(qualify('rock', 'ja')).toBe('j-rock');
    expect(qualify('hip-hop', 'ko')).toBe('k-rap');
    expect(qualify('pop', 'ko')).toBe('k-pop');
    expect(qualify('pop', 'es')).toBe('latin-pop');
    expect(qualify('indie-rock', 'ko')).toBe('korean-indie');
  });

  it('synthesizes a qualified id when no localized node exists', () => {
    expect(qualify('rock', 'ko')).toBe('rock@ko');
    expect(qualify('alternative-rock', 'ja')).toBe('alternative-rock@ja');
    expect(qualify('hip-hop', 'ja')).toBe('hip-hop@ja');
  });

  it('leaves English, unknown language and non-sensitive genres as is', () => {
    expect(qualify('rock', 'en')).toBe('rock');
    expect(qualify('rock', null)).toBe('rock');
    expect(qualify('jazz', 'ja')).toBe('jazz');
    expect(qualify('house', 'ko')).toBe('house');
    expect(qualify('salsa', 'es')).toBe('salsa');
    expect(qualify('k-pop', 'ja')).toBe('k-pop'); // already language-bound
  });

  it('knows which nodes can take a language', () => {
    expect(isLanguageNeutral('shoegaze')).toBe(true);
    expect(isLanguageNeutral('j-rock')).toBe(false);
    expect(isLanguageNeutral('chanson')).toBe(false);
    expect(isLanguageNeutral('techno')).toBe(false);
    expect(homeFamily('synth-pop')).toBe('pop');
    expect(homeFamily('trip-hop')).toBe('electronic');
  });
});

describe('qualifiedInfo — display and world family', () => {
  it('puts the language name in front', () => {
    expect(qualifiedInfo('rock@ko')?.display.en).toBe('Korean Rock');
    expect(qualifiedInfo('hip-hop@ja')?.display.en).toBe('Japanese Hip-Hop');
    expect(qualifiedInfo('alternative-rock@ja')?.shortDisplay.en).toBe('Alternative Rock');
    expect(qualifiedInfo('rock@sv')?.display.en).toBe('Swedish Rock');
    expect(qualifiedInfo('alternative-rock@ja')?.display.en).toBe('Japanese Alternative Rock');
    expect(qualifiedInfo('rock@es')?.display.en).toBe('Spanish Rock');
    expect(qualifiedInfo('rock@ko')?.display.ko).toBe('한국 록');
  });

  it('puts every genre under its language form of the family', () => {
    expect(qualifiedInfo('alternative-rock@ja')?.family).toBe('j-rock');
    expect(qualifiedInfo('trap@ko')?.family).toBe('k-rap');
    expect(qualifiedInfo('korean-indie')?.family).toBe('rock@ko');
    expect(qualifiedInfo('city-pop')?.family).toBe('j-pop');
    expect(qualifiedInfo('chanson')?.family).toBe('pop@fr');
    expect(qualifiedInfo('alternative-rock')?.family).toBe('rock');
    expect(qualifiedInfo('bossa-nova')?.family).toBe('latin');
  });
});

describe('albumLanguage — evidence ladder', () => {
  it('trusts a language-bound tag first', () => {
    expect(albumLanguage({ genres: ['j-rock', 'rock'], artistCountry: 'US' }).lang).toBe('ja');
  });

  it('lets the title script pick between conflicting tags (a K-pop act’s Japanese single)', () => {
    const r = albumLanguage({ genres: ['k-pop', 'j-pop'], title: 'えがおのまほう', artistCountry: 'KR' });
    expect(r).toEqual({ lang: 'ja', source: 'tag' });
  });

  it('reads the title script before the artist country', () => {
    expect(albumLanguage({ genres: ['pop'], title: 'Fancy', nativeTitle: '팬시', artistCountry: 'US' }).lang).toBe('ko');
    expect(albumLanguage({ genres: ['rock'], title: 'ロック', artistCountry: 'KR' }).lang).toBe('ja');
  });

  it('splits Han-only titles by country, never guessing Chinese for Japan', () => {
    expect(scriptLanguage('東京', 'JP')).toBe('ja');
    expect(scriptLanguage('北京', 'CN')).toBe('zh');
    expect(scriptLanguage('東京', null)).toBeNull();
  });

  it('uses a stored non-English tracklist language, never eng', () => {
    expect(albumLanguage({ genres: ['rock'], titleLanguage: 'deu', artistCountry: 'DE' })).toEqual({
      lang: 'de',
      source: 'title-language',
    });
    expect(albumLanguage({ genres: ['rock'], titleLanguage: 'swe' }).lang).toBe('sv');
    expect(albumLanguage({ genres: ['hip hop'], titleLanguage: 'eng', artistCountry: 'KR' }).lang).toBe('ko');
  });

  it('ignores the unreliable stored zh but accepts ko/ja name scripts', () => {
    expect(albumLanguage({ genres: ['rock'], artistNativeLanguage: 'zh' }).lang).toBeNull();
    expect(albumLanguage({ genres: ['rock'], artistNativeLanguage: 'ja' }).lang).toBe('ja');
  });

  it('falls back to countries whose acts sing in the local language', () => {
    expect(albumLanguage({ genres: ['hip hop'], title: 'HUNNIT', artistCountry: 'KR' }).lang).toBe('ko');
    expect(albumLanguage({ genres: ['rock'], artistCountry: 'GB' }).lang).toBe('en');
    expect(albumLanguage({ genres: ['rock'], artistCountry: 'SE' }).lang).toBeNull();
    expect(albumLanguage({ genres: ['rock'], artistCountry: 'XE' }).lang).toBeNull();
  });
});

describe('albumGenreLabels', () => {
  it('prefixes only the broadest genre', () => {
    expect(albumGenreLabels(['alternative rock', 'rock'], 'ja')).toEqual(['alternative rock', 'Japanese rock']);
    expect(albumGenreLabels(['shoegaze', 'dream pop'], 'ko', 'ko')).toEqual(['한국 shoegaze', 'dream pop']);
  });

  it('leaves English, unknown and already language-bound lists alone', () => {
    expect(albumGenreLabels(['rock'], 'en')).toEqual(['rock']);
    expect(albumGenreLabels(['rock'], null)).toEqual(['rock']);
    expect(albumGenreLabels(['k-pop', 'jazz'], 'ko')).toEqual(['k-pop', 'jazz']);
  });
});

describe('qualifyAlbum + primaryOfAlbum', () => {
  it('turns a Korean album tagged only hip hop into K-Hip-Hop', () => {
    expect(qualifyAlbum(['hip hop'], 'ko')).toEqual(['k-rap']);
    expect(primaryOfAlbum(['hip hop'], 'ko')).toBe('k-rap');
  });

  it('lets an explicit k-pop tag beat a qualified hip hop tag, whatever the order', () => {
    expect(qualifyAlbum(['hip hop', 'k-pop'], 'ko')).toEqual(['k-rap', 'k-pop']);
    expect(primaryOfAlbum(['hip hop', 'k-pop'], 'ko')).toBe('k-pop');
  });

  it('keeps the specific genre primary inside a qualified family', () => {
    expect(primaryOfAlbum(['alternative rock', 'rock'], 'ja')).toBe('alternative-rock@ja');
  });

  it('keeps an English rock album unmarked', () => {
    expect(qualifyAlbum(['indie rock', 'rock', 'shoegaze'], 'en')).toEqual(['indie-rock', 'rock', 'shoegaze']);
  });

  it('drops scene roots and unresolved tags', () => {
    expect(qualifyAlbum(['korean', 'rock', 'yodeling'], 'ko')).toEqual(['rock@ko']);
  });
});
