/**
 * Work Item D — artists found absent from both the catalog AND the ingestion queue during the
 * 2026-06-30 data review. MBIDs verified directly against MusicBrainz (so a bare name search,
 * which mis-resolves several of these, is bypassed — e.g. "Zico" returns a French rapper above
 * the Korean ZICO; "Paloalto" returns a US rock band next to the Korean rapper).
 *
 * Seeded via source='mbid' (MBID-direct ingest path in pipeline.ts). Extend this list as more
 * gaps surface — keep MBIDs, not names.
 */
export interface MissingArtist { name: string; mbid: string; note?: string }

export const MISSING_ARTISTS: MissingArtist[] = [
  { name: 'ZICO',        mbid: 'f2215143-d7db-4cf0-9cd4-b0040eb63cbd', note: 'KR rapper (Block B); bare "Zico" mis-resolves to a French rapper' },
  { name: 'Paloalto',    mbid: 'be3b8476-48d4-4ff9-9916-757638e8355d', note: 'KR rapper (Hi-Lite founder); name collides with a US rock band' },
  { name: 'Don Toliver', mbid: 'a0723a3c-4135-438e-85c5-012712144ede', note: 'US' },
  { name: 'ksmartboi',   mbid: '4d7a8e1d-f35b-435c-8a12-eee393000901', note: 'KR' },
  { name: 'OKASHII',     mbid: 'b085bb51-cfdd-492e-b1dd-68265ab5b7d8', note: 'KR' },
  { name: 'JMIN',        mbid: '6802de65-29cf-40b5-b51e-776b90ad8296', note: 'KR rapper' },
  { name: 'BewhY',       mbid: 'b043d091-9c31-44c4-b646-c79d0c97840f', note: 'KR' },
  { name: 'YANGHONGWON', mbid: 'b1c58e6a-2e9a-4502-8724-5571b47292ad', note: 'KR rapper, formerly Young B' },
  // From the kr-scene no-match list (2026-06-30): English-name search couldn't resolve these (accent
  // / non-KR country), so their MBIDs are pinned here. The other 7 no-matches (Gray/Dean/BIBI/
  // Woo Won Jae/Sole/George/Hate the Sun) are KR-stored under Hangul → captured by `discover:area --country=KR`.
  { name: 'BLASÉ',         mbid: '2f96c1ae-0671-4d48-9507-670892a2ac67', note: 'KR rapper; accent broke the name match' },
  { name: 'Jasmine Sokko', mbid: '19f820c2-9d82-4079-990a-5ab24e36924d', note: 'SG (not KR → not in the country:KR sweep)' },
  // 2026-07-14 (Windows): OG KR rapper. Never discovered — only ever appeared as a track-level
  // `feat.` on artists we already own (E-Sens/PSY/Wheesung/GroovyRoom/Lexy), which stores a
  // denormalized artist_display string but creates no artist row and no queue entry. The
  // ListenBrainz/Wikipedia discovery lanes don't mine our own credit graph, so he stayed invisible.
  { name: 'Masta Wu',      mbid: '554de746-8f43-49ea-bd1f-6e5b6a212b75', note: 'KR rapper (YG/OG); feat-only in catalog, never discovered as primary' },
];

// Not in MusicBrainz at all → cannot be MBID-seeded. Recover via the Deezer fallback lane
// (DEEZER_FALLBACK=1) or `npm run mb:deezer-fallback` once prioritized.
export const MISSING_NOT_IN_MB: string[] = ['lov3rboi'];
