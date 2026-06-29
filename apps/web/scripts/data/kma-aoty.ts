// Korean Music Awards — Album of the Year (올해의 앨범)
// Source: KMA official records, 2004–2026
// Includes all nominees. Grand Prize winner per year has won=true.
// Korean album titles kept in Korean (MB indexes them in original script).

export type KmaEntry = {
  year: number;
  album: string;
  artist: string;
  won: boolean;
  mbid?: string;
};

export const KMA_AOTY: KmaEntry[] = [
  // ── 2004 ──
  { year: 2004, album: 'Super Stars',                       artist: 'Cokeoer',                                 won: false },
  { year: 2004, album: '이날, 이때, 이즈음에...',             artist: 'Lee Seung-yeol',                          won: false },
  { year: 2004, album: 'Sound Renovates A Structure',        artist: 'Aso-to Union',                            won: false },
  { year: 2004, album: 'Like The Bible',                     artist: 'Big Mama',                                won: false },
  { year: 2004, album: 'F.L.O.R.I.S.T',                    artist: 'Loveholic',                               won: false },
  { year: 2004, album: 'TheThe Band',                        artist: 'The The',                                 won: true  },

  // ── 2005 ──
  { year: 2005, album: '올랭피오의 별',                       artist: 'Huckleberry Finn',                        won: false },
  { year: 2005, album: 'Instant Pig',                        artist: 'Clazziquai',                              won: false },
  { year: 2005, album: 'The livelong day',                   artist: 'Lee Seung-cheol',                         won: false },
  { year: 2005, album: 'Beats within My Soul',               artist: 'Bobby Kim',                               won: false },
  { year: 2005, album: 'Just Pop',                           artist: 'My Aunt Mary',                            won: true  },
  { year: 2005, album: 'Time Table',                         artist: '3rd Line Butterfly',                      won: false },

  // ── 2006 ──
  { year: 2006, album: 'Guitology',                          artist: 'Jo Gyu-chan',                             won: false },
  { year: 2006, album: 'Love records : Love, Power and unity', artist: 'Windy City',                            won: false },
  { year: 2006, album: '서울전자음악단',                      artist: 'Seoul Electric Band',                     won: false },
  { year: 2006, album: 'Dancing Zoo',                        artist: 'Mongoose',                                won: false },
  { year: 2006, album: '두번째 달',                          artist: 'Second Moon',                             won: true  },
  { year: 2006, album: 'Where The Story Ends',               artist: 'W',                                       won: false },

  // ── 2007 ──
  { year: 2007, album: 'Fire, Dance with Me',                artist: 'Cokeoer',                                 won: false },
  { year: 2007, album: 'Radio Dayz',                         artist: 'Lee Ji-hyeong',                           won: false },
  { year: 2007, album: 'Aresco',                             artist: 'Swallow',                                 won: true  },
  { year: 2007, album: 'A4rism',                             artist: 'Park Seon-ju',                            won: false },
  { year: 2007, album: 'The Mustangs',                       artist: 'Mustangs',                                won: false },
  { year: 2007, album: 'Q Train',                            artist: 'The Quiett',                              won: false },

  // ── 2008 ──
  { year: 2008, album: '환상... 나의 환멸',                   artist: 'Huckleberry Finn',                        won: false },
  { year: 2008, album: 'Rough Draft In Progress',            artist: 'Hollow Jan',                              won: false },
  { year: 2008, album: '나무로 만든 노래',                    artist: 'Lee Juck',                                won: true  },
  { year: 2008, album: 'In Exchange',                        artist: 'Lee Seung-yeol',                          won: false },
  { year: 2008, album: 'The Third Place',                    artist: 'Lee Sang-eun',                            won: false },
  { year: 2008, album: 'Remapping The Human Soul',           artist: 'Epik High',                               won: false },

  // ── 2009 ──
  { year: 2009, album: '가장 보통의 존재',                    artist: "Sister's Barbershop",                     won: true  },
  { year: 2009, album: '누명',                               artist: 'Verbal Jint',                             won: false },
  { year: 2009, album: 'Voyage',                             artist: 'Nah Youn-sun',                            won: false },
  { year: 2009, album: 'Monologue',                          artist: 'Kim Dong-ryul',                           won: false },
  { year: 2009, album: 'Noise On Fire',                      artist: 'Galaxy Express',                          won: false },
  { year: 2009, album: 'Hardboiled',                         artist: 'W&Whale',                                 won: false },

  // ── 2010 ──
  { year: 2010, album: '7집',                                artist: 'Lee So-ra',                               won: false },
  { year: 2010, album: 'It',                                 artist: 'Swallow',                                 won: false },
  { year: 2010, album: 'Life Is Strange',                    artist: 'Seoul Electric Band',                     won: true  },
  { year: 2010, album: '보편적인 노래',                       artist: 'Brocolli, You Too',                       won: false },
  { year: 2010, album: '201',                                artist: 'Black Skirt',                             won: false },

  // ── 2011 ──
  { year: 2011, album: 'The Paragon Of Animals',             artist: 'Crash',                                   won: false },
  { year: 2011, album: 'Afterwork',                          artist: 'Jinbo',                                   won: false },
  { year: 2011, album: '졸업',                               artist: 'Brocolli, You Too',                       won: false },
  { year: 2011, album: 'Same Girl',                          artist: 'Nah Youn-sun',                            won: false },
  { year: 2011, album: '가리온2',                            artist: 'Garion',                                  won: true  },
  { year: 2011, album: '9와 숫자들',                         artist: '9 and the Numbers',                       won: false },

  // ── 2012 ──
  { year: 2012, album: '황망한 사내',                        artist: 'Jeong Cha-sik',                           won: false },
  { year: 2012, album: '장기하와 얼굴들',                     artist: 'Kiha & The Faces',                        won: true  },
  { year: 2012, album: 'Why We Fail',                        artist: 'Lee Seung-yeol',                          won: false },
  { year: 2012, album: "Don't You Worry Baby (I'm only swimming)", artist: 'Black Skirt',                       won: false },
  { year: 2012, album: '11111101',                           artist: 'IDIOTAPE',                                won: false },

  // ── 2013 ──
  { year: 2013, album: 'Primary And The Messengers LP',      artist: 'Primary',                                 won: false },
  { year: 2013, album: '격동하는 현재사',                     artist: 'Jeong Cha-sik',                           won: false },
  { year: 2013, album: '1',                                  artist: 'Lowdown30',                               won: false },
  { year: 2013, album: '유예',                               artist: '9 and the Numbers',                       won: false },
  { year: 2013, album: 'Dreamtalk',                          artist: '3rd Line Butterfly',                      won: true  },

  // ── 2014 ──
  { year: 2014, album: 'Lento',                              artist: 'Nah Youn-sun',                            won: false },
  { year: 2014, album: 'V',                                  artist: 'Lee Seung-yeol',                          won: false },
  { year: 2014, album: 'SOONY SEVEN',                        artist: 'Jang Pill Soon',                          won: false },
  { year: 2014, album: '위험한 세계',                        artist: 'Yoon Young-bae',                          won: true  },
  { year: 2014, album: "It's okay, dear",                    artist: 'Sunwoojunga',                             won: false },

  // ── 2015 ──
  { year: 2015, album: 'EAT',                                artist: 'Hwaji',                                   won: false },
  { year: 2015, album: 'W.A.N.D.Y',                         artist: "Loro's",                                  won: true  },
  { year: 2015, album: '동물',                               artist: 'Danpyunsun and the Moments Ensemble',     won: false },
  { year: 2015, album: '{비밀}',                             artist: 'Kim Sa-wol X Kim Hae-won',                won: false },
  { year: 2015, album: '보물섬',                             artist: '9 and the Numbers',                       won: false },

  // ── 2016 ──
  { year: 2016, album: 'Abstract',                           artist: 'Method',                                  won: false },
  { year: 2016, album: '양화',                               artist: 'Deepflow',                                won: false },
  { year: 2016, album: 'into the night',                     artist: 'The Monotones',                           won: false },
  { year: 2016, album: '수잔',                               artist: 'Kim Sa-wol',                              won: false },
  { year: 2016, album: 'The Anecdote',                       artist: 'E Sens',                                  won: true  },
  { year: 2016, album: 'Irreversible',                       artist: 'Black Medicine',                          won: false },

  // ── 2017 ──
  { year: 2017, album: '나무가 되어',                        artist: 'Jo Dong-jin',                             won: true  },
  { year: 2017, album: '의식의흐름',                         artist: 'Lee Sang-ui Nalgae',                      won: false },
  { year: 2017, album: '너의 손',                            artist: 'Bahngbek',                                won: false },
  { year: 2017, album: '뿔',                                 artist: 'Danpyunsun and the Moments Ensemble',     won: false },
  { year: 2017, album: 'Attraction between two bodies',      artist: 'ABTB',                                    won: false },

  // ── 2018 ──
  { year: 2018, album: '23',                                 artist: 'Hyukoh',                                  won: false },
  { year: 2018, album: 'Palette',                            artist: 'IU',                                      won: false },
  { year: 2018, album: '콜라보 씨의 일일',                   artist: 'Kim Mok-in',                              won: false },
  { year: 2018, album: 'TEAM BABY',                          artist: 'Black Skirt',                             won: false },
  { year: 2018, album: 'bleu',                               artist: 'Kang Tae-gu',                             won: true  },

  // ── 2019 ──
  { year: 2019, album: 'Where We Were Together',             artist: 'Say Sue Me',                              won: false },
  { year: 2019, album: '오로라피플',                         artist: 'Huckleberry Finn',                        won: false },
  { year: 2019, album: 'soony eight : 소길花',              artist: 'Jang Pill Soon',                          won: true  },
  { year: 2019, album: "LOVE YOURSELF 結 'Answer'",          artist: 'BTS',                                     won: false },
  { year: 2019, album: 'Age',                                artist: 'Life and Time',                           won: false },
  { year: 2019, album: '무너지기',                           artist: 'Mid-Air Thief',                           won: false },

  // ── 2020 ──
  { year: 2020, album: 'Our love is great',                  artist: 'Baek Yerin',                              won: true  },
  { year: 2020, album: 'GENERASIAN',                         artist: 'Lim Kim',                                 won: false },
  { year: 2020, album: '킁',                                 artist: 'C JAMM',                                  won: false },
  { year: 2020, album: '전설',                               artist: 'Jannabi',                                 won: false },
  { year: 2020, album: 'THIRSTY',                            artist: 'Black Skirt',                             won: false },

  // ── 2021 ──
  { year: 2021, album: '푸른 베개',                          artist: 'Jo Dong-ik',                              won: false },
  { year: 2021, album: '청파소나타',                         artist: 'Jeongmilla',                              won: true  },
  { year: 2021, album: '수궁가',                             artist: 'Inalchi',                                 won: false },
  { year: 2021, album: 'Serenade',                           artist: 'Sunwoojunga',                             won: false },
  { year: 2021, album: 'Every letter I sent you.',           artist: 'Baek Yerin',                              won: false },
  { year: 2021, album: 'MAP OF THE SOUL : 7',               artist: 'BTS',                                     won: false },

  // ── 2022 ──
  { year: 2022, album: '수몰',                               artist: 'Cheon Yong-seong',                        won: false },
  { year: 2022, album: '늑대가 나타났다',                    artist: 'Lang Lee',                                won: true  },
  { year: 2022, album: 'LILAC',                              artist: 'IU',                                      won: false },
  { year: 2022, album: 'City Breeze & Love Song',            artist: 'Kim Hyun-cheol',                          won: false },
  { year: 2022, album: 'NEXT EPISODE',                       artist: 'AKMU',                                    won: false },

  // ── 2023 ──
  { year: 2023, album: '뽕',                                 artist: '250',                                     won: true  },
  { year: 2023, album: 'TEEN TROUBLES',                      artist: 'Black Skirt',                             won: false },
  { year: 2023, album: '당신께',                             artist: 'Nucksal, Cadejo',                         won: false },
  { year: 2023, album: '밤과낮',                             artist: 'Seon and Young',                          won: false },
  { year: 2023, album: 'Atmosphere',                         artist: 'Song Young-ju',                           won: false },
  { year: 2023, album: 'New Jeans',                          artist: 'NewJeans',                                won: false },

  // ── 2024 ──
  { year: 2024, album: 'Get Up',                             artist: 'NewJeans',                                won: false },
  { year: 2024, album: 'Nowitzki',                           artist: 'Beenzino',                                won: true  },
  { year: 2024, album: 'Machine Boy',                        artist: 'Silica Gel',                              won: false },
  { year: 2024, album: '희극',                               artist: 'Yeoyu and Seolbin',                       won: false },
  { year: 2024, album: '도시의 속마음',                      artist: 'Lee Jin-ah',                              won: false },

  // ── 2025 ──
  { year: 2025, album: '음악만세',                           artist: 'Danpyunsun and the Moments Ensemble',     won: true  },
  { year: 2025, album: 'MINISERIES 2',                       artist: 'SUMIN & Slom',                            won: false },
  { year: 2025, album: 'Armageddon - The 1st Album',         artist: 'aespa',                                   won: false },
  { year: 2025, album: 'AAA',                                artist: 'Hyukoh & Sunset Rollercoaster',           won: false },
  { year: 2025, album: 'POWER ANDRE 99',                     artist: 'Silica Gel',                              won: false },

  // ── 2026 ──
  { year: 2026, album: '소수민족',                           artist: 'Chudahye Chagis',                         won: true  },
  { year: 2026, album: '삶의 향기',                          artist: 'Gwon Na-mu',                              won: false },
  { year: 2026, album: "pullup to busan 4 morE hypEr summEr it's gonna bE a fuckin moviE", artist: 'Effie',    won: false },
  { year: 2026, album: '심장의 펌핑은 고문질',               artist: 'Woo Hee-jun',                             won: false },
  { year: 2026, album: 'EROS',                               artist: 'Lee Chan-hyeok',                          won: false },
  { year: 2026, album: 'Ruby',                               artist: 'Jennie',                                  won: false },
];
