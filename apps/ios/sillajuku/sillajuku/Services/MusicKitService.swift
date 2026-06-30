import Foundation
import MusicKit

// MARK: - Display models

struct AppleMusicArtistDisplay: Identifiable {
    let id: String
    let name: String
    let artworkURL: URL?

    init(from artist: Artist) {
        id         = artist.id.rawValue
        name       = artist.name
        artworkURL = artist.artwork?.url(width: 300, height: 300)
    }
}

struct AppleMusicAlbumDisplay: Identifiable {
    let id: String
    let name: String
    let artistName: String
    let artworkURL: URL?

    init(from album: Album) {
        id         = album.id.rawValue
        name       = album.title
        artistName = album.artistName
        artworkURL = album.artwork?.url(width: 300, height: 300)
    }
}

// MARK: - Service

enum MusicKitService {

    static var isAuthorized: Bool {
        MusicAuthorization.currentStatus == .authorized
    }

    @discardableResult
    static func requestAuthorization() async -> Bool {
        await MusicAuthorization.request() == .authorized
    }

    // Returns albums sorted by most-recently played (using library last-played date).
    static func fetchRecentlyPlayedAlbums(limit: Int = 20) async -> [AppleMusicAlbumDisplay] {
        guard isAuthorized else { return [] }
        var request = MusicLibraryRequest<Album>()
        request.limit = limit
        request.sort(by: \.lastPlayedDate, ascending: false)
        guard let response = try? await request.response() else { return [] }
        return response.items.map { AppleMusicAlbumDisplay(from: $0) }
    }

    static func fetchLibraryAlbums(limit: Int = 25) async -> [AppleMusicAlbumDisplay] {
        guard isAuthorized else { return [] }
        var request = MusicLibraryRequest<Album>()
        request.limit = limit
        guard let response = try? await request.response() else { return [] }
        return response.items.map { AppleMusicAlbumDisplay(from: $0) }
    }

    static func fetchLibraryArtists(limit: Int = 20) async -> [AppleMusicArtistDisplay] {
        guard isAuthorized else { return [] }
        var request = MusicLibraryRequest<Artist>()
        request.limit = limit
        guard let response = try? await request.response() else { return [] }
        return response.items.map { AppleMusicArtistDisplay(from: $0) }
    }
}
