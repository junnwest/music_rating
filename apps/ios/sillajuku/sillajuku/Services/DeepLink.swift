import Foundation
import Supabase

/// A sillajuku.com page link opened in the app (Universal Link). The web
/// routes these mirror live in apps/web/app/(main)/; the paths the app may
/// claim are listed in apps/web/app/.well-known/apple-app-site-association.
/// Invite (/i/), beta (/beta/) and /auth/confirmed links are handled
/// separately in sillajukuApp.swift and never parse here.
enum DeepLink: Hashable {
    case album(UUID)
    /// The web artist route takes an artist id, or a bare name for artists
    /// the catalog couldn't match to an id.
    case artist(id: UUID?, name: String)
    case profile(username: String)
    case post(ratingId: UUID)
    case mix(UUID)

    static func parse(_ url: URL) -> DeepLink? {
        guard let host = url.host?.lowercased(),
              host == "sillajuku.com" || host == "www.sillajuku.com" else { return nil }
        // pathComponents percent-decodes and starts with "/".
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count == 2 else { return nil }
        let value = parts[1]
        switch parts[0] {
        case "album":   return UUID(uuidString: value).map { .album($0) }
        case "artist":  return .artist(id: UUID(uuidString: value), name: value)
        case "profile": return value.isEmpty ? nil : .profile(username: value)
        // /r/<id> is the old rating link the iOS feed shared before 2026-11-06;
        // the web redirects it to /post/<id>.
        case "post", "r": return UUID(uuidString: value).map { .post(ratingId: $0) }
        case "mix":     return UUID(uuidString: value).map { .mix($0) }
        default:        return nil
        }
    }
}

/// What a DeepLink resolves to: the value pushed onto Home's NavigationStack.
enum DeepLinkTarget {
    case release(Release)
    case artist(ArtistDestination)
    /// Also a post on someone else's profile (focusRatingId set).
    case user(UserProfileDestination)
    case ownProfile
    /// One of your own posts, located on the Profile tab.
    case ownPost(ratingId: UUID)
    case mix(Mix)
}

extension DeepLink {
    /// Fetches whatever the destination screen needs up front. nil when the
    /// row doesn't exist or RLS hides it (private Mix, blocked profile).
    func resolve() async -> DeepLinkTarget? {
        switch self {
        case .album(let id):
            let release: Release? = try? await supabase
                .from("release_groups")
                .select("id, title, artist_display, cover_url, release_group_type, first_release_date, native_title, primary_artist_id")
                .eq("id", value: id)
                .single()
                .execute()
                .value
            return release.map { .release($0) }

        case .artist(let id, let name):
            guard let id else { return .artist(ArtistDestination(artistId: nil, name: name)) }
            struct Row: Decodable { let name: String }
            let row: Row? = try? await supabase
                .from("artists").select("name").eq("id", value: id)
                .single().execute().value
            guard let row else { return nil }
            return .artist(ArtistDestination(artistId: id, name: row.name))

        case .profile(let username):
            struct Row: Decodable { let id: UUID; let username: String }
            let row: Row? = try? await supabase
                .from("profiles").select("id, username").eq("username", value: username)
                .single().execute().value
            guard let row else { return nil }
            if row.id == supabase.auth.currentUser?.id { return .ownProfile }
            return .user(UserProfileDestination(userId: row.id, handle: row.username))

        case .post(let ratingId):
            // A post opens on its author's profile (see PostLocator).
            guard let owner = await PostLocator.owner(ofRating: ratingId) else { return nil }
            if owner.userId == supabase.auth.currentUser?.id { return .ownPost(ratingId: ratingId) }
            return .user(UserProfileDestination(userId: owner.userId, handle: owner.username,
                                                focusRatingId: ratingId))

        case .mix(let id):
            let mix: Mix? = try? await supabase
                .from("mixes")
                .select("id, user_id, name, is_public, is_default, created_at, description, kind")
                .eq("id", value: id)
                .single()
                .execute()
                .value
            return mix.map { .mix($0) }
        }
    }
}
