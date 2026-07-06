import Foundation

enum Config {
    static let supabaseURL = URL(string: "https://mmbptchpetwdievhrdsj.supabase.co")!
    static let supabaseAnonKey = "sb_publishable_qs7nNzJwJPQMDYY2GiSxYg_9nZn2I1i"
    static let oauthRedirectURL = URL(string: "sillajuku://auth/callback")!
    static let webBaseURL = URL(string: "https://www.sillajuku.com")!
    // A Sentry DSN is meant to be public/embeddable (submit-only, can't read data back) —
    // same trust tier as the Supabase anon key above, unlike a real secret.
    static let sentryDSN = "https://50a6bad9da8dbbc469286d93d4b6065f@o4511672898158592.ingest.us.sentry.io/4511672977260544"
    // Needed for Instagram's own tap-back attribution on a shared Story sticker
    // (the `source_application` query param). Sharing itself works without it —
    // this is inert (nil) until a Facebook App ID is actually registered.
    static let instagramFacebookAppID: String? = nil
}
