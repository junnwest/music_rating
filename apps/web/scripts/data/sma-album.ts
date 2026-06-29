// Seoul Music Awards (서울가요대상) — Best Album Award (음반상 / 베스트 앨범상)
// One of Korea's four major music award shows, running since 1992.
// Source: en.wikipedia.org/wiki/Seoul_Music_Awards
//
// 'year' = album release year (ceremony held in January of year+1).
// Only years with confirmed album titles are included.

export type SmaEntry = {
  year:   number;
  album:  string;
  artist: string;
  mbid?:  string;
};

export const SMA_ALBUM: SmaEntry[] = [
  { year: 2013, album: 'Hello',                    artist: '조용필'                   },
  { year: 2014, album: 'Time',                     artist: 'Beast'                    },
  { year: 2015, album: 'Kiss My Lips',             artist: 'BoA'                      },
  { year: 2016, album: 'Wings',                    artist: 'BTS'                      },
  { year: 2017, album: 'Palette',                  artist: 'IU'                       },
  { year: 2018, album: 'Love Yourself: Tear',      artist: 'BTS'                      },
  { year: 2020, album: 'Map of the Soul: 7',       artist: 'BTS'                      },
  { year: 2021, album: 'Hot Sauce',                artist: 'NCT Dream'                },
  { year: 2022, album: 'Proof',                    artist: 'BTS'                      },
  { year: 2023, album: 'FML',                      artist: 'Seventeen'                },
];
