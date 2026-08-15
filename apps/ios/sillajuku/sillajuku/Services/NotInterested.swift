import Foundation
import Supabase

/// The "Not interested" signal (tables `not_interested` / `not_interested_songs`, migrations
/// 20260719000000 / 20260810000000) -- an explicit negative signal so Quick Add stops
/// re-surfacing an album/song the user has no intention of hearing. Two separate tables
/// (album vs. song), not one polymorphic table -- see the songs migration's own comment for why.
enum NotInterested {
    @discardableResult
    static func markAlbum(releaseGroupId: UUID) async -> Bool {
        guard let userId = supabase.auth.currentUser?.id else { return false }
        struct Payload: Encodable {
            let userId: UUID; let releaseGroupId: UUID
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case releaseGroupId = "release_group_id"
            }
        }
        do {
            try await supabase.from("not_interested")
                .upsert(Payload(userId: userId, releaseGroupId: releaseGroupId),
                        onConflict: "user_id,release_group_id")
                .execute()
        } catch {
            print("NotInterested.markAlbum(\(releaseGroupId)) failed: \(error)")
            return false
        }
        return true
    }

    @discardableResult
    static func markSong(recordingId: UUID) async -> Bool {
        guard let userId = supabase.auth.currentUser?.id else { return false }
        struct Payload: Encodable {
            let userId: UUID; let recordingId: UUID
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case recordingId = "recording_id"
            }
        }
        do {
            try await supabase.from("not_interested_songs")
                .upsert(Payload(userId: userId, recordingId: recordingId),
                        onConflict: "user_id,recording_id")
                .execute()
        } catch {
            print("NotInterested.markSong(\(recordingId)) failed: \(error)")
            return false
        }
        return true
    }
}
