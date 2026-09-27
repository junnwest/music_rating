import SwiftUI

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
