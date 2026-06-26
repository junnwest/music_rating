/**
 * Manual MBID overrides for the small set of generic single-word stage names that
 * the resolver can't disambiguate from same-named foreign artists (RENOVATION_PLAN §4.1).
 * Keyed by normalized seed name (lowercase, punctuation-stripped) → MusicBrainz artist MBID.
 *
 * Fill these by looking up the correct artist on musicbrainz.org and pasting the MBID
 * from the URL (/artist/<MBID>). Until filled, these names resolve to `needs_review`
 * (safe) rather than a wrong match.
 *
 * Known cases from the §12.3 coverage gate (TODO: fill MBIDs):
 *   dean        → Korean R&B singer DEAN (not Dean Martin)
 *   gray        → Korean producer GRAY / AOMG (not David Gray)
 *   kai         → EXO's KAI (not the Australian rapper)
 *   txt         → TOMORROW X TOGETHER (seed name "TXT" hits a Depeche remixer)
 *   a pink      → Apink (seed "A Pink" hits a production-music composer)
 *   loco        → Korean rapper Loco (not Loco Locass)
 *   woo         → Korean artist Woo
 *   miso        → Korean singer MISO
 */
export const MB_ARTIST_OVERRIDES: Record<string, string> = {
  // 'dean': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
};
