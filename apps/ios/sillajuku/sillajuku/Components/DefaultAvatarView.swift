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
