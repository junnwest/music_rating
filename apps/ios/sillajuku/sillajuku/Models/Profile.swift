import Foundation

struct Profile: Codable, Identifiable {
    let id: UUID
    var displayName: String?
    var username: String?
    var ratingMode: String?

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case username
        case ratingMode = "rating_mode"
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
