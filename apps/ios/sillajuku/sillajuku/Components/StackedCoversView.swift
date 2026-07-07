import SwiftUI

// The overlapping "hand of cards" cover visual used both by the mix-share
// composer preview and the resulting feed card. Bounded to 10 covers --
// callers are expected to pass an already-bounded list (e.g. from the
// get_mix_covers RPC), this just defends against a larger array too.
struct StackedCoversView: View {
    let coverUrls: [String?]
    var size: CGFloat = 90
    var overlapFraction: CGFloat = 0.55

    var body: some View {
        let shown = Array(coverUrls.prefix(10))
        HStack(spacing: -(size * overlapFraction)) {
            ForEach(Array(shown.enumerated()), id: \.offset) { index, url in
                CoverImage(url: url, cornerRadius: 8)
                    .frame(width: size, height: size)
                    .shadow(color: .black.opacity(0.18), radius: 3, x: 0, y: 2)
                    .rotationEffect(.degrees(rotation(index: index, total: shown.count)))
                    .zIndex(Double(shown.count - index))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // Slight fan: negative on the left half, positive on the right half,
    // tapering toward 0 at the visual center -- the "hand of cards" look.
    private func rotation(index: Int, total: Int) -> Double {
        guard total > 1 else { return 0 }
        let mid = Double(total - 1) / 2
        return (Double(index) - mid) * 3.5
    }
}
