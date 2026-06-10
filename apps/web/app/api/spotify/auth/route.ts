import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { getAuthedUserId } from '../../../../lib/authGuard';

// POST — called client-side (with Bearer token) to get the Spotify OAuth URL.
// Returns { url } so the client can navigate; avoids exposing user ID in query params.
export async function POST(req: NextRequest) {
  const userId = await getAuthedUserId(req.headers.get('Authorization'));
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Spotify not configured on server' }, { status: 500 });
  }

  const state = randomBytes(16).toString('hex');
  const cookieStore = cookies();
  cookieStore.set('sp_oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 300, path: '/', sameSite: 'lax' });
  cookieStore.set('sp_oauth_user', userId, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 300, path: '/', sameSite: 'lax' });

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: 'playlist-modify-public playlist-modify-private',
  });

  return NextResponse.json({ url: `https://accounts.spotify.com/authorize?${params}` });
}
