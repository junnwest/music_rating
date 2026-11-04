/**
 * Test-only helpers for the Phase 4 tests: the real fixtures (zero's era
 * fixture incl. Coldplay, plus the 15-artist sample) merged into one input.
 * Not imported by app code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MapArtistInput, MapUserInput } from './types';

export function readFixture(name: string): MapUserInput {
  return JSON.parse(readFileSync(resolve(__dirname, '__fixtures__', name), 'utf8')) as MapUserInput;
}

/** zero's Oasis / Owl City / Bastille / Coldplay + the sample's 15 artists (19 artists, 33 rated albums). */
export function mergedInput(): MapUserInput {
  const zero = readFixture('map-input-zero-eras.json');
  const sample = readFixture('map-input-sample.json');
  return { userId: zero.userId, username: zero.username, artists: [...zero.artists, ...sample.artists] };
}

export function artistByName(input: MapUserInput, name: string): MapArtistInput {
  const a = input.artists.find((x) => x.name === name);
  if (!a) throw new Error(`fixture has no artist ${name}`);
  return a;
}

/** The input without one artist, and that artist as an unrated candidate (as loadArtistInputs returns it without a userId). */
export function withoutArtist(input: MapUserInput, name: string): { input: MapUserInput; candidate: MapArtistInput } {
  const a = artistByName(input, name);
  return {
    input: { ...input, artists: input.artists.filter((x) => x.id !== a.id) },
    candidate: { ...a, albums: a.albums.map((al) => ({ ...al, rated: false, score: null })) },
  };
}

export const COLDPLAY_MYLO_XYLOTO = '93705d4c-99d6-4bb2-9d1b-b6337185f2d1';
export const COLDPLAY_SAFETY_EP = '3ec29a4b-8d66-406c-baf8-00032d2d1f27';
