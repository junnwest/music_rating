import { describe, expect, it } from 'vitest';
import {
  buildTasteMap,
  communityWorldTotals,
  placeAlbum,
  worldAffinity,
  worldStandings,
  MAX_ALBUM_TILES,
  MAX_WORLDS,
  OTHER_WORLD,
  type RatedAlbum,
} from './worlds';

function rated(
  id: string,
  score: number,
  genres: string[],
  country: string | null,
  extra: { title?: string; year?: number } = {},
): RatedAlbum {
  return {
    id,
    score,
    year: extra.year ?? 2015,
    country,
    placement: placeAlbum({ genres, title: extra.title ?? id, artistCountry: country }),
  };
}

describe('placeAlbum', () => {
  it('places a Japanese rock album in J-Rock with qualified tiles', () => {
    const p = placeAlbum({ genres: ['alternative rock', 'rock'], title: 'x', artistCountry: 'JP' });
    expect(p.world).toBe('j-rock');
    expect(p.tiles.map((t) => t.id)).toEqual(['alternative-rock@ja', 'j-rock']);
    // The primary is picked on the tags as written (alternative rock beats the
    // broad rock), then qualified; the album lands in its language's family.
    expect(p.primary).toBe('alternative-rock@ja');
    expect(p.tiles[0].weight).toBe(1);
  });

  it('decides a K-pop album with rap co-tags by its artist', () => {
    // k-pop is a catch-all, so on tags alone two rap tags outweigh it…
    const tags = ['k-pop', 'trap', 'hip hop'];
    expect(placeAlbum({ genres: tags, title: 'x', artistCountry: 'KR' }).world).toBe('k-rap');
    // …but an idol group's own genres (dance-pop, pop) pull it back to K-Pop.
    const idol = {
      musicbrainz: [{ tag: 'k-pop', weight: 5 }, { tag: 'dance-pop', weight: 3 }, { tag: 'pop', weight: 2 }],
      catalog: [{ tag: 'k-pop', weight: 6 }, { tag: 'dance-pop', weight: 4 }, { tag: 'pop', weight: 3 }],
    };
    expect(placeAlbum({ genres: tags, title: 'x', artistCountry: 'KR', artist: idol }).world).toBe('k-pop');
  });

  it('puts pop rap in Hip-Hop when the album also says hip hop (MBDTF)', () => {
    const p = placeAlbum({ genres: ['hip hop', 'pop rap', 'contemporary r&b'], title: 'x', artistCountry: 'US' });
    expect(p.world).toBe('hip-hop');
    // A hybrid is a tile in each of its parents' worlds.
    expect(p.tiles.map((t) => t.id)).toEqual(['hip-hop', 'pop-rap']);
    expect(p.primary).toBe('pop-rap');
  });

  it('puts a Korean rap album tagged [hip hop, k-pop] in Korean Hip-Hop', () => {
    const p = placeAlbum({ genres: ['hip hop', 'k-pop'], title: '12', artistCountry: 'KR' });
    expect(p.world).toBe('k-rap');
    // k-pop is not a Korean Hip-Hop tile — it only said "Korean".
    expect(p.tiles.map((t) => t.id)).toEqual(['k-rap']);
  });

  it('picks the primary from the first few tags, not a long-tail one', () => {
    // A Rush of Blood to the Head: post-rock is the most specific tag but sits 8th.
    const tags = ['alternative rock', 'rock', 'piano rock', 'pop rock', 'art rock', 'post-britpop', 'pop', 'post-rock', 'britpop'];
    const p = placeAlbum({ genres: tags, title: 'x', artistCountry: 'GB' });
    expect(p.world).toBe('rock');
    expect(p.primary).toBe('alternative-rock');
  });

  it('places the same tags from a British act in plain Rock', () => {
    const p = placeAlbum({ genres: ['alternative rock', 'rock'], title: 'x', artistCountry: 'GB' });
    expect(p.world).toBe('rock');
    expect(p.tiles.map((t) => t.id)).toEqual(['alternative-rock', 'rock']);
  });

  it('keeps out-of-family co-tags out of the world tiles', () => {
    const p = placeAlbum({ genres: ['jazz rap', 'hip hop', 'jazz'], title: 'x', artistCountry: 'US' });
    expect(p.world).toBe('hip-hop');
    expect(p.tiles.map((t) => t.id)).toEqual(['jazz-rap', 'hip-hop']);
    expect(p.all).toContain('jazz');
  });

  it('gives an untagged album its world as the one tile', () => {
    const p = placeAlbum({
      genres: [],
      title: 'SLOWMO',
      artistCountry: 'KR',
      artist: { wikidata: [{ tag: 'hip-hop' }, { tag: 'korean hip-hop' }] },
    });
    expect(p.world).toBe('k-rap');
    expect(p.tiles).toEqual([{ id: 'k-rap', weight: 1 }]);
  });
});

describe('buildTasteMap', () => {
  const albums = [
    rated('a1', 4.5, ['alternative rock', 'rock'], 'JP'),
    rated('a2', 4, ['rock'], 'JP'),
    rated('a3', 3.5, ['indie rock', 'rock'], 'GB'),
    rated('a4', 5, ['hip hop'], 'KR', { title: 'HUNNIT' }),
    rated('a5', 4, ['hip hop', 'k-pop'], 'KR'),
    rated('a6', 3, ['k-pop', 'dance-pop'], 'KR'),
  ];

  it('separates J-Rock, Rock, Korean Hip-Hop and K-Pop into their own worlds', () => {
    const { worlds } = buildTasteMap(albums);
    const keys = worlds.map((w) => w.key).sort();
    expect(keys).toEqual(['j-rock', 'k-pop', 'k-rap', 'rock']);
    const jrock = worlds.find((w) => w.key === 'j-rock')!;
    expect(jrock.label.en).toBe('J-Rock');
    expect(jrock.language).toBe('ja');
    expect(jrock.dominantScene).toBe('jp');
    expect(jrock.mass).toBe(2);
    // Only the world carries the language; its tiles show the plain genre.
    expect(jrock.tiles.find((t) => t.id === 'alternative-rock@ja')?.display.en).toBe('Alternative Rock');
    expect(jrock.tiles.find((t) => t.id === 'alternative-rock@ja')?.fullDisplay.en).toBe('Japanese Alternative Rock');
    expect(jrock.avg).toBe(4.25);
  });

  it('is deterministic regardless of rating order', () => {
    const a = buildTasteMap(albums).worlds.map((w) => w.key);
    const b = buildTasteMap([...albums].reverse()).worlds.map((w) => w.key);
    expect(b).toEqual(a);
  });

  it('keeps a small world on its own while the map has room', () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => rated(`r${i}`, 4, ['rock'], 'GB')),
      rated('j1', 4, ['jazz'], 'US'),
    ];
    const { worlds, albumTiles } = buildTasteMap(many);
    expect(worlds.map((w) => w.key)).toEqual(['rock', 'jazz']);
    expect(albumTiles.get('j1')).toEqual(['jazz']);
  });

  it('never folds K-Pop, J-Pop or Korean R&B behind bigger worlds (2026-10-17 report)', () => {
    // The shape of a real map: three big unmarked worlds plus six small language
    // worlds — the old 7-world cap pushed K-R&B / J-Pop / K-Pop into "Other".
    const albums = [
      ...Array.from({ length: 15 }, (_, i) => rated(`r${i}`, 4, ['rock'], 'GB')),
      ...Array.from({ length: 13 }, (_, i) => rated(`p${i}`, 4, ['pop'], 'GB')),
      ...Array.from({ length: 10 }, (_, i) => rated(`h${i}`, 4, ['hip hop'], 'KR')),
      ...Array.from({ length: 4 }, (_, i) => rated(`e${i}`, 4, ['house'], 'GB')),
      ...Array.from({ length: 4 }, (_, i) => rated(`jr${i}`, 4, ['rock'], 'JP')),
      ...Array.from({ length: 4 }, (_, i) => rated(`kf${i}`, 4, ['korean folk'], 'KR')),
      ...Array.from({ length: 4 }, (_, i) => rated(`kr${i}`, 4, ['indie rock'], 'KR')),
      ...Array.from({ length: 3 }, (_, i) => rated(`krb${i}`, 4, ['r&b'], 'KR')),
      ...Array.from({ length: 2 }, (_, i) => rated(`jp${i}`, 4, ['j-pop'], 'JP')),
      rated('kp0', 4, ['k-pop'], 'KR'),
    ];
    const keys = buildTasteMap(albums).worlds.map((w) => w.key);
    expect(keys).not.toContain(OTHER_WORLD);
    expect(keys).toEqual(expect.arrayContaining(['k-r-and-b', 'j-pop', 'k-pop']));
    expect(keys).toHaveLength(MAX_WORLDS + 1);
  });

  it('moves an album of a too-small world to a well-supported runner-up world', () => {
    // [neo soul, r&b, hip hop, conscious hip hop]: R&B by a hair, Hip-Hop close behind.
    const lauryn = rated('lh', 5, ['neo soul', 'r&b', 'hip hop', 'conscious hip hop'], 'US');
    expect(lauryn.placement.world).toBe('rnb-soul');
    expect(lauryn.placement.alternates?.[0]).toMatchObject({ world: 'hip-hop' });
    const albums = [...Array.from({ length: 30 }, (_, i) => rated(`h${i}`, 4, ['hip hop'], 'US')), lauryn];
    const { worlds, albumTiles } = buildTasteMap(albums);
    expect(worlds.map((w) => w.key)).toEqual(['hip-hop']);
    expect(worlds[0].albumIds).toContain('lh');
    expect(albumTiles.get('lh')).toContain('conscious-hip-hop');
  });

  it('does not move an album on weak runner-up evidence', () => {
    // One r&b co-tag on a rap album is not enough to file it under R&B.
    const pablo = rated('tlop', 4, ['hip hop', 'pop rap', 'trap', 'contemporary r&b', 'experimental hip hop'], 'US');
    expect(pablo.placement.alternates?.some((a) => a.world === 'rnb-soul')).toBe(false);
    const albums = [...Array.from({ length: 30 }, (_, i) => rated(`r${i}`, 4, ['neo soul'], 'US')), pablo];
    expect(buildTasteMap(albums).worlds.map((w) => w.key)).toEqual(['rnb-soul', 'hip-hop']);
  });

  it('folds into Other only past MAX_WORLDS, and never a single world', () => {
    const big: [string, string, string][] = [
      ['rock', 'rock', 'GB'],
      ['hip hop', 'hip-hop', 'US'],
      ['jazz', 'jazz', 'US'],
      ['k-pop', 'k-pop', 'KR'],
      ['j-pop', 'j-pop', 'JP'],
      ['indie rock', 'rock@ko', 'KR'],
      ['house', 'electronic', 'GB'],
      ['rock', 'j-rock', 'JP'],
      ['classical', 'classical', 'DE'],
    ];
    expect(big).toHaveLength(MAX_WORLDS);
    const base = big.flatMap(([tag, , c], i) => [rated(`b${i}a`, 4, [tag], c), rated(`b${i}b`, 4, [tag], c)]);
    const one = buildTasteMap([...base, rated('m1', 3, ['heavy metal'], 'GB')]);
    expect(one.worlds.map((w) => w.key)).not.toContain(OTHER_WORLD);
    expect(one.worlds).toHaveLength(MAX_WORLDS + 1);

    const two = buildTasteMap([...base, rated('m1', 3, ['heavy metal'], 'GB'), rated('g1', 3, ['reggae'], 'JM')]);
    expect(two.worlds.slice(0, MAX_WORLDS).map((w) => w.key).sort()).toEqual(big.map(([, k]) => k).sort());
    const other = two.worlds.find((w) => w.key === OTHER_WORLD)!;
    expect(other.tiles.map((t) => t.id).sort()).toEqual(['metal', 'reggae']);
    expect(two.albumTiles.get('m1')).toEqual(['metal']);
  });
});

describe('buildTasteMap — thumbnails', () => {
  it('shows an album under its primary and at most one co-tag when others cover the rest', () => {
    const okc = ['alternative rock', 'rock', 'art rock', 'indie rock', 'britpop', 'grunge'];
    const albums = [rated('okc', 5, okc, 'GB'), ...okc.map((t, i) => rated(`x${i}`, 4, [t], 'GB'))];
    const { worlds, albumTiles } = buildTasteMap(albums);
    expect(albumTiles.get('okc')).toHaveLength(MAX_ALBUM_TILES);
    expect(albumTiles.get('okc')![0]).toBe(placeAlbum({ genres: okc, artistCountry: 'GB' }).primary);
    // Every tile still holds a thumbnail, and mass still counts every tag.
    const rock = worlds.find((w) => w.key === 'rock')!;
    expect(rock.tiles.every((t) => t.albums > 0)).toBe(true);
    expect(rock.tiles.find((t) => t.id === 'britpop')!.mass).toBe(1.5);
  });

  it('spreads co-tags across tiles instead of stacking the same one', () => {
    const albums = [
      rated('a', 5, ['rock', 'indie rock', 'britpop'], 'GB'),
      rated('b', 4.5, ['rock', 'indie rock', 'britpop'], 'GB'),
    ];
    const { albumTiles } = buildTasteMap(albums);
    const [pa, ca] = albumTiles.get('a')!;
    const [pb, cb] = albumTiles.get('b')!;
    expect(pa).toBe(pb); // both primaries are the same tile
    expect(ca).not.toBe(cb); // …but their co-tags differ
  });

  it('lets a lone album fill at most one extra tile', () => {
    const brat = ['electropop', 'dance-pop', 'electro house', 'electronic', 'hyperpop', 'electroclash', 'synth-pop'];
    const { worlds, albumTiles } = buildTasteMap([rated('brat', 4, brat, 'GB')]);
    const shown = albumTiles.get('brat')!;
    expect(shown.length).toBeLessThanOrEqual(MAX_ALBUM_TILES + 1);
    expect(worlds[0].tiles.filter((t) => t.albums > 0)).toHaveLength(shown.length);
  });

  it('keys a hybrid tile per world so one world never shows another world’s albums', () => {
    const albums = [
      rated('rk', 4, ['rock', 'pop rock'], 'GB'),
      rated('rk2', 4, ['rock'], 'GB'),
      rated('pp', 4, ['pop', 'pop rock'], 'GB'),
      rated('pp2', 4, ['pop'], 'GB'),
    ];
    const { worlds, albumTiles } = buildTasteMap(albums);
    const rock = worlds.find((w) => w.key === 'rock')!;
    const pop = worlds.find((w) => w.key === 'pop')!;
    expect(rock.tiles.find((t) => t.id === 'pop-rock')!.key).toBe('pop-rock#rock');
    expect(pop.tiles.find((t) => t.id === 'pop-rock')!.key).toBe('pop-rock#pop');
    expect(rock.tiles.find((t) => t.id === 'rock')!.key).toBe('rock');
    expect(albumTiles.get('rk')).toContain('pop-rock#rock');
    expect(albumTiles.get('pp')).toContain('pop-rock#pop');
  });
});

describe('worldAffinity', () => {
  it('only recommends in the world’s language', () => {
    const { worlds } = buildTasteMap([
      rated('a1', 4.5, ['alternative rock', 'rock'], 'JP'),
      rated('a2', 4, ['rock'], 'JP'),
    ]);
    const jrock = worlds[0];
    const jp = placeAlbum({ genres: ['alternative rock'], title: 'x', artistCountry: 'JP' });
    const gb = placeAlbum({ genres: ['alternative rock'], title: 'x', artistCountry: 'GB' });
    expect(worldAffinity(jp, 2015, jrock)).toBeGreaterThan(0);
    expect(worldAffinity(gb, 2015, jrock)).toBe(0);
  });
});

describe('worldStandings', () => {
  const mine = [
    rated('k1', 4, ['rock'], 'KR'),
    rated('k2', 5, ['indie rock'], 'KR'),
    rated('k3', 4.5, ['rock'], 'KR'),
    rated('g1', 3, ['rock'], 'GB'),
  ];
  const community = communityWorldTotals([
    { placement: placeAlbum({ genres: ['rock'], artistCountry: 'KR' }), scoreSum: 30, scoreCount: 8 },
    { placement: placeAlbum({ genres: ['rock'], artistCountry: 'GB' }), scoreSum: 40, scoreCount: 10 },
  ]);

  it('compares Korean rock with Korean rock, not with all rock', () => {
    const s = worldStandings(buildTasteMap(mine).worlds, community);
    expect(s).toHaveLength(1);
    expect(s[0].key).toBe('rock@ko');
    expect(s[0].label.en).toBe('Korean Rock');
    expect(s[0].userAvg).toBe(4.5);
    expect(s[0].communityAvg).toBe(3.75);
    expect(s[0].userCount).toBe(3);
  });

  it('skips worlds where the community is only you', () => {
    const solo = communityWorldTotals([
      { placement: placeAlbum({ genres: ['rock'], artistCountry: 'KR' }), scoreSum: 13.5, scoreCount: 3 },
    ]);
    expect(worldStandings(buildTasteMap(mine).worlds, solo)).toEqual([]);
  });
});
