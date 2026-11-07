import SwiftUI
import Supabase

/// Opening one specific album-rating post: a post notification or a
/// sillajuku.com/post/<id> link opens the author's profile (Rated tab, post
/// view) scrolled to that post and briefly outlined. There is no separate
/// single-post screen. Used by ProfileView (your own posts) and
/// UserProfileView (everyone else's).
enum PostLocator {
    /// Same shape as ProfileViewModel.fetchAlbumRatings / get_profile_album_ratings.
    static let ratingSelect = "id, score, review_text, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))"

    /// The post's author, for routing. nil if the rating is gone or hidden.
    static func owner(ofRating ratingId: UUID) async -> (userId: UUID, username: String)? {
        struct RatingRow: Decodable {
            let userId: UUID
            enum CodingKeys: String, CodingKey { case userId = "user_id" }
        }
        struct ProfileRow: Decodable { let username: String? }
        guard let rating: RatingRow = try? await supabase
            .from("ratings").select("user_id").eq("id", value: ratingId)
            .single().execute().value else { return nil }
        let profile: ProfileRow? = try? await supabase
            .from("profiles").select("username").eq("id", value: rating.userId)
            .single().execute().value
        return (rating.userId, profile?.username ?? String(localized: "someone"))
    }

    /// One post by id. Profiles load only their 60 newest ratings, so an older
    /// post has to be fetched on its own and added to the list.
    static func fetchRating(_ ratingId: UUID, ownedBy userId: UUID) async -> UserRating? {
        try? await supabase
            .from("ratings").select(ratingSelect)
            .eq("id", value: ratingId).eq("user_id", value: userId)
            .single().execute().value
    }

    /// Like count, comment count, and whether you liked it, for one post.
    static func social(for ratingId: UUID) async -> (likes: Int, comments: Int, likedByMe: Bool) {
        async let likes = try? await supabase.from("rating_likes")
            .select("*", head: true, count: .exact).eq("rating_id", value: ratingId).execute().count
        async let comments = try? await supabase.from("rating_comments")
            .select("*", head: true, count: .exact).eq("rating_id", value: ratingId).execute().count
        var liked = false
        if let me = supabase.auth.currentUser?.id,
           let n = try? await supabase.from("rating_likes")
            .select("*", head: true, count: .exact)
            .eq("rating_id", value: ratingId).eq("user_id", value: me).execute().count {
            liked = n > 0
        }
        return (await likes ?? 0, await comments ?? 0, liked)
    }

    /// Scrolls a lazily-built post list to `id`. The second pass corrects the
    /// landing spot once the rows above it have been measured.
    @MainActor
    static func scroll(_ proxy: ScrollViewProxy, to id: UUID) async {
        withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo(id, anchor: .top) }
        try? await Task.sleep(for: .seconds(0.4))
        withAnimation(.easeInOut(duration: 0.25)) { proxy.scrollTo(id, anchor: .top) }
    }

    /// How long the outline stays before fading (same as the album page's track highlight).
    static let highlightDuration: Duration = .seconds(2.6)
}

extension View {
    /// Outlines a ProfilePostCard (16pt corners) while it's the focused post.
    func postFocusOutline(_ isOn: Bool) -> some View {
        overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.sjAmber, lineWidth: 2)
                .opacity(isOn ? 1 : 0)
                .allowsHitTesting(false)
        )
    }
}
