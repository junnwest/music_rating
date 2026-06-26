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
        case id, title
        case artist      = "artist_display"
        case coverUrl    = "cover_url"
        case releaseType = "release_group_type"
        case releaseDate = "first_release_date"
        case titleNative = "native_title"
        case artistNative = "artist_native"    // not on release_groups; decodes as nil
        case tracklist                         // not on release_groups; decodes as nil
        case totalTracks = "total_tracks"      // not on release_groups; decodes as nil
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
