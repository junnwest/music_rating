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
            guard let session = try? await supabase.auth.session else {
                print("WebAPI.get(\(path)): no auth session available")
                return nil
            }
            request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            print("WebAPI.get(\(path)): network error: \(error)")
            return nil
        }
        let statusCode = (response as? HTTPURLResponse)?.statusCode
        guard statusCode == 200 else {
            let body = String(data: data, encoding: .utf8) ?? "<non-utf8 body>"
            print("WebAPI.get(\(path)): HTTP \(statusCode.map(String.init) ?? "?") -- \(body)")
            return nil
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            print("WebAPI.get(\(path)): decode error: \(error)")
            return nil
        }
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

// v4 (2026-07-13 web rebuild, MBTI 4-letter type removed in favor of a graphical chart report --
// decade/score-distribution histograms, scene mix, canon reach, 12-month timeline). Decoded in
// full since 2026-07-18: iOS's TasteView now renders the same chart report web does.
// v5 (2026-08-13, taste-page rebuild port): added `graph` (treemap worlds/albums/recs) and
// `charts.years` -- both already sent by the API since the 2026-08-10/11 web rebuild, but
// silently dropped by JSONDecoder until now since it ignores unknown keys rather than erroring.
// v11 (2026-08-27, "By the numbers" rebuild): `charts.years[i]` changed from `{year, count}` to
// `{year, above, below}` (a diverging above/below-your-average split, not a single tally) --
// this broke decoding entirely until fixed (confirmed live: every load failed with
// DecodingError.keyNotFound("count") once the API moved to this shape). Added `topScore`/
// `topAlbums` (every album tied at the top score, for a rotating "hall of fame") and
// `stats.median`/`skew`/`effectiveGenres`/`communityDelta`/`perfectRate`.
struct TasteProfileResponse: Decodable {
    let ratingCount: Int
    let albumRatingCount: Int
    let totalTags: Int
    let clusters: [TasteWorld]
    let disliked: [DislikedTag]
    let standings: [GenreStandingRow]
    let graph: TasteGraph?
    let charts: TasteCharts
    let stats: TasteStats
    let topScore: Double?
    let topAlbums: [TasteTopAlbum]
    let topAlbum: TasteTopAlbum?

    struct TasteGraph: Decodable {
        let worlds: [GraphWorld]
        let albums: [GraphAlbum]
        let recs: [String: [GraphRec]]

        struct GraphWorld: Decodable {
            let key: String
            let label: String
            let primary: String
            let share: Double
            let mass: Double
            let avg: Double?
            /// Cosine similarity to every world (including itself), same index order as `clusters`.
            let sim: [Double]
            let tags: [GraphTag]
            /// Pairwise cosine among this world's own tags, same index order as `tags`.
            let tagSim: [[Double]]

            struct GraphTag: Decodable {
                let tag: String
                let display: String
                let mass: Double
                let share: Double
                let avg: Double
            }
        }

        struct GraphAlbum: Decodable {
            let id: UUID
            let title: String
            let artist: String
            let coverUrl: String?
            let score: Double
            let tags: [String]
        }

        struct GraphRec: Decodable {
            let id: UUID
            let title: String
            let artist: String
            let coverUrl: String?
        }
    }

    struct TasteWorld: Decodable {
        let share: Double
        let avgScore: Double?
        let meanYear: Double?
        let sdYears: Double?
        let dominantScene: String?  // "kr" | "jp" | "west" | "other"
        let tags: [WorldTag]

        struct WorldTag: Decodable {
            let tag: String
            let display: String
            let avg: Double
            let n: Double
        }
    }

    struct DislikedTag: Decodable {
        let tag: String
        let display: String
    }

    struct GenreStandingRow: Decodable {
        let genre: String
        let userAvg: Double
        let communityAvg: Double
        let userCount: Int
    }

    struct TasteStats: Decodable {
        let avgScore: Double?
        let sdScore: Double?
        let fiveStars: Int
        let perfectRate: Double?
        let median: Double?
        let skew: Double?
        let effectiveGenres: Double?
        let communityDelta: Double?
        let meanYear: Int?
        let sdYears: Double?
        let prestigeShare: Double?
    }

    struct TasteCharts: Decodable {
        // Contiguous, zero-filled between first and last rated decade.
        let decades: [DecadeBin]
        // Contiguous, zero-filled between first and last rated year -- finer-grained than
        // `decades`, used by the year histogram since the 2026-08-10 web rebuild.
        let years: [YearBin]
        // Half-star buckets, index 0 = 0.5★ … 9 = 5.0★.
        let scoreDist: [Int]
        let scenes: SceneMix?
        // "YYYY-MM", oldest first, 12 entries (a rolling window, not fixed Jan-Dec).
        let timeline: [TimelineEntry]
        let peakMonthIndex: Int?

        struct DecadeBin: Decodable {
            let decade: Int
            let count: Int
        }

        // Per-release-year split of scored ratings around the overall average -- v11 replaced
        // the single `count` tally with this above/below split so the chart can show both how
        // much you rated from an era and how you felt about it (diverging frequency histogram).
        struct YearBin: Decodable {
            let year: Int
            let above: Int
            let below: Int
        }

        struct SceneMix: Decodable {
            let counts: Counts
            let total: Int

            struct Counts: Decodable {
                let kr: Int
                let jp: Int
                let west: Int
                let other: Int
            }
        }

        struct TimelineEntry: Decodable {
            let month: String
            let count: Int
        }
    }

    struct TasteTopAlbum: Decodable {
        let id: UUID
        let title: String
        let artist: String
        let coverUrl: String?
        let score: Double
    }
}
