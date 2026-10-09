import Foundation
import Supabase

/// One track an album post's author rated on that album (canonical tracklist).
struct RatedTrack: Decodable, Identifiable, Hashable {
    let userId: UUID
    let releaseGroupId: UUID
    let recordingId: UUID
    let title: String
    let discNumber: Int
    let position: Int
    let score: Double

    var id: UUID { recordingId }

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"; case releaseGroupId = "release_group_id"
        case recordingId = "recording_id"; case title
        case discNumber = "disc_number"; case position = "track_position"; case score
    }
}

/// The "Rated N tracks" data behind album posts (`get_post_rated_tracks`,
/// migration 20261006000000) -- song ratings don't post on their own, so this
/// and the album tracklist are where they show. Every card asks for its own
/// (author, album) pair; asks that land within a few ms of each other go out
/// as ONE RPC, so a feed page costs one round trip. Answers are cached for the
/// session; `invalidate` drops a user's after they rate a track.
@MainActor
final class PostRatedTracks {
    static let shared = PostRatedTracks()

    private var cache: [String: Task<[RatedTrack], Never>] = [:]
    private var pending: [(userId: UUID, releaseGroupId: UUID)] = []
    private var batch: Task<[String: [RatedTrack]]?, Never>?

    private static func key(_ userId: UUID, _ releaseGroupId: UUID) -> String {
        "\(userId.uuidString):\(releaseGroupId.uuidString)"
    }

    func tracks(userId: UUID, releaseGroupId: UUID) async -> [RatedTrack] {
        let key = Self.key(userId, releaseGroupId)
        if let hit = cache[key] { return await hit.value }

        pending.append((userId, releaseGroupId))
        let current: Task<[String: [RatedTrack]]?, Never>
        if let batch {
            current = batch
        } else {
            current = Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(30))
                let pairs = self.pending
                self.pending = []
                self.batch = nil
                let result = await Self.fetch(pairs)
                // A failed batch isn't cached as "none rated" -- the next ask retries.
                if result == nil {
                    for p in pairs { self.cache[Self.key(p.userId, p.releaseGroupId)] = nil }
                }
                return result
            }
            batch = current
        }
        let answer = Task { @MainActor in (await current.value)?[key] ?? [] }
        cache[key] = answer
        return await answer.value
    }

    func invalidate(userId: UUID) {
        let prefix = "\(userId.uuidString):"
        cache = cache.filter { !$0.key.hasPrefix(prefix) }
    }

    private static func fetch(_ pairs: [(userId: UUID, releaseGroupId: UUID)]) async -> [String: [RatedTrack]]? {
        guard !pairs.isEmpty else { return [:] }
        struct Params: Encodable {
            let userIds: [UUID]
            let releaseGroupIds: [UUID]
            enum CodingKeys: String, CodingKey {
                case userIds = "p_user_ids"; case releaseGroupIds = "p_release_group_ids"
            }
        }
        do {
            let rows: [RatedTrack] = try await supabase
                .rpc("get_post_rated_tracks", params: Params(userIds: pairs.map(\.userId),
                                                              releaseGroupIds: pairs.map(\.releaseGroupId)))
                .execute().value
            return Dictionary(grouping: rows) { key($0.userId, $0.releaseGroupId) }
        } catch {
            print("[PostRatedTracks] fetch failed: \(error)")
            return nil
        }
    }
}
