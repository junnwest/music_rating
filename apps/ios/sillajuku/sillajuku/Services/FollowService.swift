import Foundation
import Supabase

/// Where the current user stands with another account.
enum FollowState: Equatable {
    case none, requested, following
}

/// Follow / follow-request plumbing for private accounts (migration
/// 20260926000000_private_accounts). Inserting into `follows` for a private
/// target is turned into a `follow_requests` row by a DB trigger, so
/// `follow(_:)` works the same for both kinds of account; it just re-reads
/// the result to tell the caller which one happened.
enum FollowService {
    /// Mirrors get_follow_state's return shape.
    struct Status: Decodable {
        let isPrivate: Bool
        let isFollowing: Bool
        let isRequested: Bool
        let followsYou: Bool
        let canView: Bool
        let followersCount: Int
        let followingCount: Int
        let ratingsCount: Int
        let pendingRequests: Int
        /// Optional: only present once migration 20260926000002 is applied.
        let isDeactivated: Bool?
        enum CodingKeys: String, CodingKey {
            case isPrivate = "is_private", isFollowing = "is_following"
            case isRequested = "is_requested", followsYou = "follows_you"
            case canView = "can_view", followersCount = "followers_count"
            case followingCount = "following_count", ratingsCount = "ratings_count"
            case pendingRequests = "pending_requests"
            case isDeactivated = "is_deactivated"
        }

        var state: FollowState {
            isFollowing ? .following : (isRequested ? .requested : .none)
        }
    }

    /// A pending request someone sent the current user.
    struct Request: Decodable, Identifiable {
        let requesterId: UUID
        let createdAt: Date
        let requester: Requester?
        var id: UUID { requesterId }

        struct Requester: Decodable {
            let username: String?
            let displayName: String?
            let avatarUrl: String?
            enum CodingKeys: String, CodingKey {
                case username
                case displayName = "display_name"
                case avatarUrl = "avatar_url"
            }
        }
        enum CodingKeys: String, CodingKey {
            case requesterId = "requester_id"
            case createdAt = "created_at"
            case requester
        }
    }

    private struct UserParam: Encodable {
        let pUserId: UUID
        enum CodingKeys: String, CodingKey { case pUserId = "p_user_id" }
    }

    static func status(of userId: UUID) async -> Status? {
        try? await supabase
            .rpc("get_follow_state", params: UserParam(pUserId: userId))
            .single()
            .execute()
            .value
    }

    /// Follows a public account, or sends a request to a private one.
    @discardableResult
    static func follow(_ target: UUID) async -> FollowState {
        guard let me = supabase.auth.currentUser?.id else { return .none }
        struct Payload: Encodable {
            let followerId: UUID; let followingId: UUID
            enum CodingKeys: String, CodingKey {
                case followerId = "follower_id"; case followingId = "following_id"
            }
        }
        do {
            try await supabase.from("follows")
                .insert(Payload(followerId: me, followingId: target))
                .execute()
        } catch {
            print("FollowService.follow(\(target)) failed: \(error)")
        }
        NotificationCenter.default.post(name: .followChanged, object: nil)
        return await status(of: target)?.state ?? .none
    }

    /// Unfollows, or withdraws a pending request.
    static func unfollow(_ target: UUID) async {
        guard let me = supabase.auth.currentUser?.id else { return }
        _ = try? await supabase.from("follows").delete()
            .eq("follower_id", value: me).eq("following_id", value: target).execute()
        _ = try? await supabase.from("follow_requests").delete()
            .eq("requester_id", value: me).eq("target_id", value: target).execute()
        NotificationCenter.default.post(name: .followChanged, object: nil)
    }

    /// Accounts the current user has asked to follow and is still waiting on.
    static func outgoingRequestIds() async -> Set<UUID> {
        guard let me = supabase.auth.currentUser?.id else { return [] }
        struct Row: Decodable {
            let targetId: UUID
            enum CodingKeys: String, CodingKey { case targetId = "target_id" }
        }
        let rows: [Row] = (try? await supabase.from("follow_requests")
            .select("target_id").eq("requester_id", value: me).execute().value) ?? []
        return Set(rows.map(\.targetId))
    }

    /// Requests waiting on the current user's approval, newest first.
    static func incomingRequests() async -> [Request] {
        guard let me = supabase.auth.currentUser?.id else { return [] }
        return (try? await supabase.from("follow_requests")
            .select("requester_id, created_at, requester:requester_id(username, display_name, avatar_url)")
            .eq("target_id", value: me)
            .order("created_at", ascending: false)
            .execute().value) ?? []
    }

    static func respond(to requesterId: UUID, accept: Bool) async {
        struct Params: Encodable {
            let pRequester: UUID; let pAccept: Bool
            enum CodingKeys: String, CodingKey { case pRequester = "p_requester"; case pAccept = "p_accept" }
        }
        do {
            try await supabase
                .rpc("respond_follow_request", params: Params(pRequester: requesterId, pAccept: accept))
                .execute()
        } catch {
            print("FollowService.respond(\(requesterId), accept: \(accept)) failed: \(error)")
        }
        NotificationCenter.default.post(name: .followChanged, object: nil)
    }
}
