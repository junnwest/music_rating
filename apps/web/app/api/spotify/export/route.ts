import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '../../../../lib/supabaseServer';
import { getAuthedUserId } from '../../../../lib/authGuard';
import { rateLimit } from '../../../../lib/rateLimit';

interface AlbumInput {
  title: string;
  artist: string;
}

async function getClientCredToken(): Promise<string | null> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  return data.access_token ?? null;
}

async function refreshUserToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
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

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, 'spotify-export', 5, 60);
  if (limited) return limited;

  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { playlistName?: string; albums?: AlbumInput[] };
  const { playlistName = 'My Playlist', albums = [] } = body;
  if (!Array.isArray(albums) || albums.length === 0) {
    return NextResponse.json({ error: 'No albums provided' }, { status: 400 });
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: 'Unavailable' }, { status: 503 });

  // Load connection
  const { data: conn } = await supabase
    .from('spotify_connections')
    .select('spotify_user_id, access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .single();

  if (!conn) {
    return NextResponse.json({ error: 'Spotify not connected', needsConnect: true }, { status: 403 });
  }

  // Refresh token if needed
  let userToken = conn.access_token;
  if (new Date(conn.expires_at) < new Date(Date.now() + 60_000)) {
    const refreshed = await refreshUserToken(conn.refresh_token);
    if (!refreshed) return NextResponse.json({ error: 'Could not refresh Spotify token' }, { status: 401 });
    userToken = refreshed.access_token;
    await supabase.from('spotify_connections').update({
      access_token: userToken,
      expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId);
  }

  // Search token (client credentials — no user scope needed for searching)
  const searchToken = await getClientCredToken();
  if (!searchToken) return NextResponse.json({ error: 'Could not get search token' }, { status: 503 });

  // For each album find representative tracks (cap at 10 albums to stay within timeout)
  const trackUris: string[] = [];
  for (const album of albums.slice(0, 10)) {
    const q = encodeURIComponent(`album:"${album.title}" artist:"${album.artist}"`);
    const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=5&market=US`, {
      headers: { Authorization: `Bearer ${searchToken}` },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const items: any[] = data.tracks?.items ?? [];
    trackUris.push(...items.slice(0, 3).map((t) => t.uri as string));
  }

  if (trackUris.length === 0) {
    return NextResponse.json({ error: 'No tracks found on Spotify for these albums' }, { status: 404 });
  }

  // Create playlist
  const createRes = await fetch(
    `https://api.spotify.com/v1/users/${conn.spotify_user_id}/playlists`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `${playlistName} — sillajuku`,
        description: 'Exported from sillajuku',
        public: true,
      }),
    },
  );
  const created = await createRes.json();
  if (!created.id) return NextResponse.json({ error: 'Failed to create Spotify playlist' }, { status: 500 });

  // Add tracks (Spotify max 100 per request)
  await fetch(`https://api.spotify.com/v1/playlists/${created.id}/tracks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: trackUris.slice(0, 100) }),
  });

  return NextResponse.json({ url: created.external_urls?.spotify ?? null });
}
