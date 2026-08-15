/**
 * Dummy dataset for the offline mock backend (scripts/mock/server.ts).
 * Rows are stored pre-embedded in the exact shapes the web app's selects
 * expect (FEED_SELECT, RG_EMBED_NATIVE, notification aliases, etc.), so the
 * server doesn't need to implement PostgREST resource embedding.
 */

// ── helpers ─────────────────────────────────────────────────────────────────

const uid = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;

function cover(hex: string, label: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>` +
    `<rect width='300' height='300' fill='${hex}'/>` +
    `<text x='150' y='168' font-family='sans-serif' font-size='52' font-weight='bold' fill='rgba(255,255,255,0.85)' text-anchor='middle'>${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const daysAgo = (d: number, h = 0) =>
  new Date(Date.now() - d * 86400_000 - h * 3600_000).toISOString();

// ── auth users ──────────────────────────────────────────────────────────────

export const AUTH_USERS = {
  demo: {
    id: uid(1),
    email: 'demo@mock.local',
    user_metadata: { full_name: 'Demo Listener' },
  },
  // Signing in with the Google button maps to this fresh account (no profile
  // row) so the onboarding flow can be tested from scratch.
  newbie: {
    id: uid(9),
    email: 'newbie@mock.local',
    user_metadata: { full_name: 'New Person' },
  },
};

// ── profiles ────────────────────────────────────────────────────────────────

interface P {
  id: string;
  username: string;
  display_name: string;
  bio?: string;
  is_bot?: boolean;
}

const people: P[] = [
  { id: uid(1), username: 'demo', display_name: 'Demo Listener', bio: 'Testing in mock mode.' },
  { id: uid(2), username: 'mirae', display_name: '미래', bio: 'k-indie forever' },
  { id: uid(3), username: 'vinylwolf', display_name: 'Wolf', bio: 'LPs > everything' },
  { id: uid(4), username: 'sunbeam', display_name: 'Sunny' },
  { id: uid(5), username: 'crateking', display_name: 'Crate King', bio: 'digging daily' },
  { id: uid(6), username: 'botfm', display_name: 'Radio Bot', is_bot: true },
];

const profiles = people.map((p) => ({
  id: p.id,
  username: p.username,
  display_name: p.display_name,
  bio: p.bio ?? null,
  avatar_url: null,
  manual_rating_step: 0.5,
  notifications_last_seen_at: null,
  notify_likes: true,
  notify_replies: true,
  notify_followers: true,
  notify_rankings: true,
  notify_capsule: true,
  profile_visibility: 'Public',
  catalog_visibility: null,
  library_visibility: null,
  stats_visibility: null,
  is_bot: p.is_bot ?? false,
}));

const profileEmbed = (id: string) => {
  const p = profiles.find((x) => x.id === id)!;
  return { id: p.id, username: p.username, display_name: p.display_name, avatar_url: null };
};

// ── artists ─────────────────────────────────────────────────────────────────

interface A {
  id: string;
  name: string;
  name_native: string | null;
  country: string | null;
  hex: string;
}

const artistDefs: A[] = [
  { id: uid(101), name: 'NewJeans', name_native: '뉴진스', country: 'KR', hex: '#7fb3d5' },
  { id: uid(102), name: 'IU', name_native: '아이유', country: 'KR', hex: '#b57fd5' },
  { id: uid(103), name: 'Radiohead', name_native: null, country: 'GB', hex: '#5d6d7e' },
  { id: uid(104), name: 'Kendrick Lamar', name_native: null, country: 'US', hex: '#b9770e' },
  { id: uid(105), name: 'Silica Gel', name_native: '실리카겔', country: 'KR', hex: '#48c9b0' },
  { id: uid(106), name: 'Frank Ocean', name_native: null, country: 'US', hex: '#ec7063' },
  { id: uid(107), name: 'Fiona Apple', name_native: null, country: 'US', hex: '#58d68d' },
  { id: uid(108), name: 'Tyler, the Creator', name_native: null, country: 'US', hex: '#f4d03f' },
];

const artists = artistDefs.map((a) => ({
  id: a.id,
  name: a.name,
  name_native: a.name_native,
  name_phonetic_ko: null,
  native_language: a.name_native ? 'ko' : null,
  country: a.country,
  disambiguation: null,
  cover_url: cover(a.hex, a.name.slice(0, 2).toUpperCase()),
}));

// ── release groups ──────────────────────────────────────────────────────────

interface RG {
  id: string;
  artist: A;
  title: string;
  native_title?: string;
  type: string;
  date: string;
  genres: string[];
  prestige: number;
  hex: string;
}

const rgDefs: RG[] = [
  { id: uid(201), artist: artistDefs[0], title: 'Get Up', type: 'ep', date: '2023-07-21', genres: ['k-pop', 'dance-pop'], prestige: 0.71, hex: '#7fb3d5' },
  { id: uid(202), artist: artistDefs[1], title: 'LILAC', native_title: '라일락', type: 'album', date: '2021-03-25', genres: ['k-pop', 'r&b'], prestige: 0.78, hex: '#b57fd5' },
  { id: uid(203), artist: artistDefs[2], title: 'OK Computer', type: 'album', date: '1997-05-21', genres: ['alternative rock', 'art rock'], prestige: 0.97, hex: '#5d6d7e' },
  { id: uid(204), artist: artistDefs[3], title: 'To Pimp a Butterfly', type: 'album', date: '2015-03-15', genres: ['hip hop', 'jazz rap'], prestige: 0.96, hex: '#b9770e' },
  { id: uid(205), artist: artistDefs[4], title: 'POWER ANDRE 99', type: 'album', date: '2023-12-06', genres: ['k-indie', 'psychedelic rock'], prestige: 0.74, hex: '#48c9b0' },
  { id: uid(206), artist: artistDefs[5], title: 'Blonde', type: 'album', date: '2016-08-20', genres: ['r&b', 'avant-soul'], prestige: 0.95, hex: '#ec7063' },
  { id: uid(207), artist: artistDefs[6], title: 'Fetch the Bolt Cutters', type: 'album', date: '2020-04-17', genres: ['art pop', 'singer-songwriter'], prestige: 0.9, hex: '#58d68d' },
  { id: uid(208), artist: artistDefs[7], title: 'IGOR', type: 'album', date: '2019-05-17', genres: ['hip hop', 'neo-soul'], prestige: 0.88, hex: '#f4d03f' },
  { id: uid(209), artist: artistDefs[2], title: 'In Rainbows', type: 'album', date: '2007-10-10', genres: ['alternative rock'], prestige: 0.94, hex: '#af601a' },
  { id: uid(210), artist: artistDefs[1], title: 'Love poem', native_title: '러브 포엠', type: 'ep', date: '2019-11-18', genres: ['k-pop', 'ballad'], prestige: 0.69, hex: '#d98cb3' },
  { id: uid(211), artist: artistDefs[0], title: 'OMG', type: 'single', date: '2023-01-02', genres: ['k-pop'], prestige: 0.6, hex: '#85c1e9' },
  { id: uid(212), artist: artistDefs[3], title: 'DAMN.', type: 'album', date: '2017-04-14', genres: ['hip hop'], prestige: 0.92, hex: '#922b21' },
];

const release_groups = rgDefs.map((r) => ({
  id: r.id,
  primary_artist_id: r.artist.id,
  title: r.title,
  artist_display: r.artist.name,
  release_group_type: r.type,
  first_release_date: r.date,
  cover_url: cover(r.hex, r.title.slice(0, 2).toUpperCase()),
  genres: r.genres,
  native_title: r.native_title ?? null,
  prestige_score: r.prestige,
  // embed used by album page (artists!release_groups_primary_artist_id_fkey)
  artists: { name_native: r.artist.name_native },
}));

const rgEmbed = (rgId: string) => {
  const rg = release_groups.find((x) => x.id === rgId)!;
  return {
    id: rg.id,
    title: rg.title,
    artist_display: rg.artist_display,
    cover_url: rg.cover_url,
    release_group_type: rg.release_group_type,
    first_release_date: rg.first_release_date,
    native_title: rg.native_title,
    artists: rg.artists,
  };
};

// ── recordings / releases / release_tracks (tracklists for two albums) ─────

interface TrackDef {
  rg: string;
  titles: string[];
}

const trackDefs: TrackDef[] = [
  { rg: uid(201), titles: ['New Jeans', 'Super Shy', 'ETA', 'Cool With You', 'Get Up', 'ASAP'] },
  { rg: uid(203), titles: ['Airbag', 'Paranoid Android', 'Exit Music (For a Film)', 'Karma Police', 'No Surprises'] },
];

const recordings: any[] = [];
const releases: any[] = [];
const release_tracks: any[] = [];

let recSeq = 300;
for (const td of trackDefs) {
  const rg = release_groups.find((x) => x.id === td.rg)!;
  const releaseId = uid(recSeq++);
  releases.push({
    id: releaseId,
    release_group_id: rg.id,
    is_canonical: true,
    title: rg.title,
    release_groups: rgEmbed(rg.id),
  });
  td.titles.forEach((title, i) => {
    const recId = uid(recSeq++);
    recordings.push({
      id: recId,
      primary_artist_id: rg.primary_artist_id,
      artist_display: rg.artist_display,
      title,
      isrc: null,
      duration_ms: 150_000 + i * 17_000,
    });
    release_tracks.push({
      release_id: releaseId,
      recording_id: recId,
      position: i + 1,
      disc_number: 1,
      recordings: { id: recId, title, duration_ms: 150_000 + i * 17_000, artist_display: rg.artist_display },
      releases: { is_canonical: true, release_groups: { id: rg.id, title: rg.title, artist_display: rg.artist_display, cover_url: rg.cover_url } },
    });
  });
}

// ── ratings (the explore feed pool) ─────────────────────────────────────────

// [user index into people, rg index into rgDefs, score, review?, daysAgo]
const ratingDefs: [number, number, number, string | null, number][] = [
  [1, 0, 4.5, 'ETA alone carries this. Song of the summer.', 0],
  [2, 2, 5.0, 'Still the blueprint. Nothing has aged better.', 0],
  [3, 3, 5.0, null, 1],
  [4, 5, 4.5, 'For the summer nights.', 1],
  [1, 4, 4.0, '기타 톤이 미쳤다', 2],
  [2, 8, 4.5, null, 2],
  [3, 1, 4.0, 'Celebrity is a perfect pop song.', 3],
  [4, 7, 4.0, null, 3],
  [5, 2, 4.5, null, 4],
  [1, 6, 3.5, 'Respect it more than I love it.', 4],
  [2, 11, 4.0, null, 5],
  [3, 5, 5.0, 'White Ferrari at 2am. That is the review.', 5],
  [4, 0, 3.5, null, 6],
  [5, 3, 4.5, 'u', 6],
  [1, 9, 3.0, null, 7],
  [2, 4, 4.5, '실리카겔은 라이브가 진짜다', 7],
  [3, 7, 4.5, null, 8],
  [4, 2, 4.0, null, 9],
  [5, 8, 4.0, 'Weird Fishes forever.', 9],
  [1, 3, 4.5, null, 10],
  [2, 6, 4.0, null, 11],
  [3, 11, 3.5, null, 12],
  [4, 10, 3.0, null, 13],
  [5, 0, 4.0, null, 14],
];

const ratings = ratingDefs.map(([pi, ri, score, review, d], i) => {
  const user = people[pi];
  const rg = rgDefs[ri];
  return {
    id: uid(400 + i),
    user_id: user.id,
    release_group_id: rg.id,
    score,
    review_text: review,
    created_at: daysAgo(d, i % 5),
    updated_at: null,
    release_groups: rgEmbed(rg.id),
    profiles: { username: user.username, display_name: user.display_name, avatar_url: null },
  };
});

// ── social: likes, comments, follows, saves, mixes, notifications ──────────

const rating_likes = [
  { user_id: uid(2), rating_id: uid(400) },
  { user_id: uid(3), rating_id: uid(400) },
  { user_id: uid(1), rating_id: uid(401) },
  { user_id: uid(4), rating_id: uid(401) },
  { user_id: uid(5), rating_id: uid(401) },
  { user_id: uid(1), rating_id: uid(411) },
  { user_id: uid(2), rating_id: uid(402) },
];

const rating_comments = [
  {
    id: uid(501),
    user_id: uid(3),
    rating_id: uid(400),
    content: 'Cool With You is the real highlight though',
    created_at: daysAgo(0, 1),
    profiles: profileEmbed(uid(3)),
  },
  {
    id: uid(502),
    user_id: uid(1),
    rating_id: uid(401),
    content: 'Which pressing do you have?',
    created_at: daysAgo(0, 2),
    profiles: profileEmbed(uid(1)),
  },
];

const follows = [
  { follower_id: uid(1), following_id: uid(2) },
  { follower_id: uid(1), following_id: uid(3) },
  { follower_id: uid(2), following_id: uid(1) },
  { follower_id: uid(4), following_id: uid(1) },
  { follower_id: uid(5), following_id: uid(2) },
];

const saved_releases = [
  { user_id: uid(1), release_group_id: uid(206), release_groups: rgEmbed(uid(206)) },
  { user_id: uid(1), release_group_id: uid(207), release_groups: rgEmbed(uid(207)) },
];

const mixes = [
  {
    id: uid(601),
    user_id: uid(1),
    name: 'Favorites',
    is_public: false,
    is_default: true,
    created_at: daysAgo(30),
    description: null,
    profiles: profileEmbed(uid(1)),
  },
  {
    id: uid(602),
    user_id: uid(1),
    name: 'Rainy Day',
    is_public: true,
    is_default: false,
    created_at: daysAgo(12),
    description: 'for grey afternoons',
    profiles: profileEmbed(uid(1)),
  },
  {
    id: uid(603),
    user_id: uid(2),
    name: '새벽 감성',
    is_public: true,
    is_default: false,
    created_at: daysAgo(8),
    description: null,
    profiles: profileEmbed(uid(2)),
  },
];

const mix_items = [
  { id: uid(611), mix_id: uid(601), release_group_id: uid(203), created_at: daysAgo(29), release_groups: rgEmbed(uid(203)) },
  { id: uid(612), mix_id: uid(601), release_group_id: uid(206), created_at: daysAgo(20), release_groups: rgEmbed(uid(206)) },
  { id: uid(613), mix_id: uid(602), release_group_id: uid(207), created_at: daysAgo(11), release_groups: rgEmbed(uid(207)) },
  { id: uid(614), mix_id: uid(602), release_group_id: uid(209), created_at: daysAgo(10), release_groups: rgEmbed(uid(209)) },
  { id: uid(615), mix_id: uid(603), release_group_id: uid(202), created_at: daysAgo(7), release_groups: rgEmbed(uid(202)) },
];

// Notification rows carry the `actor:` / `rating:` alias keys the
// notifications page selects.
const notifications = [
  {
    id: uid(701),
    user_id: uid(1),
    actor_id: uid(2),
    type: 'like',
    rating_id: uid(400),
    created_at: daysAgo(0, 3),
    actor: { username: 'mirae', display_name: '미래' },
    rating: { release_groups: rgEmbed(uid(201)) },
  },
  {
    id: uid(702),
    user_id: uid(1),
    actor_id: uid(3),
    type: 'comment',
    rating_id: uid(400),
    created_at: daysAgo(0, 5),
    actor: { username: 'vinylwolf', display_name: 'Wolf' },
    rating: { release_groups: rgEmbed(uid(201)) },
  },
  {
    id: uid(703),
    user_id: uid(1),
    actor_id: uid(4),
    type: 'follow',
    rating_id: null,
    created_at: daysAgo(1),
    actor: { username: 'sunbeam', display_name: 'Sunny' },
    rating: null,
  },
];

const track_ratings = [
  { id: uid(801), user_id: uid(1), recording_id: recordings[1]?.id, score: 4.5, created_at: daysAgo(2), recordings: { id: recordings[1]?.id, title: recordings[1]?.title, artist_display: recordings[1]?.artist_display } },
  { id: uid(802), user_id: uid(1), recording_id: recordings[3]?.id, score: 4.0, created_at: daysAgo(3), recordings: { id: recordings[3]?.id, title: recordings[3]?.title, artist_display: recordings[3]?.artist_display } },
];

// ── table store ─────────────────────────────────────────────────────────────

export const tables: Record<string, any[]> = {
  profiles,
  artists,
  release_groups,
  recordings,
  releases,
  release_tracks,
  ratings,
  track_ratings,
  rating_likes,
  rating_comments,
  comment_likes: [],
  follows,
  blocked_users: [],
  saved_releases,
  mixes,
  mix_items,
  notifications,
  reports: [],
  search_misses: [],
  pairwise_comparisons: [],
  track_pairwise_comparisons: [],
  spotify_connections: [],
  contact_submissions: [],
  daily_questions: [],
  daily_answers: [],
  lists: [],
  list_items: [],
  reviews: [],
  user_rankings: [],
  user_ranking_entries: [],
  ranking_votes: [],
  ranking_categories: [],
  ranking_seed_entries: [],
  user_accomplishments: [],
  curated_releases: [],
};

// After inserts, re-attach embeds so new rows render in feeds immediately.
export const hydrators: Record<string, (row: any) => void> = {
  ratings: (row) => {
    if (row.release_group_id && !row.release_groups) row.release_groups = rgEmbed(row.release_group_id);
    if (row.user_id && !row.profiles) {
      const p = tables.profiles.find((x) => x.id === row.user_id);
      if (p) row.profiles = { username: p.username, display_name: p.display_name, avatar_url: p.avatar_url ?? null };
    }
    if (row.review_text === undefined) row.review_text = null;
  },
  track_ratings: (row) => {
    if (row.recording_id && !row.recordings) {
      const r = tables.recordings.find((x) => x.id === row.recording_id);
      if (r) row.recordings = { id: r.id, title: r.title, artist_display: r.artist_display };
    }
  },
  rating_comments: (row) => {
    if (row.user_id && !row.profiles) {
      const p = tables.profiles.find((x) => x.id === row.user_id);
      if (p) row.profiles = { id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url ?? null };
    }
  },
  mixes: (row) => {
    if (row.user_id && !row.profiles) {
      const p = tables.profiles.find((x) => x.id === row.user_id);
      if (p) row.profiles = { id: p.id, username: p.username, display_name: p.display_name };
    }
    if (row.is_public === undefined) row.is_public = false;
    if (row.is_default === undefined) row.is_default = false;
  },
  mix_items: (row) => {
    if (row.release_group_id && !row.release_groups) row.release_groups = rgEmbed(row.release_group_id);
  },
  saved_releases: (row) => {
    if (row.release_group_id && !row.release_groups) row.release_groups = rgEmbed(row.release_group_id);
  },
};

// Upsert conflict keys per table (PostgREST on_conflict).
export const conflictKeys: Record<string, string[]> = {
  profiles: ['id'],
  ratings: ['user_id', 'release_group_id'],
  track_ratings: ['user_id', 'recording_id'],
  rating_likes: ['user_id', 'rating_id'],
  saved_releases: ['user_id', 'release_group_id'],
  follows: ['follower_id', 'following_id'],
};

// ── RPC results ─────────────────────────────────────────────────────────────

function ratingStats() {
  const byRg: Record<string, { sum: number; n: number }> = {};
  for (const r of tables.ratings) {
    if (r.score == null || !r.release_group_id) continue;
    const s = (byRg[r.release_group_id] ||= { sum: 0, n: 0 });
    s.sum += r.score;
    s.n += 1;
  }
  return byRg;
}

function chartRow(rg: any, extra: Record<string, unknown>) {
  return {
    release_id: rg.id,
    title: rg.title,
    artist: rg.artist_display,
    cover_url: rg.cover_url,
    native_title: rg.native_title,
    artist_native: rg.artists?.name_native ?? null,
    ...extra,
  };
}

function songChartRows(kind: 'rated' | 'trending') {
  return release_tracks.slice(0, 10).map((rt, i) => {
    const rg = rt.releases.release_groups;
    const full = release_groups.find((x) => x.id === rg.id)!;
    const base = {
      release_id: rg.id,
      track_position: rt.position,
      track_title: rt.recordings.title,
      artist: rt.recordings.artist_display,
      album_title: rg.title,
      cover_url: rg.cover_url,
      album_title_native: full.native_title,
      artist_native: full.artists?.name_native ?? null,
    };
    return kind === 'rated'
      ? { ...base, avg_score: 4.6 - i * 0.15, rating_count: 40 - i * 3 }
      : { ...base, new_count: 25 - i * 2 };
  });
}

const lim = (args: any, def = 20) =>
  Math.max(1, Math.min(100, Number(args?.lim ?? args?.p_limit ?? def)));

export const rpcs: Record<string, (args: any) => unknown> = {
  get_charts_trending: (a) =>
    [...release_groups]
      .sort((x, y) => (y.prestige_score ?? 0) - (x.prestige_score ?? 0))
      .slice(4, 4 + lim(a, 12))
      .map((rg, i) => chartRow(rg, { new_count: 30 - i * 2 })),
  get_charts_trending_for_genres: (a) =>
    release_groups
      .filter((rg) => (a?.p_genres ?? []).some((g: string) => rg.genres?.includes(g)))
      .slice(0, lim(a, 12))
      .map((rg, i) => chartRow(rg, { new_count: 18 - i })),
  get_charts_most_rated: (a) => {
    const stats = ratingStats();
    return [...release_groups]
      .sort((x, y) => (stats[y.id]?.n ?? 0) - (stats[x.id]?.n ?? 0))
      .slice(0, lim(a, 12))
      .map((rg) =>
        chartRow(rg, {
          avg_score: stats[rg.id] ? stats[rg.id].sum / stats[rg.id].n : null,
          rating_count: stats[rg.id]?.n ?? 0,
        }),
      );
  },
  get_silla_leaderboard: (a) =>
    [...release_groups]
      .filter((rg) => !a?.p_genre || rg.genres?.includes(a.p_genre))
      .sort((x, y) => (y.prestige_score ?? 0) - (x.prestige_score ?? 0))
      .slice(0, lim(a, 20))
      .map((rg) =>
        chartRow(rg, {
          silla_score: rg.prestige_score ?? 0.5,
          rating_count: ratingStats()[rg.id]?.n ?? 0,
          release_date: rg.first_release_date,
          release_group_type: rg.release_group_type,
        }),
      ),
  get_charts_pulse: () => [
    { total_ratings: tables.ratings.length, avg_score: 4.1, today_count: 6 },
  ],
  get_rankings_unlock_status: () => [
    {
      album_events: 320,
      album_events_target: 300,
      album_unlocked: true,
      song_events: 205,
      song_events_target: 200,
      song_unlocked: true,
    },
  ],
  get_charts_top_rated_songs: () => songChartRows('rated'),
  get_charts_most_rated_songs: () => songChartRows('rated'),
  get_charts_trending_songs: () => songChartRows('trending'),
  search_release_groups: (a) => {
    const q = String(a?.q ?? '').toLowerCase();
    return release_groups
      .filter(
        (rg) =>
          rg.title.toLowerCase().includes(q) ||
          rg.artist_display.toLowerCase().includes(q) ||
          (rg.native_title ?? '').includes(q) ||
          (rg.artists?.name_native ?? '').includes(q),
      )
      .slice(0, lim(a))
      .map((rg) => ({
        id: rg.id,
        title: rg.title,
        artist_display: rg.artist_display,
        cover_url: rg.cover_url,
        native_title: rg.native_title,
        release_group_type: rg.release_group_type,
        first_release_date: rg.first_release_date,
        artist_native: rg.artists?.name_native ?? null,
      }));
  },
  search_artists: (a) => {
    const q = String(a?.q ?? '').toLowerCase();
    return artists
      .filter((ar) => ar.name.toLowerCase().includes(q) || (ar.name_native ?? '').includes(q))
      .slice(0, lim(a))
      .map((ar) => ({
        id: ar.id,
        name: ar.name,
        name_native: ar.name_native,
        cover_url: ar.cover_url,
        release_count: release_groups.filter((rg) => rg.primary_artist_id === ar.id).length,
      }));
  },
  get_artist_release_groups: (a) =>
    release_groups
      .filter((rg) => rg.primary_artist_id === a?.p_artist_id)
      .slice(0, lim(a, 50))
      .map((rg) => ({
        id: rg.id,
        title: rg.title,
        artist_display: rg.artist_display,
        cover_url: rg.cover_url,
        native_title: rg.native_title,
        release_group_type: rg.release_group_type,
        first_release_date: rg.first_release_date,
      })),
  get_release_group_credits: (a) => {
    const rg = release_groups.find((x) => x.id === a?.p_release_group_id);
    if (!rg?.primary_artist_id) return [];
    const ar = artists.find((x) => x.id === rg.primary_artist_id)!;
    return [{ artist_id: ar.id, credited_as: ar.name, join_phrase: '', position: 1 }];
  },
  get_user_top_genres: () => [
    { genre: 'k-pop', count: 6 },
    { genre: 'hip hop', count: 4 },
    { genre: 'alternative rock', count: 3 },
  ],
  get_user_genre_standings: () => [
    { genre: 'k-pop', user_avg: 4.1, community_avg: 3.8, user_count: 6, community_count: 90 },
    { genre: 'hip hop', user_avg: 4.3, community_avg: 4.0, user_count: 4, community_count: 70 },
    { genre: 'alternative rock', user_avg: 4.6, community_avg: 4.2, user_count: 3, community_count: 55 },
  ],
  get_suggested_users: () =>
    [uid(4), uid(5)].map((id) => {
      const p = tables.profiles.find((x) => x.id === id)!;
      return {
        id: p.id,
        username: p.username,
        display_name: p.display_name,
        avatar_url: null,
        rating_count: tables.ratings.filter((r) => r.user_id === id).length,
      };
    }),
  get_critics_picks: () =>
    release_groups.slice(2, 8).map((rg, i) => ({
      release_id: rg.id,
      title: rg.title,
      artist: rg.artist_display,
      cover_url: rg.cover_url,
      native_title: rg.native_title,
      critic_score: 92 - i * 3,
      critic_count: 14 - i,
      sources: ['mock review daily'],
    })),
};
