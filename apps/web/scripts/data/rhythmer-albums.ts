// 리드머 (Rhythmer) 연간 국내 앨범 베스트
// Annual domestic album best lists from Rhythmer (Korea's foremost hip-hop/R&B media)
// Source: http://rhythmer.net
// Tier 2 (major critics list, specialized in Korean hip-hop & R&B)
//
// Two separate sources: rhythmer_hiphop / rhythmer_rnb
// List sizes:
//   2017–2023, 2025: Best 10  normalizedScore = (11 - rank) / 10
//   2024:            Best 5   normalizedScore = (6 - rank) / 5
//
// year = list year (not album release year)
// rawScore = rank (1 = best)
// No 2019 R&B album list (Rhythmer published only a songs list that year)

export type RhythmerEntry = {
  year:  number;
  rank:  number;
  total: number;  // list size: 5 (2024 only) or 10
  album: string;
  artist: string;
  mbid?: string;
};

// ── 국내 랩/힙합 앨범 베스트 (Domestic Rap/Hip-hop Album Best) ─────────────

export const RHYTHMER_HIPHOP: RhythmerEntry[] = [
  // ── 2025 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2025, rank:  1, total: 10, album: 'Free The Mane 3 "Free The Mane VS B-Free"', artist: 'B-Free' },
  { year: 2025, rank:  2, total: 10, album: 'ANIMAL FKRY',          artist: '바이스 벌사' },
  { year: 2025, rank:  3, total: 10, album: "pullup to busan 4 morE hypEr summEr it's gonna bE a fuckin moviE", artist: 'Effie' },
  { year: 2025, rank:  4, total: 10, album: 'Home Sweet Home',       artist: '루시갱' },
  { year: 2025, rank:  5, total: 10, album: 'GMBT',                  artist: '재림 & 선진' },
  { year: 2025, rank:  6, total: 10, album: 'toast recipe',          artist: '플랫샵' },
  { year: 2025, rank:  7, total: 10, album: 'K-FLIP',               artist: 'Sik-K & Lil Moshpit' },
  { year: 2025, rank:  8, total: 10, album: 'Tundra',               artist: '히피쿤다' },
  { year: 2025, rank:  9, total: 10, album: 'RUSHHOUR',             artist: '모도 & Ambiguous Jack' },
  { year: 2025, rank: 10, total: 10, album: 'Ape Has Escaped',       artist: 'Ape Oblong' },

  // ── 2024 – Best 5 ──────────────────────────────────────────────────────────
  { year: 2024, rank: 1, total: 5, album: 'Free Hukky Shibaseki & the God Sun Symphony Group: Odyssey.1', artist: 'B-Free & Hukky Shibaseki' },
  { year: 2024, rank: 2, total: 5, album: 'ESCAPE',                 artist: 'EK' },
  { year: 2024, rank: 3, total: 5, album: '개미',                   artist: 'QM' },
  { year: 2024, rank: 4, total: 5, album: 'DISTORTED',              artist: 'Kwai' },
  { year: 2024, rank: 5, total: 5, album: 'AKUMA',                  artist: 'Fleeky Bang' },

  // ── 2023 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2023, rank:  1, total: 10, album: 'NOWITZKI',             artist: 'Beenzino' },
  { year: 2023, rank:  2, total: 10, album: '선전기술 X',            artist: "O'Domar" },
  { year: 2023, rank:  3, total: 10, album: '저금통',               artist: 'E Sens' },
  { year: 2023, rank:  4, total: 10, album: 'Trapstar Lifestyle',   artist: 'Rabbitoneabeat' },
  { year: 2023, rank:  5, total: 10, album: 'BEIGE',               artist: 'Kid Milli' },
  { year: 2023, rank:  6, total: 10, album: 'Arkestra',            artist: '선진 & 격 & 덥덥이' },
  { year: 2023, rank:  7, total: 10, album: '해방',                artist: 'Sky Min-hyuk' },
  { year: 2023, rank:  8, total: 10, album: 'True',               artist: 'Unofficialboyy' },
  { year: 2023, rank:  9, total: 10, album: "FREE THE MANE 'END OF AMEN'", artist: 'B-Free' },
  { year: 2023, rank: 10, total: 10, album: 'A Prescription For', artist: 'Leebido & HD BL4CK' },

  // ── 2022 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2022, rank:  1, total: 10, album: '당신께',               artist: 'Nucksal & Cadejo' },
  { year: 2022, rank:  2, total: 10, album: 'Dirt',                artist: 'Palo Alto' },
  { year: 2022, rank:  3, total: 10, album: '번역 중 손실',          artist: 'Lee Hyeon-jun' },
  { year: 2022, rank:  4, total: 10, album: '걘',                  artist: 'C JAMM' },
  { year: 2022, rank:  5, total: 10, album: 'ㅠㅠ',               artist: 'Gonggonggu' },
  { year: 2022, rank:  6, total: 10, album: '비공식적 기록 III',    artist: 'JJK' },
  { year: 2022, rank:  7, total: 10, album: 'Hot Stuff 3',        artist: 'Chaboom & Leebido' },
  { year: 2022, rank:  8, total: 10, album: '자유주제',             artist: '배현이' },
  { year: 2022, rank:  9, total: 10, album: 'Hue',               artist: '전산시스템오류' },
  { year: 2022, rank: 10, total: 10, album: 'lobonatune2!',       artist: 'Rabbitoneabeat' },

  // ── 2021 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2021, rank:  1, total: 10, album: 'Underground Rockstar',      artist: 'Changmo' },
  { year: 2021, rank:  2, total: 10, album: 'Fragment',                  artist: 'Mild Beats' },
  { year: 2021, rank:  3, total: 10, album: 'Skandalouz',                artist: 'Los' },
  { year: 2021, rank:  4, total: 10, album: '엔트로피',                  artist: 'Kwai & Irene' },
  { year: 2021, rank:  5, total: 10, album: 'MODM: Original Saga',       artist: 'Khundi Panda' },
  { year: 2021, rank:  6, total: 10, album: '그물, 덫, 발사대기, 포획',  artist: 'Unofficialboyy & Haifhaif' },
  { year: 2021, rank:  7, total: 10, album: 'Hot Stuff 2',               artist: 'Chaboom & Leebido' },
  { year: 2021, rank:  8, total: 10, album: 'Heartcore',                 artist: 'Heatcore' },
  { year: 2021, rank:  9, total: 10, album: 'Bomb Head',                 artist: 'Jaedal' },
  { year: 2021, rank: 10, total: 10, album: '돈숨',                      artist: 'QM' },

  // ── 2020 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2020, rank:  1, total: 10, album: 'Free The Beast',     artist: 'B-Free' },
  { year: 2020, rank:  2, total: 10, album: 'DETOX',              artist: 'Bill Stax' },
  { year: 2020, rank:  3, total: 10, album: 'Founder',            artist: 'Deepflow' },
  { year: 2020, rank:  4, total: 10, album: '가로사옥',            artist: 'Khundi Panda' },
  { year: 2020, rank:  5, total: 10, album: 'FLAME',              artist: 'BLNK' },
  { year: 2020, rank:  6, total: 10, album: 'Hot Stuff',          artist: 'Chaboom & Leebido' },
  { year: 2020, rank:  7, total: 10, album: 'Flowering4',         artist: 'Kwai' },
  { year: 2020, rank:  8, total: 10, album: 'CC',                 artist: 'ChoiLB' },
  { year: 2020, rank:  9, total: 10, album: '1Q87',               artist: 'Nucksal' },
  { year: 2020, rank: 10, total: 10, album: 'Undercover Angel',   artist: 'Swervy' },

  // ── 2019 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2019, rank:  1, total: 10, album: '킁',                 artist: 'C JAMM' },
  { year: 2019, rank:  2, total: 10, album: '이방인',             artist: 'E Sens' },
  { year: 2019, rank:  3, total: 10, album: 'BFOTY',             artist: 'Futuristic Swaver' },
  { year: 2019, rank:  4, total: 10, album: '오리엔테이션',        artist: 'ChoiLB' },
  { year: 2019, rank:  5, total: 10, album: 'Boyhood',           artist: 'Changmo' },
  { year: 2019, rank:  6, total: 10, album: 'Cyber Lover',       artist: 'OLNL' },
  { year: 2019, rank:  7, total: 10, album: '화기엄금',           artist: 'Simon Dominic' },
  { year: 2019, rank:  8, total: 10, album: 'Second Language',   artist: 'XXX' },
  { year: 2019, rank:  9, total: 10, album: 'Off Duty',          artist: 'Dynamic Duo' },
  { year: 2019, rank: 10, total: 10, album: "Life's A Loop",     artist: 'Damye' },

  // ── 2018 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2018, rank:  1, total: 10, album: 'flaw, flaw',        artist: 'Jclef' },
  { year: 2018, rank:  2, total: 10, album: '탕아',              artist: 'Bassagong' },
  { year: 2018, rank:  3, total: 10, album: '4 the Youth',       artist: 'Justhis & Palo Alto' },
  { year: 2018, rank:  4, total: 10, album: 'Language',          artist: 'XXX' },
  { year: 2018, rank:  5, total: 10, album: '전체이용가',          artist: 'OLNL' },
  { year: 2018, rank:  6, total: 10, album: 'WASD',              artist: 'Hwaji' },
  { year: 2018, rank:  7, total: 10, album: 'Period',            artist: 'Jaedal' },
  { year: 2018, rank:  8, total: 10, album: 'AI, The Playlist',  artist: 'Kid Milli' },
  { year: 2018, rank:  9, total: 10, album: 'Secondhand Smoking', artist: 'Mild Beats' },
  { year: 2018, rank: 10, total: 10, album: 'KOKI7',             artist: 'JJANGYOU' },

  // ── 2017 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2017, rank:  1, total: 10, album: '재건축',             artist: 'Viann & Khundi Panda' },
  { year: 2017, rank:  2, total: 10, album: 'Junk Drunk Love',   artist: 'Legit Goons' },
  { year: 2017, rank:  3, total: 10, album: 'Moonshine',         artist: 'Kim Sim-ya & Son Dae-hyun' },
  { year: 2017, rank:  4, total: 10, album: 'Sour',              artist: 'Chaboom' },
  { year: 2017, rank:  5, total: 10, album: 'Reborn',            artist: 'Dok2' },
  { year: 2017, rank:  6, total: 10, album: 'Adventure',         artist: 'Jaedal' },
  { year: 2017, rank:  7, total: 10, album: 'Vibe',              artist: 'Wavisabiroom' },
  { year: 2017, rank:  8, total: 10, album: "'Buffet' Mixtape",  artist: 'Bill Stax' },
  { year: 2017, rank:  9, total: 10, album: 'OVRWRT',            artist: 'Jerry. K' },
  { year: 2017, rank: 10, total: 10, album: 'ㅂㅂ',              artist: 'TFO' },
];

// ── 국내 알앤비/소울 앨범 베스트 (Domestic R&B/Soul Album Best) ───────────────
// Note: No 2019 album list — Rhythmer published only a songs list (노래 베스트 10) that year.

export const RHYTHMER_RNB: RhythmerEntry[] = [
  // ── 2025 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2025, rank:  1, total: 10, album: '개미의 왕',            artist: '윤다혜' },
  { year: 2025, rank:  2, total: 10, album: '소수민족',             artist: '추다혜차지스' },
  { year: 2025, rank:  3, total: 10, album: 'Eve: Romance',        artist: 'BIBI' },
  { year: 2025, rank:  4, total: 10, album: 'Jbfm',               artist: '진보' },
  { year: 2025, rank:  5, total: 10, album: 'Misery',              artist: 'jeebanoff' },
  { year: 2025, rank:  6, total: 10, album: 'Endless',             artist: 'Cadejo' },
  { year: 2025, rank:  7, total: 10, album: 'New Wave',            artist: 'Soul Delivery' },
  { year: 2025, rank:  8, total: 10, album: "Hannah's Studio",     artist: 'Hannah Jang' },
  { year: 2025, rank:  9, total: 10, album: 'Love is a Bandage',   artist: 'Dada' },
  { year: 2025, rank: 10, total: 10, album: 'Povidone Orange',     artist: 'A.Train' },

  // ── 2024 – Best 5 ──────────────────────────────────────────────────────────
  { year: 2024, rank: 1, total: 5, album: 'Miniseries 2',         artist: 'Sumin & Slom' },
  { year: 2024, rank: 2, total: 5, album: 'Monsoon',              artist: 'BRWN' },
  { year: 2024, rank: 3, total: 5, album: 'PSST!',               artist: 'John Park' },
  { year: 2024, rank: 4, total: 5, album: 'Time Machine',         artist: '쏠' },
  { year: 2024, rank: 5, total: 5, album: 'Cool',                 artist: '주혜린' },

  // ── 2023 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2023, rank:  1, total: 10, album: 'BOMM',               artist: 'Jerd' },
  { year: 2023, rank:  2, total: 10, album: '꽤 많은 수의 촉수 돌기', artist: 'youra' },
  { year: 2023, rank:  3, total: 10, album: 'Freeverse',          artist: 'Cadejo' },
  { year: 2023, rank:  4, total: 10, album: '추 (Yours Truly)',    artist: 'BRWN' },
  { year: 2023, rank:  5, total: 10, album: '시치미',              artist: 'Sumin' },
  { year: 2023, rank:  6, total: 10, album: 'wonderego',          artist: 'Crush' },
  { year: 2023, rank:  7, total: 10, album: 'Peninsula Park',     artist: 'Soul Delivery' },
  { year: 2023, rank:  8, total: 10, album: 'Moth',               artist: 'Soma' },
  { year: 2023, rank:  9, total: 10, album: 'Wooof!',             artist: 'THAMA' },
  { year: 2023, rank: 10, total: 10, album: 'oceanfromtheblue',   artist: 'oceanfromtheblue' },

  // ── 2022 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2022, rank:  1, total: 10, album: 'RAD',                   artist: 'Rad Museum' },
  { year: 2022, rank:  2, total: 10, album: 'Private Pink',          artist: 'A.Train' },
  { year: 2022, rank:  3, total: 10, album: 'Kpop',                  artist: '체' },
  { year: 2022, rank:  4, total: 10, album: 'Foodcourt',             artist: 'Soul Delivery' },
  { year: 2022, rank:  5, total: 10, album: "I Just Can't Control My Feet!", artist: 'Xin Seha' },
  { year: 2022, rank:  6, total: 10, album: 'Studio X {1. Phase}',   artist: 'Sunwoo JungA' },
  { year: 2022, rank:  7, total: 10, album: 'Lowlife Princess: Noir', artist: 'BIBI' },
  { year: 2022, rank:  8, total: 10, album: 'S:inema',               artist: '쎄이' },
  { year: 2022, rank:  9, total: 10, album: "EGO 90's",              artist: 'Babylon' },
  { year: 2022, rank: 10, total: 10, album: 'Next',                  artist: 'DAUL, Noair, plan8 & CHANNEL 201' },

  // ── 2021 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2021, rank:  1, total: 10, album: "Don't Die Colors",   artist: 'THAMA' },
  { year: 2021, rank:  2, total: 10, album: 'Precious',           artist: 'sogumm' },
  { year: 2021, rank:  3, total: 10, album: 'Who I Am',           artist: 'SHINDRUM' },
  { year: 2021, rank:  4, total: 10, album: '입수',               artist: '정지아' },
  { year: 2021, rank:  5, total: 10, album: 'MINISERIES',         artist: 'Sumin & Slom' },
  { year: 2021, rank:  6, total: 10, album: '분열',               artist: 'Lil Fish' },
  { year: 2021, rank:  7, total: 10, album: 'A.M.P.',             artist: 'Jerd' },
  { year: 2021, rank:  8, total: 10, album: 'Gaussian',           artist: 'youra' },
  { year: 2021, rank:  9, total: 10, album: 'Hardy',              artist: 'Babylon' },
  { year: 2021, rank: 10, total: 10, album: 'Olive',              artist: 'L-like' },

  // ── 2020 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2020, rank:  1, total: 10, album: '오늘밤 당산나무 아래서', artist: '추다혜차지스' },
  { year: 2020, rank:  2, total: 10, album: 'Serenade',            artist: 'Sunwoo JungA' },
  { year: 2020, rank:  3, total: 10, album: 'PAINGREEN',           artist: 'A.Train' },
  { year: 2020, rank:  4, total: 10, album: 'FREEBODY',            artist: 'Cadejo' },
  { year: 2020, rank:  5, total: 10, album: 'Never Gonna Dance Again: Act 1 & Act 2', artist: 'Taemin' },
  { year: 2020, rank:  6, total: 10, album: 'UNITY II',            artist: 'Samuel Seo' },
  { year: 2020, rank:  7, total: 10, album: 'The Dragon Warrior',  artist: 'Fisherman' },
  { year: 2020, rank:  8, total: 10, album: 'The Sandwich Artist', artist: 'Damye' },
  { year: 2020, rank:  9, total: 10, album: 'Good Boy Syndrome',   artist: 'OLNL' },
  { year: 2020, rank: 10, total: 10, album: '미술관',               artist: '로파이베이비' },

  // ── 2018 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2018, rank:  1, total: 10, album: 'Your Home',           artist: 'Sumin' },
  { year: 2018, rank:  2, total: 10, album: 'Sound Doctrine',      artist: 'Naul' },
  { year: 2018, rank:  3, total: 10, album: '언어',                artist: 'Hippy Was Gipsy' },
  { year: 2018, rank:  4, total: 10, album: 'Metrocity',           artist: 'Horim' },
  { year: 2018, rank:  5, total: 10, album: 'Hello, My Name Is Insecure.', artist: 'A.Train' },
  { year: 2018, rank:  6, total: 10, album: 'UNITY',               artist: 'Samuel Seo' },
  { year: 2018, rank:  7, total: 10, album: '신보경',              artist: 'Boni' },
  { year: 2018, rank:  8, total: 10, album: '봄',                  artist: 'Soma' },
  { year: 2018, rank:  9, total: 10, album: 'Rotate',              artist: '정진우' },
  { year: 2018, rank: 10, total: 10, album: 'Bank Robber',         artist: 'VILLAIN' },

  // ── 2017 – Best 10 ─────────────────────────────────────────────────────────
  { year: 2017, rank:  1, total: 10, album: '나무',                artist: 'Hippy Was Gipsy' },
  { year: 2017, rank:  2, total: 10, album: 'Scene',               artist: 'Rad Museum' },
  { year: 2017, rank:  3, total: 10, album: 'White Light Panorama', artist: 'Rico' },
  { year: 2017, rank:  4, total: 10, album: 'boy.',                artist: 'offonoff' },
  { year: 2017, rank:  5, total: 10, album: '2226',                artist: 'sAewoo in YUNHWAY' },
  { year: 2017, rank:  6, total: 10, album: '7F, the Void',        artist: 'Xin Seha' },
  { year: 2017, rank:  7, total: 10, album: '00',                  artist: 'Zion.T' },
  { year: 2017, rank:  8, total: 10, album: 'Now',                 artist: 'Minje' },
  { year: 2017, rank:  9, total: 10, album: 'for the few',         artist: 'jeebanoff' },
  { year: 2017, rank: 10, total: 10, album: 'Come Over',           artist: 'MADDY' },
];
