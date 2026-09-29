import { describe, expect, it } from 'vitest';
import { buildTasteMap, placeAlbum, worldAffinity, OTHER_WORLD, type RatedAlbum } from './worlds';

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

  it('keeps a K-pop album with rap co-tags in K-Pop', () => {
    const p = placeAlbum({ genres: ['k-pop', 'trap', 'hip hop'], title: 'x', artistCountry: 'KR' });
    expect(p.world).toBe('k-pop');
  });

  it('places the same tags from a British act in plain Rock', () => {
    const p = placeAlbum({ genres: ['alternative rock', 'rock'], title: 'x', artistCountry: 'GB' });
    expect(p.world).toBe('rock');
    expect(p.tiles.map((t) => t.id)).toEqual(['alternative-rock', 'rock']);
  });

  it('keeps out-of-family co-tags out of the world tiles', () => {
    const p = placeAlbum({ genres: ['jazz rap', 'jazz'], title: 'x', artistCountry: 'US' });
    expect(p.world).toBe('hip-hop');
    expect(p.tiles.map((t) => t.id)).toEqual(['jazz-rap']);
    expect(p.all).toContain('jazz');
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

  it('folds small worlds into Other without losing their albums', () => {
    const many = [
      ...Array.from({ length: 30 }, (_, i) => rated(`r${i}`, 4, ['rock'], 'GB')),
      rated('j1', 4, ['jazz'], 'US'),
    ];
    const { worlds, albumTiles } = buildTasteMap(many);
    const other = worlds.find((w) => w.key === OTHER_WORLD)!;
    expect(other.tiles.map((t) => t.id)).toEqual(['jazz']);
    expect(albumTiles.get('j1')).toEqual(['jazz']);
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
