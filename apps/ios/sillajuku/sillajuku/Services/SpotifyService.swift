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

struct SpotifyArtistDisplay: Identifiable {
    let id: String
    let name: String
    let imageUrl: String?
}

struct SpotifyAlbumDisplay: Identifiable {
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

    // Returns nil if the user didn't log in with Spotify or the token is missing.
    // Caches the most-recently-seen token so Supabase session refreshes don't erase it.
    static func providerToken() async -> String? {
        if let token = try? await supabase.auth.session.providerToken {
            UserDefaults.standard.set(token, forKey: "sj_spotify_provider_token")
            return token
        }
        return UserDefaults.standard.string(forKey: "sj_spotify_provider_token")
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
