import Foundation

enum Config {
    static let supabaseURL = URL(string: "https://mmbptchpetwdievhrdsj.supabase.co")!
    static let supabaseAnonKey = "sb_publishable_qs7nNzJwJPQMDYY2GiSxYg_9nZn2I1i"
    static let oauthRedirectURL = URL(string: "sillajuku://auth/callback")!
    // nonisolated: read from ImageCache's off-main fetch path.
    nonisolated static let webBaseURL = URL(string: "https://www.sillajuku.com")!
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
    // Off since 2026-10-17: Spotify's Web API is in Development Mode, which only
    // serves 5 allowlisted users (extended quota needs a registered business and
    // 250k MAU), so any other Spotify sign-in fails with "Error getting user
    // profile from external provider". Hides every place a user is offered
    // Spotify (sign-in, Connected Accounts, Add-tab nudge, onboarding).
    // Already-linked accounts keep their Spotify row and data. Flip back on once
    // extended quota is granted.
    static let spotifyEnabled = false
}
