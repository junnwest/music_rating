import Foundation
import Supabase

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

struct SpotifyRecentlyPlayedResponse: Codable {
    let items: [SpotifyPlayItem]
}

struct SpotifyPlayItem: Codable {
    let track: SpotifyTrack?   // nil for podcast episodes
    let playedAt: String

    enum CodingKeys: String, CodingKey {
        case track
        case playedAt = "played_at"
    }
}

struct SpotifyTrack: Codable {
    let name: String
    let artists: [SpotifyTrackArtist]
    let album: SpotifyAlbum?   // nil for podcast episodes — those are skipped

    struct SpotifyTrackArtist: Codable { let name: String }

    struct SpotifyAlbum: Codable {
        let id: String
        let name: String
        let artists: [SpotifyTrackArtist]
        let images: [SpotifyArtist.SpotifyImage]
        var imageUrl: String? { images.first?.url }
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
        guard let token = providerToken() else { return nil }
        return await tokenIsLive(token) ? token : nil
    }

    // Lightweight liveness check — one request to /me.
    static func tokenIsLive(_ token: String) async -> Bool {
        guard let url = URL(string: "\(baseURL)/me") else { return false }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (_, response) = try? await URLSession.shared.data(for: req) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
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

        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let response = try? decoder.decode(SpotifyTopArtistsResponse.self, from: data) else { return [] }

        return response.items.map { SpotifyArtistDisplay(id: $0.id, name: $0.name, imageUrl: $0.imageUrl) }
    }

    static func recentlyPlayed(token: String, limit: Int = 50) async -> [SpotifyAlbumDisplay] {
        guard let url = URL(string: "\(baseURL)/me/player/recently-played?limit=\(limit)") else { return [] }
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let response = try? decoder.decode(SpotifyRecentlyPlayedResponse.self, from: data) else { return [] }

        // Deduplicate albums by id, preserving order (most recent first); skip podcasts (nil track or nil album)
        var seen = Set<String>()
        var albums: [SpotifyAlbumDisplay] = []
        for item in response.items {
            guard let track = item.track, let album = track.album else { continue }
            if seen.insert(album.id).inserted {
                albums.append(SpotifyAlbumDisplay(
                    id: album.id,
                    name: album.name,
                    artistName: album.artists.first?.name ?? track.artists.first?.name ?? "",
                    imageUrl: album.imageUrl
                ))
            }
        }
        return albums
    }
}
