import Foundation

extension String {
    /// True when more than half of this string's letters are Hangul (syllables or jamo).
    /// Used to guard native-name fields that are mixed-provenance — some hold real Korean,
    /// others hold Japanese/Chinese transliterations from a different backfill pass.
    var isPredominantlyHangul: Bool {
        var hangulCount = 0
        var letterCount = 0
        for scalar in unicodeScalars where CharacterSet.letters.contains(scalar) {
            letterCount += 1
            switch scalar.value {
            case 0xAC00...0xD7A3, 0x1100...0x11FF, 0x3130...0x318F:
                hangulCount += 1
            default:
                break
            }
        }
        guard letterCount > 0 else { return false }
        return Double(hangulCount) / Double(letterCount) > 0.5
    }
}

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
    // var (not let) + default so the many memberwise Release(...) call sites AND the Codable
    // decoder both keep working without threading this field through each one. Present only
    // when the query/RPC selects primary_artist_id (fetchRelease's gate + search_release_groups);
    // decodes as nil otherwise. Lets album matching fall back to artist-id equality when the
    // native artist_display can't string-overlap a romanized external artist name.
    var primaryArtistId: UUID? = nil

    enum CodingKeys: String, CodingKey {
        case id, title
        case artist      = "artist_display"
        case coverUrl    = "cover_url"
        case releaseType = "release_group_type"
        case releaseDate = "first_release_date"
        case titleNative = "native_title"
        case artistNative = "artist_native"    // only present when the query/RPC joins artists explicitly; decodes as nil otherwise
        case tracklist                         // not on release_groups; decodes as nil
        case totalTracks = "total_tracks"      // not on release_groups; decodes as nil
        case primaryArtistId = "primary_artist_id" // only when selected; decodes as nil otherwise
    }

    // native_title/name_native are mixed-provenance across backfill eras — many non-Korean
    // artists carry a Japanese transliteration there instead (e.g. Drake → "ドレイク"), so only
    // trust the native field when it's actually predominantly Hangul.
    var displayTitle: String { titleNative?.isPredominantlyHangul == true ? titleNative! : title }
    var displayArtist: String { artistNative?.isPredominantlyHangul == true ? artistNative! : artist }
    var typeLabel: String {
        switch releaseType?.lowercased() {
        case "album":  return String(localized: "Album")
        case "ep":     return String(localized: "EP")
        case "single": return String(localized: "Single")
        default:       return releaseType?.capitalized ?? String(localized: "Release")
        }
    }

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
