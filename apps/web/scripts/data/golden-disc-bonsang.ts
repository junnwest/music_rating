// Golden Disc Awards (골든디스크 어워즈) — 음반 본상 (Album Main Prize / Bonsang)
// Source: en.wikipedia.org — individual ceremony pages (32nd–40th)
//
// 'year' = Golden Disc award year (≈ album release year; ceremony held Jan/Feb of year+1).
// Daesang (grand prize) winners are NOT duplicated here; see golden-disc-daesang.ts.
// normalizedScore: 0.35 (bonsang = meaningful industry recognition, not the top prize)

export type GoldenDiscBonsangEntry = {
  year:   number;
  album:  string;
  artist: string;
  mbid?:  string;
};

export const GOLDEN_DISC_BONSANG: GoldenDiscBonsangEntry[] = [

  // ── 2017 (32nd ceremony) ─────────────────────────────────────────────────
  { year: 2017, album: 'The War',                           artist: 'EXO'                          },
  { year: 2017, album: 'Holiday Night',                     artist: "Girls' Generation"            },
  { year: 2017, album: 'Flight Log: Arrival',               artist: 'GOT7'                         },
  { year: 2017, album: 'Be Ordinary',                       artist: 'Hwang Chi-yeul'               },
  { year: 2017, album: 'The Code',                          artist: 'MONSTA X'                     },
  { year: 2017, album: 'W, Here',                           artist: 'NU\'EST W'                    },
  { year: 2017, album: 'Teen, Age',                         artist: 'Seventeen'                    },
  { year: 2017, album: 'My Voice',                          artist: 'Taeyeon'                      },
  { year: 2017, album: 'Twicetagram',                       artist: 'TWICE'                        },

  // ── 2018 (33rd ceremony) ─────────────────────────────────────────────────
  { year: 2018, album: 'Love Yourself: Answer',             artist: 'BTS'                          },
  { year: 2018, album: "Don't Mess Up My Tempo",           artist: 'EXO'                          },
  { year: 2018, album: 'Eyes on You',                       artist: 'GOT7'                         },
  { year: 2018, album: 'Poet | Artist',                     artist: 'Jonghyun'                     },
  { year: 2018, album: 'Take.1 Are You There?',             artist: 'MONSTA X'                     },
  { year: 2018, album: 'Regular-Irregular',                 artist: 'NCT 127'                      },
  { year: 2018, album: 'Who, You',                          artist: 'NU\'EST W'                    },
  { year: 2018, album: 'You Make My Day',                   artist: 'Seventeen'                    },
  { year: 2018, album: 'What Is Love?',                     artist: 'TWICE'                        },
  { year: 2018, album: '0+1=1 (I Promise You)',             artist: 'Wanna One'                    },

  // ── 2019 (34th ceremony) ─────────────────────────────────────────────────
  { year: 2019, album: 'City Lights',                       artist: 'Baekhyun'                     },
  { year: 2019, album: 'Map of the Soul: Persona',          artist: 'BTS'                          },
  { year: 2019, album: 'What a Life',                       artist: 'EXO-SC'                       },
  { year: 2019, album: 'Spinning Top: Between Security & Insecurity', artist: 'GOT7'             },
  { year: 2019, album: 'Take.2 We Are Here',               artist: 'MONSTA X'                     },
  { year: 2019, album: 'We Boom',                           artist: 'NCT Dream'                    },
  { year: 2019, album: 'Happily Ever After',                artist: 'NU\'EST'                      },
  { year: 2019, album: 'An Ode',                            artist: 'Seventeen'                    },
  { year: 2019, album: 'Time Slip',                         artist: 'Super Junior'                 },
  { year: 2019, album: 'Feel Special',                      artist: 'TWICE'                        },

  // ── 2020 (35th ceremony) ─────────────────────────────────────────────────
  { year: 2020, album: 'Delight',                           artist: 'Baekhyun'                     },
  { year: 2020, album: 'The Album',                         artist: 'BLACKPINK'                    },
  { year: 2020, album: 'Obsession',                         artist: 'EXO'                          },
  { year: 2020, album: 'Dye',                               artist: 'GOT7'                         },
  { year: 2020, album: 'NCT 2020 Resonance Pt. 1',          artist: 'NCT'                          },
  { year: 2020, album: 'Neo Zone',                          artist: 'NCT 127'                      },
  { year: 2020, album: 'Heng:garæ',                        artist: 'Seventeen'                    },
  { year: 2020, album: 'The Dream Chapter: Eternity',       artist: 'Tomorrow X Together'          },
  { year: 2020, album: 'More & More',                       artist: 'TWICE'                        },
  { year: 2020, album: 'Vivid',                             artist: 'AB6IX'                        },
  { year: 2020, album: 'Zero: Fever Part.1',               artist: 'ATEEZ'                        },
  { year: 2020, album: 'Season 2. Hideout: The New Day We Step Into', artist: 'CRAVITY'           },
  { year: 2020, album: '1 Billion Views',                   artist: 'EXO-SC'                       },
  { year: 2020, album: 'Not Shy',                           artist: 'ITZY'                         },
  { year: 2020, album: 'Love Poem',                         artist: 'IU'                           },
  { year: 2020, album: 'Kai (开)',                           artist: 'Kai'                          },
  { year: 2020, album: 'Magenta',                           artist: 'Kang Daniel'                  },
  { year: 2020, album: 'We Are Family',                     artist: 'Kim Ho-joong'                 },
  { year: 2020, album: 'Travel',                            artist: 'MAMAMOO'                      },
  { year: 2020, album: 'Fatal Love',                        artist: 'MONSTA X'                     },
  { year: 2020, album: 'The Table',                         artist: 'NU\'EST'                      },
  { year: 2020, album: 'Monster',                           artist: 'Red Velvet - Irene & Seulgi' },
  { year: 2020, album: 'In Life',                           artist: 'Stray Kids'                   },
  { year: 2020, album: 'Self-Portrait',                     artist: 'Suho'                         },
  { year: 2020, album: 'When We Were Us',                   artist: 'Super Junior-K.R.Y.'          },
  { year: 2020, album: 'Super One',                         artist: 'SuperM'                       },
  { year: 2020, album: 'Never Gonna Dance Again: Act 1',    artist: 'Taemin'                       },
  { year: 2020, album: 'Love Synonym #1: Right for Me',     artist: 'Wonho'                        },
  { year: 2020, album: 'Equal',                             artist: 'WOODZ'                        },

  // ── 2021 (36th ceremony) ─────────────────────────────────────────────────
  { year: 2021, album: 'Dimension: Dilemma',                artist: 'ENHYPEN'                      },
  { year: 2021, album: 'Lilac',                             artist: 'IU'                           },
  { year: 2021, album: 'Sticker',                           artist: 'NCT 127'                      },
  { year: 2021, album: 'Hot Sauce',                         artist: 'NCT Dream'                    },
  { year: 2021, album: 'Attacca',                           artist: 'Seventeen'                    },
  { year: 2021, album: 'Noeasy',                            artist: 'Stray Kids'                   },
  { year: 2021, album: 'The Chaos Chapter: Freeze',         artist: 'Tomorrow X Together'          },
  { year: 2021, album: 'I Burn',                            artist: '(G)I-dle'                     },
  { year: 2021, album: 'Must',                              artist: '2PM'                          },
  { year: 2021, album: 'Savage',                            artist: 'aespa'                        },
  { year: 2021, album: 'All Yours',                         artist: 'ASTRO'                        },
  { year: 2021, album: 'Zero: Fever Part.3',               artist: 'ATEEZ'                        },
  { year: 2021, album: 'Season 3. Hideout: Be Our Voice',   artist: 'CRAVITY'                      },
  { year: 2021, album: 'Empathy',                           artist: 'D.O.'                         },
  { year: 2021, album: 'Game Changer',                      artist: 'Golden Child'                 },
  { year: 2021, album: 'Breath of Love: Last Piece',        artist: 'GOT7'                         },
  { year: 2021, album: 'The Classic Album I – My Favorite Arias', artist: 'Kim Ho-joong'          },
  { year: 2021, album: 'Crazy in Love',                     artist: 'ITZY'                         },
  { year: 2021, album: '[&]',                               artist: 'LOONA'                        },
  { year: 2021, album: 'One of a Kind',                     artist: 'MONSTA X'                     },
  { year: 2021, album: 'NCT 2020 Resonance Pt. 2',          artist: 'NCT'                          },
  { year: 2021, album: 'Romanticize',                       artist: 'NU\'EST'                      },
  { year: 2021, album: 'Blood Moon',                        artist: 'ONEUS'                        },
  { year: 2021, album: 'Queendom',                          artist: 'Red Velvet'                   },
  { year: 2021, album: "Don't Call Me",                    artist: 'SHINee'                       },
  { year: 2021, album: 'The Renaissance',                   artist: 'Super Junior'                 },
  { year: 2021, album: 'Thrill-ing',                        artist: 'THE BOYZ'                     },
  { year: 2021, album: 'Taste of Love',                     artist: 'TWICE'                        },
  { year: 2021, album: 'Noir',                              artist: 'U-Know Yunho'                 },

  // ── 2022 (37th ceremony) ─────────────────────────────────────────────────
  { year: 2022, album: 'Born Pink',                         artist: 'BLACKPINK'                    },
  { year: 2022, album: 'Manifesto: Day 1',                  artist: 'ENHYPEN'                      },
  { year: 2022, album: 'Universe',                          artist: 'NCT'                          },
  { year: 2022, album: '2 Baddies',                         artist: 'NCT 127'                      },
  { year: 2022, album: 'Glitch Mode',                       artist: 'NCT Dream'                    },
  { year: 2022, album: 'Face the Sun',                      artist: 'Seventeen'                    },
  { year: 2022, album: 'Maxident',                          artist: 'Stray Kids'                   },
  { year: 2022, album: 'I Love',                            artist: '(G)I-dle'                     },
  { year: 2022, album: 'The World EP.1: Movement',          artist: 'ATEEZ'                        },
  { year: 2022, album: 'Checkmate',                         artist: 'ITZY'                         },
  { year: 2022, album: 'Jack in the Box',                   artist: 'j-hope'                       },
  { year: 2022, album: 'Panorama',                          artist: 'Kim Ho-joong'                 },
  { year: 2022, album: 'Im Hero',                           artist: 'Lim Young-woong'              },
  { year: 2022, album: 'IM NAYEON',                         artist: 'Nayeon'                       },
  { year: 2022, album: 'The ReVe Festival 2022 – Feel My Rhythm', artist: 'Red Velvet'            },
  { year: 2022, album: '2021 Winter SMTOWN: SMCU Express',  artist: 'SM Town'                      },
  { year: 2022, album: 'Be Aware',                          artist: 'THE BOYZ'                     },
  { year: 2022, album: 'The Second Step: Chapter One',      artist: 'TREASURE'                     },
  { year: 2022, album: 'Between 1&2',                       artist: 'TWICE'                        },
  { year: 2022, album: 'Mmm',                               artist: 'Young Tak'                    },

  // ── 2023 (38th ceremony) ─────────────────────────────────────────────────
  { year: 2023, album: 'My World',                          artist: 'aespa'                        },
  { year: 2023, album: 'Dark Blood',                        artist: 'ENHYPEN'                      },
  { year: 2023, album: "I've Mine",                        artist: 'IVE'                          },
  { year: 2023, album: 'Golden',                            artist: 'Jungkook'                     },
  { year: 2023, album: 'Unforgiven',                        artist: 'LE SSERAFIM'                  },
  { year: 2023, album: 'ISTJ',                              artist: 'NCT Dream'                    },
  { year: 2023, album: '5-Star',                            artist: 'Stray Kids'                   },
  { year: 2023, album: 'The Name Chapter: Freefall',        artist: 'Tomorrow X Together'          },
  { year: 2023, album: 'Youth in the Shade',                artist: 'ZEROBASEONE'                  },

  // ── 2024 (39th ceremony) ─────────────────────────────────────────────────
  { year: 2024, album: '2',                                 artist: '(G)I-dle'                     },
  { year: 2024, album: 'Armageddon',                        artist: 'aespa'                        },
  { year: 2024, album: 'The World EP.Fin: Will',            artist: 'ATEEZ'                        },
  { year: 2024, album: 'Romance: Untold',                   artist: 'ENHYPEN'                      },
  { year: 2024, album: 'IVE Switch',                        artist: 'IVE'                          },
  { year: 2024, album: 'Dream()scape',                      artist: 'NCT Dream'                    },
  { year: 2024, album: 'Ate',                               artist: 'Stray Kids'                   },
  { year: 2024, album: 'The Star Chapter: Sanctuary',       artist: 'Tomorrow X Together'          },
  { year: 2024, album: 'You Had Me at Hello',               artist: 'ZEROBASEONE'                  },

  // ── 2025 (40th ceremony) ─────────────────────────────────────────────────
  { year: 2025, album: 'Golden Hour: Part.2',               artist: 'ATEEZ'                        },
  { year: 2025, album: 'Desire: Unleash',                   artist: 'ENHYPEN'                      },
  { year: 2025, album: 'Übermensch',                        artist: 'G-Dragon'                     },
  { year: 2025, album: 'IVE Empathy',                       artist: 'IVE'                          },
  { year: 2025, album: 'Color',                             artist: 'NCT Wish'                     },
  { year: 2025, album: 'Odyssey',                           artist: 'RIIZE'                        },
  { year: 2025, album: 'Happy Burstday',                    artist: 'Seventeen'                    },
  { year: 2025, album: 'The Star Chapter: Together',        artist: 'Tomorrow X Together'          },
  { year: 2025, album: 'Never Say Never',                   artist: 'ZEROBASEONE'                  },

];
