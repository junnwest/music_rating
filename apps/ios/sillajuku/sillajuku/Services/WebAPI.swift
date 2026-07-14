import Foundation
import Supabase
import Auth

// Calls sillajuku's own Next.js API routes directly -- for algorithm work (recommendations,
// discovery, taste profile) that lives in TypeScript route handlers on web, not in Postgres RPCs
// this app can call the usual way. One algorithm, one source of truth, instead of a second Swift
// implementation that inevitably drifts from web's. Same auth pattern SettingsView's
// deleteAccount() already uses: Config.webBaseURL + Bearer session.accessToken.
enum WebAPI {
    static func get<T: Decodable>(_ path: String, authed: Bool, query: [String: String] = [:]) async -> T? {
        guard var components = URLComponents(url: Config.webBaseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            return nil
        }
        if !query.isEmpty {
            components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = components.url else { return nil }

        var request = URLRequest(url: url)
        if authed {
            guard let session = try? await supabase.auth.session else { return nil }
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        }

        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

// MARK: - /api/discovery (unauthenticated)

struct DiscoveryResponse: Decodable {
    let popular: [Release]
    let newReleases: [Release]
    let trending: [Release]
}

// MARK: - /api/recommendations (authenticated)

struct RecommendationsResponse: Decodable {
    let fromYourTaste: [Release]
    let forYou: [Release]
    let worlds: [World]
    let blockedArtists: [String]

    struct World: Decodable {
        let label: String
        let albums: [Release]
    }
}

// MARK: - /api/taste/profile (authenticated)

struct TasteProfileResponse: Decodable {
    let ratingCount: Int
    let type: TasteType
    let standings: [GenreStandingRow]
    let stats: TasteStats
    let topAlbum: TasteTopAlbum?

    struct TasteType: Decodable {
        let code: String
        let adjectiveKey: String
        let nounKey: String
    }

    struct GenreStandingRow: Decodable {
        let genre: String
        let userAvg: Double
        let communityAvg: Double
        let userCount: Int
    }

    struct TasteStats: Decodable {
        let months: [Int]
        let peakMonthIndex: Int?
        let peakMonthCount: Int
    }

    struct TasteTopAlbum: Decodable {
        let id: UUID
        let title: String
        let artist: String
        let coverUrl: String?
        let score: Double
    }
}
