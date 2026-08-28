import { NextResponse } from 'next/server';

// Served at /.well-known/apple-app-site-association (no extension, required
// exact path) so iOS can verify this domain is allowed to open the app via
// Universal Links. appID = "<Team ID>.<Bundle ID>" — GGJ5HX3A4M / com.sillajuku.app
// per this project's existing Apple Developer team + bundle id (see .env.example's
// APNS_TEAM_ID/APNS_BUNDLE_ID, same team used for push notifications).
//
// /i/* is the invite-link flow; /beta/* is the private beta-tester redeem
// flow (see BetaInviteLink.swift) — both listed explicitly rather than a
// catch-all, since those are the only two universal-link consumers built so far.
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        appID: 'GGJ5HX3A4M.com.sillajuku.app',
        paths: ['/i/*', '/beta/*'],
      },
    ],
  },
};

export async function GET() {
  return NextResponse.json(AASA, {
    headers: { 'Content-Type': 'application/json' },
  });
}
