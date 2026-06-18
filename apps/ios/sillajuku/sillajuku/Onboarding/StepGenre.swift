import SwiftUI

struct StepGenre: View {
    @Binding var data: OnboardingData
    let onNext: () -> Void

    @State private var genres: [String] = []

    private let fallback = [
        "k-pop", "hip-hop", "pop", "r&b", "rock", "electronic", "jazz",
        "indie", "classical", "metal", "folk", "soul", "reggae", "punk",
        "country", "latin", "afrobeats", "j-pop"
    ]

    var displayGenres: [String] { genres.isEmpty ? fallback : genres }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 110)

            VStack(alignment: .leading, spacing: 8) {
                Text("What do you listen to?")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("Pick genres to personalize your feed.")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 24)

            ScrollView {
                GenreFlowLayout(spacing: 8) {
                    ForEach(displayGenres, id: \.self) { genre in
                        GenrePill(
                            label: genre,
                            isSelected: data.selectedGenres.contains(genre)
                        ) {
                            if data.selectedGenres.contains(genre) {
                                data.selectedGenres.removeAll { $0 == genre }
                            } else {
                                data.selectedGenres.append(genre)
                            }
                        }
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 16)
            }

            Button(action: onNext) {
                Text("Continue")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.sjInk)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
        .task { await loadGenres() }
    }

    private func loadGenres() async {
        guard let url = URL(string: "https://sillajuku.com/api/genres/top") else { return }
        guard let (responseData, _) = try? await URLSession.shared.data(from: url) else { return }
        struct Item: Decodable { let genre: String }
        guard let items = try? JSONDecoder().decode([Item].self, from: responseData) else { return }
        genres = items.map(\.genre)
    }
}

struct GenrePill: View {
    let label: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(isSelected ? .white : Color.sjInk)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(isSelected ? Color.sjInk : Color.white)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(isSelected ? Color.clear : Color.sjBorder, lineWidth: 1))
        }
    }
}

// Simple wrapping flow layout using the Layout protocol (iOS 16+)
struct GenreFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 0
        var y: CGFloat = 0
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth + size.width > width, rowWidth > 0 {
                y += rowHeight + spacing
                rowWidth = 0
                rowHeight = 0
            }
            rowWidth += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX, x > bounds.minX {
                y += rowHeight + spacing
                x = bounds.minX
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
