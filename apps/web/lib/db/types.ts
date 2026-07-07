/**
 * Canonical TypeScript reference for the post-renovation Supabase schema
 * (2026-06-24 `20260624000001_db_renovation.sql` and later migrations).
 *
 * ⚠ Hand-derived from `supabase/migrations/*.sql` and cross-checked against the
 * live iOS decode structs (`apps/ios`) — this machine has no Supabase DB URL or
 * access token, so `supabase gen types typescript` cannot run here. When a
 * linked environment exists, replace this file with generated types and keep
 * the RPC row interfaces (generated types don't cover RPC RETURNS TABLE well).
 *
 * Naming: `*Row` = a table row as selected; `*RPC` = an RPC result row.
 */

// ── Catalog ────────────────────────────────────────────────────────────────

export type ReleaseGroupType =
  | 'album'
  | 'ep'
  | 'single'
  | 'compilation'
  | 'live'
  | 'soundtrack'
  | 'other';

export interface ReleaseGroupRow {
  id: string;
  primary_artist_id: string | null;
  artist_display: string;
  title: string;
  release_group_type: ReleaseGroupType | string;
  first_release_date: string | null;
  cover_url: string | null;
  genres: string[] | null;
  native_title: string | null; // 20260525000002 era column carried over
  prestige_score: number | null; // 20260628000000
}

export interface ArtistRow {
  id: string;
  name: string;
  name_native: string | null;
  name_phonetic_ko: string | null; // 20260703000006
  native_language: string | null;
  country: string | null;
  disambiguation: string | null;
  cover_url: string | null;
}

export interface RecordingRow {
  id: string;
  primary_artist_id: string | null;
  artist_display: string;
  title: string;
  isrc: string | null;
  duration_ms: number | null;
}

export interface ReleaseTrackRow {
  release_id: string;
  recording_id: string;
  position: number;
  disc_number: number;
}

// ── User data ──────────────────────────────────────────────────────────────

export type RatingMode = 'manual' | 'instinct';

export interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  rating_mode: RatingMode | null;
  manual_rating_step: number | null; // 0.5 | 0.1
  notifications_last_seen_at: string | null;
  notify_likes: boolean | null;
  notify_replies: boolean | null;
  notify_followers: boolean | null;
  notify_rankings: boolean | null;
  notify_capsule: boolean | null;
  profile_visibility: string | null;
  catalog_visibility: string | null;
  library_visibility: string | null; // renamed from listen_later_visibility (20260706000012)
  stats_visibility: string | null; // 20260706000012
  is_bot: boolean | null; // 20260705000004
}

/** ratings keys on release_group_id (renovation §8). score OR elo_score may be set. */
export interface RatingRow {
  id: string;
  user_id: string;
  release_group_id: string;
  score: number | null;
  elo_score: number | null;
  elo_games: number;
  review_text: string | null; // 20260701000001
  created_at: string;
  updated_at: string | null;
}

/** track_ratings keys on recording_id (renovation §10). */
export interface TrackRatingRow {
  id: string;
  user_id: string;
  recording_id: string;
  score: number | null;
  elo_score: number | null;
  elo_games: number;
  created_at: string;
}

export interface FollowRow {
  follower_id: string;
  following_id: string;
}

export interface RatingLikeRow {
  user_id: string;
  rating_id: string;
}

export interface RatingCommentRow {
  id: string;
  user_id: string;
  rating_id: string;
  content: string;
  created_at: string;
}

export interface MixRow {
  id: string;
  user_id: string;
  name: string;
  is_public: boolean;
  is_default: boolean;
  created_at: string;
}

export interface MixItemRow {
  id: string;
  mix_id: string;
  release_group_id: string;
  created_at: string;
}

export interface SavedReleaseRow {
  user_id: string;
  release_group_id: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  actor_id: string | null;
  type: string; // 'like' | 'comment' | 'follow'
  rating_id: string | null;
  created_at: string;
}

export interface BlockedUserRow {
  blocker_id: string;
  blocked_id: string;
}

export interface ReportRow {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  rating_id: string | null;
  reason: string;
  status: string; // 20260703000001
  created_at: string;
}

export interface PairwiseComparisonInsert {
  user_id: string;
  winner_id: string;
  loser_id: string;
}

// ── RPC result rows ────────────────────────────────────────────────────────

/** search_release_groups(q, lim, yr?, query_embedding?) — 20260703000004 */
export interface SearchReleaseGroupRPC {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  native_title: string | null;
  release_group_type: string | null;
  first_release_date: string | null;
  artist_native: string | null;
}

/** search_artists(q, lim) — 20260703000006 (name_phonetic_ko aware) */
export interface SearchArtistRPC {
  id: string;
  name: string;
  name_native: string | null;
  cover_url: string | null;
  release_count: number;
}

/** get_artist_release_groups(p_artist_id, lim) — 20260630000001 */
export interface ArtistReleaseGroupRPC {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  native_title: string | null;
  release_group_type: string | null;
  first_release_date: string | null;
}

/** get_release_group_credits(p_release_group_id) — 20260630000001 */
export interface ReleaseGroupCreditRPC {
  artist_id: string;
  credited_as: string;
  join_phrase: string;
  position: number;
}

/** get_charts_top_rated / most_rated / hidden_gems / controversial — 20260703000004 + 20260705000005 */
export interface ChartRankedRPC {
  release_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  avg_score: number | null;
  rating_count: number | null;
  native_title: string | null;
  artist_native: string | null;
}

/** get_charts_trending / get_charts_trending_for_genres */
export interface ChartTrendingRPC {
  release_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  new_count: number | null;
  native_title: string | null;
  artist_native: string | null;
}

/** get_charts_top_rated_songs / most_rated_songs — 20260703000005 */
export interface SongChartRPC {
  release_id: string;
  track_position: number;
  track_title: string;
  artist: string;
  album_title: string;
  cover_url: string | null;
  avg_score: number | null;
  rating_count: number | null;
  album_title_native: string | null;
  artist_native: string | null;
}

/** get_charts_trending_songs */
export interface TrendingSongRPC {
  release_id: string;
  track_position: number;
  track_title: string;
  artist: string;
  album_title: string;
  cover_url: string | null;
  new_count: number | null;
  album_title_native: string | null;
  artist_native: string | null;
}

/** get_silla_leaderboard(p_genre, p_country, p_limit, p_offset) — silla_score is [0,1]; display ×5 */
export interface SillaLeaderboardRPC {
  release_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  silla_score: number;
  rating_count: number | null;
  native_title: string | null;
  artist_native: string | null;
}

/** get_charts_pulse() */
export interface ChartsPulseRPC {
  total_ratings: number | null;
  avg_score: number | null;
  today_count: number | null;
}

/** get_rankings_unlock_status() — 20260706000000. The coverage floor is server-side only. */
export interface RankingsUnlockStatusRPC {
  album_events: number;
  album_events_target: number;
  album_unlocked: boolean;
  song_events: number;
  song_events_target: number;
  song_unlocked: boolean;
}

/** get_user_top_genres(p_user_id, p_limit) */
export interface UserTopGenreRPC {
  genre: string;
  count: number;
}

/** get_user_genre_standings(p_user_id) — rebuilt 20260703000004 */
export interface GenreStandingRPC {
  genre: string;
  user_avg: number;
  community_avg: number;
  user_count: number;
  community_count: number;
}

/** get_suggested_users(p_user_id) — 20260621000003 */
export interface SuggestedUserRPC {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  rating_count: number;
}

/** get_critics_picks(p_limit, p_scope) — 20260705000007 (honest critic-scored surface) */
export interface CriticsPickRPC {
  release_id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  native_title: string | null;
  critic_score: number | null;
  critic_count: number;
  sources: string[];
}
