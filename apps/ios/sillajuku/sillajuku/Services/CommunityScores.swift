import Foundation
import Supabase

/// Every score for an album/song, with no user ids attached
/// (get_album_community_scores / get_song_community_scores, migration
/// 20260926000000_private_accounts). Reading `ratings` directly only returns
/// rows the viewer is allowed to see, which leaves private accounts out of
/// averages; these RPCs keep them in, anonymously.
enum CommunityScores {
    struct AlbumScore: Decodable {
        let releaseGroupId: UUID
        let score: Double?
        enum CodingKeys: String, CodingKey { case releaseGroupId = "release_group_id", score }
    }

    struct SongScore: Decodable {
        let recordingId: UUID
        let score: Double?
        enum CodingKeys: String, CodingKey { case recordingId = "recording_id", score }
    }

    static func albums(_ releaseGroupIds: [UUID]) async -> [AlbumScore] {
        guard !releaseGroupIds.isEmpty else { return [] }
        struct Params: Encodable {
            let ids: [UUID]
            enum CodingKeys: String, CodingKey { case ids = "p_release_group_ids" }
        }
        return (try? await supabase
            .rpc("get_album_community_scores", params: Params(ids: releaseGroupIds))
            .execute().value) ?? []
    }

    static func songs(_ recordingIds: [UUID]) async -> [SongScore] {
        guard !recordingIds.isEmpty else { return [] }
        struct Params: Encodable {
            let ids: [UUID]
            enum CodingKeys: String, CodingKey { case ids = "p_recording_ids" }
        }
        return (try? await supabase
            .rpc("get_song_community_scores", params: Params(ids: recordingIds))
            .execute().value) ?? []
    }
}
