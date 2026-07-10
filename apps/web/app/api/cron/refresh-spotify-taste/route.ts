import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';

// Scheduled (Vercel Cron) job — refreshes every connected user's Spotify top-artists and
// recently-played data server-side, independent of whether they've opened the app. Mirrors
// SpotifyService.swift's topArtists()/recentlyPlayed() shapes exactly so this write path and
// the client's own opportunistic write path always produce identical JSON.
//
// Deliberately duplicates the refresh-token exchange from app/api/spotify/export/route.ts
// rather than importing a shared helper -- that file backs an unrelated, currently-working
// feature (playlist export) and isn't touched here.

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

async function fetchTopArtists(accessToken: string): Promise<SpotifyArtistDisplay[]> {
  const res = await fetch('https://api.spotify.com/v1/me/top/artists?limit=10&time_range=short_term', {
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

  // Dedup by album id, preserving order (most recent first); skip podcasts (nil track/album) --
  // ports SpotifyService.swift's recentlyPlayed() dedup loop exactly.
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

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'Unavailable' }, { status: 503 });

  const { data: rows } = await supabase
    .from('spotify_taste_tokens')
    .select('user_id, refresh_token');

  let refreshed = 0;
  let failed = 0;
  const total = rows?.length ?? 0;

  for (const row of rows ?? []) {
    const tokens = await refreshAccessToken(row.refresh_token);
    if (!tokens) {
      failed++;
      continue;
    }

    // Spotify may rotate the refresh token on any refresh -- persist it if so.
    if (tokens.refresh_token && tokens.refresh_token !== row.refresh_token) {
      await supabase
        .from('spotify_taste_tokens')
        .update({ refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() })
        .eq('user_id', row.user_id);
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
      .eq('id', row.user_id);

    refreshed++;
  }

  return NextResponse.json({ refreshed, failed, total });
}
