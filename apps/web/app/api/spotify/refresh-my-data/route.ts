import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { recordUnknownArtists } from '../../../../lib/taste/demandSignal';

// On-demand version of the refresh-spotify-taste cron, scoped to one user -- called by the iOS
// app (SpotifyService.swift's refreshViaBackend()) when its own cached Spotify access token has
// expired. Confirmed live 2026-09-21: this project's Spotify app registration is a confidential
// client (refresh requires Basic auth with SPOTIFY_CLIENT_SECRET, same as export/route.ts and the
// cron below), so an iOS-only refresh using just client_id (no secret) always fails with a real
// Spotify 400 invalid_request -- the secret can never safely live in the app, so this refresh has
// to happen server-side. The iOS client re-reads profiles.spotify_artists/spotify_recently_played
// afterward (its existing DB-read layer) rather than this endpoint returning the data directly,
// so there's exactly one place (this file + the cron) that knows Spotify's response shape.
//
// Deliberately duplicates the refresh-token exchange + fetch logic from
// app/api/cron/refresh-spotify-taste/route.ts rather than importing a shared helper -- same
// reasoning as that file's own comment about not touching export/route.ts.

interface SpotifyArtistDisplay {
  id: string;
  name: string;
  imageUrl: string | null;
}

interface SpotifyAlbumDisplay {
  id: string;
  name: string;
  artistName: string;
  imageUrl: string | null;
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string } | null> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  const data = await res.json();
  return data.access_token ? data : null;
}

// medium_term (~6 months), not short_term (~4 weeks) -- matches SpotifyService.swift's
// topArtists(), widened 2026-09-21 per explicit request after short_term returned 0 items for a
// real account whose listening just hadn't been active in the last few weeks specifically.
async function fetchTopArtists(accessToken: string): Promise<SpotifyArtistDisplay[]> {
  const res = await fetch('https://api.spotify.com/v1/me/top/artists?limit=10&time_range=medium_term', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const items: any[] = data.items ?? [];
  return items.map((a) => ({ id: a.id, name: a.name, imageUrl: a.images?.[0]?.url ?? null }));
}

async function fetchRecentlyPlayed(accessToken: string): Promise<SpotifyAlbumDisplay[]> {
  const res = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const items: any[] = data.items ?? [];

  const seen = new Set<string>();
  const albums: SpotifyAlbumDisplay[] = [];
  for (const item of items) {
    const track = item.track;
    const album = track?.album;
    if (!track || !album) continue;
    if (seen.has(album.id)) continue;
    seen.add(album.id);
    albums.push({
      id: album.id,
      name: album.name,
      artistName: album.artists?.[0]?.name ?? track.artists?.[0]?.name ?? '',
      imageUrl: album.images?.[0]?.url ?? null,
    });
  }
  return albums;
}

export async function POST(req: NextRequest) {
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'Unavailable' }, { status: 503 });

  const { data: row } = await supabase
    .from('spotify_taste_tokens')
    .select('refresh_token')
    .eq('user_id', userId)
    .single();

  if (!row?.refresh_token) {
    return NextResponse.json({ error: 'Not connected' }, { status: 404 });
  }

  const tokens = await refreshAccessToken(row.refresh_token);
  if (!tokens) {
    // The refresh token itself is dead (revoked/expired) -- the user genuinely needs to
    // reconnect Spotify, not something this endpoint can recover from.
    return NextResponse.json({ error: 'Refresh failed' }, { status: 502 });
  }

  if (tokens.refresh_token && tokens.refresh_token !== row.refresh_token) {
    await supabase
      .from('spotify_taste_tokens')
      .update({ refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  }

  const [artists, recentlyPlayed] = await Promise.all([
    fetchTopArtists(tokens.access_token),
    fetchRecentlyPlayed(tokens.access_token),
  ]);

  await supabase
    .from('profiles')
    .update({
      spotify_artists: artists,
      spotify_recently_played: recentlyPlayed,
      spotify_data_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  // Feed the catalogue: any artist this user actually listens to that we do not hold is the
  // strongest demand signal available -- revealed preference, and the name comes from Spotify
  // rather than being typed. recordUnknownArtists writes those into search_misses, which the
  // pipeline's tryMisses() already knows how to resolve (MusicBrainz first, Deezer on repeated
  // demand for artists MB lacks). Best-effort and awaited only so errors cannot escape it; it
  // swallows its own failures rather than breaking the refresh.
  const names = [
    ...artists.map(a => a.name),
    ...recentlyPlayed.map(r => r.artistName),
  ].filter(Boolean);
  const queued = await recordUnknownArtists(supabase, names, 'spotify_taste');
  if (queued.length) console.log(`[taste-demand] ${queued.length} unknown artist(s) queued: ${queued.slice(0, 5).join(', ')}`);

  return NextResponse.json({ success: true });
}
