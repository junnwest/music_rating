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

    struct Actor: Codable {
        let username: String?
        let displayName: String?
        enum CodingKeys: String, CodingKey { case username; case displayName = "display_name" }
        var handle: String { username ?? displayName ?? String(localized: "someone") }
    }

    struct RatingInfo: Codable {
        let releaseGroups: ReleaseInfo?
        struct ReleaseInfo: Codable {
            let id: UUID
            let title: String
            let artistDisplay: String
            let titleNative: String?
            let primaryArtist: NativeArtistRef?
            enum CodingKeys: String, CodingKey {
                case id
                case title
                case artistDisplay = "artist_display"
                case titleNative   = "native_title"
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
        case createdAt  = "created_at"
        case ratingId   = "rating_id"
        case mixId      = "mix_id"
        case mixShareId = "mix_share_id"
        case actorId    = "actor_id"
        case mixShare   = "mix_share"
    }

    var albumRelease: Release? {
        guard (type == "like" || type == "comment"), let rg = rating?.releaseGroups else { return nil }
        return Release(id: rg.id, title: rg.title, artist: rg.artistDisplay,
                       coverUrl: nil, releaseType: nil, releaseDate: nil,
                       titleNative: rg.titleNative, artistNative: rg.artistNative, tracklist: nil, totalTracks: nil)
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
        default:
            return String(format: String(localized: "%@ interacted with your content"), who)
        }
    }

    var iconName: String {
        switch type {
        case "like", "mix_like", "mix_share_like": return "heart.fill"
        case "comment", "mix_share_comment":       return "bubble.right.fill"
        case "follow":                             return "person.fill.badge.plus"
        default:                                   return "bell.fill"
        }
    }

    var iconColor: Color {
        switch type {
        case "like", "mix_like", "mix_share_like": return .red
        case "comment", "mix_share_comment":       return Color.sjAmber
        case "follow":                             return Color.sjAmber
        default:                                   return Color.sjMuted
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
                    Image(systemName: "bell")
                        .font(.system(size: 44))
                        .foregroundStyle(Color.sjBorder)
                    Text("No notifications yet")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(notifications) { notif in
                    Group {
                        if let release = notif.albumRelease {
                            NavigationLink(value: release) {
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
            .select("id, type, created_at, rating_id, mix_id, mix_share_id, actor_id, actor:actor_id(username, display_name), rating:rating_id(release_groups(id, title, artist_display, native_title, artists!release_groups_primary_artist_id_fkey(name_native))), mix:mix_id(id, user_id, name, description, is_public, is_default, created_at), mix_share:mix_share_id(mixes(id, user_id, name, description, is_public, is_default, created_at))")
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

    var body: some View {
        HStack(alignment: .top, spacing: 13) {
            // Icon
            ZStack {
                Circle()
                    .fill(notif.iconColor.opacity(0.12))
                    .frame(width: 38, height: 38)
                Image(systemName: notif.iconName)
                    .font(.system(size: 15))
                    .foregroundStyle(notif.iconColor)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(notif.bodyText)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                Text(notif.createdAt.relativeTimeString)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
    }
}
