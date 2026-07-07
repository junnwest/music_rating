/**
 * Client-side data shapes + Supabase select strings for the rebuilt web app.
 * These mirror the iOS ViewModels' queries 1:1 (HomeView / AlbumDetailView /
 * SearchView / ProfileView) so both platforms read the schema the same way.
 */

import { displayName } from './display';

/** The app-wide release shape (mirror of iOS `Release`). */
export interface SJRelease {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  releaseType: string | null;
  releaseDate: string | null;
  titleNative: string | null;
  artistNative: string | null;
}

export function releaseDisplayTitle(r: Pick<SJRelease, 'title' | 'titleNative'>): string {
  return displayName(r.title, r.titleNative);
}

export function releaseDisplayArtist(r: Pick<SJRelease, 'artist' | 'artistNative'>): string {
  return displayName(r.artist, r.artistNative);
}

/** Raw embed shape for `release_groups(...)` with the native-artist join. */
export interface ReleaseGroupEmbed {
  id: string;
  title: string;
  artist_display: string;
  cover_url: string | null;
  release_group_type: string | null;
  first_release_date?: string | null;
  native_title: string | null;
  artists?: { name_native: string | null } | null;
}

export function releaseFromEmbed(rg: ReleaseGroupEmbed): SJRelease {
  return {
    id: rg.id,
    title: rg.title,
    artist: rg.artist_display,
    coverUrl: rg.cover_url,
    releaseType: rg.release_group_type ?? null,
    releaseDate: rg.first_release_date ?? null,
    titleNative: rg.native_title,
    artistNative: rg.artists?.name_native ?? null,
  };
}

/** Columns for a plain release_groups select (no artist join). */
export const RG_COLS =
  'id, title, artist_display, cover_url, release_group_type, first_release_date, native_title';

/** release_groups embed with the primary artist's native name joined. */
export const RG_EMBED_NATIVE =
  'release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))';

/** The feed select — identical to iOS HomeViewModel.feedSelect. */
export const FEED_SELECT =
  `id, user_id, score, elo_score, review_text, created_at, ` +
  `release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native)), ` +
  `profiles!ratings_user_id_fkey(username, display_name)`;

export interface FeedProfileEmbed {
  username: string | null;
  display_name: string | null;
}

export function profileHandle(p?: FeedProfileEmbed | null): string {
  return p?.username ?? p?.display_name ?? 'someone';
}

export interface FeedItemRow {
  id: string;
  user_id: string;
  score: number | null;
  elo_score: number | null;
  review_text: string | null;
  created_at: string;
  release_groups: ReleaseGroupEmbed;
  profiles: FeedProfileEmbed | null;
}
