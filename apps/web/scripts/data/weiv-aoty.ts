// Weiv (웨이브) 올해의 국내 앨범 (Best Korean Albums of the Year)
// Major Korean music criticism webzine — tier 2 critics' list
// Source: https://www.weiv.co.kr (연말결산 articles)
//
// Scoring:
//   2015–2018: ranked top 10  → normalizedScore = (10 + 1 - rank) / 10
//   2019+:     unranked list  → normalizedScore = 0.8 (flat; weiv dropped rankings)
//
// year = list year (= album release year)
// 2016 note: ranks 8 and 8 are tied (공동 8위); rank 9 is skipped.

export type WeivEntry = {
  year:   number;
  rank:   number | null;  // null = unranked (2019+)
  album:  string;
  artist: string;
  mbid?:  string;
};

export const WEIV_AOTY: WeivEntry[] = [

  // ── 2019 (unranked — weiv dropped rankings from domestic list) ───────────
  { year: 2019, rank: null, album: 're:FLEX*ion',         artist: 'NET GALA'               },
  { year: 2019, rank: null, album: 'GENERASIAN',          artist: 'Lim Kim'                },
  { year: 2019, rank: null, album: '겹',                  artist: 'Room306'                },
  { year: 2019, rank: null, album: 'Our love is great',   artist: '백예린'                 },
  { year: 2019, rank: null, album: 'Serenade',            artist: '선우정아'               },
  { year: 2019, rank: null, album: 'Digital Advance',     artist: 'SYUNMAN'                },
  { year: 2019, rank: null, album: 'Sobrightttttttt',     artist: 'sogumm'                 },
  { year: 2019, rank: null, album: 'So! YoON!',          artist: 'So! YoON!'              },
  { year: 2019, rank: null, album: 'OO DA DA',            artist: 'SUMIN'                  },
  { year: 2019, rank: null, album: '3',                   artist: '향니'                   },

  // ── 2018 (ranked 1–10) ───────────────────────────────────────────────────
  { year: 2018, rank:  1, album: 'Your Home',                        artist: 'SUMIN'               },
  { year: 2018, rank:  2, album: '무너지기',                         artist: '공중도둑'            },
  { year: 2018, rank:  3, album: '이르고 무의미한 고백',              artist: '장명선'              },
  { year: 2018, rank:  4, album: 'Sarah',                            artist: 'KIRARA'              },
  { year: 2018, rank:  5, album: 'LANGUAGE',                         artist: 'XXX'                 },
  { year: 2018, rank:  6, album: '주인 없는 금',                     artist: '모임 별'             },
  { year: 2018, rank:  7, album: 'FACE',                             artist: 'KEY'                 },
  { year: 2018, rank:  8, album: 'CLAASSIC',                         artist: 'SAAY'                },
  { year: 2018, rank:  9, album: 'Waltz, Seoul',                     artist: 'Electric Planet Five' },
  { year: 2018, rank: 10, album: 'Enchanted Propaganda',             artist: 'Jvcki Wai'           },

  // ── 2017 (ranked 1–10) ───────────────────────────────────────────────────
  { year: 2017, rank:  1, album: 'Perfect Velvet',                    artist: 'Red Velvet'          },
  { year: 2017, rank:  2, album: 'ㅂㅂ',                             artist: 'TFO'                 },
  { year: 2017, rank:  3, album: '우연의 연속에 의한 필연',           artist: '끝없는잔향속에서우리는' },
  { year: 2017, rank:  4, album: 'With You In Mind',                 artist: 'DUVV'                },
  { year: 2017, rank:  5, album: '콜라보 씨의 일일',                  artist: '김목인'              },
  { year: 2017, rank:  6, album: '끝내 바다에',                      artist: '한승석 & 정재일'     },
  { year: 2017, rank:  7, album: "Grack Thany Presents '8luminum'",  artist: 'Grack Thany'         },
  { year: 2017, rank:  8, album: '나의 가역반응',                    artist: '신해경'              },
  { year: 2017, rank:  9, album: 'SsingSsing',                       artist: '씽씽'                },
  { year: 2017, rank: 10, album: 'Favorite',                         artist: 'SOWALL'              },

  // ── 2016 (ranked 1–10; ranks 8 tied — 공동 8위, rank 9 skipped) ─────────
  { year: 2016, rank:  1, album: '뿔',                               artist: '단편선과 선원들'     },
  { year: 2016, rank:  2, album: '빌린 입',                          artist: '이민휘'              },
  { year: 2016, rank:  3, album: '은서',                             artist: '잠비나이'            },
  { year: 2016, rank:  4, album: '불안의 세계',                      artist: '줄리아 드림'         },
  { year: 2016, rank:  5, album: 'Moves',                            artist: 'KIRARA'              },
  { year: 2016, rank:  6, album: '작은 것들의 신',                    artist: '넉살'                },
  { year: 2016, rank:  7, album: '신의 놀이',                        artist: '이랑'                },
  { year: 2016, rank:  8, album: '실리카겔',                         artist: '실리카겔'            },
  { year: 2016, rank:  8, album: 'Things What May Happen In Your Planet', artist: '구텐버즈'        },
  { year: 2016, rank: 10, album: 'Wings',                            artist: 'BTS'                 },

  // ── 2015 (ranked 1–10) ───────────────────────────────────────────────────
  { year: 2015, rank:  1, album: '양화',                             artist: 'Deepflow'            },
  { year: 2015, rank:  2, album: '언젠가 그 날이 오면',              artist: '파라솔'              },
  { year: 2015, rank:  3, album: 'The Anecdote',                     artist: 'E SENS'              },
  { year: 2015, rank:  4, album: '3 Little Wacks',                   artist: '영기획'              },
  { year: 2015, rank:  5, album: '공중도덕',                         artist: '공중도덕'            },
  { year: 2015, rank:  6, album: 'Marginal',                         artist: 'Trampauline'         },
  { year: 2015, rank:  7, album: '수잔',                             artist: '김사월'              },
  { year: 2015, rank:  8, album: '4 Walls',                          artist: 'f(x)'                },
  { year: 2015, rank:  9, album: '소음의 왕',                        artist: '전자양'              },
  { year: 2015, rank: 10, album: 'Flowing',                          artist: '나희경'              },

];
