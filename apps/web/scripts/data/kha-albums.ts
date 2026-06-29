// Korean Hiphop Awards (한국힙합어워즈 / KHA)
// Two categories: Hip Hop Album of the Year + R&B Album of the Year
// 2017–2026 (inaugural year was 2017)
// Seed as separate sources: kha_hiphop / kha_rnb

export type KhaEntry = {
  year: number;
  album: string;
  artist: string;
  won: boolean;
  mbid?: string;
};

// ── Hip Hop Album of the Year (올해의 힙합 앨범) ──────────────────────────────

export const KHA_HIPHOP: KhaEntry[] = [
  // 2017
  { year: 2017, album: '작은 것들의 신',               artist: 'Nucksal',                     won: true  },
  { year: 2017, album: '12',                           artist: 'Beenzino',                    won: false },
  { year: 2017, album: 'Zissou',                       artist: 'Hwaji',                       won: false },
  { year: 2017, album: '2 Many Homes 4 1 Kid',         artist: 'Justhis',                     won: false },
  { year: 2017, album: '녹색이념',                     artist: 'Takeone',                     won: false },
  { year: 2017, album: 'Free From Seoul',               artist: 'B-Free',                      won: false },

  // 2018
  { year: 2018, album: 'Junk Drunk Love',               artist: 'Legit Goons',                 won: true  },
  { year: 2018, album: 'Reborn',                        artist: 'Dok2',                        won: false },
  { year: 2018, album: "Muggles' Mansion",              artist: 'Code Kunst',                  won: false },
  { year: 2018, album: 'Fanaconda',                     artist: 'Hwana',                       won: false },
  { year: 2018, album: 'Moonshine',                     artist: 'Kim Sim-ya & Son Dae-hyun',   won: false },
  { year: 2018, album: 'Sour',                          artist: 'Chaboom',                     won: false },

  // 2019
  { year: 2019, album: 'Language',                      artist: 'XXX',                         won: true  },
  { year: 2019, album: '4 the Youth',                   artist: 'Justhis & Palo Alto',         won: false },
  { year: 2019, album: 'Glow Forever',                  artist: 'The Quiett',                  won: false },
  { year: 2019, album: 'Ai, the Playlist',              artist: 'Kid Milli',                   won: false },
  { year: 2019, album: '탕아',                          artist: 'Bassagong',                   won: false },
  { year: 2019, album: 'Cosmos',                        artist: 'Illinit',                     won: false },

  // 2020
  { year: 2020, album: '킁',                            artist: 'C JAMM',                      won: true  },
  { year: 2020, album: '이방인',                        artist: 'E Sens',                      won: false },
  { year: 2020, album: 'Boyhood',                       artist: 'Changmo',                     won: false },
  { year: 2020, album: 'Second Language',               artist: 'XXX',                         won: false },
  { year: 2020, album: '밭',                            artist: "O'Domar",                     won: false },
  { year: 2020, album: 'BFOTY',                         artist: 'Futuristic Swaver',           won: false },

  // 2021
  { year: 2021, album: 'Detox',                         artist: 'Bill Stax',                   won: true  },
  { year: 2021, album: 'Founder',                       artist: 'Deepflow',                    won: false },
  { year: 2021, album: 'H1ghr: Red Tape',               artist: 'H1GHR Music',                 won: false },
  { year: 2021, album: '1Q87',                          artist: 'Nucksal',                     won: false },
  { year: 2021, album: '가로사옥',                      artist: 'Khundi Panda',                won: false },
  { year: 2021, album: '선인장화',                      artist: 'Don Malik',                   won: false },

  // 2022
  { year: 2022, album: 'Underground Rockstar',          artist: 'Changmo',                     won: true  },
  { year: 2022, album: 'Skandalouz',                    artist: 'Los',                         won: false },
  { year: 2022, album: '그물,덫,발사대기,포획',          artist: 'Unofficialboyy & Haifhaif',   won: false },
  { year: 2022, album: '독립음악',                      artist: 'ChoiLB',                      won: false },
  { year: 2022, album: 'Cliche',                        artist: 'Kid Milli & Dress',           won: false },
  { year: 2022, album: 'Fanatiic',                      artist: 'Hwana',                       won: false },

  // 2023
  { year: 2023, album: 'AAA',                           artist: 'Lil Moshpit',                 won: true  },
  { year: 2023, album: 'ㅠㅠ',                          artist: 'Gonggonggu',                  won: false },
  { year: 2023, album: '당신께',                        artist: 'Nucksal & Cadejo',            won: false },
  { year: 2023, album: '걘',                            artist: 'C JAMM',                      won: false },
  { year: 2023, album: '번역 중 손실',                  artist: 'Lee Hyeon-jun',               won: false },
  { year: 2023, album: 'Dirt',                          artist: 'Palo Alto',                   won: false },

  // 2024
  { year: 2024, album: 'Nowitzki',                      artist: 'Beenzino',                    won: true  },
  { year: 2024, album: 'Trapstar Lifestyle',            artist: 'Rabbitoneabeat',              won: false },
  { year: 2024, album: '해방',                          artist: 'Sky Min-hyuk',                won: false },
  { year: 2024, album: 'AP Alchemy: Side A',            artist: 'AP Alchemy',                  won: false },
  { year: 2024, album: '저금통',                        artist: 'E Sens',                      won: false },
  { year: 2024, album: 'Beige',                         artist: 'Kid Milli',                   won: false },

  // 2025
  { year: 2025, album: 'Free Hukky Shibaseki & the God Sun Symphony Group : Odyssey.1', artist: 'B-Free & Hukky Shibaseki', won: true  },
  { year: 2025, album: '94-24',                         artist: 'Zene the Zilla',              won: false },
  { year: 2025, album: 'AKUMA',                         artist: 'Fleeky Bang',                 won: false },
  { year: 2025, album: 'ESCAPE',                        artist: 'EK',                          won: false },
  { year: 2025, album: 'Luxury Flow',                   artist: 'The Quiett',                  won: false },
  { year: 2025, album: '개미',                          artist: 'QM',                          won: false },

  // 2026
  { year: 2026, album: 'K-FLIP+',                       artist: 'Sik-K & Lil Moshpit',        won: true  },
  { year: 2026, album: "FREE THE MANE 3 'FREE THE MANE VS B-FREE'", artist: 'B-Free',         won: false },
  { year: 2026, album: 'LIT',                           artist: 'Justhis',                     won: false },
  { year: 2026, album: "pullup to busan 4 morE hypEr summEr it's gonna bE a fuckin moviE", artist: 'Effie', won: false },
  { year: 2026, album: 'YAHO',                          artist: 'EK',                          won: false },
  { year: 2026, album: '살아숨셔 4',                    artist: 'Yumdda',                      won: false },
];

// ── R&B Album of the Year (올해의 R&B 앨범) ──────────────────────────────────

export const KHA_RNB: KhaEntry[] = [
  // 2017
  { year: 2017, album: 'Everything You Wanted',         artist: 'Jay Park',                    won: true  },
  { year: 2017, album: '130 mood: TRBL',                artist: 'Dean',                        won: false },
  { year: 2017, album: 'Ego Expand',                    artist: 'Samuel Seo',                  won: false },
  { year: 2017, album: 'On And On',                     artist: 'Hoody',                       won: false },
  { year: 2017, album: 'Till The Sun Goes Up',          artist: 'Nahzam Sue',                  won: false },
  { year: 2017, album: 'Interlude',                     artist: 'Crush',                       won: false },

  // 2018
  { year: 2018, album: '나무',                          artist: 'Hippy Was Gipsy',             won: true  },
  { year: 2018, album: 'White Light Panorama',          artist: 'Rico',                        won: false },
  { year: 2018, album: 'Boy',                           artist: 'Offonoff',                    won: false },
  { year: 2018, album: 'Scene',                         artist: 'Rad Museum',                  won: false },
  { year: 2018, album: '7F, the Void',                  artist: 'Shin Seha',                   won: false },
  { year: 2018, album: '사이',                          artist: 'Vinicius',                    won: false },

  // 2019
  { year: 2019, album: 'Your Home',                     artist: 'Sumin',                       won: true  },
  { year: 2019, album: 'Wave',                          artist: 'Colde',                       won: false },
  { year: 2019, album: 'Sound Doctrine',                artist: 'Naul',                        won: false },
  { year: 2019, album: 'Flaw, Flaw',                   artist: 'Jclef',                       won: false },
  { year: 2019, album: '언어',                          artist: 'Hippy Was Gipsy',             won: false },
  { year: 2019, album: 'Metrocity',                     artist: 'Horim',                       won: false },

  // 2020
  { year: 2020, album: 'From Midnight to Sunrise',      artist: 'Crush',                       won: true  },
  { year: 2020, album: 'The Misfit',                    artist: 'Samuel Seo',                  won: false },
  { year: 2020, album: '불',                            artist: 'Hippy Was Gipsy',             won: false },
  { year: 2020, album: 'Not My Fault',                  artist: 'Dress & Sogumm',              won: false },
  { year: 2020, album: 'Every Letter I Sent You.',      artist: 'Baek Yerin',                  won: false },
  { year: 2020, album: 'Sobrightttttttt',               artist: 'Sogumm',                      won: false },

  // 2021
  { year: 2021, album: 'Unity II',                      artist: 'Samuel Seo',                  won: true  },
  { year: 2021, album: 'With Her',                      artist: 'Crush',                       won: false },
  { year: 2021, album: 'Tellusboutyourself',            artist: 'Baek Yerin',                  won: false },
  { year: 2021, album: 'XX,',                           artist: 'Sumin',                       won: false },
  { year: 2021, album: 'Creme',                         artist: 'DeVita',                      won: false },
  { year: 2021, album: 'Good Thing. [remix]',           artist: 'Jeebanoff',                   won: false },

  // 2022
  { year: 2022, album: "Don't Die Colors",              artist: 'Thama',                       won: true  },
  { year: 2022, album: 'Moodswings in This Order',      artist: 'DPR Ian',                     won: false },
  { year: 2022, album: 'Circle',                        artist: 'Mind Combined',               won: false },
  { year: 2022, album: 'Miniseries',                    artist: 'Sumin & Slom',                won: false },
  { year: 2022, album: '4 ONLY',                        artist: 'Lee Hi',                      won: false },
  { year: 2022, album: 'A.M.P.',                        artist: 'Jerd',                        won: false },

  // 2023
  { year: 2023, album: 'Rad',                           artist: 'Rad Museum',                  won: true  },
  { year: 2023, album: 'Moodswings in This Order',      artist: 'DPR Ian',                     won: false },
  { year: 2023, album: "Ego 90's",                      artist: 'Babylon',                     won: false },
  { year: 2023, album: 'Lowlife Princess: Noir',        artist: 'BIBI',                        won: false },
  { year: 2023, album: '낭만',                          artist: 'Big Naughty',                 won: false },
  { year: 2023, album: 'Private Pink',                  artist: 'A.Train',                     won: false },

  // 2024
  { year: 2024, album: 'Bomm',                          artist: 'Jerd',                        won: true  },
  { year: 2024, album: 'Wooof',                         artist: 'Thama',                       won: false },
  { year: 2024, album: '시치미',                        artist: 'Sumin',                       won: false },
  { year: 2024, album: '꽤 많은 수의 촉수돌기',          artist: 'Yura',                        won: false },
  { year: 2024, album: 'Zip',                           artist: 'Zion.T',                      won: false },
  { year: 2024, album: 'Wonderego',                     artist: 'Crush',                       won: false },

  // 2025
  { year: 2025, album: 'MINISERIES 2',                  artist: 'Sumin & Slom',                won: true  },
  { year: 2025, album: 'HOME SICK',                     artist: 'Rad Museum',                  won: false },
  { year: 2025, album: 'PoPoMo',                        artist: 'Jinbo The Superfricc & Hersh & PoPoMo', won: false },
  { year: 2025, album: 'Sphere',                        artist: 'Jooyoung',                    won: false },
  { year: 2025, album: 'THE ONE YOU WANTED',            artist: 'Jay Park',                    won: false },
  { year: 2025, album: 'Time Machine',                  artist: 'Sole',                        won: false },

  // 2026
  { year: 2026, album: 'FANG',                          artist: 'Crush',                       won: true  },
  { year: 2026, album: 'EVE: ROMANCE',                  artist: 'BIBI',                        won: false },
  { year: 2026, album: 'NONG',                          artist: 'Shinjihang',                  won: false },
  { year: 2026, album: 'Jbfm',                          artist: 'Jinho The Superfricc',        won: false },
  { year: 2026, album: 'TENT',                          artist: 'Wonstein',                    won: false },
  { year: 2026, album: '개미의 왕',                     artist: 'Yoon Da Hye',                 won: false },
];
