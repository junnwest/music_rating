import SwiftUI
import Supabase

/// The no-avatar-url placeholder -- mirrors web's `Avatar.tsx` exactly: a
/// `sjBorder`-filled circle with a filled `User` glyph at ~0.58x the circle's
/// diameter, tinted `sjMuted`. Not just a bare icon -- web's circular
/// background is part of the look.
struct DefaultAvatarView: View {
    let size: CGFloat

    var body: some View {
        Circle()
            .fill(Color.sjBorder)
            .overlay {
                Image("icon-user-filled")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .frame(width: size * 0.58, height: size * 0.58)
                    .foregroundStyle(Color.sjMuted)
            }
            .frame(width: size, height: size)
    }
}

/// A user's profile photo, falling back to `DefaultAvatarView` when they have
/// none (or while it loads). Used wherever a post, comment, or like list shows
/// its author -- those rows used to render `DefaultAvatarView` unconditionally.
struct UserAvatarView: View {
    let url: String?
    let size: CGFloat

    var body: some View {
        if let url = url.flatMap(URL.init) {
            CachedImage(url: url) { DefaultAvatarView(size: size) }
                .scaledToFill()
                .frame(width: size, height: size)
                .clipShape(Circle())
        } else {
            DefaultAvatarView(size: size)
        }
    }
}

/// The signed-in user's own photo, for compose bars (the comment sheets used
/// to show `DefaultAvatarView` there unconditionally). The last-known url is
/// kept for the session so the bar opens with the photo already in place, and
/// refetched on every appearance so a just-changed photo shows up.
struct CurrentUserAvatarView: View {
    let size: CGFloat

    private static var cachedUrl: String?
    @State private var url: String? = CurrentUserAvatarView.cachedUrl

    var body: some View {
        UserAvatarView(url: url, size: size)
            .task {
                guard let userId = supabase.auth.currentUser?.id else { return }
                struct Row: Decodable {
                    let avatarUrl: String?
                    enum CodingKeys: String, CodingKey { case avatarUrl = "avatar_url" }
                }
                guard let row: Row = try? await supabase.from("profiles")
                    .select("avatar_url").eq("id", value: userId)
                    .single().execute().value else { return }
                Self.cachedUrl = row.avatarUrl
                url = row.avatarUrl
            }
    }
}
