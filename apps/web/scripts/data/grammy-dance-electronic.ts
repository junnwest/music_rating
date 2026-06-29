// Grammy Award for Best Dance/Electronic Album
// year = ceremony year. Source: Wikipedia
import type { GrammyEntry } from './grammy-aoty';
export type { GrammyEntry };

export const GRAMMY_DANCE_ELECTRONIC: GrammyEntry[] = [
  // ── 2005 ──────────────────────────────────────────────────────────────────
  { year: 2005, won: true,  album: 'Kish Kash',                                   artist: 'Basement Jaxx' },
  { year: 2005, won: false, album: 'Chicken Grease',                              artist: 'Daft Punk' },
  { year: 2005, won: false, album: 'Speakerboxxx/The Love Below',                 artist: 'OutKast' },
  // ── 2006 ──────────────────────────────────────────────────────────────────
  { year: 2006, won: true,  album: 'Demon Days',                                  artist: 'Gorillaz' },
  { year: 2006, won: false, album: 'Electro-Shock Blues Show',                    artist: 'Eels' },
  { year: 2006, won: false, album: 'Push the Button',                             artist: 'The Chemical Brothers' },
  // ── 2007 ──────────────────────────────────────────────────────────────────
  { year: 2007, won: true,  album: 'Monkey Business',                             artist: 'The Black Eyed Peas' },
  { year: 2007, won: false, album: 'We Are the Night',                            artist: 'The Chemical Brothers' },
  // ── 2008 ──────────────────────────────────────────────────────────────────
  { year: 2008, won: true,  album: 'Alive 2007',                                  artist: 'Daft Punk' },
  // ── 2014 ──────────────────────────────────────────────────────────────────
  { year: 2014, won: true,  album: 'Random Access Memories',                      artist: 'Daft Punk' },
  { year: 2014, won: false, album: 'Bangarang',                                   artist: 'Skrillex' },
  { year: 2014, won: false, album: 'Settle',                                      artist: 'Disclosure' },
  // ── 2015 ──────────────────────────────────────────────────────────────────
  { year: 2015, won: true,  album: 'Syro',                                        artist: 'Aphex Twin' },
  // ── 2016 ──────────────────────────────────────────────────────────────────
  { year: 2016, won: true,  album: 'Caracal',                                     artist: 'Disclosure' },
  // ── 2017 ──────────────────────────────────────────────────────────────────
  { year: 2017, won: true,  album: 'Skin',                                        artist: 'Flume' },
  // ── 2018 ──────────────────────────────────────────────────────────────────
  // Winner TBD — need to verify via Windows /browse
  { year: 2018, won: false, album: 'Migration',                                   artist: 'Bonobo' },
  { year: 2018, won: false, album: 'Funk Wav Bounces Vol. 1',                     artist: 'Calvin Harris' },
  // ── 2019 ──────────────────────────────────────────────────────────────────
  { year: 2019, won: true,  album: 'Woman Worldwide',                             artist: 'Justice' },
  { year: 2019, won: false, album: 'Bloom',                                       artist: 'Odesza' },
  // ── 2020 ──────────────────────────────────────────────────────────────────
  { year: 2020, won: true,  album: 'Hi This Is Flume',                            artist: 'Flume' },
  // ── 2021 ──────────────────────────────────────────────────────────────────
  { year: 2021, won: true,  album: 'Trip',                                        artist: 'Kaytranada' },
  { year: 2021, won: false, album: 'Crush',                                       artist: 'Yaeji' },
  { year: 2021, won: false, album: 'Bubba',                                       artist: 'Kaytranada' },
  { year: 2021, won: false, album: 'Planet Her',                                  artist: 'Doja Cat' },
  // ── 2022 ──────────────────────────────────────────────────────────────────
  { year: 2022, won: true,  album: 'Promises',                                    artist: 'Floating Points, Pharoah Sanders & the London Symphony Orchestra' },
  { year: 2022, won: false, album: 'Collapsed in Sunbeams',                       artist: 'Arlo Parks' },
  { year: 2022, won: false, album: 'Finding Your Feet',                           artist: 'Bonobo' },
  { year: 2022, won: false, album: 'Power',                                       artist: 'Little Simz' },
  // ── 2023 ──────────────────────────────────────────────────────────────────
  { year: 2023, won: true,  album: 'Renaissance',                                 artist: 'Beyoncé' },
  { year: 2023, won: false, album: 'Diplo Presents Thomas Wesley Chapter 2: Swamp Savant', artist: 'Diplo' },
  { year: 2023, won: false, album: 'Fossora',                                     artist: 'Björk' },
  { year: 2023, won: false, album: 'Quest for Fire',                              artist: 'Kaytranada' },
  { year: 2023, won: false, album: 'Versions of Me',                              artist: 'Rina Sawayama' },
  // ── 2024 ──────────────────────────────────────────────────────────────────
  { year: 2024, won: true,  album: 'Quest for Fire',                              artist: 'Kaytranada' },
  { year: 2024, won: false, album: 'Actual Life 3 (January 1 – September 9 2022)', artist: 'Fred again..' },
  { year: 2024, won: false, album: 'Jacobin',                                     artist: 'Arca' },
  { year: 2024, won: false, album: 'Memento Mori',                                artist: 'Depeche Mode' },
  // ── 2025 ──────────────────────────────────────────────────────────────────
  { year: 2025, won: true,  album: 'Imaginal Disk',                               artist: 'Magdalena Bay' },
  { year: 2025, won: false, album: 'Chromakopia',                                 artist: 'Tyler, the Creator' },
  { year: 2025, won: false, album: 'GNX',                                         artist: 'Kendrick Lamar' },
  { year: 2025, won: false, album: 'Radical Optimism',                            artist: 'Dua Lipa' },
  // ── 2026 ──────────────────────────────────────────────────────────────────
  { year: 2026, won: true,  album: 'Eusexua',                                     artist: 'FKA twigs' },
  { year: 2026, won: false, album: 'BRAT',                                        artist: 'Charli XCX' },
  { year: 2026, won: false, album: 'Diamond Jubilee',                             artist: 'Cindy Lee' },
];
