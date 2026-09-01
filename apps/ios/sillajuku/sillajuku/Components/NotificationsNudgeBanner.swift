import SwiftUI

/// Nudges a user whose OS-level notification permission isn't authorized
/// (denied, or never decided) -- card styling mirrors SearchView's
/// quickAddBanner. Dismissible for the current app launch only (no
/// persisted flag), so it reappears next cold start until the user actually
/// fixes it in Settings rather than being silenced forever by one tap.
struct NotificationsNudgeBanner: View {
    let onOpenSettings: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Image("icon-bell")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 18, height: 18)
                .foregroundStyle(Color.sjInk)

            VStack(alignment: .leading, spacing: 2) {
                Text("Notifications are off")
                    .font(.jakarta(14, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("Turn them on for likes, replies, and rankings.")
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Button(action: onOpenSettings) {
                Text("Enable")
                    .font(.jakarta(13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .glassEffect(.regular.tint(Color.sjBlue), in: Capsule())
            }
            .buttonStyle(.plain)

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
