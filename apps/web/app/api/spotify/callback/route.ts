import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '../../../../lib/supabaseServer';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  const cookieStore = cookies();
  const storedState = cookieStore.get('sp_oauth_state')?.value;
  const userId = cookieStore.get('sp_oauth_user')?.value;

  cookieStore.delete('sp_oauth_state');
  cookieStore.delete('sp_oauth_user');

  const base = req.nextUrl.origin;

  if (error || !code || !state || state !== storedState || !userId) {
    return NextResponse.redirect(new URL('/settings?sp_error=auth', base));
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.redirect(new URL('/settings?sp_error=config', base));
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  const tokens = await tokenRes.json();
  if (!tokens.access_token) {
    return NextResponse.redirect(new URL('/settings?sp_error=token', base));
  }

  // Get the Spotify user profile
  const profileRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await profileRes.json();
  if (!profile.id) {
    return NextResponse.redirect(new URL('/settings?sp_error=profile', base));
  }

  // Persist tokens (service role so we can write on behalf of the user)
  const supabase = createServerClient();
  if (!supabase) return NextResponse.redirect(new URL('/settings?sp_error=db', base));

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await supabase.from('spotify_connections').upsert({
    user_id: userId,
    spotify_user_id: profile.id,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? '',
    expires_at: expiresAt,
    scope: tokens.scope ?? '',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  return NextResponse.redirect(new URL('/settings?tab=preferences&sp_connected=1', base));
}
