import SwiftUI

struct AlbumCard: View {
    let release: Release
    /// The tab's shared per-release score, so the flower shows (and edits) the
    /// same score everywhere this release appears.
    var scoreBinding: Binding<Double?> = .constant(nil)
    var ratingStep: Double = 0.5

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomTrailing) {
                CoverImage(url: release.coverUrl, cornerRadius: 8)
                    .aspectRatio(1, contentMode: .fit)
                    // Decorative: the title/artist Text below already describes this
                    // exact release, so a separate label would just repeat it.
                    .accessibilityHidden(true)

                // The flower rate button, same as every other Add-tab section
                // (DiscoveryAlbumCard) -- replaced the old "+" (opened a sheet) /
                // static checkmark on 2026-09-29.
                AlbumRateButton(release: release, externalScore: scoreBinding, ratingStep: ratingStep, size: 30)
                    .padding(4)
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
