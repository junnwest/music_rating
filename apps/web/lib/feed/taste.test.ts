import { describe, expect, it } from 'vitest';
import { buildFeedTaste } from './taste';
import type { ReleaseGroupEmbed } from '../sj/data';
const now = Date.parse('2026-09-28T12:00:00Z');
const album = (artist = 'artist'): ReleaseGroupEmbed => ({ id: 'album', title: '', artist_display: 'Same Name',
  primary_artist_id: artist, genres: null, cover_url: null, native_title: null, release_group_type: 'album' });
describe('feed taste', () => {
  it('uses a neutral prior for a new listener', () => {
    const taste = buildFeedTaste([], now);
    expect(taste.score(album())).toBe(0.5);
    expect(taste.knownArtist(album())).toBe(false);
  });
  it('uses artist identity even with missing genre metadata', () => {
    const taste = buildFeedTaste([{ score: 5, created_at: new Date(now).toISOString(), release_groups: album() }], now);
    expect(taste.score(album())).toBeGreaterThan(taste.score(album('different-id')));
    expect(taste.knownArtist(album('different-id'))).toBe(false);
  });
  it('keeps a disliked artist eligible with reduced affinity', () => {
    const taste = buildFeedTaste([{ score: 1, created_at: new Date(now).toISOString(), release_groups: album() }], now);
    expect(taste.score(album())).toBeGreaterThan(0);
    expect(taste.score(album())).toBeLessThan(taste.score(album('other')));
    expect(taste.artistIds).not.toContain('artist');
  });
});
