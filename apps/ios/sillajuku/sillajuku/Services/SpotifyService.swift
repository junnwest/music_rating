import Foundation
import Supabase
import Sentry

// MARK: - Response models

struct SpotifyTopArtistsResponse: Codable {
    let items: [SpotifyArtist]
}

struct SpotifyArtist: Codable, Identifiable {
    let id: String
    let name: String
    let images: [SpotifyImage]

    struct SpotifyImage: Codable {
        let url: String
        let width: Int?
        let height: Int?
    }

    var imageUrl: String? { images.first?.url }
}

struct SpotifyRecentlyPlayedResponse: Decodable {
    let items: [LenientPlayItem]

    // Confirmed live via Sentry 2026-09-21: a genuine 200 response with real
    // track data still failed to decode as [SpotifyPlayItem] -- Swift's
    // JSONDecoder fails an array atomically the instant ANY single element
    // throws (e.g. a locally-uploaded file or another edge-case entry
    // Spotify's recently-played history can include, which doesn't fully
    // match this schema), silently discarding every other valid item in the
    // same response. Decoding item-by-item and dropping only the ones that
    // fail, instead of the whole batch, fixes this without needing to know
    // exactly which field/shape was the culprit -- and stays correct if
    // Spotify includes some other edge case later.
    struct LenientPlayItem: Decodable {
        let value: SpotifyPlayItem?
        init(from decoder: Decoder) throws {
            value = try? SpotifyPlayItem(from: decoder)
        }
    }
}

struct SpotifyPlayItem: Decodable {
    let track: SpotifyTrack?   // nil for podcast episodes, or a track that itself failed to decode
    let playedAt: String

    enum CodingKeys: String, CodingKey {
        case track
        case playedAt = "played_at"
    }

    // Lenient like everything below it, for the same reason (see SpotifyAlbum's
    // comment) -- belt and suspenders alongside the outer LenientPlayItem
    // wrapper, since a missing/malformed `track` shouldn't fail `playedAt`
    // either, or vice versa.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        track = try? c.decode(SpotifyTrack.self, forKey: .track)
        playedAt = (try? c.decode(String.self, forKey: .playedAt)) ?? ""
    }
}

struct SpotifyTrack: Decodable {
    let name: String
    let artists: [SpotifyTrackArtist]
    let album: SpotifyAlbum?   // nil for podcast episodes — those are skipped

    struct SpotifyTrackArtist: Decodable {
        let name: String
        enum CodingKeys: String, CodingKey { case name }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = (try? c.decode(String.self, forKey: .name)) ?? ""
        }
    }

    struct SpotifyAlbum: Decodable {
        // Confirmed live via Sentry 2026-09-21: a real recently-played item
        // existed (raw items=1) but still failed to decode even under the
        // per-item LenientPlayItem wrapper -- something *inside* this nested
        // structure was throwing, not the top-level shape. Most likely a
        // locally-uploaded file, which Spotify can return with fields a
        // normal catalog album always has left out or null -- `id` in
        // particular. Every field here now decodes leniently with a safe
        // fallback instead of letting one missing/null field kill the whole
        // item a second time.
        let id: String?
        let name: String
        let artists: [SpotifyTrackArtist]
        let images: [SpotifyArtist.SpotifyImage]
        var imageUrl: String? { images.first?.url }

        enum CodingKeys: String, CodingKey { case id, name, artists, images }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try? c.decode(String.self, forKey: .id)
            name = (try? c.decode(String.self, forKey: .name)) ?? ""
            artists = (try? c.decode([SpotifyTrackArtist].self, forKey: .artists)) ?? []
            images = (try? c.decode([SpotifyArtist.SpotifyImage].self, forKey: .images)) ?? []
        }
    }

    enum CodingKeys: String, CodingKey { case name, artists, album }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        artists = (try? c.decode([SpotifyTrackArtist].self, forKey: .artists)) ?? []
        album = try? c.decode(SpotifyAlbum.self, forKey: .album)
    }
}

// Spotify's /api/token refresh response -- refresh_token is only present when Spotify rotates
// it on this particular refresh, not every time (see SpotifyService.refreshAccessToken()).
private struct SpotifyRefreshResponse: Decodable {
    let accessToken: String
    let refreshToken: String?
    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
    }
}

// MARK: - Simplified display models

struct SpotifyArtistDisplay: Identifiable, Codable {
    let id: String
    let name: String
    let imageUrl: String?
}

struct SpotifyAlbumDisplay: Identifiable, Codable {
    let id: String
    let name: String
    let artistName: String
    let imageUrl: String?
}

// MARK: - Service

enum SpotifyService {

    private static let baseURL = "https://api.spotify.com/v1"
    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    // MARK: - Display data cache (survives token expiry)

    static func saveArtists(_ artists: [SpotifyArtistDisplay]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(artists), forKey: "sj_cached_artists")
    }
    static func loadCachedArtists() -> [SpotifyArtistDisplay] {
        guard let d = UserDefaults.standard.data(forKey: "sj_cached_artists") else { return [] }
        return (try? JSONDecoder().decode([SpotifyArtistDisplay].self, from: d)) ?? []
    }

    static func saveRecentlyPlayed(_ albums: [SpotifyAlbumDisplay]) {
        UserDefaults.standard.set(try? JSONEncoder().encode(albums), forKey: "sj_cached_recent")
    }
    static func loadCachedRecentlyPlayed() -> [SpotifyAlbumDisplay] {
        guard let d = UserDefaults.standard.data(forKey: "sj_cached_recent") else { return [] }
        return (try? JSONDecoder().decode([SpotifyAlbumDisplay].self, from: d)) ?? []
    }

    // Clears all device-local Spotify cache — call on sign out so the next
    // user doesn't see a previous account's data.
    static func clearCache() {
        UserDefaults.standard.removeObject(forKey: "sj_cached_artists")
        UserDefaults.standard.removeObject(forKey: "sj_cached_recent")
        UserDefaults.standard.removeObject(forKey: "sj_spotify_provider_token")
        UserDefaults.standard.removeObject(forKey: "sj_spotify_provider_refresh_token")
    }

    // The auth observer in sillajukuApp saves the token immediately on sign-in,
    // before any session refresh can drop it. We just read from there.
    static func providerToken() -> String? {
        UserDefaults.standard.string(forKey: "sj_spotify_provider_token")
    }

    // Returns a live Spotify access token if available, nil otherwise.
    // NOTE: Supabase's refreshSession() does NOT return a provider token —
    // providerToken only appears in the initial OAuth callback URL.
    // The auth observer in sillajukuApp.swift captures it at sign-in time.
    static func validToken() async -> String? {
        guard let token = providerToken() else {
            // No token saved in UserDefaults at all -- distinct from "saved
            // but expired" (tokenIsLive below), and was previously silent.
            // Confirmed live 2026-09-21: a fresh Spotify signup's DB columns
            // (spotify_artists/spotify_recently_played) stayed null even
            // though the account's identity WAS genuinely linked server-side
            // (verified directly against auth.identities) -- meaning
            // whichever of these two guards is actually firing needs to be
            // distinguishable, not both collapsing into the same silent nil.
            SentrySDK.capture(message: "SpotifyService.validToken: no provider token in UserDefaults")
            return nil
        }
        if await tokenIsLive(token) { return token }
        // Access token expired (confirmed live 2026-09-21: a real 401 from
        // /me, Spotify access tokens are only valid ~1 hour) -- try
        // refreshing with the saved refresh token before giving up entirely.
        // Previously this just returned nil here, silently falling back to
        // stale cached/DB data (or a "reconnect Spotify" prompt) for the
        // rest of the session with no attempt to actually recover.
        return await refreshAccessToken()
    }

    // Spotify's own /api/token endpoint, bypassing Supabase entirely --
    // Supabase's signInWithOAuth()/session(from:) only ever handles the
    // INITIAL sign-in code exchange, it has no equivalent for refreshing a
    // provider access token later (session.providerToken only ever appears
    // once, on that first exchange -- see validToken()'s own note above).
    // Safe to call directly with just client_id (no client secret) since
    // this is the public/PKCE side of Spotify's OAuth -- refresh tokens
    // issued this way don't require re-authenticating as a confidential
    // client. Spotify may rotate the refresh token itself on any given
    // refresh; both the local cache and the DB-persisted copy
    // (spotify_taste_tokens, used elsewhere for a server-side refresh) are
    // updated when that happens so neither goes stale independently.
    static func refreshAccessToken() async -> String? {
        guard let refreshToken = UserDefaults.standard.string(forKey: "sj_spotify_provider_refresh_token") else {
            SentrySDK.capture(message: "SpotifyService.refreshAccessToken: no refresh token saved")
            return nil
        }
        guard let url = URL(string: "https://accounts.spotify.com/api/token") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var body = URLComponents()
        body.queryItems = [
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refreshToken),
            URLQueryItem(name: "client_id", value: Config.spotifyClientId),
        ]
        req.httpBody = body.percentEncodedQuery?.data(using: .utf8)

        guard let (data, response) = try? await URLSession.shared.data(for: req) else {
            SentrySDK.capture(message: "SpotifyService.refreshAccessToken: request failed (network)")
            return nil
        }
        let status = (response as? HTTPURLResponse)?.statusCode
        guard status == 200, let parsed = try? JSONDecoder().decode(SpotifyRefreshResponse.self, from: data) else {
            // A 400 with error=invalid_grant means the refresh token itself was revoked/expired --
            // the user genuinely needs to reconnect, not something a retry fixes. Any other status
            // is unexpected. Both logged the same way so the distinction is visible next time
            // instead of guessed at, matching every other Spotify API failure path in this file.
            captureSpotifyAPIFailure(endpoint: "accounts/api/token (refresh)", status: status, data: data)
            return nil
        }

        UserDefaults.standard.set(parsed.accessToken, forKey: "sj_spotify_provider_token")
        if let newRefreshToken = parsed.refreshToken {
            UserDefaults.standard.set(newRefreshToken, forKey: "sj_spotify_provider_refresh_token")
            await saveTasteRefreshToken(newRefreshToken)
        }
        return parsed.accessToken
    }

    // Lightweight liveness check — one request to /me.
    static func tokenIsLive(_ token: String) async -> Bool {
        guard let url = URL(string: "\(baseURL)/me") else { return false }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: req) else {
            SentrySDK.capture(message: "SpotifyService.tokenIsLive: request failed (network)")
            return false
        }
        let status = (response as? HTTPURLResponse)?.statusCode
        if status != 200 {
            captureSpotifyAPIFailure(endpoint: "me (liveness check)", status: status, data: data)
        }
        return status == 200
    }

    // Centralizes what gets attached to the Sentry event for every Spotify
    // API failure path above -- status code plus a truncated response body
    // (Spotify's own error JSON, e.g. {"error":{"status":403,"message":
    // "..."}}, is the one thing that actually distinguishes an expired
    // token from an insufficient-scope grant from a genuine empty result,
    // none of which were ever visible before this).
    private static func captureSpotifyAPIFailure(endpoint: String, status: Int?, data: Data?) {
        let bodySnippet = data.flatMap { String(data: $0, encoding: .utf8) }?.prefix(300)
        SentrySDK.capture(message: "SpotifyService.\(endpoint) failed: status=\(status.map(String.init) ?? "none") body=\(bodySnippet ?? "nil")")
    }

    // MARK: - DB persistence (survives reinstalls and device switches)

    private struct ArtistsUpdate: Encodable {
        let spotifyArtists: [SpotifyArtistDisplay]
        let spotifyDataUpdatedAt: String
        enum CodingKeys: String, CodingKey {
            case spotifyArtists = "spotify_artists"
            case spotifyDataUpdatedAt = "spotify_data_updated_at"
        }
    }

    private struct RecentlyPlayedUpdate: Encodable {
        let spotifyRecentlyPlayed: [SpotifyAlbumDisplay]
        enum CodingKeys: String, CodingKey { case spotifyRecentlyPlayed = "spotify_recently_played" }
    }

    static func saveArtistsToDB(_ artists: [SpotifyArtistDisplay]) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let ts = ISO8601DateFormatter().string(from: Date())
        try? await supabase
            .from("profiles")
            .update(ArtistsUpdate(spotifyArtists: artists, spotifyDataUpdatedAt: ts))
            .eq("id", value: userId)
            .execute()
    }

    static func saveRecentlyPlayedToDB(_ albums: [SpotifyAlbumDisplay]) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        try? await supabase
            .from("profiles")
            .update(RecentlyPlayedUpdate(spotifyRecentlyPlayed: albums))
            .eq("id", value: userId)
            .execute()
    }

    // Persists the OAuth refresh token captured at login so a server-side cron can pull
    // fresh top-artists/recently-played data independent of this device ever reopening
    // the app or the short-lived access token still being valid.
    private struct TasteTokenUpsert: Encodable {
        let userId: UUID; let refreshToken: String; let updatedAt: String
        enum CodingKeys: String, CodingKey {
            case userId = "user_id"; case refreshToken = "refresh_token"; case updatedAt = "updated_at"
        }
    }

    static func saveTasteRefreshToken(_ token: String) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let ts = ISO8601DateFormatter().string(from: Date())
        try? await supabase
            .from("spotify_taste_tokens")
            .upsert(TasteTokenUpsert(userId: userId, refreshToken: token, updatedAt: ts))
            .execute()
    }

    static func loadArtistsFromDB() async -> [SpotifyArtistDisplay] {
        guard let userId = supabase.auth.currentUser?.id else { return [] }
        struct Row: Decodable {
            let spotifyArtists: [SpotifyArtistDisplay]?
            enum CodingKeys: String, CodingKey { case spotifyArtists = "spotify_artists" }
        }
        guard let row: Row = try? await supabase
            .from("profiles")
            .select("spotify_artists")
            .eq("id", value: userId)
            .single()
            .execute()
            .value else { return [] }
        return row.spotifyArtists ?? []
    }

    static func loadRecentlyPlayedFromDB() async -> [SpotifyAlbumDisplay] {
        guard let userId = supabase.auth.currentUser?.id else { return [] }
        struct Row: Decodable {
            let spotifyRecentlyPlayed: [SpotifyAlbumDisplay]?
            enum CodingKeys: String, CodingKey { case spotifyRecentlyPlayed = "spotify_recently_played" }
        }
        guard let row: Row = try? await supabase
            .from("profiles")
            .select("spotify_recently_played")
            .eq("id", value: userId)
            .single()
            .execute()
            .value else { return [] }
        return row.spotifyRecentlyPlayed ?? []
    }

    static func topArtists(token: String, limit: Int = 10) async -> [SpotifyArtistDisplay] {
        guard let url = URL(string: "\(baseURL)/me/top/artists?limit=\(limit)&time_range=short_term") else { return [] }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        // Both this and recentlyPlayed() used to discard the HTTP response
        // entirely on failure (`try? data(for:)` + `try? decode`, no way to
        // tell a 401/expired-token from a 403/insufficient-scope from a
        // genuinely-empty 200) -- confirmed live 2026-09-21: a fresh Spotify
        // signup's DB columns stayed null forever (spotify_data_updated_at)
        // with zero visibility into why. Logging the status/body on any
        // non-200 is the only way the next occurrence gives a real answer
        // instead of another guess.
        guard let (data, response) = try? await URLSession.shared.data(for: req) else {
            captureSpotifyAPIFailure(endpoint: "top/artists", status: nil, data: nil)
            return []
        }
        let status = (response as? HTTPURLResponse)?.statusCode
        guard status == 200, let parsed = try? decoder.decode(SpotifyTopArtistsResponse.self, from: data) else {
            captureSpotifyAPIFailure(endpoint: "top/artists", status: status, data: data)
            return []
        }

        if parsed.items.isEmpty {
            // Structurally successful (200, decoded fine) but zero artists --
            // real, legitimate Spotify behavior for time_range=short_term
            // when there isn't enough ~4-week-recent listening activity, NOT
            // a bug by itself. Logged anyway (once) since the last two
            // rounds of the "3 rows only" investigation need to actually
            // confirm this is what's happening rather than infer it from the
            // absence of a failure capture.
            SentrySDK.capture(message: "SpotifyService.top/artists: 200 OK, 0 items (time_range=short_term)")
        }
        return parsed.items.map { SpotifyArtistDisplay(id: $0.id, name: $0.name, imageUrl: $0.imageUrl) }
    }

    static func recentlyPlayed(token: String, limit: Int = 50) async -> [SpotifyAlbumDisplay] {
        guard let url = URL(string: "\(baseURL)/me/player/recently-played?limit=\(limit)") else { return [] }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        guard let (data, urlResponse) = try? await URLSession.shared.data(for: req) else {
            captureSpotifyAPIFailure(endpoint: "recently-played", status: nil, data: nil)
            return []
        }
        let recentStatus = (urlResponse as? HTTPURLResponse)?.statusCode
        guard recentStatus == 200, let response = try? decoder.decode(SpotifyRecentlyPlayedResponse.self, from: data) else {
            captureSpotifyAPIFailure(endpoint: "recently-played", status: recentStatus, data: data)
            return []
        }

        // Deduplicate albums by id, preserving order (most recent first); skip podcasts (nil track or
        // nil album), items with nothing worth showing (empty album name -- SpotifyAlbum's own
        // lenient decode falls back to "" rather than failing), and any item that failed to decode
        // at all (LenientPlayItem.value nil -- see its own comment on SpotifyRecentlyPlayedResponse).
        var seen = Set<String>()
        var albums: [SpotifyAlbumDisplay] = []
        for wrapped in response.items {
            guard let item = wrapped.value, let track = item.track, let album = track.album,
                  !album.name.isEmpty else { continue }
            // Local files can come back with a null album id (see SpotifyAlbum's own comment) --
            // falls back to a synthetic id built from the name, which is fine here since this id is
            // only ever used for local dedup/SwiftUI Identifiable, never sent back to Spotify or
            // matched against it directly (catalog matching elsewhere goes by name+artist text).
            let albumId = album.id ?? "local:\(album.name)"
            if seen.insert(albumId).inserted {
                albums.append(SpotifyAlbumDisplay(
                    id: albumId,
                    name: album.name,
                    artistName: album.artists.first?.name ?? track.artists.first?.name ?? "",
                    imageUrl: album.imageUrl
                ))
            }
        }
        // Reported every time now, not just when the final count is zero -- confirmed live
        // 2026-09-21 that a suspiciously LOW-but-nonzero count (1, when the user expected several)
        // needs the same raw-vs-final visibility a fully empty result already got two rounds ago.
        // Distinguishes: genuinely few items in Spotify's own response (rawCount itself low),
        // items present but failing individual decode (rawCount > decodedCount), or items decoding
        // fine but being a podcast/local-file/duplicate with nothing to show (decodedCount >
        // albums.count).
        let rawCount = response.items.count
        let decodedCount = response.items.compactMap(\.value).count
        if albums.count < rawCount {
            SentrySDK.capture(message: "SpotifyService.recently-played: 200 OK, \(albums.count) albums after filtering (raw items=\(rawCount), individually-decoded=\(decodedCount))")
        }
        return albums
    }
}
