import SwiftUI
import Supabase

// MARK: - Model

struct AppNotification: Codable, Identifiable {
    let id: UUID
    let type: String
    let createdAt: Date
    let ratingId: UUID?
    let mixId: UUID?
    let mixShareId: UUID?
    let actorId: UUID?
    let actor: Actor?
    let rating: RatingInfo?
    let mix: MixInfo?
    let mixShare: MixShareInfo?
    // No embedded song/release info yet (unlike `rating`/`mix`/`mixShare`) -- recordings aren't
    // directly joinable to release_groups via a single FK the way ratings/mixes are, so a
    // track_rating_like/comment notification degrades to generic text + no tap target for now,
    // same as any other notification type this model doesn't recognize (see the `default:` cases
    // below). Revisit if that's worth the extra nested-embed complexity.
    let trackRatingId: UUID?

    struct Actor: Codable {
        let username: String?
        let displayName: String?
        let avatarUrl: String?
        enum CodingKeys: String, CodingKey {
            case username; case displayName = "display_name"; case avatarUrl = "avatar_url"
        }
        var handle: String { username ?? displayName ?? String(localized: "someone") }
    }

    struct RatingInfo: Codable {
        let releaseGroups: ReleaseInfo?
        struct ReleaseInfo: Codable {
            let id: UUID
            let title: String
            let artistDisplay: String
            let titleNative: String?
            let coverUrl: String?
            let primaryArtist: NativeArtistRef?
            enum CodingKeys: String, CodingKey {
                case id
                case title
                case artistDisplay = "artist_display"
                case titleNative   = "native_title"
                case coverUrl      = "cover_url"
                case primaryArtist = "artists"
            }
            var artistNative: String? { primaryArtist?.nameNative }
            var displayTitle: String { titleNative?.isPredominantlyHangul == true ? titleNative! : title }
            var displayArtist: String { artistNative?.isPredominantlyHangul == true ? artistNative! : artistDisplay }
        }
        enum CodingKeys: String, CodingKey {
            case releaseGroups = "release_groups"
        }
    }

    struct MixInfo: Codable {
        let id: UUID
        let userId: UUID
        let name: String
        let description: String?
        let isPublic: Bool
        let isDefault: Bool
        let createdAt: Date
        enum CodingKeys: String, CodingKey {
            case id, name, description
            case userId = "user_id"; case isPublic = "is_public"
            case isDefault = "is_default"; case createdAt = "created_at"
        }
    }

    struct MixShareInfo: Codable {
        let mixes: MixInfo?
    }

    enum CodingKeys: String, CodingKey {
        case id, type, actor, rating, mix
        case createdAt     = "created_at"
        case ratingId      = "rating_id"
        case mixId         = "mix_id"
        case mixShareId    = "mix_share_id"
        case actorId       = "actor_id"
        case mixShare      = "mix_share"
        case trackRatingId = "track_rating_id"
    }

    // A like/comment notification is about a specific post (the rating, with its own review
    // text/like-comment thread) -- linking to the bare release page loses that entirely
    // (AlbumDetailView only shows aggregate community stats, never individual posts). These
    // route to a real single-post screen instead.
    var albumPostDestination: AlbumPostDestination? {
        guard (type == "like" || type == "comment"), let ratingId else { return nil }
        return AlbumPostDestination(ratingId: ratingId)
    }

    var songPostDestination: SongPostDestination? {
        guard (type == "track_rating_like" || type == "track_rating_comment"), let trackRatingId else { return nil }
        return SongPostDestination(ratingId: trackRatingId)
    }

    var actorDestination: UserProfileDestination? {
        guard type == "follow", let actorId else { return nil }
        return UserProfileDestination(userId: actorId, handle: actor?.handle ?? String(localized: "someone"))
    }

    var mixDestination: Mix? {
        if type == "mix_like", let m = mix {
            return Mix(id: m.id, userId: m.userId, name: m.name, isPublic: m.isPublic,
                       isDefault: m.isDefault, createdAt: m.createdAt, description: m.description)
        }
        if (type == "mix_share_like" || type == "mix_share_comment"), let m = mixShare?.mixes {
            return Mix(id: m.id, userId: m.userId, name: m.name, isPublic: m.isPublic,
                       isDefault: m.isDefault, createdAt: m.createdAt, description: m.description)
        }
        return nil
    }

    var bodyText: String {
        let who = "@" + (actor?.handle ?? String(localized: "someone"))
        switch type {
        case "like":
            if let title = rating?.releaseGroups?.displayTitle {
                return String(format: String(localized: "%@ liked your rating of %@"), who, title)
            }
            return String(format: String(localized: "%@ liked your rating"), who)
        case "comment":
            if let title = rating?.releaseGroups?.displayTitle {
                return String(format: String(localized: "%@ commented on %@"), who, title)
            }
            return String(format: String(localized: "%@ commented on your rating"), who)
        case "follow":
            return String(format: String(localized: "%@ started following you"), who)
        case "mix_like":
            if let name = mix?.name {
                return String(format: String(localized: "%@ liked your mix \"%@\""), who, name)
            }
            return String(format: String(localized: "%@ liked your mix"), who)
        case "mix_share_like":
            return String(format: String(localized: "%@ liked your shared mix"), who)
        case "mix_share_comment":
            return String(format: String(localized: "%@ commented on your shared mix"), who)
        case "track_rating_like":
            return String(format: String(localized: "%@ liked your song rating"), who)
        case "track_rating_comment":
            return String(format: String(localized: "%@ commented on your song rating"), who)
        default:
            return String(format: String(localized: "%@ interacted with your content"), who)
        }
    }

    var iconName: String {
        switch type {
        case "like", "mix_like", "mix_share_like", "track_rating_like": return "icon-heart-filled"
        case "comment", "mix_share_comment", "track_rating_comment":    return "icon-message-square"
        case "follow":                                                  return "icon-user-plus"
        default:                                                        return "icon-bell"
        }
    }

    var iconColor: Color {
        switch type {
        case "like", "mix_like", "mix_share_like", "track_rating_like": return .red
        case "comment", "mix_share_comment", "track_rating_comment":    return Color.sjAmber
        case "follow":                                                  return Color.sjAmber
        default:                                                        return Color.sjMuted
        }
    }
}

// MARK: - View

struct NotificationsView: View {
    @State private var notifications: [AppNotification] = []
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if notifications.isEmpty {
                VStack(spacing: 14) {
                    Image("icon-bell")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 44, height: 44)
                        .foregroundStyle(Color.sjBorder)
                    Text("No notifications yet")
                        .font(.jakarta(15))
                        .foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(notifications) { notif in
                    Group {
                        if let dest = notif.albumPostDestination {
                            NavigationLink(value: dest) {
                                NotificationRow(notif: notif)
                            }
                        } else if let dest = notif.songPostDestination {
                            NavigationLink(value: dest) {
                                NotificationRow(notif: notif)
                            }
                        } else if let dest = notif.actorDestination {
                            NavigationLink(value: dest) {
                                NotificationRow(notif: notif)
                            }
                        } else if let mix = notif.mixDestination {
                            // Direct destination, not NavigationLink(value:) -- this
                            // view is its own distinct navigation stack, matching the
                            // convention already used for MixDetailView elsewhere.
                            NavigationLink(destination: MixDetailView(mix: mix)) {
                                NotificationRow(notif: notif)
                            }
                        } else {
                            NotificationRow(notif: notif)
                        }
                    }
                    .listRowBackground(Color.sjSurface)
                    .listRowSeparatorTint(Color.sjBorder.opacity(0.5))
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
            await markAllRead()
        }
    }

    private func load() async {
        guard let userId = supabase.auth.currentUser?.id else { isLoading = false; return }
        isLoading = true
        notifications = (try? await supabase
            .from("notifications")
            .select("id, type, created_at, rating_id, mix_id, mix_share_id, actor_id, track_rating_id, actor:actor_id(username, display_name, avatar_url), rating:rating_id(release_groups(id, title, artist_display, native_title, cover_url, artists!release_groups_primary_artist_id_fkey(name_native))), mix:mix_id(id, user_id, name, description, is_public, is_default, created_at), mix_share:mix_share_id(mixes(id, user_id, name, description, is_public, is_default, created_at))")
            .eq("user_id", value: userId)
            .order("created_at", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []
        isLoading = false
    }

    private func markAllRead() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct Patch: Encodable {
            let notificationsLastSeenAt: Date
            enum CodingKeys: String, CodingKey {
                case notificationsLastSeenAt = "notifications_last_seen_at"
            }
        }
        _ = try? await supabase
            .from("profiles")
            .update(Patch(notificationsLastSeenAt: Date()))
            .eq("id", value: userId)
            .execute()
    }
}

// MARK: - Row

private struct NotificationRow: View {
    let notif: AppNotification

    // Every notification type in this system is actor-driven (like/comment/follow/mix_like/
    // mix_share_like/mix_share_comment/track_rating_like/track_rating_comment all set actor_id
    // to the acting user) -- so the actor's own avatar is always the more informative image, with
    // the old icon-only circle demoted to a small type badge in the corner (who did it + what
    // they did, instead of just what).
    private var avatar: some View {
        Group {
            if let urlStr = notif.actor?.avatarUrl, let url = URL(string: urlStr) {
                CachedImage(url: url) { defaultAvatar }
                    .scaledToFill()
            } else {
                defaultAvatar
            }
        }
        .frame(width: 38, height: 38)
        .clipShape(Circle())
    }

    private var defaultAvatar: some View {
        DefaultAvatarView(size: 38)
    }

    private var typeBadge: some View {
        ZStack {
            Circle()
                .fill(notif.iconColor)
                .frame(width: 18, height: 18)
            Image(notif.iconName)
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 9, height: 9)
                .foregroundStyle(.white)
        }
        .overlay(Circle().stroke(Color.sjCream, lineWidth: 2))
    }

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            ZStack(alignment: .bottomTrailing) {
                avatar
                typeBadge
                    .offset(x: 3, y: 3)
            }
            .accessibilityHidden(true) // bodyText alongside already names the actor and the action

            VStack(alignment: .leading, spacing: 3) {
                Text(notif.bodyText)
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text(notif.createdAt.relativeTimeString)
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
    }
}

// MARK: - Single-post destinations

// A notification's rating_id/track_rating_id always belongs to the CURRENT signed-in user --
// the notify triggers explicitly set the recipient to the rating's owner and exclude self-
// notifications (owner_id <> actor), so "the post this notification is about" is always one of
// my own ratings, never someone else's. That's what makes a plain ratingId-keyed fetch safe here
// without an extra ownership check.
struct AlbumPostDestination: Hashable {
    let ratingId: UUID
}

struct SongPostDestination: Hashable {
    let ratingId: UUID
}

// MARK: - Album post detail

// Single-post screen for an album-rating like/comment notification -- reuses ProfilePostCard
// exactly (Main/ProfileView.swift), just fed by a fresh fetch keyed on one rating id instead of
// the owning ProfileViewModel's whole in-memory list, since a notification can point at a rating
// from well before whatever page ProfileViewModel currently has loaded.
struct AlbumPostDetailView: View {
    let ratingId: UUID

    @State private var rating: UserRating?
    @State private var isLoading = true
    @State private var totalRatingsCount = 0
    @State private var likesCount = 0
    @State private var commentsCount = 0
    @State private var isLiked = false
    @State private var myHandle: String? = nil
    @State private var myVerified = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let rating {
                ScrollView(showsIndicators: false) {
                    ProfilePostCard(
                        rating: rating,
                        likesCount: likesCount,
                        commentsCount: commentsCount,
                        isLiked: isLiked,
                        onLike: toggleLike,
                        headerHandle: myHandle,
                        headerVerified: myVerified
                    )
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                }
            } else {
                VStack(spacing: 12) {
                    Image("icon-alert-circle")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 36, height: 36)
                        .foregroundStyle(Color.sjBorder)
                    Text("This rating is no longer available")
                        .font(.jakarta(15)).foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Post")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard let userId = supabase.auth.currentUser?.id else { isLoading = false; return }

        rating = try? await supabase
            .from("ratings")
            .select("id, score, review_text, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))")
            .eq("id", value: ratingId)
            .single()
            .execute()
            .value

        // These single-post screens always show one of the signed-in user's own
        // ratings (see the comment on AlbumPostDestination), so the card header
        // is the user's own handle.
        struct MyProfile: Decodable {
            let username: String?
            let isVerified: Bool?
            enum CodingKeys: String, CodingKey { case username; case isVerified = "is_verified" }
        }
        if let p: MyProfile = try? await supabase.from("profiles")
            .select("username, is_verified").eq("id", value: userId)
            .single().execute().value {
            myHandle = p.username
            myVerified = p.isVerified == true
        }

        if let r = try? await supabase.from("ratings").select("*", count: .exact)
            .eq("user_id", value: userId).execute() {
            totalRatingsCount = r.count ?? 0
        }
        if let r = try? await supabase.from("rating_likes").select("*", count: .exact)
            .eq("rating_id", value: ratingId).execute() {
            likesCount = r.count ?? 0
        }
        if let r = try? await supabase.from("rating_comments").select("*", count: .exact)
            .eq("rating_id", value: ratingId).execute() {
            commentsCount = r.count ?? 0
        }
        struct IdRow: Decodable {
            let ratingId: UUID
            enum CodingKeys: String, CodingKey { case ratingId = "rating_id" }
        }
        if let rows: [IdRow] = try? await supabase
            .from("rating_likes").select("rating_id")
            .eq("user_id", value: userId).eq("rating_id", value: ratingId)
            .execute().value {
            isLiked = !rows.isEmpty
        }
        isLoading = false
    }

    private func toggleLike() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = isLiked
        isLiked.toggle()
        likesCount = max(0, likesCount + (wasLiked ? -1 : 1))
        do {
            if wasLiked {
                try await supabase.from("rating_likes").delete()
                    .eq("user_id", value: userId).eq("rating_id", value: ratingId).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let ratingId: UUID
                    enum CodingKeys: String, CodingKey { case userId = "user_id"; case ratingId = "rating_id" }
                }
                try await supabase.from("rating_likes")
                    .insert(Payload(userId: userId, ratingId: ratingId)).execute()
            }
        } catch {
            isLiked = wasLiked
            likesCount = max(0, likesCount + (wasLiked ? 1 : -1))
        }
    }
}

// MARK: - Song post detail

// Single-post screen for a song-rating like/comment notification -- reuses ProfileSongPostCard
// exactly (Main/ProfileView.swift), same shape as AlbumPostDetailView above.
struct SongPostDetailView: View {
    let ratingId: UUID

    @State private var song: SongRatingRow?
    @State private var isLoading = true
    @State private var likesCount = 0
    @State private var commentsCount = 0
    @State private var isLiked = false
    @State private var myHandle: String? = nil
    @State private var myVerified = false

    var body: some View {
        Group {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let song {
                ScrollView(showsIndicators: false) {
                    ProfileSongPostCard(
                        song: song,
                        likesCount: likesCount,
                        commentsCount: commentsCount,
                        isLiked: isLiked,
                        onLike: toggleLike,
                        headerHandle: myHandle,
                        headerVerified: myVerified
                    )
                    .padding(.horizontal, 12)
                    .padding(.top, 12)
                }
            } else {
                VStack(spacing: 12) {
                    Image("icon-alert-circle")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 36, height: 36)
                        .foregroundStyle(Color.sjBorder)
                    Text("This rating is no longer available")
                        .font(.jakarta(15)).foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Post")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard let userId = supabase.auth.currentUser?.id else { isLoading = false; return }

        struct TrackRatingRow: Codable {
            let id: UUID
            let recordingId: UUID
            let score: Double?
            let reviewText: String?
            let createdAt: Date
            let recordings: RecordingInfo
            struct RecordingInfo: Codable {
                let id: UUID; let title: String; let artistDisplay: String?
                enum CodingKeys: String, CodingKey {
                    case id, title; case artistDisplay = "artist_display"
                }
            }
            enum CodingKeys: String, CodingKey {
                case id, recordingId = "recording_id"; case score
                case reviewText = "review_text"
                case createdAt = "created_at"; case recordings
            }
        }
        guard let raw: TrackRatingRow = try? await supabase
            .from("track_ratings")
            .select("id, recording_id, score, review_text, created_at, recordings(id, title, artist_display)")
            .eq("id", value: ratingId)
            .single()
            .execute()
            .value else {
            isLoading = false
            return
        }

        struct RTCoverRow: Codable {
            let releases: CoverRelRow?
            struct CoverRelRow: Codable {
                let isCanonical: Bool?
                let releaseGroups: RGCover?
                struct RGCover: Codable {
                    let id: UUID; let title: String; let artistDisplay: String?; let coverUrl: String?
                    let titleNative: String?; let primaryArtist: NativeArtistRef?
                    enum CodingKeys: String, CodingKey {
                        case id, title; case artistDisplay = "artist_display"; case coverUrl = "cover_url"
                        case titleNative = "native_title"; case primaryArtist = "artists"
                    }
                }
                enum CodingKeys: String, CodingKey {
                    case isCanonical = "is_canonical"; case releaseGroups = "release_groups"
                }
            }
        }
        let coverRows: [RTCoverRow] = (try? await supabase
            .from("release_tracks")
            .select("releases(is_canonical, release_groups(id, title, artist_display, cover_url, native_title, artists!release_groups_primary_artist_id_fkey(name_native)))")
            .eq("recording_id", value: raw.recordingId)
            .execute()
            .value) ?? []
        var rg: RTCoverRow.CoverRelRow.RGCover?
        for row in coverRows {
            guard let rel = row.releases, let candidate = rel.releaseGroups else { continue }
            if rel.isCanonical == true || rg == nil { rg = candidate }
        }
        let ref = ReleaseRef(
            id:            rg?.id ?? UUID(),
            title:         rg?.title ?? "",
            artist:        rg?.artistDisplay ?? raw.recordings.artistDisplay ?? "",
            coverUrl:      rg?.coverUrl,
            releaseType:   nil,
            titleNative:   rg?.titleNative,
            primaryArtist: rg?.primaryArtist
        )
        song = SongRatingRow(
            ratingId: raw.id, recordingId: raw.recordingId, score: raw.score,
            reviewText: raw.reviewText, trackTitle: raw.recordings.title, release: ref, createdAt: raw.createdAt
        )

        // Own-post header identity (see AlbumPostDetailView's matching fetch).
        struct MyProfile: Decodable {
            let username: String?
            let isVerified: Bool?
            enum CodingKeys: String, CodingKey { case username; case isVerified = "is_verified" }
        }
        if let p: MyProfile = try? await supabase.from("profiles")
            .select("username, is_verified").eq("id", value: userId)
            .single().execute().value {
            myHandle = p.username
            myVerified = p.isVerified == true
        }

        if let r = try? await supabase.from("track_rating_likes").select("*", count: .exact)
            .eq("track_rating_id", value: ratingId).execute() {
            likesCount = r.count ?? 0
        }
        if let r = try? await supabase.from("track_rating_comments").select("*", count: .exact)
            .eq("track_rating_id", value: ratingId).execute() {
            commentsCount = r.count ?? 0
        }
        struct IdRow: Decodable {
            let trackRatingId: UUID
            enum CodingKeys: String, CodingKey { case trackRatingId = "track_rating_id" }
        }
        if let rows: [IdRow] = try? await supabase
            .from("track_rating_likes").select("track_rating_id")
            .eq("user_id", value: userId).eq("track_rating_id", value: ratingId)
            .execute().value {
            isLiked = !rows.isEmpty
        }
        isLoading = false
    }

    private func toggleLike() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = isLiked
        isLiked.toggle()
        likesCount = max(0, likesCount + (wasLiked ? -1 : 1))
        do {
            if wasLiked {
                try await supabase.from("track_rating_likes").delete()
                    .eq("user_id", value: userId).eq("track_rating_id", value: ratingId).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let trackRatingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case trackRatingId = "track_rating_id"
                    }
                }
                try await supabase.from("track_rating_likes")
                    .insert(Payload(userId: userId, trackRatingId: ratingId)).execute()
            }
        } catch {
            isLiked = wasLiked
            likesCount = max(0, likesCount + (wasLiked ? 1 : -1))
        }
    }
}
