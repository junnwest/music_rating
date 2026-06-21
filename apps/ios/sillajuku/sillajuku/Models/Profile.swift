import Foundation

struct Profile: Codable, Identifiable {
    let id: UUID
    var displayName: String?
    var username: String?
    var ratingMode: String?
    var ratingStep: Double?
    var bio: String?
    var avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case username
        case ratingMode  = "rating_mode"
        case ratingStep  = "manual_rating_step"
        case bio
        case avatarUrl   = "avatar_url"
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
