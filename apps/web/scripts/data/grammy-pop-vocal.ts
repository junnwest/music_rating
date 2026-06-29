// Grammy Award for Best Pop Vocal Album
// year = ceremony year. Source: Wikipedia
// Note: category existed 1968 only, then resumed 1995.
import type { GrammyEntry } from './grammy-aoty';
export type { GrammyEntry };

export const GRAMMY_POP_VOCAL: GrammyEntry[] = [
  // ── 1968 ──────────────────────────────────────────────────────────────────
  { year: 1968, won: true,  album: "Sgt. Pepper's Lonely Hearts Club Band",       artist: 'The Beatles' },
  // ── 1995 ──────────────────────────────────────────────────────────────────
  { year: 1995, won: true,  album: 'Longing in Their Hearts',                     artist: 'Bonnie Raitt' },
  { year: 1995, won: false, album: 'Seal',                                        artist: 'Seal' },
  { year: 1995, won: false, album: 'The Sign',                                    artist: 'Ace of Base' },
  // ── 1996 ──────────────────────────────────────────────────────────────────
  { year: 1996, won: true,  album: 'Turbulent Indigo',                            artist: 'Joni Mitchell' },
  { year: 1996, won: false, album: 'Bedtime Stories',                             artist: 'Madonna' },
  { year: 1996, won: false, album: 'Daydream',                                    artist: 'Mariah Carey' },
  { year: 1996, won: false, album: 'Hell Freezes Over',                           artist: 'Eagles' },
  { year: 1996, won: false, album: 'Medusa',                                      artist: 'Annie Lennox' },
  // ── 1997 ──────────────────────────────────────────────────────────────────
  { year: 1997, won: true,  album: 'Falling into You',                            artist: 'Celine Dion' },
  { year: 1997, won: false, album: 'Mercury Falling',                             artist: 'Sting' },
  { year: 1997, won: false, album: 'New Beginning',                               artist: 'Tracy Chapman' },
  { year: 1997, won: false, album: 'Secrets',                                     artist: 'Toni Braxton' },
  // ── 1998 ──────────────────────────────────────────────────────────────────
  { year: 1998, won: true,  album: 'Hourglass',                                   artist: 'James Taylor' },
  { year: 1998, won: false, album: 'The Dance',                                   artist: 'Fleetwood Mac' },
  { year: 1998, won: false, album: 'Surfacing',                                   artist: 'Sarah McLachlan' },
  // ── 1999 ──────────────────────────────────────────────────────────────────
  { year: 1999, won: true,  album: 'Ray of Light',                                artist: 'Madonna' },
  { year: 1999, won: false, album: "Let's Talk About Love",                       artist: 'Celine Dion' },
  // ── 2000 ──────────────────────────────────────────────────────────────────
  { year: 2000, won: true,  album: 'Brand New Day',                               artist: 'Sting' },
  { year: 2000, won: false, album: 'Believe',                                     artist: 'Cher' },
  { year: 2000, won: false, album: 'Millennium',                                  artist: 'Backstreet Boys' },
  // ── 2001 ──────────────────────────────────────────────────────────────────
  { year: 2001, won: true,  album: 'Two Against Nature',                          artist: 'Steely Dan' },
  { year: 2001, won: false, album: 'Music',                                       artist: 'Madonna' },
  { year: 2001, won: false, album: 'No Strings Attached',                         artist: 'NSYNC' },
  { year: 2001, won: false, album: "Oops!... I Did It Again",                     artist: 'Britney Spears' },
  // ── 2002 ──────────────────────────────────────────────────────────────────
  { year: 2002, won: true,  album: 'Lovers Rock',                                 artist: 'Sade' },
  { year: 2002, won: false, album: 'All for You',                                 artist: 'Janet Jackson' },
  { year: 2002, won: false, album: 'Celebrity',                                   artist: 'NSYNC' },
  // ── 2003 ──────────────────────────────────────────────────────────────────
  { year: 2003, won: true,  album: 'Come Away with Me',                           artist: 'Norah Jones' },
  { year: 2003, won: false, album: 'Let Go',                                      artist: 'Avril Lavigne' },
  { year: 2003, won: false, album: 'Missundaztood',                               artist: 'Pink' },
  // ── 2004 ──────────────────────────────────────────────────────────────────
  { year: 2004, won: true,  album: 'Justified',                                   artist: 'Justin Timberlake' },
  { year: 2004, won: false, album: 'Stripped',                                    artist: 'Christina Aguilera' },
  // ── 2005 ──────────────────────────────────────────────────────────────────
  { year: 2005, won: true,  album: 'Genius Loves Company',                        artist: 'Ray Charles and Various Artists' },
  { year: 2005, won: false, album: 'Feels Like Home',                             artist: 'Norah Jones' },
  // ── 2006 ──────────────────────────────────────────────────────────────────
  { year: 2006, won: true,  album: 'Breakaway',                                   artist: 'Kelly Clarkson' },
  { year: 2006, won: false, album: 'Extraordinary Machine',                       artist: 'Fiona Apple' },
  { year: 2006, won: false, album: 'Love. Angel. Music. Baby.',                   artist: 'Gwen Stefani' },
  // ── 2007 ──────────────────────────────────────────────────────────────────
  { year: 2007, won: true,  album: 'Continuum',                                   artist: 'John Mayer' },
  { year: 2007, won: false, album: 'Back to Basics',                              artist: 'Christina Aguilera' },
  { year: 2007, won: false, album: 'FutureSex/LoveSounds',                        artist: 'Justin Timberlake' },
  // ── 2008 ──────────────────────────────────────────────────────────────────
  { year: 2008, won: true,  album: 'Back to Black',                               artist: 'Amy Winehouse' },
  { year: 2008, won: false, album: 'The Reminder',                                artist: 'Feist' },
  // ── 2009 ──────────────────────────────────────────────────────────────────
  { year: 2009, won: true,  album: 'Rockferry',                                   artist: 'Duffy' },
  { year: 2009, won: false, album: 'Long Road Out of Eden',                       artist: 'Eagles' },
  { year: 2009, won: false, album: 'Spirit',                                      artist: 'Leona Lewis' },
  // ── 2010 ──────────────────────────────────────────────────────────────────
  { year: 2010, won: true,  album: 'The E.N.D.',                                  artist: 'Black Eyed Peas' },
  { year: 2010, won: false, album: 'All I Ever Wanted',                           artist: 'Kelly Clarkson' },
  { year: 2010, won: false, album: 'Funhouse',                                    artist: 'Pink' },
  // ── 2011 ──────────────────────────────────────────────────────────────────
  { year: 2011, won: true,  album: 'The Fame Monster',                            artist: 'Lady Gaga' },
  { year: 2011, won: false, album: 'My World 2.0',                                artist: 'Justin Bieber' },
  { year: 2011, won: false, album: 'Teenage Dream',                               artist: 'Katy Perry' },
  // ── 2012 ──────────────────────────────────────────────────────────────────
  { year: 2012, won: true,  album: '21',                                          artist: 'Adele' },
  { year: 2012, won: false, album: 'Born This Way',                               artist: 'Lady Gaga' },
  { year: 2012, won: false, album: 'Loud',                                        artist: 'Rihanna' },
  // ── 2013 ──────────────────────────────────────────────────────────────────
  { year: 2013, won: true,  album: 'Stronger',                                    artist: 'Kelly Clarkson' },
  { year: 2013, won: false, album: 'Ceremonials',                                 artist: 'Florence and the Machine' },
  { year: 2013, won: false, album: 'Some Nights',                                 artist: 'Fun' },
  { year: 2013, won: false, album: 'The Truth About Love',                        artist: 'Pink' },
  // ── 2014 ──────────────────────────────────────────────────────────────────
  { year: 2014, won: true,  album: 'Unorthodox Jukebox',                          artist: 'Bruno Mars' },
  { year: 2014, won: false, album: 'Pure Heroine',                                artist: 'Lorde' },
  // ── 2015 ──────────────────────────────────────────────────────────────────
  { year: 2015, won: true,  album: 'In the Lonely Hour',                          artist: 'Sam Smith' },
  { year: 2015, won: false, album: 'Ghost Stories',                               artist: 'Coldplay' },
  { year: 2015, won: false, album: 'My Everything',                               artist: 'Ariana Grande' },
  { year: 2015, won: false, album: 'x',                                           artist: 'Ed Sheeran' },
  // ── 2016 ──────────────────────────────────────────────────────────────────
  { year: 2016, won: true,  album: '1989',                                        artist: 'Taylor Swift' },
  { year: 2016, won: false, album: 'How Big, How Blue, How Beautiful',            artist: 'Florence and the Machine' },
  // ── 2017 ──────────────────────────────────────────────────────────────────
  { year: 2017, won: true,  album: '25',                                          artist: 'Adele' },
  { year: 2017, won: false, album: 'Dangerous Woman',                             artist: 'Ariana Grande' },
  { year: 2017, won: false, album: 'Purpose',                                     artist: 'Justin Bieber' },
  // ── 2018 ──────────────────────────────────────────────────────────────────
  { year: 2018, won: true,  album: '÷',                                           artist: 'Ed Sheeran' },
  { year: 2018, won: false, album: 'Evolve',                                      artist: 'Imagine Dragons' },
  { year: 2018, won: false, album: 'Joanne',                                      artist: 'Lady Gaga' },
  { year: 2018, won: false, album: 'Lust for Life',                               artist: 'Lana Del Rey' },
  { year: 2018, won: false, album: 'Rainbow',                                     artist: 'Kesha' },
  // ── 2019 ──────────────────────────────────────────────────────────────────
  { year: 2019, won: true,  album: 'Sweetener',                                   artist: 'Ariana Grande' },
  { year: 2019, won: false, album: 'Beautiful Trauma',                            artist: 'Pink' },
  { year: 2019, won: false, album: 'Camila',                                      artist: 'Camila Cabello' },
  { year: 2019, won: false, album: 'Reputation',                                  artist: 'Taylor Swift' },
  // ── 2020 ──────────────────────────────────────────────────────────────────
  { year: 2020, won: true,  album: 'When We All Fall Asleep, Where Do We Go?',   artist: 'Billie Eilish' },
  { year: 2020, won: false, album: 'Lover',                                       artist: 'Taylor Swift' },
  { year: 2020, won: false, album: 'Thank U, Next',                               artist: 'Ariana Grande' },
  // ── 2021 ──────────────────────────────────────────────────────────────────
  { year: 2021, won: true,  album: 'Future Nostalgia',                            artist: 'Dua Lipa' },
  { year: 2021, won: false, album: 'Changes',                                     artist: 'Justin Bieber' },
  { year: 2021, won: false, album: 'Chromatica',                                  artist: 'Lady Gaga' },
  { year: 2021, won: false, album: 'Fine Line',                                   artist: 'Harry Styles' },
  { year: 2021, won: false, album: 'Folklore',                                    artist: 'Taylor Swift' },
  // ── 2022 ──────────────────────────────────────────────────────────────────
  { year: 2022, won: true,  album: 'Sour',                                        artist: 'Olivia Rodrigo' },
  { year: 2022, won: false, album: 'Happier Than Ever',                           artist: 'Billie Eilish' },
  { year: 2022, won: false, album: 'Planet Her (Deluxe)',                         artist: 'Doja Cat' },
  { year: 2022, won: false, album: 'Positions',                                   artist: 'Ariana Grande' },
  // ── 2023 ──────────────────────────────────────────────────────────────────
  { year: 2023, won: true,  album: "Harry's House",                               artist: 'Harry Styles' },
  { year: 2023, won: false, album: 'Music of the Spheres',                        artist: 'Coldplay' },
  { year: 2023, won: false, album: '30',                                          artist: 'Adele' },
  { year: 2023, won: false, album: 'Voyage',                                      artist: 'ABBA' },
  // ── 2024 ──────────────────────────────────────────────────────────────────
  { year: 2024, won: true,  album: 'Midnights',                                   artist: 'Taylor Swift' },
  { year: 2024, won: false, album: 'Endless Summer Vacation',                     artist: 'Miley Cyrus' },
  { year: 2024, won: false, album: 'Guts',                                        artist: 'Olivia Rodrigo' },
  // ── 2025 ──────────────────────────────────────────────────────────────────
  { year: 2025, won: true,  album: "Short n' Sweet",                              artist: 'Sabrina Carpenter' },
  { year: 2025, won: false, album: 'Eternal Sunshine',                            artist: 'Ariana Grande' },
  { year: 2025, won: false, album: 'Hit Me Hard and Soft',                        artist: 'Billie Eilish' },
  { year: 2025, won: false, album: 'The Rise and Fall of a Midwest Princess',     artist: 'Chappell Roan' },
  { year: 2025, won: false, album: 'The Tortured Poets Department',               artist: 'Taylor Swift' },
  // ── 2026 ──────────────────────────────────────────────────────────────────
  { year: 2026, won: true,  album: 'Mayhem',                                      artist: 'Lady Gaga' },
];
