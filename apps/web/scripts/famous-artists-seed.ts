/**
 * Starter watchlist for the Instagram "out now" pipeline (globally famous artists,
 * any market — NOT the rating catalog's Korean-underground seed list in
 * seed-artists.ts, which this is deliberately separate from).
 *
 * Data-only module, no side effects. Deliberately a rough, broad starting point —
 * the user filters posts by hand downstream, so err toward including a name here
 * rather than excluding it. Edit this list directly to add/remove artists; run
 * resolve-famous-artists.ts afterward to pick up new entries.
 */

export interface FamousArtistSeed { name: string; country: string | null }

export const FAMOUS_ARTISTS_SEED: FamousArtistSeed[] = [
  // ── US / UK pop & hip-hop ──────────────────────────────────────────────────
  ...['Taylor Swift', 'Beyoncé', 'Drake', 'Kendrick Lamar', 'Ariana Grande', 'Billie Eilish',
      'The Weeknd', 'Kanye West', 'Rihanna', 'Bad Bunny', 'Travis Scott', 'SZA', 'Olivia Rodrigo',
      'Doja Cat', 'Post Malone', 'Ed Sheeran', 'Adele', 'Dua Lipa', 'Harry Styles', 'Sabrina Carpenter',
      'Charli XCX', 'Lady Gaga', 'Justin Bieber', 'Chris Brown', 'Cardi B', 'Nicki Minaj', 'J. Cole',
      'Future', 'Lil Wayne', 'Eminem', 'Coldplay', 'Sam Smith', 'Miley Cyrus', 'Katy Perry',
     ].map((name): FamousArtistSeed => ({ name, country: null })),

  // ── K-pop (global-famous tier — distinct purpose from the rating-catalog seed) ──
  ...['BTS', 'BLACKPINK', 'NewJeans', 'aespa', 'Stray Kids', 'SEVENTEEN', 'TXT', 'ENHYPEN',
      'IVE', 'LE SSERAFIM', 'TWICE', 'EXO', 'IU', 'G-Dragon', 'Jungkook', 'Jimin', 'RM',
     ].map((name): FamousArtistSeed => ({ name, country: 'KR' })),

  // ── Latin / reggaeton ──────────────────────────────────────────────────────
  ...['Karol G', 'Feid', 'Peso Pluma', 'Rauw Alejandro', 'Shakira', 'J Balvin',
     ].map((name): FamousArtistSeed => ({ name, country: null })),

  // ── Afrobeats ──────────────────────────────────────────────────────────────
  ...['Burna Boy', 'Wizkid', 'Davido', 'Tems', 'Rema',
     ].map((name): FamousArtistSeed => ({ name, country: null })),

  // ── Rock / alternative / other global ─────────────────────────────────────
  ...['Imagine Dragons', 'Twenty One Pilots', 'Arctic Monkeys', 'Foo Fighters', 'Metallica',
      'Linkin Park', 'Green Day', 'Radiohead', 'Tame Impala', 'Billie Joe Armstrong',
     ].map((name): FamousArtistSeed => ({ name, country: null })),

  // ── Japanese mainstream ────────────────────────────────────────────────────
  ...['YOASOBI', 'Hikaru Utada', 'Kenshi Yonezu', 'Ado', 'Official HIGE DANdism',
     ].map((name): FamousArtistSeed => ({ name, country: 'JP' })),
];
