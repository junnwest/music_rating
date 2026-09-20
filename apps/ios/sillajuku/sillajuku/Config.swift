import Foundation

enum Config {
    static let supabaseURL = URL(string: "https://mmbptchpetwdievhrdsj.supabase.co")!
    static let supabaseAnonKey = "sb_publishable_qs7nNzJwJPQMDYY2GiSxYg_9nZn2I1i"
    static let oauthRedirectURL = URL(string: "sillajuku://auth/callback")!
    static let webBaseURL = URL(string: "https://www.sillajuku.com")!
    // A Spotify app's client_id is NOT a secret per Spotify's own PKCE/Authorization Code docs --
    // it's designed to be included in public/client-side code (unlike a client SECRET, which this
    // app never has or needs, since the OAuth exchange itself goes through Supabase). Needed here
    // directly for SpotifyService.refreshAccessToken(): refreshing a PKCE-flow access token is a
    // call straight to Spotify's own /api/token endpoint, bypassing Supabase entirely (Supabase's
    // signInWithOAuth() only handles the initial sign-in exchange). Same value already used
    // web-side (apps/web/.env.local's SPOTIFY_CLIENT_ID) for this app's one registered Spotify app.
    static let spotifyClientId = "34eeabbdcc2a43029e7943da2f5bdad8"
    // A Sentry DSN is meant to be public/embeddable (submit-only, can't read data back) —
    // same trust tier as the Supabase anon key above, unlike a real secret.
    static let sentryDSN = "https://50a6bad9da8dbbc469286d93d4b6065f@o4511672898158592.ingest.us.sentry.io/4511672977260544"
    // Needed for Instagram's own tap-back attribution on a shared Story sticker
    // (the `source_application` query param). Registered 2026-07-08 at
    // developers.facebook.com ("Create an app without a use case" -- no
    // Graph API calls happen anywhere in this app, so no other use case or
    // business portfolio verification applies), iOS platform, bundle ID
    // com.sillajuku.app.
    static let instagramFacebookAppID: String? = "2171948313662107"
}
