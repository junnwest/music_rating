import Foundation

struct Profile: Codable, Identifiable {
    let id: UUID
    var displayName: String?
    var username: String?
    var ratingStep: Double?
    var bio: String?
    var avatarUrl: String?
    // Notification preferences (default true)
    var notifyLikes: Bool?
    var notifyReplies: Bool?
    var notifyFollowers: Bool?
    var notifyRankings: Bool?
    var notifyCapsule: Bool?
    // Privacy settings -- profileVisibility is the general Public/Private
    // toggle and default for the three subtab overrides below; NULL on an
    // override means "same as profileVisibility."
    var profileVisibility: String?
    // Opt-out for being featured (credited) on sillajuku's social accounts.
    var allowSocialFeature: Bool?
    var catalogVisibility: String?
    var libraryVisibility: String?
    var statsVisibility: String?
    var referralCode: String?
    // Non-nil = the user has claimed their quest-completion flower badge, and
    // this is its permanent color (raw values match QuestBadgeColor + the DB
    // check constraint) -- a DB trigger blocks changing it once set, so this
    // is safe to treat as immutable once non-nil.
    var badgeColor: String?
    // Manually granted (no self-serve flow) -- see `is_verified` migration.
    var isVerified: Bool?
    // 1…500 once claimed from Quests (claim_founding_badge, migration
    // 20260926000003); nil otherwise. Shown as the rocket founding badge.
    var foundingNumber: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case displayName          = "display_name"
        case username
        case ratingStep           = "manual_rating_step"
        case bio
        case avatarUrl            = "avatar_url"
        case notifyLikes          = "notify_likes"
        case notifyReplies        = "notify_replies"
        case notifyFollowers      = "notify_followers"
        case notifyRankings       = "notify_rankings"
        case notifyCapsule        = "notify_capsule"
        case profileVisibility    = "profile_visibility"
        case allowSocialFeature   = "allow_social_feature"
        case catalogVisibility    = "catalog_visibility"
        case libraryVisibility    = "library_visibility"
        case statsVisibility      = "stats_visibility"
        case referralCode = "referral_code"
        case badgeColor   = "badge_color"
        case isVerified   = "is_verified"
        case foundingNumber = "founding_number"
    }
}

struct ProfileInsert: Encodable {
    let id: UUID
    let displayName: String
    let username: String

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case username
    }
}
