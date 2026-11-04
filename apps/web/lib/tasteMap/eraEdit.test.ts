import { describe, expect, it } from 'vitest';
import { autoSplits, eraView, parseEraPut, validateSplits } from './eraEdit';
import { splitEras } from './eras';
import { buildFeatureSpace } from './features';
import { artistByName, COLDPLAY_MYLO_XYLOTO, COLDPLAY_SAFETY_EP, readFixture } from './phase4Fixtures';

const zero = readFixture('map-input-zero-eras.json');
const coldplay = artistByName(zero, 'Coldplay');
const oasis = artistByName(zero, 'Oasis');

describe('era override: Coldplay split before Mylo Xyloto', () => {
  it('the fixture has Mylo Xyloto (2011) rated', () => {
    const mylo = coldplay.albums.find((a) => a.id === COLDPLAY_MYLO_XYLOTO)!;
    expect(mylo.title).toBe('Mylo Xyloto');
    expect(mylo.year).toBe(2011);
    expect(mylo.rated).toBe(true);
  });

  it('yields exactly 2 Coldplay era nodes in the feature space', () => {
    const checked = validateSplits(coldplay, [COLDPLAY_MYLO_XYLOTO]);
    expect(checked).toEqual({ ok: true, value: [COLDPLAY_MYLO_XYLOTO] });
    const space = buildFeatureSpace(zero, [{ artistId: coldplay.id, splitAlbumIds: [COLDPLAY_MYLO_XYLOTO] }]);
    const nodes = space.nodes.filter((n) => n.artistId === coldplay.id);
    expect(nodes.map((n) => n.key)).toEqual([`e:${coldplay.id}:${COLDPLAY_SAFETY_EP}`, `e:${coldplay.id}:${COLDPLAY_MYLO_XYLOTO}`]);
    // Split BEFORE Mylo Xyloto: 2000s records in the first era, Mylo Xyloto opens the second.
    const [early, late] = nodes;
    expect(late.albumIds[0]).toBe(COLDPLAY_MYLO_XYLOTO);
    expect(late.ratedAlbumIds).toEqual([COLDPLAY_MYLO_XYLOTO]);
    expect(early.ratedAlbumIds.length).toBe(3); // Parachutes, A Rush of Blood, X&Y
    expect(early.albumIds).not.toContain(COLDPLAY_MYLO_XYLOTO);
    // Without the override it's one node (the detector finds no split on this data).
    expect(buildFeatureSpace(zero).nodes.filter((n) => n.artistId === coldplay.id)).toHaveLength(1);
  });

  it('an empty override merges back into one node', () => {
    const segs = splitEras(coldplay, { artistId: coldplay.id, splitAlbumIds: [] });
    expect(segs).toHaveLength(1);
    expect(segs[0].key).toBe(`a:${coldplay.id}`);
  });
});

describe('eraView', () => {
  it('lists the whole discography chronologically with counts flags and auto splits', () => {
    const v = eraView(coldplay, null);
    expect(v.artistId).toBe(coldplay.id);
    expect(v.albums).toHaveLength(coldplay.albums.length);
    expect(v.albums[0].id).toBe(COLDPLAY_SAFETY_EP);
    expect(v.albums.filter((a) => a.rated)).toHaveLength(4);
    expect(v.override).toBeNull();
    expect(v.auto).toEqual([]); // known data gap (eras.test.ts)
    expect(eraView(coldplay, [COLDPLAY_MYLO_XYLOTO]).override).toEqual([COLDPLAY_MYLO_XYLOTO]);
  });

  it('auto = each detected era’s first album except the first, and round-trips as an override', () => {
    const y = (id: string, year: number) => ({
      id,
      title: id,
      artistId: 'X',
      year,
      genres: year < 2010 ? ['shoegaze', 'dream pop'] : ['k-pop', 'dance-pop'],
      titleLanguage: null,
      coverUrl: null,
      embedding: null,
      score: 4,
      rated: true,
    });
    const artist = { id: 'X', name: 'X', nameNative: null, country: null, genreEvidence: null, similar: [], albums: [y('a', 2001), y('b', 2003), y('c', 2005), y('d', 2012), y('e', 2014), y('f', 2016)] };
    const auto = autoSplits(artist);
    expect(auto).toEqual(['d']);
    expect(splitEras(artist, { artistId: 'X', splitAlbumIds: auto })).toEqual(splitEras(artist));
  });
});

describe('parseEraPut / validateSplits', () => {
  it('parses null, [] and id lists', () => {
    expect(parseEraPut({ splitAlbumIds: null })).toEqual({ ok: true, value: null });
    expect(parseEraPut({ splitAlbumIds: [] })).toEqual({ ok: true, value: [] });
    expect(parseEraPut({}).ok).toBe(false);
    expect(parseEraPut({ splitAlbumIds: ['nope'] }).ok).toBe(false);
    expect(parseEraPut({ splitAlbumIds: Array.from({ length: 51 }, () => COLDPLAY_MYLO_XYLOTO) }).ok).toBe(false);
  });

  it('rejects another artist’s album, the first album and non-counting albums', () => {
    expect(validateSplits(coldplay, [oasis.albums[0].id]).ok).toBe(false);
    expect(validateSplits(coldplay, [COLDPLAY_SAFETY_EP]).ok).toBe(false);
    const compilation = { ...coldplay, albums: [...coldplay.albums, { ...coldplay.albums[5], id: '99999999-9999-4999-8999-999999999999', type: 'compilation', rated: false }] };
    expect(validateSplits(compilation, ['99999999-9999-4999-8999-999999999999']).ok).toBe(false);
    // …unless the user rated it.
    const ratedComp = { ...compilation, albums: compilation.albums.map((a) => (a.type === 'compilation' ? { ...a, rated: true } : a)) };
    expect(validateSplits(ratedComp, ['99999999-9999-4999-8999-999999999999']).ok).toBe(true);
  });

  it('dedupes and orders chronologically', () => {
    const ghost = '036fbbe9-3bdc-4b79-be91-321cf492cfec'; // Ghost Stories, 2014
    expect(validateSplits(coldplay, [ghost, COLDPLAY_MYLO_XYLOTO, ghost])).toEqual({ ok: true, value: [COLDPLAY_MYLO_XYLOTO, ghost] });
  });
});
