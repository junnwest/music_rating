/**
 * Manual MBID overrides for the small set of generic single-word stage names that
 * the resolver can't disambiguate from same-named foreign artists (RENOVATION_PLAN §4.1).
 * Keyed by normalized seed name (lowercase, punctuation-stripped) → MusicBrainz artist MBID.
 *
 * Fill these by looking up the correct artist on musicbrainz.org and pasting the MBID
 * from the URL (/artist/<MBID>). Until filled, these names resolve to `needs_review`
 * (safe) rather than a wrong match.
 *
 * Filled 2026-06-26 by verifying each MBID against MusicBrainz (country=KR + alias
 * carrying the stage name + genre). Verification notes below each entry.
 *
 * STILL UNRESOLVED (left as `needs_review` on purpose — a wrong override is worse than
 * a safe skip; "missing > wrong"). These three don't surface their Korean artist in MB
 * search even at limit 25 / KR-filtered, so we don't guess:
 *   dean   → Korean R&B singer DEAN (정재원) — MB search returns Dean Martin/Blunt/etc.
 *   gray   → Korean producer GRAY / AOMG (이성화) — MB search returns Macy/Dobie/Steve Gray
 *   kai    → EXO's KAI — MB search returns the Australian rapper / German acts
 * To resolve later: find each on musicbrainz.org, confirm KR + correct discography, add below.
 */
export const MB_ARTIST_OVERRIDES: Record<string, string> = {
  // TOMORROW X TOGETHER — KR, k-pop, aliases include "TXT" (bare "TXT" hits a Depeche remixer)
  'txt': '9d027d72-790e-40ec-bbb7-61aa613457de',
  // Apink — KR, k-pop, alias "A Pink" (bare "A Pink" hits a production-music composer)
  'a pink': '9102bdf6-b03e-4470-9f78-12127c4995cc',
  // Loco — KR (Seoul), Korean rapper, alias 로꼬 (bare "Loco" hits Loco Locass / Mr. Loco)
  'loco': '9e9e2a33-905c-4436-8ad8-8d9df00ba23d',
  // 우원재 (Woo Won-jae) — KR, alias "Woo" (bare "Woo" hits classical pianists / null-country acts)
  'woo': 'b22efa02-ca72-4aa7-a81d-838e60dc81c7',
  // MISO — KR, singer-songwriter/producer, alias "Miso" (bare "MISO" hits a Croatian + a D&B producer)
  'miso': '175f54d4-250b-435e-a522-60f2dde15401',
};
