import Foundation

struct Profile: Codable, Identifiable {
    let id: UUID
    var displayName: String?
    var username: String?
    var ratingMode: String?
    var ratingStep: Double?
    var bio: String?
    var avatarUrl: String?
    // Notification preferences (default true)
    var notifyLikes: Bool?
    var notifyReplies: Bool?
    var notifyFollowers: Bool?
    var notifyRankings: Bool?
    var notifyCapsule: Bool?
    // Privacy settings (default "Public")
    var profileVisibility: String?
    var catalogVisibility: String?
    var listenLaterVisibility: String?

    enum CodingKeys: String, CodingKey {
        case id
        case displayName          = "display_name"
        case username
        case ratingMode           = "rating_mode"
        case ratingStep           = "manual_rating_step"
        case bio
        case avatarUrl            = "avatar_url"
        case notifyLikes          = "notify_likes"
        case notifyReplies        = "notify_replies"
        case notifyFollowers      = "notify_followers"
        case notifyRankings       = "notify_rankings"
        case notifyCapsule        = "notify_capsule"
        case profileVisibility    = "profile_visibility"
        case catalogVisibility    = "catalog_visibility"
        case listenLaterVisibility = "listen_later_visibility"
    }
}

struct ProfileInsert: Encodable {
    let id: UUID
    let displayName: String
    let username: String
    let ratingMode: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case username
        case ratingMode = "rating_mode"
    }
}
