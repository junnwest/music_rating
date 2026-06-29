// Grammy Award for Best Rock Album
// year = ceremony year. Source: Wikipedia
import type { GrammyEntry } from './grammy-aoty';
export type { GrammyEntry };

export const GRAMMY_ROCK: GrammyEntry[] = [
  // ── 1995 ──────────────────────────────────────────────────────────────────
  { year: 1995, won: true,  album: 'Voodoo Lounge',                               artist: 'The Rolling Stones' },
  { year: 1995, won: false, album: 'Monster',                                     artist: 'R.E.M.' },
  { year: 1995, won: false, album: 'Sleeps with Angels',                          artist: 'Neil Young and Crazy Horse' },
  { year: 1995, won: false, album: 'Superunknown',                                artist: 'Soundgarden' },
  { year: 1995, won: false, album: 'Vs.',                                         artist: 'Pearl Jam' },
  // ── 1996 ──────────────────────────────────────────────────────────────────
  { year: 1996, won: true,  album: 'Jagged Little Pill',                          artist: 'Alanis Morissette' },
  { year: 1996, won: false, album: 'Forever Blue',                                artist: 'Chris Isaak' },
  { year: 1996, won: false, album: 'Mirror Ball',                                 artist: 'Neil Young' },
  { year: 1996, won: false, album: 'Vitalogy',                                    artist: 'Pearl Jam' },
  { year: 1996, won: false, album: 'Wildflowers',                                 artist: 'Tom Petty' },
  // ── 1997 ──────────────────────────────────────────────────────────────────
  { year: 1997, won: true,  album: 'Sheryl Crow',                                 artist: 'Sheryl Crow' },
  { year: 1997, won: false, album: 'Broken Arrow',                                artist: 'Neil Young and Crazy Horse' },
  { year: 1997, won: false, album: 'Crash',                                       artist: 'Dave Matthews Band' },
  { year: 1997, won: false, album: 'Road Tested',                                 artist: 'Bonnie Raitt' },
  { year: 1997, won: false, album: 'Tragic Kingdom',                              artist: 'No Doubt' },
  // ── 1998 ──────────────────────────────────────────────────────────────────
  { year: 1998, won: true,  album: 'Blue Moon Swamp',                             artist: 'John Fogerty' },
  { year: 1998, won: false, album: 'Bridges to Babylon',                          artist: 'The Rolling Stones' },
  { year: 1998, won: false, album: 'The Colour and the Shape',                    artist: 'Foo Fighters' },
  { year: 1998, won: false, album: 'Nine Lives',                                  artist: 'Aerosmith' },
  { year: 1998, won: false, album: 'Pop',                                         artist: 'U2' },
  // ── 1999 ──────────────────────────────────────────────────────────────────
  { year: 1999, won: true,  album: 'The Globe Sessions',                          artist: 'Sheryl Crow' },
  { year: 1999, won: false, album: 'Before These Crowded Streets',                artist: 'Dave Matthews Band' },
  { year: 1999, won: false, album: 'Celebrity Skin',                              artist: 'Hole' },
  { year: 1999, won: false, album: 'Version 2.0',                                 artist: 'Garbage' },
  // ── 2000 ──────────────────────────────────────────────────────────────────
  { year: 2000, won: true,  album: 'Supernatural',                                artist: 'Santana' },
  { year: 2000, won: false, album: 'Californication',                             artist: 'Red Hot Chili Peppers' },
  { year: 2000, won: false, album: 'Echo',                                        artist: 'Tom Petty and the Heartbreakers' },
  // ── 2001 ──────────────────────────────────────────────────────────────────
  { year: 2001, won: true,  album: 'There Is Nothing Left to Lose',               artist: 'Foo Fighters' },
  { year: 2001, won: false, album: 'The Battle of Los Angeles',                   artist: 'Rage Against the Machine' },
  { year: 2001, won: false, album: 'Return of Saturn',                            artist: 'No Doubt' },
  // ── 2002 ──────────────────────────────────────────────────────────────────
  { year: 2002, won: true,  album: 'All That You Can\'t Leave Behind',            artist: 'U2' },
  { year: 2002, won: false, album: 'Gold',                                        artist: 'Ryan Adams' },
  { year: 2002, won: false, album: 'Hybrid Theory',                               artist: 'Linkin Park' },
  { year: 2002, won: false, album: 'Stories from the City, Stories from the Sea', artist: 'PJ Harvey' },
  // ── 2003 ──────────────────────────────────────────────────────────────────
  { year: 2003, won: true,  album: 'The Rising',                                  artist: 'Bruce Springsteen' },
  { year: 2003, won: false, album: "C'mon, C'mon",                                artist: 'Sheryl Crow' },
  { year: 2003, won: false, album: 'When I Was Cruel',                            artist: 'Elvis Costello' },
  // ── 2004 ──────────────────────────────────────────────────────────────────
  { year: 2004, won: true,  album: 'One by One',                                  artist: 'Foo Fighters' },
  { year: 2004, won: false, album: 'Audioslave',                                  artist: 'Audioslave' },
  { year: 2004, won: false, album: 'Fallen',                                      artist: 'Evanescence' },
  // ── 2005 ──────────────────────────────────────────────────────────────────
  { year: 2005, won: true,  album: 'American Idiot',                              artist: 'Green Day' },
  { year: 2005, won: false, album: 'Contraband',                                  artist: 'Velvet Revolver' },
  { year: 2005, won: false, album: 'Hot Fuss',                                    artist: 'The Killers' },
  // ── 2006 ──────────────────────────────────────────────────────────────────
  { year: 2006, won: true,  album: 'How to Dismantle an Atomic Bomb',             artist: 'U2' },
  { year: 2006, won: false, album: 'A Bigger Bang',                               artist: 'The Rolling Stones' },
  { year: 2006, won: false, album: 'In Your Honor',                               artist: 'Foo Fighters' },
  { year: 2006, won: false, album: 'X&Y',                                         artist: 'Coldplay' },
  // ── 2007 ──────────────────────────────────────────────────────────────────
  { year: 2007, won: true,  album: 'Stadium Arcadium',                            artist: 'Red Hot Chili Peppers' },
  { year: 2007, won: false, album: 'Broken Boy Soldiers',                         artist: 'The Raconteurs' },
  { year: 2007, won: false, album: 'Highway Companion',                           artist: 'Tom Petty' },
  // ── 2008 ──────────────────────────────────────────────────────────────────
  { year: 2008, won: true,  album: 'Echoes, Silence, Patience & Grace',           artist: 'Foo Fighters' },
  { year: 2008, won: false, album: 'Daughtry',                                    artist: 'Daughtry' },
  { year: 2008, won: false, album: 'Magic',                                       artist: 'Bruce Springsteen' },
  { year: 2008, won: false, album: 'Sky Blue Sky',                                artist: 'Wilco' },
  // ── 2009 ──────────────────────────────────────────────────────────────────
  { year: 2009, won: true,  album: 'Viva la Vida or Death and All His Friends',   artist: 'Coldplay' },
  { year: 2009, won: false, album: 'Consolers of the Lonely',                     artist: 'The Raconteurs' },
  { year: 2009, won: false, album: 'Death Magnetic',                              artist: 'Metallica' },
  { year: 2009, won: false, album: 'Only by the Night',                           artist: 'Kings of Leon' },
  // ── 2010 ──────────────────────────────────────────────────────────────────
  { year: 2010, won: true,  album: '21st Century Breakdown',                      artist: 'Green Day' },
  { year: 2010, won: false, album: 'Black Ice',                                   artist: 'AC/DC' },
  { year: 2010, won: false, album: 'No Line on the Horizon',                      artist: 'U2' },
  // ── 2011 ──────────────────────────────────────────────────────────────────
  { year: 2011, won: true,  album: 'The Resistance',                              artist: 'Muse' },
  { year: 2011, won: false, album: 'Backspacer',                                  artist: 'Pearl Jam' },
  { year: 2011, won: false, album: 'Le Noise',                                    artist: 'Neil Young' },
  { year: 2011, won: false, album: 'Mojo',                                        artist: 'Tom Petty and the Heartbreakers' },
  // ── 2012 ──────────────────────────────────────────────────────────────────
  { year: 2012, won: true,  album: 'Wasting Light',                               artist: 'Foo Fighters' },
  { year: 2012, won: false, album: "I'm with You",                                artist: 'Red Hot Chili Peppers' },
  { year: 2012, won: false, album: 'The Whole Love',                              artist: 'Wilco' },
  // ── 2013 ──────────────────────────────────────────────────────────────────
  { year: 2013, won: true,  album: 'El Camino',                                   artist: 'The Black Keys' },
  { year: 2013, won: false, album: 'The 2nd Law',                                 artist: 'Muse' },
  { year: 2013, won: false, album: 'Blunderbuss',                                 artist: 'Jack White' },
  { year: 2013, won: false, album: 'Mylo Xyloto',                                 artist: 'Coldplay' },
  { year: 2013, won: false, album: 'Wrecking Ball',                               artist: 'Bruce Springsteen' },
  // ── 2014 ──────────────────────────────────────────────────────────────────
  { year: 2014, won: true,  album: 'Celebration Day',                             artist: 'Led Zeppelin' },
  { year: 2014, won: false, album: '13',                                          artist: 'Black Sabbath' },
  { year: 2014, won: false, album: '...Like Clockwork',                           artist: 'Queens of the Stone Age' },
  { year: 2014, won: false, album: 'The Next Day',                                artist: 'David Bowie' },
  // ── 2015 ──────────────────────────────────────────────────────────────────
  { year: 2015, won: true,  album: 'Morning Phase',                               artist: 'Beck' },
  { year: 2015, won: false, album: 'Hypnotic Eye',                                artist: 'Tom Petty and the Heartbreakers' },
  { year: 2015, won: false, album: 'Ryan Adams',                                  artist: 'Ryan Adams' },
  { year: 2015, won: false, album: 'Turn Blue',                                   artist: 'The Black Keys' },
  // ── 2016 ──────────────────────────────────────────────────────────────────
  { year: 2016, won: true,  album: 'Drones',                                      artist: 'Muse' },
  { year: 2016, won: false, album: 'Chaos and the Calm',                          artist: 'James Bay' },
  { year: 2016, won: false, album: 'Kintsugi',                                    artist: 'Death Cab for Cutie' },
  // ── 2017 ──────────────────────────────────────────────────────────────────
  { year: 2017, won: true,  album: 'Tell Me I\'m Pretty',                         artist: 'Cage the Elephant' },
  { year: 2017, won: false, album: 'California',                                  artist: 'Blink-182' },
  { year: 2017, won: false, album: 'Death of a Bachelor',                         artist: 'Panic! at the Disco' },
  { year: 2017, won: false, album: 'Magma',                                       artist: 'Gojira' },
  // ── 2018 ──────────────────────────────────────────────────────────────────
  { year: 2018, won: true,  album: 'A Deeper Understanding',                      artist: 'The War on Drugs' },
  { year: 2018, won: false, album: 'Emperor of Sand',                             artist: 'Mastodon' },
  { year: 2018, won: false, album: 'Hardwired... to Self-Destruct',               artist: 'Metallica' },
  { year: 2018, won: false, album: 'Villains',                                    artist: 'Queens of the Stone Age' },
  // ── 2019 ──────────────────────────────────────────────────────────────────
  { year: 2019, won: true,  album: 'From the Fires',                              artist: 'Greta Van Fleet' },
  { year: 2019, won: false, album: 'Prequelle',                                   artist: 'Ghost' },
  { year: 2019, won: false, album: 'Rainier Fog',                                 artist: 'Alice in Chains' },
  // ── 2020 ──────────────────────────────────────────────────────────────────
  { year: 2020, won: true,  album: 'Social Cues',                                 artist: 'Cage the Elephant' },
  { year: 2020, won: false, album: 'Amo',                                         artist: 'Bring Me the Horizon' },
  { year: 2020, won: false, album: 'Feral Roots',                                 artist: 'Rival Sons' },
  // ── 2021 ──────────────────────────────────────────────────────────────────
  { year: 2021, won: true,  album: 'The New Abnormal',                            artist: 'The Strokes' },
  { year: 2021, won: false, album: 'A Hero\'s Death',                             artist: 'Fontaines D.C.' },
  { year: 2021, won: false, album: 'Kiwanuka',                                    artist: 'Michael Kiwanuka' },
  { year: 2021, won: false, album: 'Sound & Fury',                                artist: 'Sturgill Simpson' },
  // ── 2022 ──────────────────────────────────────────────────────────────────
  { year: 2022, won: true,  album: 'Medicine at Midnight',                        artist: 'Foo Fighters' },
  { year: 2022, won: false, album: 'McCartney III',                               artist: 'Paul McCartney' },
  { year: 2022, won: false, album: 'Power Up',                                    artist: 'AC/DC' },
  // ── 2023 ──────────────────────────────────────────────────────────────────
  { year: 2023, won: true,  album: 'Patient Number 9',                            artist: 'Ozzy Osbourne' },
  { year: 2023, won: false, album: 'Crawler',                                     artist: 'Idles' },
  { year: 2023, won: false, album: 'Dropout Boogie',                              artist: 'The Black Keys' },
  { year: 2023, won: false, album: 'Lucifer on the Sofa',                         artist: 'Spoon' },
  // ── 2024 ──────────────────────────────────────────────────────────────────
  { year: 2024, won: true,  album: 'This Is Why',                                 artist: 'Paramore' },
  { year: 2024, won: false, album: '72 Seasons',                                  artist: 'Metallica' },
  { year: 2024, won: false, album: 'But Here We Are',                             artist: 'Foo Fighters' },
  { year: 2024, won: false, album: 'In Times New Roman...',                       artist: 'Queens of the Stone Age' },
  // ── 2025 ──────────────────────────────────────────────────────────────────
  { year: 2025, won: true,  album: 'Hackney Diamonds',                            artist: 'The Rolling Stones' },
  { year: 2025, won: false, album: 'Dark Matter',                                 artist: 'Pearl Jam' },
  { year: 2025, won: false, album: 'No Name',                                     artist: 'Jack White' },
  { year: 2025, won: false, album: 'Romance',                                     artist: 'Fontaines D.C.' },
  { year: 2025, won: false, album: 'Saviors',                                     artist: 'Green Day' },
  // ── 2026 ──────────────────────────────────────────────────────────────────
  { year: 2026, won: true,  album: 'Never Enough',                                artist: 'Turnstile' },
  { year: 2026, won: false, album: 'From Zero',                                   artist: 'Linkin Park' },
  { year: 2026, won: false, album: 'Private Music',                               artist: 'Deftones' },
];
