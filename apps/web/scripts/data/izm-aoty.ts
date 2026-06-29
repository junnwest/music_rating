// IZM (이즘) 올해의 국내 앨범 (Best Korean Albums of the Year)
// Major Korean music criticism webzine — tier 2 critics' list
// Source: https://www.izm.co.kr/picks
//
// Lists are explicitly unranked ("순서와 순위는 무관하다")
// 2023–2025 accessible via new site (post-August 2024 redesign):
//   2023: izm.co.kr/posts?id=32260  |  2024: /posts?id=33058  |  2025: /posts?id=33746
// year = list year; RM's Indigo (Dec 2022) appears in IZM's 2023 list — kept as year=2023.

export type IzmEntry = {
  year:   number;
  album:  string;
  artist: string;
  mbid?:  string;
};

export const IZM_AOTY: IzmEntry[] = [
  // ── 2023 ──────────────────────────────────────────────────────────────────
  { year: 2023, album: 'Indigo',                             artist: 'RM'                           },
  { year: 2023, album: 'Love',                               artist: '강허달림'                     },
  { year: 2023, album: 'Nowitzki',                           artist: '빈지노'                       },
  { year: 2023, album: '꽤 많은 수의 촉수 돌기',               artist: '유라'                         },
  { year: 2023, album: '작은 마을',                          artist: '이설아'                       },
  { year: 2023, album: '저금통',                             artist: '이센스'                       },
  { year: 2023, album: '꿈의 거처',                          artist: '이승윤'                       },
  { year: 2023, album: 'Bomm',                               artist: 'jerd'                         },
  { year: 2023, album: 'Beige',                              artist: 'Kid Milli'                    },
  { year: 2023, album: 'Kiss of Life',                       artist: 'KISS OF LIFE'                 },

  // ── 2024 ──────────────────────────────────────────────────────────────────
  { year: 2024, album: '여행',                             artist: '김범수'                       },
  { year: 2024, album: '45주년 기념 앨범 너는 어디에',       artist: '김수철'                       },
  { year: 2024, album: '짙은햇살',                         artist: 'Moscow Surfing Club'          },
  { year: 2024, album: 'N/A',                              artist: 'The Solutions'                },
  { year: 2024, album: 'MINISERIES 2',                     artist: 'Sumin & Slom'                 },
  { year: 2024, album: 'Power André 99',                   artist: 'Silica Gel'                   },
  { year: 2024, album: '날씨가 바뀌든 안 바뀌든',           artist: 'Okoyé'                        },
  { year: 2024, album: 'Walk',                             artist: 'NCT 127'                      },
  { year: 2024, album: 'Wonderego',                        artist: 'Crush'                        },
  { year: 2024, album: 'Assemble24',                       artist: 'tripleS'                      },

  // ── 2025 ──────────────────────────────────────────────────────────────────
  { year: 2025, album: 'Vol.07',                           artist: '고고학'                        },
  { year: 2025, album: '산만한시선 2',                     artist: '산만한시선'                     },
  { year: 2025, album: 'New Wave',                         artist: 'Soul Delivery'                },
  { year: 2025, album: 'K-FLIP+',                          artist: 'Sik-K & Lil Moshpit'          },
  { year: 2025, album: 'E',                                artist: '에피'                          },
  { year: 2025, album: 'Blue Valentine',                   artist: 'NMIXX'                        },
  { year: 2025, album: 'The Musician',                     artist: 'Sam Lee & 이근형 & 이선정 & 이성열 & Charlie Jung & Tami Kim' },
  { year: 2025, album: 'Extraordinary',                    artist: '임현정'                        },
  { year: 2025, album: 'Ruby',                             artist: 'Jennie'                        },
  { year: 2025, album: 'Misery',                           artist: 'Jeebanoff'                    },
];
