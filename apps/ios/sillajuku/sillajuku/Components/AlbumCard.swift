import SwiftUI

struct AlbumCard: View {
    let release: Release
    var onAdd: (() -> Void)? = nil
    var isRated: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomTrailing) {
                CoverImage(url: release.coverUrl, cornerRadius: 8)
                    .aspectRatio(1, contentMode: .fit)
                    // Decorative: the title/artist Text below already describes this
                    // exact release, so a separate label would just repeat it.
                    .accessibilityHidden(true)

                if isRated {
                    ZStack {
                        Circle()
                            .fill(Color.sjBlue)
                            .frame(width: 28, height: 28)
                            .shadow(color: .black.opacity(0.15), radius: 4, y: 1)
                        Image("icon-check")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 11, height: 11)
                            .foregroundStyle(.white)
                    }
                    .allowsHitTesting(false)
                    .padding(6)
                } else if let onAdd {
                    Button(action: onAdd) {
                        ZStack {
                            Circle()
                                .fill(.white)
                                .frame(width: 28, height: 28)
                                .shadow(color: .black.opacity(0.15), radius: 4, y: 1)
                            Image("icon-plus")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 12, height: 12)
                                .foregroundStyle(Color.sjBlue)
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(6)
                    .accessibilityLabel(String(format: String(localized: "Add %@"), release.displayTitle))
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(release.displayTitle)
                    .font(.jakarta(12, weight: .medium))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(release.displayArtist)
                    .font(.jakarta(11))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
        }
    }
}

#Preview {
    HStack(spacing: 12) {
        AlbumCard(release: .preview).frame(width: 140)
        AlbumCard(release: .preview).frame(width: 140)
    }
    .padding()
    .background(Color.sjCream)
}
