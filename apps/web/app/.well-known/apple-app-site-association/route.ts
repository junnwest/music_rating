import { NextResponse } from 'next/server';

// Served at /.well-known/apple-app-site-association (no extension, required
// exact path) so iOS can verify this domain is allowed to open the app via
// Universal Links. appID = "<Team ID>.<Bundle ID>" — GGJ5HX3A4M / com.sillajuku.app
// per this project's existing Apple Developer team + bundle id (see .env.example's
// APNS_TEAM_ID/APNS_BUNDLE_ID, same team used for push notifications).
//
// /i/* is the invite-link flow; /beta/* is the private beta-tester redeem
// flow (see BetaInviteLink.swift); /auth/confirmed is the post-email-
// verification landing page (see app/auth/confirmed/page.tsx) — routes a
// Supabase email confirmation straight back into the app instead of a plain
// web onboarding flow. All listed explicitly rather than a catch-all, since
// these are the only universal-link consumers built so far.
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: 'GGJ5HX3A4M.com.sillajuku.app',
        paths: ['/i/*', '/beta/*', '/auth/confirmed'],
      },
    ],
  },
};

export async function GET() {
  return NextResponse.json(AASA, {
    headers: { 'Content-Type': 'application/json' },
  });
}
