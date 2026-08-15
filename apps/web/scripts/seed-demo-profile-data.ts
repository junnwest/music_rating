/**
 * Phase B of the screenshot-recapture seed (see seed-demo-fictional-content.ts for Phase A).
 * Attaches ratings + spotify_recently_played/spotify_artists to a real, already-authenticated
 * demo profile so the Add page's personalized shelf and the Profile/rated-grid screens render
 * the fictional catalog instead of anything real. Targets a Google-signed-in account
 * deliberately -- no real Spotify token means no live-refetch code path can ever overwrite this
 * with real data (see SearchView.swift's load(), which only calls the live Spotify API when
 * SpotifyService.validToken() succeeds).
 *
 * spotify_recently_played / spotify_artists use camelCase inner keys (artistName, imageUrl) --
 * SpotifyAlbumDisplay/SpotifyArtistDisplay (iOS) have no custom CodingKeys, so they decode
 * exact camelCase, unlike the snake_case column names themselves.
 *
 * Run:
 *   npx tsx --env-file=.env.local scripts/seed-demo-profile-data.ts --username=orangeandmustard
 */
import { createClient } from '@supabase/supabase-js';

const usernameArg = process.argv.find((a) => a.startsWith('--username='));
const username = usernameArg?.split('=')[1];
if (!username) { console.error('Usage: --username=<demo account username>'); process.exit(1); }

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

// Scores span a believable range -- not everything a 5, not everything average.
const RATING_SCORES: Record<string, number> = {
  'Low Fidelity': 4.0,
  'Roomtone': 3.5,
  'Nightbus': 4.5,
  '창밖': 4.0,
  '유리병': 3.0,
  '한여름': 4.5,
  'AXIS': 4.0,
  'Neon Halo': 5.0,
  'Reverie': 3.5,
  'Slow Static': 4.0,
  'Amber Room': 4.5,
  'Paper Weather': 3.0,
};

async function main() {
  const { data: profile, error: profErr } = await db
    .from('profiles')
    .select('id, username')
    .eq('username', username)
    .single();
  if (profErr || !profile) throw new Error(`profile lookup failed: ${profErr?.message ?? 'not found'}`);
  const userId = profile.id as string;
  console.log(`Target profile: ${profile.username} (${userId})`);

  const { data: albums, error: rgErr } = await db
    .from('release_groups')
    .select('id, title, artist_display, cover_url')
    .eq('source', 'manual');
  if (rgErr) throw new Error(`fetch release_groups: ${rgErr.message}`);
  if (!albums || albums.length === 0) throw new Error('No source=manual release_groups found -- run seed-demo-fictional-content.ts first');
  console.log(`Found ${albums.length} fictional albums.`);

  // ── Ratings ──────────────────────────────────────────────────────────────
  const ratingRows = albums.map((a) => ({
    user_id: userId,
    release_group_id: a.id,
    score: RATING_SCORES[a.title] ?? 4.0,
    status: 'Listened',
  }));
  const { error: ratErr } = await db
    .from('ratings')
    .upsert(ratingRows, { onConflict: 'user_id,release_group_id' });
  if (ratErr) throw new Error(`insert ratings: ${ratErr.message}`);
  console.log(`Rated ${ratingRows.length} albums.`);

  // ── spotify_recently_played (Add page's personalized shelf) ────────────────
  const recentlyPlayed = albums.map((a, i) => ({
    id: `demo-${i}`,
    name: a.title,
    artistName: a.artist_display,
    imageUrl: a.cover_url,
  }));

  // ── spotify_artists (one entry per fictional artist, using one of their covers as a stand-in image) ──
  const artistsSeen = new Map<string, string | null>();
  for (const a of albums) if (!artistsSeen.has(a.artist_display)) artistsSeen.set(a.artist_display, a.cover_url);
  const spotifyArtists = Array.from(artistsSeen.entries()).map(([name, imageUrl], i) => ({
    id: `demo-artist-${i}`,
    name,
    imageUrl,
  }));

  const { error: updErr } = await db
    .from('profiles')
    .update({
      spotify_recently_played: recentlyPlayed,
      spotify_artists: spotifyArtists,
      spotify_data_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (updErr) throw new Error(`update profile: ${updErr.message}`);
  console.log(`Seeded spotify_recently_played (${recentlyPlayed.length}) and spotify_artists (${spotifyArtists.length}).`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
