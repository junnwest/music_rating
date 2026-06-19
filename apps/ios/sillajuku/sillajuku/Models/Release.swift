import Foundation

struct TrackItem: Codable {
    let position: Int
    let title: String
    let durationMs: Int?
    let artists: [String]?
}

struct Release: Codable, Identifiable, Hashable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    let releaseType: String?
    let releaseDate: String?
    let titleNative: String?
    let artistNative: String?
    let tracklist: [TrackItem]?
    let totalTracks: Int?

    enum CodingKeys: String, CodingKey {
        case id, title, artist
        case coverUrl = "cover_url"
        case releaseType = "release_type"
        case releaseDate = "release_date"
        case titleNative = "title_native"
        case artistNative = "artist_native"
        case tracklist
        case totalTracks = "total_tracks"
    }

    var displayTitle: String { titleNative ?? title }
    var displayArtist: String { artistNative ?? artist }

    static func == (lhs: Release, rhs: Release) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

extension Release {
    static let preview = Release(
        id: UUID(),
        title: "MAGO",
        artist: "GFRIEND",
        coverUrl: nil,
        releaseType: "Album",
        releaseDate: "2020-11-09",
        titleNative: "마고",
        artistNative: "여자친구",
        tracklist: nil,
        totalTracks: nil
    )
}
