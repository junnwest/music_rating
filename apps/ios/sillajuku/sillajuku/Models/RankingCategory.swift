import Foundation

struct RankingCategory: Codable, Identifiable, Hashable {
    let id: UUID
    let name: String
    let slug: String
    let description: String?

    enum CodingKeys: String, CodingKey {
        case id, name, slug, description
    }

    static func == (lhs: RankingCategory, rhs: RankingCategory) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
