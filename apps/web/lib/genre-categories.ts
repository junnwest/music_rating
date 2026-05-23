/**
 * Catalog of recommendation categories surfaced on the homepage.
 *
 * The full list (~30 categories) lives here. The runtime resolver in
 * lib/category-resolver.ts picks a subset (currently 10) for each user based
 * on their auth state, onboarding preferences, and rating history.
 *
 * Fields:
 *   key             URL-safe slug used by /genre/[key] and as a cache key
 *   name            Display title on the row header
 *   description     Subtitle copy under the row title
 *   genreFilters    Substrings matched against releases.genres (case-insensitive)
 *   spotifyQuery    Legacy: kept for the admin seed-curated route only
 *   onboardingGenre Optional: matches a value from the onboarding genre picker
 *                   (apps/web/app/(main)/onboarding/page.tsx GENRES array).
 *                   Used by the resolver to upweight categories the user picked.
 *   origin          'korean' | 'japanese' | 'western' | 'global' — used by the
 *                   resolver to ensure diversity (don't show all Korean rows)
 *   isDefault       Show in the default mix for users with no preferences
 *   sortOrder       Lower = appears earlier when tied on score
 */
export const GENRE_CATEGORIES = [
  // ── Korean ────────────────────────────────────────────────────────────────
  {
    key: 'k-pop',
    name: 'K-Pop Picks',
    description: 'Popular K-Pop albums making waves',
    genreFilters: ['k-pop', 'korean pop'],
    spotifyQuery: 'k-pop',
    onboardingGenre: 'K-Pop',
    origin: 'korean',
    isDefault: true,
    sortOrder: 10,
  },
  {
    key: 'korean-indie',
    name: 'Korean Indie & Ballad',
    description: 'Thoughtful indie and ballad albums from Korea',
    genreFilters: ['k-indie', 'korean indie', 'korean folk', 'korean ballad'],
    spotifyQuery: 'korean indie',
    onboardingGenre: 'K-Indie',
    origin: 'korean',
    isDefault: true,
    sortOrder: 20,
  },
  {
    key: 'korean-rb',
    name: 'K-R&B Essentials',
    description: 'Smooth and soulful Korean R&B',
    genreFilters: ['k-r&b', 'korean r&b'],
    spotifyQuery: 'korean r&b',
    onboardingGenre: 'K-R&B',
    origin: 'korean',
    isDefault: false,
    sortOrder: 30,
  },
  {
    key: 'k-rap',
    name: 'Korean Hip-Hop',
    description: 'The Korean rap scene',
    genreFilters: ['k-rap', 'korean rap', 'korean hip hop'],
    spotifyQuery: 'k-rap',
    onboardingGenre: 'K-Rap',
    origin: 'korean',
    isDefault: false,
    sortOrder: 40,
  },
  {
    key: 'korean-ballad',
    name: 'Korean Ballads',
    description: 'Heartfelt vocal ballads from Korea',
    genreFilters: ['korean ballad', 'k-ballad'],
    spotifyQuery: 'korean ballad',
    onboardingGenre: 'Korean Ballad',
    origin: 'korean',
    isDefault: false,
    sortOrder: 50,
  },
  {
    key: 'korean-folk',
    name: 'Korean Folk',
    description: 'Acoustic and folk music from Korea',
    genreFilters: ['korean folk', 'k-folk'],
    spotifyQuery: 'korean folk',
    onboardingGenre: 'Korean Folk',
    origin: 'korean',
    isDefault: false,
    sortOrder: 60,
  },

  // ── Japanese ──────────────────────────────────────────────────────────────
  {
    key: 'j-pop',
    name: 'J-Pop',
    description: 'Modern J-Pop favorites',
    genreFilters: ['j-pop', 'japanese pop'],
    spotifyQuery: 'j-pop',
    onboardingGenre: 'J-Pop',
    origin: 'japanese',
    isDefault: false,
    sortOrder: 100,
  },
  {
    key: 'j-rock',
    name: 'J-Rock',
    description: 'Japanese rock and alternative',
    genreFilters: ['j-rock', 'japanese rock', 'visual kei'],
    spotifyQuery: 'j-rock',
    onboardingGenre: 'J-Rock',
    origin: 'japanese',
    isDefault: false,
    sortOrder: 110,
  },
  {
    key: 'city-pop',
    name: 'City Pop',
    description: '70s/80s Japanese city pop',
    genreFilters: ['city pop'],
    spotifyQuery: 'city pop',
    onboardingGenre: 'City Pop',
    origin: 'japanese',
    isDefault: false,
    sortOrder: 120,
  },

  // ── Indie / Alt rock ──────────────────────────────────────────────────────
  {
    key: 'indie-rock',
    name: 'Indie Rock',
    description: 'Essential indie rock albums',
    genreFilters: ['indie rock'],
    spotifyQuery: 'indie rock',
    onboardingGenre: 'Indie Rock',
    origin: 'global',
    isDefault: true,
    sortOrder: 200,
  },
  {
    key: 'indie-pop',
    name: 'Indie Pop',
    description: 'Indie pop favorites',
    genreFilters: ['indie pop', 'bedroom pop'],
    spotifyQuery: 'indie pop',
    onboardingGenre: undefined,
    origin: 'global',
    isDefault: false,
    sortOrder: 210,
  },
  {
    key: 'alternative',
    name: 'Alternative',
    description: 'Alternative rock from across decades',
    genreFilters: ['alternative rock', 'alt-rock', 'alternative'],
    spotifyQuery: 'alternative rock',
    onboardingGenre: 'Alternative',
    origin: 'western',
    isDefault: true,
    sortOrder: 220,
  },
  {
    key: 'post-rock',
    name: 'Post-Rock',
    description: 'Atmospheric and instrumental post-rock',
    genreFilters: ['post-rock'],
    spotifyQuery: 'post-rock',
    onboardingGenre: 'Post-Rock',
    origin: 'global',
    isDefault: false,
    sortOrder: 230,
  },
  {
    key: 'shoegaze',
    name: 'Shoegaze',
    description: 'Wall-of-sound shoegaze and dream pop',
    genreFilters: ['shoegaze', 'dream pop'],
    spotifyQuery: 'shoegaze',
    onboardingGenre: 'Shoegaze',
    origin: 'global',
    isDefault: false,
    sortOrder: 240,
  },
  {
    key: 'math-rock',
    name: 'Math Rock',
    description: 'Intricate math rock and prog',
    genreFilters: ['math rock', 'progressive rock'],
    spotifyQuery: 'math rock',
    onboardingGenre: undefined,
    origin: 'global',
    isDefault: false,
    sortOrder: 250,
  },

  // ── Hip-Hop / Rap ─────────────────────────────────────────────────────────
  {
    key: 'hip-hop',
    name: 'Hip-Hop & Rap',
    description: 'Essential hip-hop and rap records',
    genreFilters: ['hip-hop', 'hip hop', 'rap', 'jazz rap'],
    spotifyQuery: 'hip-hop album',
    onboardingGenre: 'Hip-Hop',
    origin: 'western',
    isDefault: true,
    sortOrder: 300,
  },

  // ── R&B / Soul / Funk ─────────────────────────────────────────────────────
  {
    key: 'rb-soul',
    name: 'R&B & Soul',
    description: 'R&B, soul, and neo-soul classics',
    genreFilters: ['r&b', 'soul', 'neo-soul'],
    spotifyQuery: 'r&b soul',
    onboardingGenre: 'R&B & Soul',
    origin: 'western',
    isDefault: true,
    sortOrder: 310,
  },
  {
    key: 'funk',
    name: 'Funk',
    description: 'Funk, disco, and groove',
    genreFilters: ['funk', 'disco'],
    spotifyQuery: 'funk',
    onboardingGenre: undefined,
    origin: 'western',
    isDefault: false,
    sortOrder: 320,
  },

  // ── Jazz / Classical / Acoustic ───────────────────────────────────────────
  {
    key: 'jazz',
    name: 'Jazz',
    description: 'Jazz classics and modern jazz',
    genreFilters: ['jazz', 'jazz fusion'],
    spotifyQuery: 'jazz',
    onboardingGenre: 'Jazz',
    origin: 'global',
    isDefault: true,
    sortOrder: 400,
  },
  {
    key: 'folk',
    name: 'Folk & Singer-Songwriter',
    description: 'Acoustic folk and singer-songwriter records',
    genreFilters: ['folk', 'singer-songwriter', 'americana'],
    spotifyQuery: 'folk',
    onboardingGenre: 'Folk',
    origin: 'global',
    isDefault: false,
    sortOrder: 410,
  },
  {
    key: 'classical',
    name: 'Classical',
    description: 'Classical and orchestral music',
    genreFilters: ['classical'],
    spotifyQuery: 'classical',
    onboardingGenre: 'Classical',
    origin: 'global',
    isDefault: false,
    sortOrder: 420,
  },

  // ── Rock canon ────────────────────────────────────────────────────────────
  {
    key: 'classic-rock',
    name: 'Classic Rock',
    description: 'The rock canon from the 60s through the 80s',
    genreFilters: ['classic rock', 'hard rock'],
    spotifyQuery: 'classic rock',
    onboardingGenre: undefined,
    origin: 'western',
    isDefault: true,
    sortOrder: 500,
  },
  {
    key: 'metal',
    name: 'Metal',
    description: 'Heavy metal, progressive metal, and beyond',
    genreFilters: ['metal', 'heavy metal'],
    spotifyQuery: 'metal',
    onboardingGenre: undefined,
    origin: 'western',
    isDefault: false,
    sortOrder: 510,
  },
  {
    key: 'punk',
    name: 'Punk',
    description: 'Punk rock and post-punk',
    genreFilters: ['punk', 'post-punk'],
    spotifyQuery: 'punk',
    onboardingGenre: undefined,
    origin: 'western',
    isDefault: false,
    sortOrder: 520,
  },

  // ── Electronic ────────────────────────────────────────────────────────────
  {
    key: 'electronic',
    name: 'Electronic',
    description: 'House, techno, and electronic music',
    genreFilters: ['electronic', 'house', 'techno'],
    spotifyQuery: 'electronic',
    onboardingGenre: 'Electronic',
    origin: 'global',
    isDefault: true,
    sortOrder: 600,
  },
  {
    key: 'ambient',
    name: 'Ambient & Lo-fi',
    description: 'Ambient music and lo-fi beats',
    genreFilters: ['ambient', 'lo-fi'],
    spotifyQuery: 'ambient',
    onboardingGenre: 'Ambient',
    origin: 'global',
    isDefault: false,
    sortOrder: 610,
  },

  // ── Pop ───────────────────────────────────────────────────────────────────
  {
    key: 'pop',
    name: 'Pop',
    description: 'Contemporary and classic pop',
    genreFilters: ['pop'],
    spotifyQuery: 'pop',
    onboardingGenre: 'Pop',
    origin: 'global',
    isDefault: false,
    sortOrder: 700,
  },

  // ── World / Country ───────────────────────────────────────────────────────
  {
    key: 'country',
    name: 'Country',
    description: 'Country, Americana, and roots music',
    genreFilters: ['country', 'americana'],
    spotifyQuery: 'country',
    onboardingGenre: undefined,
    origin: 'western',
    isDefault: false,
    sortOrder: 800,
  },
  {
    key: 'bossa-nova',
    name: 'Bossa Nova',
    description: 'Brazilian bossa nova classics',
    genreFilters: ['bossa nova'],
    spotifyQuery: 'bossa nova',
    onboardingGenre: undefined,
    origin: 'global',
    isDefault: false,
    sortOrder: 810,
  },
  {
    key: 'afrobeat',
    name: 'Afrobeat',
    description: 'Afrobeat and African popular music',
    genreFilters: ['afrobeat'],
    spotifyQuery: 'afrobeat',
    onboardingGenre: undefined,
    origin: 'global',
    isDefault: false,
    sortOrder: 820,
  },
] as const;

export type GenreCategory = typeof GENRE_CATEGORIES[number];
export type GenreCategoryKey = GenreCategory['key'];
