/**
 * Catalog expansion #2 — curated Korean hip-hop / R&B / indie roster.
 *
 * Names resolved to MBIDs by `queue-by-name.ts --list=kr-scene --region=KR` (confident,
 * unambiguous matches only; ambiguous ones are reported to add to data/missing-artists.ts with an
 * explicit MBID). This guarantees scene coverage for artists that may NOT be reachable via the
 * credit-stub graph (expansion #1). Overlap with already-ingested artists is fine — re-ingest is
 * idempotent. Extend freely.
 */
export const NAMES: string[] = [
  // ── Hip-hop (labels: AOMG, H1GHR, Hi-Lite, VMC, Ambition, Indigo, Daytona) ──
  'Jay Park', 'Simon Dominic', 'Loco', 'Gray', 'Code Kunst', 'Woo Won Jae', 'Sik-K', 'pH-1',
  'Woodie Gochild', 'HAON', 'BIG Naughty', 'GroovyRoom', 'Paloalto', 'Huckleberry P', 'Okasian',
  'Reddy', 'G2', 'Sumin', 'Dok2', 'The Quiett', 'Beenzino', 'Deepflow', 'Nucksal', 'Don Mills',
  'Black Nut', 'Vinxen', 'ODEE', 'Changmo', 'Leellamarz', 'ASH ISLAND', 'BewhY', 'C Jamm',
  'Giriboy', 'Swings', 'Mommy Son', 'Owen', 'Khundi Panda', 'Jvcki Wai', 'Nafla', 'Loopy',
  'Hash Swan', 'Punchnello', 'Yumdda', 'Verbal Jint', 'San E', 'Mad Clown', 'Dynamic Duo',
  'Tiger JK', 'Drunken Tiger', 'Epik High', 'Tablo', 'Gaeko', 'Kid Milli', 'JUSTHIS',
  'Lil Moshpit', 'Fleeky Bang', 'Keith Ape', 'Sokodomo', 'Lil Cherry', 'Coogie', 'Bill Stax',
  'Owen Ovadoz', 'Young B', 'Skinny Brown', 'Blase', 'Northfacegawd', 'Toigo', 'Untell',
  // ── R&B / soul ──
  'Dean', 'Crush', 'Zion.T', 'Colde', 'Heize', 'DeVita', 'Sole', 'George', 'Jclef', 'Rad Museum',
  'sogumm', 'Yerin Baek', 'Hoody', 'Samuel Seo', 'Jinbo', 'OFFONOFF', 'Lee Hi', 'BIBI', 'Wonstein',
  'Car, the Garden', 'Jasmine Sokko',
  // ── Indie / alternative / band ──
  'Hyukoh', 'The Black Skirts', 'Jannabi', 'ADOY', 'Se So Neon', 'Silica Gel', 'wave to earth',
  'The Volunteers', 'Touched', 'Nerd Connection', 'LUCY', 'Lacuna', 'Glen Check', 'Hate the Sun',
  'Thornapple', 'Jaurim', 'Nell', 'Standing Egg', 'Oohyo', 'Yukika', 'Asian Glow', 'Parannoul',
];
