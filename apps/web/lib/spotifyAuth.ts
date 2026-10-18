/**
 * Off since 2026-10-17: Spotify's Web API is in Development Mode, which only
 * serves 5 allowlisted users (extended quota needs a registered business and
 * 250k MAU), so any other Spotify sign-in fails with "Error getting user
 * profile from external provider". Hides the Spotify sign-in button; Apple +
 * Google show up front instead. Mirrors iOS `Config.spotifyEnabled`. Flip back
 * on once extended quota is granted.
 */
export const SPOTIFY_ENABLED = false;
