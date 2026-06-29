// MAMA Award for Album of the Year (Mnet Asian Music Awards / 올해의 앨범상)
// 2006–2025 (20 ceremonies)
// Source: https://en.wikipedia.org/wiki/MAMA_Award_for_Album_of_the_Year
// year = ceremony year

export type MamaEntry = {
  year:   number;
  album:  string;
  artist: string;
  won:    boolean;
  mbid?:  string;
};

export const MAMA_AOTY: MamaEntry[] = [
  // 2006
  { year: 2006, album: 'The 3rd Masterpiece',                        artist: 'SG Wannabe',                won: true  },
  { year: 2006, album: "Rain's World",                               artist: 'Rain',                      won: false },
  { year: 2006, album: 'State of the Art',                           artist: 'Shinhwa',                   won: false },
  { year: 2006, album: '"O"-Jung.Ban.Hap.',                          artist: 'TVXQ',                      won: false },
  { year: 2006, album: 'Re Feel',                                    artist: 'Vibe',                      won: false },

  // 2007
  { year: 2007, album: 'Remapping the Human Soul',                   artist: 'Epik High',                 won: true  },
  { year: 2007, album: 'Always',                                     artist: 'Big Bang',                  won: false },
  { year: 2007, album: 'The Sentimental Chord',                      artist: 'SG Wannabe',                won: false },
  { year: 2007, album: 'The Wonder Years',                           artist: 'Wonder Girls',              won: false },
  { year: 2007, album: 'The Windows of My Soul',                     artist: 'Yangpa',                    won: false },

  // 2008
  { year: 2008, album: 'Mirotic',                                    artist: 'TVXQ',                      won: true  },
  { year: 2008, album: 'Two Things Needed for the Same Purpose and 5 Objects', artist: 'Brown Eyes',     won: false },
  { year: 2008, album: 'Pieces, Part One',                           artist: 'Epik High',                 won: false },
  { year: 2008, album: 'Monologue',                                  artist: 'Kim Dong-ryool',            won: false },
  { year: 2008, album: 'Thank You',                                  artist: 'Toy',                       won: false },

  // 2009 (no nominees announced)
  { year: 2009, album: 'Heartbreaker',                               artist: 'G-Dragon',                  won: true  },

  // 2010
  { year: 2010, album: 'To Anyone',                                  artist: '2NE1',                      won: true  },
  { year: 2010, album: "Can't Let You Go Even If I Die",             artist: '2AM',                       won: false },
  { year: 2010, album: 'Hurricane Venus',                            artist: 'BoA',                       won: false },
  { year: 2010, album: 'Bonamana',                                   artist: 'Super Junior',              won: false },
  { year: 2010, album: 'Solar',                                      artist: 'Taeyang',                   won: false },

  // 2011
  { year: 2011, album: 'Mr. Simple',                                 artist: 'Super Junior',              won: true  },
  { year: 2011, album: '2NE1 2nd Mini Album',                        artist: '2NE1',                      won: false },
  { year: 2011, album: 'Tonight',                                    artist: 'Big Bang',                  won: false },
  { year: 2011, album: 'The Boys',                                   artist: "Girls' Generation",         won: false },
  { year: 2011, album: 'Keep Your Head Down',                        artist: 'TVXQ',                      won: false },

  // 2012
  { year: 2012, album: 'Sexy, Free & Single',                        artist: 'Super Junior',              won: true  },
  { year: 2012, album: 'Alive',                                      artist: 'Big Bang',                  won: false },
  { year: 2012, album: 'Busker Busker 1st Album',                    artist: 'Busker Busker',             won: false },
  { year: 2012, album: 'One of a Kind',                              artist: 'G-Dragon',                  won: false },
  { year: 2012, album: 'Catch Me',                                   artist: 'TVXQ',                      won: false },

  // 2013
  { year: 2013, album: 'XOXO',                                       artist: 'EXO',                       won: true  },
  { year: 2013, album: 'Hello',                                      artist: 'Cho Yong-pil',              won: false },
  { year: 2013, album: "Coup d'Etat",                                artist: 'G-Dragon',                  won: false },
  { year: 2013, album: 'I Got a Boy',                                artist: "Girls' Generation",         won: false },
  { year: 2013, album: 'Chapter 1. Dream Girl – The Misconceptions of You', artist: 'SHINee',            won: false },

  // 2014
  { year: 2014, album: 'Overdose',                                   artist: 'EXO',                       won: true  },
  { year: 2014, album: 'Good Luck',                                  artist: 'Beast',                     won: false },
  { year: 2014, album: 'Mr.Mr.',                                     artist: "Girls' Generation",         won: false },
  { year: 2014, album: 'Season 2',                                   artist: 'Infinite',                  won: false },
  { year: 2014, album: 'Mamacita',                                   artist: 'Super Junior',              won: false },

  // 2015
  { year: 2015, album: 'Exodus',                                     artist: 'EXO',                       won: true  },
  { year: 2015, album: 'Made',                                       artist: 'Big Bang',                  won: false },
  { year: 2015, album: 'The Most Beautiful Moment in Life, Part 1',  artist: 'BTS',                       won: false },
  { year: 2015, album: 'Odd',                                        artist: 'SHINee',                    won: false },
  { year: 2015, album: 'Devil',                                      artist: 'Super Junior',              won: false },

  // 2016
  { year: 2016, album: "Ex'Act",                                     artist: 'EXO',                       won: true  },
  { year: 2016, album: 'Wings',                                      artist: 'BTS',                       won: false },
  { year: 2016, album: 'Love & Letter',                              artist: 'Seventeen',                 won: false },
  { year: 2016, album: '1 of 1',                                     artist: 'SHINee',                    won: false },
  { year: 2016, album: 'Page Two',                                   artist: 'TWICE',                     won: false },

  // 2017
  { year: 2017, album: 'The War',                                    artist: 'EXO',                       won: true  },
  { year: 2017, album: 'Love Yourself: Her',                         artist: 'BTS',                       won: false },
  { year: 2017, album: 'Al1',                                        artist: 'Seventeen',                 won: false },
  { year: 2017, album: 'Signal',                                     artist: 'TWICE',                     won: false },
  { year: 2017, album: '1×1=1 (To Be One)',                         artist: 'Wanna One',                 won: false },

  // 2018
  { year: 2018, album: 'Love Yourself: Tear',                        artist: 'BTS',                       won: true  },
  { year: 2018, album: 'The Perfect Red Velvet',                     artist: 'Red Velvet',                won: false },
  { year: 2018, album: 'You Make My Day',                            artist: 'Seventeen',                 won: false },
  { year: 2018, album: 'What Is Love?',                              artist: 'TWICE',                     won: false },
  { year: 2018, album: '0+1=1 (I Promise You)',                      artist: 'Wanna One',                 won: false },

  // 2019
  { year: 2019, album: 'Map of the Soul: Persona',                   artist: 'BTS',                       won: true  },
  { year: 2019, album: 'Kill This Love',                             artist: 'BLACKPINK',                 won: false },
  { year: 2019, album: "Don't Mess Up My Tempo",                     artist: 'EXO',                       won: false },
  { year: 2019, album: 'An Ode',                                     artist: 'Seventeen',                 won: false },
  { year: 2019, album: 'Fancy You',                                  artist: 'TWICE',                     won: false },

  // 2020
  { year: 2020, album: 'Map of the Soul: 7',                         artist: 'BTS',                       won: true  },
  { year: 2020, album: 'The Album',                                  artist: 'BLACKPINK',                 won: false },
  { year: 2020, album: 'Delight',                                    artist: 'Baekhyun',                  won: false },
  { year: 2020, album: 'Love Poem',                                  artist: 'IU',                        won: false },
  { year: 2020, album: 'Heng:garæ',                                  artist: 'Seventeen',                 won: false },

  // 2021
  { year: 2021, album: 'Be',                                         artist: 'BTS',                       won: true  },
  { year: 2021, album: 'Sticker',                                    artist: 'NCT 127',                   won: false },
  { year: 2021, album: 'Savage',                                     artist: 'aespa',                     won: false },
  { year: 2021, album: 'Lilac',                                      artist: 'IU',                        won: false },
  { year: 2021, album: 'Hot Sauce',                                  artist: 'NCT Dream',                 won: false },

  // 2022
  { year: 2022, album: 'Proof',                                      artist: 'BTS',                       won: true  },
  { year: 2022, album: 'Born Pink',                                  artist: 'BLACKPINK',                 won: false },
  { year: 2022, album: 'Glitch Mode',                                artist: 'NCT Dream',                 won: false },
  { year: 2022, album: 'Face the Sun',                               artist: 'Seventeen',                 won: false },
  { year: 2022, album: 'Maxident',                                   artist: 'Stray Kids',                won: false },

  // 2023
  { year: 2023, album: 'FML',                                        artist: 'Seventeen',                 won: true  },
  { year: 2023, album: 'ISTJ',                                       artist: 'NCT Dream',                 won: false },
  { year: 2023, album: 'Get Up',                                     artist: 'NewJeans',                  won: false },
  { year: 2023, album: '5-Star',                                     artist: 'Stray Kids',                won: false },
  { year: 2023, album: 'The Name Chapter: Temptation',               artist: 'Tomorrow X Together',       won: false },

  // 2024
  { year: 2024, album: 'Seventeenth Heaven',                         artist: 'Seventeen',                 won: true  },
  { year: 2024, album: 'Romance: Untold',                            artist: 'ENHYPEN',                   won: false },
  { year: 2024, album: 'Golden',                                     artist: 'Jungkook',                  won: false },
  { year: 2024, album: 'Rock-Star',                                  artist: 'Stray Kids',                won: false },
  { year: 2024, album: 'The Name Chapter: Freefall',                 artist: 'Tomorrow X Together',       won: false },

  // 2025
  { year: 2025, album: 'Karma',                                      artist: 'Stray Kids',                won: true  },
  { year: 2025, album: 'Desire: Unleash',                            artist: 'ENHYPEN',                   won: false },
  { year: 2025, album: 'Odyssey',                                    artist: 'RIIZE',                     won: false },
  { year: 2025, album: 'Spill the Feels',                            artist: 'Seventeen',                 won: false },
  { year: 2025, album: 'The Star Chapter: Together',                 artist: 'Tomorrow X Together',       won: false },
];
