export interface ActiveRanking {
  id: string;
  title: string;
  topAlbum: {
    title: string;
    artist: string;
    color: string;
  };
  submissions: number;
  status: 'Active' | 'Growing' | 'Niche';
}

export const activeRankings: ActiveRanking[] = [
  {
    id: 'all-time',
    title: 'Greatest Albums of All Time',
    topAlbum: { title: 'To Pimp a Butterfly', artist: 'Kendrick Lamar', color: 'bg-orange-300' },
    submissions: 12406,
    status: 'Active',
  },
  {
    id: 'hip-hop-all',
    title: 'Greatest Hip-Hop Albums',
    topAlbum: { title: 'Illmatic', artist: 'Nas', color: 'bg-slate-400' },
    submissions: 8932,
    status: 'Active',
  },
  {
    id: 'korea-all',
    title: 'Greatest Korean Albums',
    topAlbum: { title: 'Palette', artist: 'IU', color: 'bg-amber-200' },
    submissions: 5621,
    status: 'Growing',
  },
  {
    id: 'korea-hiphop',
    title: 'Greatest Korean Hip-Hop Albums',
    topAlbum: { title: 'Map of the Soul', artist: 'BTS', color: 'bg-violet-300' },
    submissions: 3240,
    status: 'Growing',
  },
  {
    id: '2010s',
    title: 'Greatest Albums of the 2010s',
    topAlbum: { title: 'To Pimp a Butterfly', artist: 'Kendrick Lamar', color: 'bg-orange-300' },
    submissions: 7891,
    status: 'Active',
  },
  {
    id: 'rnb-all',
    title: 'Greatest R&B Albums',
    topAlbum: { title: "What's Going On", artist: 'Marvin Gaye', color: 'bg-teal-300' },
    submissions: 4532,
    status: 'Growing',
  },
  {
    id: 'japan-all',
    title: 'Greatest Japanese Albums',
    topAlbum: { title: 'Pacific', artist: 'Haruomi Hosono', color: 'bg-cyan-300' },
    submissions: 2890,
    status: 'Niche',
  },
  {
    id: 'rock-all',
    title: 'Greatest Rock Albums',
    topAlbum: { title: 'OK Computer', artist: 'Radiohead', color: 'bg-red-300' },
    submissions: 6789,
    status: 'Active',
  },
];

export const filterCountries = [
  'Global',
  'Korea',
  'Japan',
  'United States',
  'United Kingdom',
  'Philippines',
  'Indonesia',
  'Thailand',
  'Vietnam',
  'China',
];

export const filterGenres = [
  'All Genres',
  'Hip-Hop',
  'Jazz',
  'R&B',
  'Rock',
  'Electronic',
  'Pop',
  'K-pop',
  'Korean Hip-Hop',
  'K-Indie',
  'Indie',
  'Folk',
  'Soul',
  'Metal',
  'Classical',
  'Alternative',
];

export const filterTimes = [
  'All Time',
  '2020s',
  '2010s',
  '2000s',
  '1990s',
  '1980s',
  '1970s',
];

export interface PoolAlbum {
  id: string;
  title: string;
  artist: string;
  year: number;
  color: string;
  avgRating: number;
}

export const albumPool: PoolAlbum[] = [
  { id: 'p1', title: 'To Pimp a Butterfly', artist: 'Kendrick Lamar', year: 2015, color: 'bg-orange-300', avgRating: 4.8 },
  { id: 'p2', title: 'Illmatic', artist: 'Nas', year: 1994, color: 'bg-slate-400', avgRating: 4.9 },
  { id: 'p3', title: 'Madvillainy', artist: 'Madvillain', year: 2004, color: 'bg-amber-300', avgRating: 4.7 },
  { id: 'p4', title: 'The Low End Theory', artist: 'A Tribe Called Quest', year: 1991, color: 'bg-teal-400', avgRating: 4.7 },
  { id: 'p5', title: 'Enter the Wu-Tang (36 Chambers)', artist: 'Wu-Tang Clan', year: 1993, color: 'bg-yellow-500', avgRating: 4.6 },
  { id: 'p6', title: 'My Beautiful Dark Twisted Fantasy', artist: 'Kanye West', year: 2010, color: 'bg-red-400', avgRating: 4.7 },
  { id: 'p7', title: 'Ready to Die', artist: 'The Notorious B.I.G.', year: 1994, color: 'bg-stone-500', avgRating: 4.6 },
  { id: 'p8', title: 'Good Kid, M.A.A.D City', artist: 'Kendrick Lamar', year: 2012, color: 'bg-indigo-400', avgRating: 4.7 },
  { id: 'p9', title: 'Aquemini', artist: 'OutKast', year: 1998, color: 'bg-green-400', avgRating: 4.6 },
  { id: 'p10', title: 'Liquid Swords', artist: 'GZA', year: 1995, color: 'bg-emerald-500', avgRating: 4.5 },
  { id: 'p11', title: 'Late Registration', artist: 'Kanye West', year: 2005, color: 'bg-rose-300', avgRating: 4.5 },
  { id: 'p12', title: 'AmeriKKKa\'s Most Wanted', artist: 'Ice Cube', year: 1990, color: 'bg-black', avgRating: 4.3 },
  { id: 'p13', title: 'The Blueprint', artist: 'Jay-Z', year: 2001, color: 'bg-blue-500', avgRating: 4.5 },
  { id: 'p14', title: 'Endtroducing.....', artist: 'DJ Shadow', year: 1996, color: 'bg-gray-400', avgRating: 4.4 },
  { id: 'p15', title: 'Paid in Full', artist: 'Eric B. & Rakim', year: 1987, color: 'bg-yellow-600', avgRating: 4.4 },
  { id: 'p16', title: '2001', artist: 'Dr. Dre', year: 1999, color: 'bg-slate-300', avgRating: 4.3 },
  { id: 'p17', title: 'Take Care', artist: 'Drake', year: 2011, color: 'bg-purple-400', avgRating: 4.2 },
  { id: 'p18', title: 'Ctrl', artist: 'SZA', year: 2017, color: 'bg-pink-300', avgRating: 4.4 },
  { id: 'p19', title: 'Blonde', artist: 'Frank Ocean', year: 2016, color: 'bg-neutral-300', avgRating: 4.6 },
  { id: 'p20', title: 'Channel Orange', artist: 'Frank Ocean', year: 2012, color: 'bg-orange-400', avgRating: 4.5 },
];

export interface CommunityRankingItem {
  rank: number;
  albumId: string;
  title: string;
  artist: string;
  year: number;
  color: string;
  score: number;
  movement: string;
}

export const communityTop10: CommunityRankingItem[] = [
  { rank: 1, albumId: 'p1', title: 'To Pimp a Butterfly', artist: 'Kendrick Lamar', year: 2015, color: 'bg-orange-300', score: 982, movement: '—' },
  { rank: 2, albumId: 'p2', title: 'Illmatic', artist: 'Nas', year: 1994, color: 'bg-slate-400', score: 964, movement: '↑2' },
  { rank: 3, albumId: 'p6', title: 'My Beautiful Dark Twisted Fantasy', artist: 'Kanye West', year: 2010, color: 'bg-red-400', score: 941, movement: '↓1' },
  { rank: 4, albumId: 'p3', title: 'Madvillainy', artist: 'Madvillain', year: 2004, color: 'bg-amber-300', score: 923, movement: '↑1' },
  { rank: 5, albumId: 'p8', title: 'Good Kid, M.A.A.D City', artist: 'Kendrick Lamar', year: 2012, color: 'bg-indigo-400', score: 912, movement: '—' },
  { rank: 6, albumId: 'p19', title: 'Blonde', artist: 'Frank Ocean', year: 2016, color: 'bg-neutral-300', score: 887, movement: '↑3' },
  { rank: 7, albumId: 'p4', title: 'The Low End Theory', artist: 'A Tribe Called Quest', year: 1991, color: 'bg-teal-400', score: 876, movement: '↓3' },
  { rank: 8, albumId: 'p9', title: 'Aquemini', artist: 'OutKast', year: 1998, color: 'bg-green-400', score: 854, movement: '—' },
  { rank: 9, albumId: 'p5', title: 'Enter the Wu-Tang (36 Chambers)', artist: 'Wu-Tang Clan', year: 1993, color: 'bg-yellow-500', score: 843, movement: '↓1' },
  { rank: 10, albumId: 'p20', title: 'Channel Orange', artist: 'Frank Ocean', year: 2012, color: 'bg-orange-400', score: 821, movement: 'New' },
];
