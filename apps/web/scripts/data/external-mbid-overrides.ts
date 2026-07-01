/**
 * Hand-verified (artist, album_title) → release-group MBID for prestige albums the auto-matcher
 * can't reach. Mostly Korean "N집" classics whose MusicBrainz title is the album's REAL name, not
 * "<artist> N집" (e.g. 이문세 5집 = 옛사랑, 조용필 7집 = "Blue Deep") — a semantic gap no string
 * match can bridge — plus mis-resolving names (大瀧詠一 → a wrong same-named entity).
 *
 * How to add one: find the album on musicbrainz.org, open the RELEASE GROUP (not a release), copy
 * the MBID from the URL (…/release-group/<MBID>). `artist`/`album_title` must match external_scores
 * EXACTLY. Applied by `backfill:external-mbids` before the resolve→browse pass (overrides win).
 */
export interface ExtOverride { artist: string; album_title: string; mbid: string; note?: string }

export const OVERRIDES: ExtOverride[] = [
  // ── examples (fill with hand-verified MBIDs) ──
  // { artist: '이문세',  album_title: '이문세 5집', mbid: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', note: '옛사랑' },
  // { artist: '大瀧詠一', album_title: 'A LONG VACATION', mbid: 'xxxxxxxx-...', note: 'resolver picks the wrong 大瀧詠一郎' },
];
