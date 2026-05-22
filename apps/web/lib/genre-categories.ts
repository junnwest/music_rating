export const GENRE_CATEGORIES = [
  {
    key: 'k-pop',
    name: 'K-Pop Picks',
    description: 'Popular K-Pop albums making waves',
    genreFilters: ['k-pop', 'korean pop'],
    spotifyQuery: 'k-pop',
  },
  {
    key: 'korean-indie',
    name: 'Korean Indie & Ballad',
    description: 'Thoughtful indie and ballad albums from Korea',
    genreFilters: ['k-indie', 'korean indie', 'korean folk', 'korean ballad'],
    spotifyQuery: 'korean indie',
  },
  {
    key: 'korean-rb',
    name: 'K-R&B Essentials',
    description: 'Smooth and soulful Korean R&B',
    genreFilters: ['k-r&b', 'korean r&b'],
    spotifyQuery: 'korean r&b',
  },
  {
    key: 'indie-global',
    name: 'Indie Essentials',
    description: 'Essential indie albums from around the world',
    genreFilters: ['indie rock', 'indie pop', 'dream pop', 'shoegaze', 'bedroom pop'],
    spotifyQuery: 'indie album',
  },
  {
    key: 'hip-hop',
    name: 'Hip-Hop & Rap',
    description: 'Essential hip-hop and rap records',
    genreFilters: ['hip-hop', 'hip hop', 'rap', 'jazz rap', 'k-rap'],
    spotifyQuery: 'hip-hop album',
  },
] as const;

export type GenreCategoryKey = typeof GENRE_CATEGORIES[number]['key'];
