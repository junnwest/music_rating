/**
 * Curated seed artist list (region-tagged). Data-only module — no side effects —
 * so both the iTunes gap-fill script and the MB coverage gate / pipeline can import it.
 *
 * `region` is a soft hint for MB artist resolution (prefer candidates from this
 * country/area when scores tie); null = no strong hint.
 */

export interface SeedArtist { name: string; region: string | null }

export const SEED: SeedArtist[] = [
  // ── Korean: K-pop 4th gen ───────────────────────────────────────────────────
  ...['aespa','NewJeans','IVE','LE SSERAFIM','NMIXX','Kep1er','ILLIT','ENHYPEN','TXT',
      'Stray Kids','ATEEZ','MONSTA X','The Boyz','ONEUS','SEVENTEEN','NCT 127','NCT Dream','WayV',
  // ── K-pop 3rd gen ──
      'BTS','BLACKPINK','EXO','Red Velvet','TWICE','MAMAMOO','ITZY','(G)I-DLE','OH MY GIRL',
      'ASTRO','PENTAGON','Dreamcatcher','Weki Meki',
  // ── K-pop 2nd gen ──
      'Girls Generation','SHINee','Super Junior','BIGBANG','2NE1','INFINITE','B2ST','f(x)',
      'Miss A','T-ara','After School','SISTAR','A Pink','BEAST','Block B','Teen Top','VIXX',
  // ── K-pop 1st gen / classic ──
      'H.O.T','god','Shinhwa','S.E.S.','Fin.K.L','Baby V.O.X','Seo Taiji and Boys',
  // ── Korean solo pop / R&B / ballad ──
      'IU','Taeyeon','Taeyang','G-Dragon','CL','Lee Hi','Heize','Suzy','Baekhyun','Chanyeol','Sehun','Kai',
  // ── Korean R&B / Soul ──
      'Dean','Crush','Zion.T','GRAY','Colde','offonoff','pH-1','MISO','SOLE','BIBI','Primary','Loco',
      'Simon Dominic','Hoody','Sik-K','Woo','PENOMECO',
  // ── Korean hip-hop ──
      'Epik High','Dynamic Duo','Dok2','The Quiett','Beenzino','Lil Boi','Jay Park','Swings',
      'Hash Swan','Changmo','Nafla',
  // ── Korean indie / alternative ──
      'Hyukoh','Jannabi','Nell','The Rose','DAY6','N.Flying','Silica Gel','Sunwoo Jung-a','Leenalchi',
      'Adoy','Cifika','Glen Check','Se So Neon','LUCY','Sultan of the Disco','Guckkasten',
  // ── Korean older artists ──
      'Kim Kwang Seok','Lee Juck','Shin Hae Chul','Lee Seung Hwan','Kim Gun Mo','Cho Yong Pil',
      'Na Hoon A','Lim Chang Jung','Park Hyo Shin','Song Chang Shik','Lee Moon Sae',
     ].map((name): SeedArtist => ({ name, region: 'KR' })),

  // ── Japanese ──
  ...['YOASOBI','Hikaru Utada','Kenshi Yonezu','Aimyon','Official HIGE DANdism','King Gnu','Fujii Kaze',
      'Mrs. GREEN APPLE','Vaundy','Eve','Yorushika','Hoshino Gen','RADWIMPS','Bump of Chicken','Spitz',
      'Shiina Ringo','Ado','imase',
     ].map((name): SeedArtist => ({ name, region: 'JP' })),

  // ── Western (no single strong region hint) ──
  ...['Taylor Swift','Adele','Beyoncé','Dua Lipa','Ariana Grande','Ed Sheeran','Harry Styles',
      'Olivia Rodrigo','Billie Eilish','Sabrina Carpenter','Chappell Roan','Charli XCX','P!nk',
      'Katy Perry','Lady Gaga','Miley Cyrus','Selena Gomez','Post Malone','The Weeknd',
      'Drake','Kendrick Lamar','J. Cole','Travis Scott','Tyler, the Creator','SZA','Frank Ocean',
      'Childish Gambino','21 Savage','Lil Baby','Gunna','Future','Metro Boomin','Nicki Minaj','Cardi B',
      'Megan Thee Stallion','Doja Cat','Roddy Ricch',
      'Radiohead','Arctic Monkeys','Tame Impala','Beach House','Bon Iver','The National','Phoebe Bridgers',
      'Japanese Breakfast','boygenius','Vampire Weekend','Fleet Foxes','Sufjan Stevens','Big Thief',
      'Mitski','Soccer Mommy','Snail Mail','Lucy Dacus',
      'Four Tet','Fred again..','Floating Points','Jamie xx','Daft Punk','Justice','Air','Moderat',
      'Jon Hopkins','Aphex Twin','Boards of Canada','James Blake',
      'The Beatles','Prince','Björk','David Bowie','Bob Dylan','Bruce Springsteen','Neil Young',
      'Miles Davis','John Coltrane','Bill Evans','Charlie Parker','Dave Brubeck','Thelonious Monk',
      'Herbie Hancock','Wayne Shorter','Art Blakey','Wes Montgomery','Chet Baker',
     ].map((name): SeedArtist => ({ name, region: null })),

  // ── Latin ──
  ...['Bad Bunny','J Balvin','Ozuna','Rauw Alejandro','Karol G','ROSALÍA','Maluma','Anuel AA',
      'Jhay Cortez','Myke Towers','Sech','Farruko','Peso Pluma','Fuerza Regida','Natanael Cano',
      'Nicki Nicole','Bizarrap','Anitta',
     ].map((name): SeedArtist => ({ name, region: null })),

  // ── African ──
  ...['Burna Boy','Wizkid','Davido','Asake','Rema','Black Coffee','Fireboy DML','CKay','Omah Lay',
      'Ayra Starr','Tems','Kizz Daniel','Olamide','Yemi Alade','Tiwa Savage',
     ].map((name): SeedArtist => ({ name, region: null })),

  // ── French ──
  ...['Stromae','Aya Nakamura','PNL','Angèle','Damso','Ninho','Nekfeu','Orelsan','SCH','Hamza','Jul',
     ].map((name): SeedArtist => ({ name, region: 'FR' })),

  // ── Indian ──
  ...['Arijit Singh','A.R. Rahman','Shreya Ghoshal','Atif Aslam','Jubin Nautiyal','Diljit Dosanjh','Neha Kakkar',
     ].map((name): SeedArtist => ({ name, region: 'IN' })),
];

// De-duplicated names-only view (Radiohead appears once here).
export const SEED_ARTISTS: string[] = [...new Set(SEED.map(s => s.name))];
