import SwiftUI
import Supabase

// MARK: - Model

struct AppNotification: Codable, Identifiable {
    let id: UUID
    let type: String
    let createdAt: Date
    let ratingId: UUID?
    let actor: Actor?
    let rating: RatingInfo?

    struct Actor: Codable {
        let username: String?
        let displayName: String?
        enum CodingKeys: String, CodingKey { case username; case displayName = "display_name" }
        var handle: String { username ?? displayName ?? "someone" }
    }

    struct RatingInfo: Codable {
        let releases: ReleaseInfo?
        struct ReleaseInfo: Codable {
            let title: String
            let artist: String
        }
    }

    enum CodingKeys: String, CodingKey {
        case id, type, actor, rating
        case createdAt = "created_at"
        case ratingId  = "rating_id"
    }

    var bodyText: String {
        let who = "@\(actor?.handle ?? "someone")"
        switch type {
        case "like":
            if let title = rating?.releases?.title { return "\(who) liked your rating of \(title)" }
            return "\(who) liked your rating"
        case "comment":
            if let title = rating?.releases?.title { return "\(who) commented on \(title)" }
            return "\(who) commented on your rating"
        case "follow":
            return "\(who) started following you"
        default:
            return "\(who) interacted with your content"
        }
    }

    var iconName: String {
        switch type {
        case "like":    return "heart.fill"
        case "comment": return "bubble.right.fill"
        case "follow":  return "person.fill.badge.plus"
        default:        return "bell.fill"
        }
    }

    var iconColor: Color {
        switch type {
        case "like":    return .red
        case "comment": return Color.sjAmber
        case "follow":  return Color.sjAmber
        default:        return Color.sjMuted
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
                    NotificationRow(notif: notif)
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
            .select("id, type, created_at, rating_id, actor:actor_id(username, display_name), rating:rating_id(releases(title, artist))")
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
