// Golden Disc Awards (골든디스크 어워즈) — 음반 대상 (Album Grand Prize)
// Korea's oldest and most prestigious music award, running since 1986.
// Source: ko.wikipedia.org/wiki/골든_디스크_어워즈
//
// Only 음반 대상 (Album Grand Prize / Daesang) winners are included here.
// 음반 본상 (Bonsang) nominees can be added as a separate source later.
//
// 'year' = the award year as labeled by the Golden Disc (≈ album release year).
// The physical ceremony is held in January/February of year+1.
// Coverage window: ~November 1 of (year-1) through October 31 of year.
// e.g. year=2021 covers Nov 2020–Oct 2021 (which is why BTS - BE, Nov 2020, is under 2021).

export type GoldenDiscEntry = {
  year:   number;
  album:  string;
  artist: string;
  mbid?:  string;
};

export const GOLDEN_DISC_DAESANG: GoldenDiscEntry[] = [

  // ── Pre-idol era (1986–2003) ──────────────────────────────────────────────
  { year: 1986, album: '허공',                        artist: '조용필'         },
  { year: 1987, album: '사랑이 지나가면',              artist: '이문세'         },
  { year: 1988, album: '신사동 그 사람',               artist: '주현미'         },
  { year: 1989, album: '너무 늦었잖아요',              artist: '변진섭'         },
  { year: 1990, album: '너에게로 또 다시',             artist: '변진섭'         },
  { year: 1991, album: '내 사랑 내 곁에',              artist: '김현식'         },
  { year: 1992, album: '보이지 않는 사랑',             artist: '신승훈'         },
  { year: 1993, album: '널 사랑하니까',                artist: '신승훈'         },
  { year: 1994, album: '핑계',                         artist: '김건모'         },
  { year: 1995, album: '잘못된 만남',                  artist: '김건모'         },
  { year: 1996, album: '스피드',                       artist: '김건모'         },
  { year: 1997, album: '행복',                         artist: 'H.O.T.'        },
  { year: 1998, album: '사랑을 위하여',                artist: '김종환'         },
  { year: 1999, album: '슬픈 영혼식',                  artist: '조성모'         },
  { year: 2000, album: '아시나요',                     artist: '조성모'         },
  { year: 2001, album: '길',                           artist: 'god'            },
  { year: 2002, album: '진실',                         artist: '쿨'             },
  { year: 2003, album: '피아노',                       artist: '조성모'         },

  // ── Mid-era (2004–2012) ───────────────────────────────────────────────────
  { year: 2004, album: '휠릴리',                       artist: '이수영'         },
  { year: 2005, album: '죄와 벌',                      artist: 'SG Wannabe'    },
  { year: 2006, album: 'O-正.反.合',                   artist: 'TVXQ'          },
  { year: 2007, album: '아리랑',                       artist: 'SG Wannabe'    },
  { year: 2008, album: 'MIROTIC',                      artist: 'TVXQ'          },
  { year: 2009, album: 'Sorry, Sorry',                 artist: 'Super Junior'  },
  { year: 2010, album: 'Oh!',                          artist: "Girls' Generation" },
  { year: 2011, album: 'Mr. Simple',                   artist: 'Super Junior'  },
  { year: 2012, album: 'Sexy, Free & Single',          artist: 'Super Junior'  },

  // ── EXO era (2013–2016) ───────────────────────────────────────────────────
  { year: 2013, album: 'XOXO',                         artist: 'EXO'           },
  { year: 2014, album: 'Overdose',                     artist: 'EXO'           },
  { year: 2015, album: 'EXODUS',                       artist: 'EXO'           },
  { year: 2016, album: "EX'ACT",                       artist: 'EXO'           },

  // ── BTS era (2017–2022) ───────────────────────────────────────────────────
  { year: 2017, album: 'Love Yourself: Her',           artist: 'BTS'           },
  { year: 2018, album: 'Love Yourself: Answer',        artist: 'BTS'           },
  { year: 2019, album: 'Map of the Soul: Persona',     artist: 'BTS'           },
  { year: 2020, album: 'Map of the Soul: 7',           artist: 'BTS'           },
  { year: 2021, album: 'BE',                           artist: 'BTS'           },
  { year: 2022, album: 'Proof',                        artist: 'BTS'           },

  // ── Recent (2023–2025) ────────────────────────────────────────────────────
  { year: 2023, album: 'FML',                          artist: 'Seventeen'     },
  { year: 2024, album: 'Spill the Feels',              artist: 'Seventeen'     },
  { year: 2025, album: 'KARMA',                        artist: 'Stray Kids'    },

];
