// Melon Music Award for Album of the Year (올해의 앨범상)
// Melon is Korea's largest streaming platform — this is the premier streaming-era album award.
// Source: en.wikipedia.org/wiki/Melon_Music_Award_for_Album_of_the_Year
//
// Only official ceremony winners included (2009–present; 2005–2008 were online-vote only).
// Nominees listed without album titles on Wikipedia — not seeded here.

export type MmaEntry = {
  year:   number;
  album:  string;
  artist: string;
  mbid?:  string;
};

export const MMA_AOTY: MmaEntry[] = [
  { year: 2009, album: 'Heartbreaker',                                          artist: 'G-Dragon'       },
  { year: 2010, album: 'To Anyone',                                             artist: '2NE1'           },
  { year: 2011, album: '2NE1',                                                  artist: '2NE1'           },
  { year: 2012, album: '버스커 버스커',                                           artist: '버스커 버스커'  },
  { year: 2013, album: '두 번째 편지',                                            artist: '버스커 버스커'  },
  { year: 2014, album: 'Chapter 8',                                             artist: 'g.o.d'          },
  { year: 2015, album: 'EXODUS',                                                artist: 'EXO'            },
  { year: 2016, album: 'The Most Beautiful Moment in Life: Young Forever',      artist: 'BTS'            },
  { year: 2017, album: 'Palette',                                               artist: 'IU'             },
  { year: 2018, album: 'Love Yourself: Tear',                                   artist: 'BTS'            },
  { year: 2019, album: 'Map of the Soul: Persona',                              artist: 'BTS'            },
  { year: 2020, album: 'Map of the Soul: 7',                                    artist: 'BTS'            },
  { year: 2021, album: 'Lilac',                                                 artist: 'IU'             },
  { year: 2022, album: 'Im Hero',                                               artist: 'Lim Young-woong'},
  { year: 2023, album: "I've Ive",                                              artist: 'IVE'            },
  { year: 2024, album: 'Armageddon',                                            artist: 'aespa'          },
  { year: 2025, album: 'Übermensch',                                            artist: 'G-Dragon'       },
];
