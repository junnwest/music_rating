import SwiftUI

/// Tappable prompt row -- the Add tab's "Connect Spotify" / "Connect Apple Music" nudges
/// (SearchView.swift).
struct NudgeRow: View {
    let icon: String
    let title: LocalizedStringKey

    var body: some View {
        HStack(spacing: 12) {
            Image(icon)
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 16, height: 16)
                .foregroundStyle(Color.sjCream)
                .frame(width: 32, height: 32)
                .background(Color.sjInk)
                .clipShape(Circle())
            Text(title)
                .font(.jakarta(14.5, weight: .semibold))
                .foregroundStyle(Color.sjInk)
            Spacer(minLength: 8)
            Image("icon-chevron-right")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 12, height: 12)
                .foregroundStyle(Color.sjMuted)
        }
        .padding(14)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
