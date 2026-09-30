import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { placeAlbum } from '../taste/worlds';
import {
  artistLanguage,
  chooseWorld,
  familiesOf,
  familyDistribution,
  itunesTag,
  resolveEvidenceTag,
  type ArtistEvidence,
} from './placement';
import { toArtistEvidence } from './artistEvidence';

// Hand-labelled golden sets (GENRE_AUDIT.md §8): every rated album (labelled per
// album) + a held-out set of 152 albums by 39 Korean artists. `expect[0]` is the
// best world, the rest are defensible alternates. Artist evidence is a snapshot.
interface GoldenAlbum {
  set: 'rated' | 'korean-holdout';
  artist: string;
  title: string;
  expect: string[];
  album: Parameters<typeof placeAlbum>[0];
  artistEvidence: Record<keyof ArtistEvidence, [string, number?][]>;
}
const golden: GoldenAlbum[] = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/placement-golden.json'), 'utf8'),
).albums;

const toEvidence = (e: GoldenAlbum['artistEvidence']): ArtistEvidence =>
  Object.fromEntries(
    Object.entries(e).map(([k, tags]) => [k, tags.map(([tag, weight]) => ({ tag, weight }))]),
  );
const worldOf = (a: GoldenAlbum) => placeAlbum({ ...a.album, artist: toEvidence(a.artistEvidence) }).world;

function accuracy(set: GoldenAlbum['set']) {
  const albums = golden.filter((a) => a.set === set);
  let best = 0;
  let acceptable = 0;
  for (const a of albums) {
    const w = worldOf(a);
    if (w === a.expect[0]) best++;
    if (w && a.expect.includes(w)) acceptable++;
  }
  return { best: best / albums.length, acceptable: acceptable / albums.length };
}

describe('golden sets — accuracy floors (raise them when placement improves)', () => {
  it('rated albums', () => {
    const { best, acceptable } = accuracy('rated');
    expect(best).toBeGreaterThanOrEqual(0.91);
    expect(acceptable).toBeGreaterThanOrEqual(0.98);
  });
  it('Korean holdout', () => {
    const { best, acceptable } = accuracy('korean-holdout');
    expect(best).toBeGreaterThanOrEqual(0.89);
    expect(acceptable).toBeGreaterThanOrEqual(0.99);
  });
});

describe('golden sets — the cases that motivated the rebuild', () => {
  const cases: [string, string, string][] = [
    ['Ye', '808s & Heartbreak', 'hip-hop'],
    ['Ye', 'My Beautiful Dark Twisted Fantasy', 'hip-hop'],
    ['Ye', 'The Life of Pablo', 'hip-hop'],
    ['Ye', 'The College Dropout', 'hip-hop'],
    ['Radiohead', 'OK Computer', 'rock'],
    ['The Smashing Pumpkins', 'Siamese Dream', 'rock'],
    ['기리보이', '졸업식', 'k-rap'],
    ['기리보이', '치명적인 앨범 Ⅲ', 'k-rap'],
    ['YANGHONGWON', 'SLOWMO', 'k-rap'],
    ['YANGHONGWON', '3 STEPS FORWARD, 2 STEPS BACK', 'k-rap'],
    ['Beenzino', 'NOWITZKI', 'k-rap'],
    ['혁오', 'AAA', 'rock@ko'],
    ['Crush', 'wonderego', 'k-r-and-b'],
    ['BTS', 'MAP OF THE SOUL : 7', 'k-pop'],
    // Fixed by trot, iTunes, the artist-language fallback and the shared-name filter.
    ['박상철', '빵빵', 'k-pop'],
    ['Dominique A', 'Spirales', 'rock@fr'],
    ['10cm', '1.0', 'korean-folk'],
    ['Loco', 'Locomotive', 'k-rap'],
    ['TAEYEON', 'VOICE', 'j-pop'],
  ];
  it.each(cases)('%s — %s → %s', (artist, title, world) => {
    const a = golden.find((g) => g.artist === artist && g.title === title);
    expect(a, `${artist} — ${title} missing from the fixture`).toBeDefined();
    expect(worldOf(a!)).toBe(world);
  });
});

describe('familyDistribution', () => {
  it('splits a hybrid across its parents', () => {
    expect(familiesOf('pop-rap').sort()).toEqual(['hip-hop', 'pop']);
    const d = familyDistribution([{ tag: 'pop rap' }]);
    expect(d.get('hip-hop')).toBeCloseTo(0.5);
    expect(d.get('pop')).toBeCloseTo(0.5);
  });
  it('ignores descriptors and discounts catch-alls', () => {
    expect(familyDistribution([{ tag: 'instrumental' }]).size).toBe(0);
    // k-pop alone is weak evidence: 0.3 of the source's mass, not 1.
    expect(familyDistribution([{ tag: 'k-pop' }]).get('pop')).toBeCloseTo(0.3);
  });
  it('weights by votes relative to the top tag', () => {
    const d = familyDistribution([
      { tag: 'hip hop', weight: 10 },
      { tag: 'rock', weight: 5 },
    ]);
    expect(d.get('hip-hop')).toBeCloseTo(10 / 15);
    expect(d.get('rock')).toBeCloseTo(5 / 15);
  });
  it('reads outside-source spellings', () => {
    expect(resolveEvidenceTag('Funk / Soul')).toBe('rnb-soul');
    expect(resolveEvidenceTag('hip hop music')).toBe('hip-hop');
    expect(resolveEvidenceTag('Korean hip-hop')).toBe('k-rap');
    expect(resolveEvidenceTag('seen live')).toBeNull();
  });
});

describe('outside sources', () => {
  it('maps iTunes store genres, dropping the catch-all "Alternative"', () => {
    expect(itunesTag('Hip-Hop/Rap')).toBe('hip hop');
    expect(itunesTag('R&B/Soul')).toBe('r&b');
    expect(itunesTag('Korean Hip-Hop')).toBe('korean hip hop');
    expect(itunesTag('Variété Française')).toBe('chanson');
    expect(itunesTag('Alternative')).toBeNull();
    expect(itunesTag('Soundtrack')).toBeNull();
    expect(itunesTag('K-Pop')).toBe('k-pop');
  });
  it('keeps an album\'s own iTunes genre out of its artist-level counts', () => {
    const { artist, itunesGenre } = toArtistEvidence(
      { itunes: { id: 1, genres: [['Hip-Hop/Rap', 3], ['Electronic']], albums: { a1: 'Electronic' } } },
      [],
      'a1',
    );
    expect(itunesGenre).toBe('Electronic');
    expect(artist.itunes).toEqual([{ tag: 'Hip-Hop/Rap', weight: 3 }]);
  });
  it('drops Last.fm tags from a page shared by same-named artists', () => {
    const { artist } = toArtistEvidence({ lastfm: [['thrash metal', 100]], lastfm_shared_name: true });
    expect(artist.lastfm).toBeUndefined();
  });
});

describe('artist-level language fallback', () => {
  it('needs enough releases and a clear majority', () => {
    expect(artistLanguage({ total: 39, counts: { fr: 37 } })).toBe('fr');
    expect(artistLanguage({ total: 72, counts: { fr: 46, en: 20 } })).toBeNull(); // bilingual: 64% < 70%
    expect(artistLanguage({ total: 2, counts: { fr: 2 } })).toBeNull();
  });
  it('applies only when the album shows no language of its own', () => {
    const rl = { total: 10, counts: { fr: 9 } };
    expect(chooseWorld({ genres: ['rock'], artistCountry: 'FR', artistReleaseLanguages: rl }).lang).toBe('fr');
    expect(chooseWorld({ genres: ['rock'], artistCountry: 'GB', artistReleaseLanguages: rl }).lang).toBe('en');
  });
});

describe('chooseWorld', () => {
  it('lets the most-supported family win, not the most specific tag', () => {
    // alternative r&b is one co-tag among hip-hop, pop and electronic ones.
    const w = chooseWorld({
      genres: ['hip hop', 'alternative r&b', 'pop rap', 'trap', 'cloud rap'],
      artistCountry: 'CA',
    });
    expect(w.family).toBe('hip-hop');
  });
  it('never lets a descriptor pick the world', () => {
    expect(chooseWorld({ genres: ['hip hop', 'instrumental'], artistCountry: 'KR' }).family).toBe('hip-hop');
  });
  it('knows trot as Korean pop', () => {
    const w = chooseWorld({ genres: ['trot'], artistCountry: 'KR' });
    expect(w.family).toBe('pop');
    expect(w.lang).toBe('ko');
  });
  it('counts the album\'s iTunes genre at half weight', () => {
    // 10cm — 1.0: generic pop/rock tags vs the store filing it as Folk.
    const w = chooseWorld({ genres: ['pop', 'rock'], artistCountry: 'KR', itunesGenre: 'Folk' });
    expect(w.family).toBe('pop'); // half weight doesn't override two tags on its own…
    const w2 = chooseWorld({
      genres: ['pop', 'rock'],
      artistCountry: 'KR',
      itunesGenre: 'Folk',
      artist: { itunes: [{ tag: 'Folk', weight: 6 }], lastfm: [{ tag: 'acoustic', weight: 100 }, { tag: 'folk', weight: 60 }] },
    });
    expect(w2.family).toBe('folk'); // …but it tips a tie the artist agrees with
  });
  it('falls back to a descriptor when it is all there is', () => {
    expect(chooseWorld({ genres: ['christmas music'] }).family).toBe('pop');
  });
  it('places an untagged album by its artist', () => {
    const w = chooseWorld({
      genres: [],
      artistCountry: 'KR',
      artist: { musicbrainz: [{ tag: 'hip hop', weight: 3 }], lastfm: [{ tag: 'korean hip hop', weight: 100 }] },
    });
    expect(w.family).toBe('hip-hop');
    expect(w.lang).toBe('ko');
  });
  it('lets the artist outvote a k-pop-only album', () => {
    const w = chooseWorld({
      genres: ['k-pop'],
      artistCountry: 'KR',
      artist: { wikidata: [{ tag: 'hip-hop' }], lastfm: [{ tag: 'k-pop', weight: 100 }, { tag: 'hip-hop', weight: 60 }] },
    });
    expect(w.family).toBe('hip-hop');
  });
  it('reads the language from a Hangul artist name', () => {
    expect(chooseWorld({ genres: ['hip hop'], title: 'avante', artistName: '기리보이' }).lang).toBe('ko');
  });
  it('never takes the language from artist tags when the country is known', () => {
    // Wikidata lists "samba" among Michael Jackson's genres.
    const w = chooseWorld({ genres: ['pop'], artistCountry: 'US', artist: { wikidata: [{ tag: 'samba' }] } });
    expect(w.lang).toBe('en');
  });
});
