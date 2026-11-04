import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bestSplit, chronological, splitEras } from './eras';
import type { MapAlbumInput, MapArtistInput } from './types';

// Synthetic discographies: a deterministic "embedding" per sound plus small
// per-album noise, so splits are decided by the data and not by luck.
const DIM = 16;
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32 - 0.5;
  };
}
function direction(seed: number): number[] {
  const r = rng(seed);
  return Array.from({ length: DIM }, () => r());
}
function noisy(base: number[], seed: number, amount = 0.08): number[] {
  const r = rng(seed);
  return base.map((x) => x + amount * r());
}

let nextId = 0;
function album(artistId: string, year: number | null, genres: string[], embedding: number[] | null, rated = true): MapAlbumInput {
  const id = `${artistId}-rg${++nextId}`;
  return { id, title: `${artistId} ${year ?? 'undated'} ${nextId}`, artistId, year, genres, titleLanguage: null, coverUrl: null, embedding, score: rated ? 4 : null, rated };
}
function artist(id: string, albums: MapAlbumInput[], country = 'GB'): MapArtistInput {
  return { id, name: id, nameNative: null, country, genreEvidence: null, similar: [], albums };
}

const ROCK = direction(1);
const POP = direction(2);

function coldplay(): MapArtistInput {
  const early = ['britpop', 'alternative rock'];
  const late = ['pop', 'dance-pop'];
  return artist('coldplay', [
    album('coldplay', 2008, early, noisy(ROCK, 14)),
    album('coldplay', 2000, early, noisy(ROCK, 11)),
    album('coldplay', 2002, ['alternative rock', 'britpop', 'pop rock'], noisy(ROCK, 12)),
    album('coldplay', 2005, early, noisy(ROCK, 13)),
    album('coldplay', 2011, late, noisy(POP, 21)),
    album('coldplay', 2015, late, noisy(POP, 22)),
    album('coldplay', 2021, ['pop', 'dance-pop', 'synth-pop'], noisy(POP, 23)),
    album('coldplay', 2024, late, noisy(POP, 24), false),
  ]);
}

describe('splitEras', () => {
  it('splits a Coldplay-like discography at 2011', () => {
    const segs = splitEras(coldplay());
    expect(segs).toHaveLength(2);
    expect(segs[0].startYear).toBe(2000);
    expect(segs[0].endYear).toBe(2008);
    expect(segs[1].startYear).toBe(2011);
    expect(segs[1].endYear).toBe(2024);
    // Era keys start at the era's first album; albums chronological.
    expect(segs[0].key).toBe(`e:coldplay:${segs[0].albumIds[0]}`);
    expect(segs[1].key.startsWith('e:coldplay:')).toBe(true);
    expect(segs.flatMap((s) => s.albumIds)).toHaveLength(8);
  });

  it('still splits on tags alone, and on embeddings alone', () => {
    const tagsOnly = coldplay();
    tagsOnly.albums.forEach((a) => (a.embedding = null));
    expect(splitEras(tagsOnly)).toHaveLength(2);
    const embOnly = coldplay();
    embOnly.albums.forEach((a) => (a.genres = []));
    expect(splitEras(embOnly)).toHaveLength(2);
  });

  it('keeps a consistent artist as one node', () => {
    const base = direction(3);
    const a = artist('radiohead-ish', [
      album('r', 1995, ['alternative rock'], noisy(base, 31)),
      album('r', 1997, ['alternative rock', 'art rock'], noisy(base, 32)),
      album('r', 2000, ['alternative rock'], noisy(base, 33)),
      album('r', 2003, ['alternative rock', 'art rock'], noisy(base, 34)),
      album('r', 2007, ['alternative rock'], noisy(base, 35)),
      album('r', 2011, ['art rock', 'alternative rock'], noisy(base, 36)),
    ]);
    const segs = splitEras(a);
    expect(segs).toHaveLength(1);
    expect(segs[0].key).toBe('a:radiohead-ish');
    expect(segs[0].albumIds).toHaveLength(6);
  });

  it('never makes an era of one album, and leaves tiny catalogs whole', () => {
    const a = artist('x', [
      album('x', 2000, ['britpop'], noisy(ROCK, 41)),
      album('x', 2001, ['britpop'], noisy(ROCK, 42)),
      album('x', 2002, ['dance-pop'], noisy(POP, 43)),
    ]);
    expect(splitEras(a)).toHaveLength(1);
    const c = coldplay();
    const segs = splitEras(c);
    for (const s of segs) expect(s.albumIds.length).toBeGreaterThanOrEqual(2);
  });

  it('splits at most into 3 eras', () => {
    const third = direction(9);
    const a = coldplay();
    a.albums.push(
      album('coldplay', 2030, ['hip hop', 'trap'], noisy(third, 51)),
      album('coldplay', 2032, ['hip hop', 'trap'], noisy(third, 52)),
      album('coldplay', 2034, ['hip hop'], noisy(third, 53)),
    );
    const segs = splitEras(a);
    expect(segs).toHaveLength(3);
    expect(segs.map((s) => s.startYear)).toEqual([2000, 2011, 2030]);
  });

  it('applies an override exactly, and an empty override merges', () => {
    const c = coldplay();
    const order = chronological(c.albums);
    const at2005 = order.find((x) => x.year === 2005)!.id;
    const at2021 = order.find((x) => x.year === 2021)!.id;
    const segs = splitEras(c, { artistId: 'coldplay', splitAlbumIds: [at2021, at2005, 'not-in-catalog', order[0].id] });
    expect(segs.map((s) => [s.startYear, s.endYear])).toEqual([
      [2000, 2002],
      [2005, 2015],
      [2021, 2024],
    ]);
    expect(segs[1].key).toBe(`e:coldplay:${at2005}`);
    const merged = splitEras(c, { artistId: 'coldplay', splitAlbumIds: [] });
    expect(merged).toHaveLength(1);
    expect(merged[0].key).toBe('a:coldplay');
    // An override for another artist is ignored.
    expect(splitEras(c, { artistId: 'other', splitAlbumIds: [] })).toHaveLength(2);
  });

  it('puts undated albums in the era they sound like', () => {
    const c = coldplay();
    const undated = album('coldplay', null, ['dance-pop', 'pop'], noisy(POP, 61));
    c.albums.push(undated);
    const segs = splitEras(c);
    expect(segs).toHaveLength(2);
    expect(segs[1].albumIds[segs[1].albumIds.length - 1]).toBe(undated.id);
  });

  it('handles empty, undated-only and data-less catalogs', () => {
    expect(splitEras(artist('none', []))).toEqual([]);
    const u = splitEras(artist('u', [album('u', null, [], null), album('u', null, [], null)]));
    expect(u).toHaveLength(1);
    expect(u[0].startYear).toBeNull();
    const blank = splitEras(artist('b', [1, 2, 3, 4, 5].map((i) => album('b', 2000 + i, [], null))));
    expect(blank).toHaveLength(1);
  });

  it('never cuts between two releases of the same year', () => {
    // NewJeans-like: a sparsely tagged debut, then one richly tagged and three
    // sparsely tagged 2023 releases — the tag-count difference must not be an era.
    const base = direction(8);
    const plain = ['k-pop', 'contemporary r&b', 'pop'];
    const a = artist('nj', [
      album('nj', 2022, plain, noisy(base, 81)),
      album('nj', 2023, ['k-pop', 'uk garage', 'baltimore club', 'alternative r&b', 'dance-pop', 'electronic', 'experimental'], noisy(base, 82)),
      album('nj', 2023, plain, noisy(base, 83)),
      album('nj', 2023, plain, noisy(base, 84)),
      album('nj', 2023, plain, noisy(base, 85)),
    ], 'KR');
    expect(splitEras(a)).toHaveLength(1);
  });

  it('ignores unrated compilations, live albums and soundtracks', () => {
    const c = coldplay();
    const comp = album('coldplay', 2009, ['pop'], noisy(POP, 91), false);
    comp.type = 'compilation';
    const live = album('coldplay', 2012, ['rock'], noisy(ROCK, 92), true);
    live.type = 'live';
    c.albums.push(comp, live);
    const ids = splitEras(c).flatMap((s) => s.albumIds);
    expect(ids).not.toContain(comp.id);
    expect(ids).toContain(live.id); // rated → always counts
  });

  it('bestSplit reports reduction and distance', () => {
    const rows = [[1, 0], [1, 0.05], [0, 1], [0.05, 1]];
    const s = bestSplit(rows)!;
    expect(s.at).toBe(2);
    expect(s.reduction).toBeGreaterThan(0.9);
    expect(s.distance).toBeGreaterThan(0.8);
  });
});

const FIXTURE = resolve(__dirname, '__fixtures__/map-input-sample.json');
describe.skipIf(!existsSync(FIXTURE))('real fixture (map-input-sample.json)', () => {
  it('segments every artist into contiguous, complete eras', () => {
    const input = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { artists: MapArtistInput[] };
    for (const a of input.artists) {
      const segs = splitEras(a);
      expect(segs.length).toBeGreaterThanOrEqual(1);
      expect(segs.length).toBeLessThanOrEqual(3);
      expect(segs.flatMap((s) => s.albumIds).sort()).toEqual(a.albums.map((x) => x.id).sort());
      for (let i = 1; i < segs.length; i++) expect(segs[i].startYear!).toBeGreaterThan(segs[i - 1].endYear!);
    }
  });
});

// Trimmed real input for user zero (2026-11-03): Coldplay plus three multi-album
// artists, counted albums only, embeddings rounded to 4 dp (detector numbers
// unchanged). See the MIN_VARIANCE_REDUCTION comment in eras.ts for the numbers.
const ZERO_FIXTURE = resolve(__dirname, '__fixtures__/map-input-zero-eras.json');
describe('real fixture (map-input-zero-eras.json)', () => {
  const input = JSON.parse(readFileSync(ZERO_FIXTURE, 'utf8')) as { artists: MapArtistInput[] };
  const byName = (n: string) => input.artists.find((a) => a.name === n)!;

  it.each(['Oasis', 'Owl City', 'Bastille'])('keeps %s as one era', (name) => {
    const a = byName(name);
    const segs = splitEras(a);
    expect(segs).toHaveLength(1);
    expect(segs[0].key).toBe(`a:${a.id}`);
  });

  // Desired behavior, NOT met on today's data: Coldplay's tags and title+tags
  // embeddings carry no 2008|2011 signal (best cut 2019|2020 at reduction 0.08),
  // so no threshold separates it from consistent artists. `it.fails` keeps the
  // target on record and turns red once better tag data makes it pass — then
  // drop the `.fails`.
  it.fails('splits Coldplay between Viva la Vida (2008) and Mylo Xyloto (2011)', () => {
    const segs = splitEras(byName('Coldplay'));
    expect(segs.length).toBeGreaterThanOrEqual(2);
    const cut = segs.findIndex((s) => s.startYear === 2011 || s.startYear === 2009);
    expect(cut).toBeGreaterThan(0);
    expect(segs[cut - 1].endYear).toBeLessThanOrEqual(2009);
  });

  it('currently keeps Coldplay whole (known data gap)', () => {
    expect(splitEras(byName('Coldplay'))).toHaveLength(1);
  });
});
