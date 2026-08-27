import SwiftUI

/// The Instagram Story sticker card — mirrors the real post layout (avatar +
/// username + timestamp, then cover + title + subtitle + score), minus
/// the ⋯ menu and like/comment bar, per the approved design. Also doubles as
/// the "share this album/mix" card (no rating involved) when `score` is nil.
///
/// `coverImages` are pre-loaded `UIImage`s, not URLs: this view gets rendered
/// to a flat image via `ImageRenderer`, which snapshots whatever is *already*
/// on screen — an async `CoverImage`/`AsyncImage` load racing the snapshot
/// would export a blank shimmer placeholder instead of the actual cover(s).
/// The caller downloads them first (see `InstagramShare.downloadImage(s)`)
/// and hands them in already resolved. A single cover (album/song) renders
/// as the usual 80×80 square; more than one (a mix) renders as a small
/// overlapping collage, same "hand of cards" math as `StackedCoversView`
/// adapted for pre-loaded images instead of URLs.
struct ShareCardView: View {
    let username: String
    let coverImages: [UIImage?]
    let title: String
    let subtitle: String
    let score: Double?
    let reviewText: String?

    private let cardWidth: CGFloat = 320

    private func collageRotation(index: Int, total: Int) -> Double {
        guard total > 1 else { return 0 }
        let mid = Double(total - 1) / 2
        return (Double(index) - mid) * 3.5
    }

    @ViewBuilder
    private var coverArea: some View {
        if coverImages.count > 1 {
            let shown = Array(coverImages.prefix(4))
            HStack(spacing: -18) {
                ForEach(Array(shown.enumerated()), id: \.offset) { index, image in
                    Group {
                        if let image {
                            Image(uiImage: image).resizable().scaledToFill()
                        } else {
                            Color.sjBorder
                        }
                    }
                    .frame(width: 52, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .shadow(color: .black.opacity(0.18), radius: 3, x: 0, y: 2)
                    .rotationEffect(.degrees(collageRotation(index: index, total: shown.count)))
                    .zIndex(Double(shown.count - index))
                }
            }
            .frame(width: 80, height: 80, alignment: .leading)
        } else {
            Group {
                if let coverImage = coverImages.first ?? nil {
                    Image(uiImage: coverImage).resizable().scaledToFill()
                } else {
                    Color.sjBorder
                }
            }
            .frame(width: 80, height: 80)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header — avatar + username + "now", no ⋯ menu
            HStack(spacing: 9) {
                Image(systemName: "person.circle.fill")
                    .font(.jakarta(26))
                    .foregroundStyle(Color(uiColor: .systemGray3))
                Text("@\(username)")
                    .font(.jakarta(13.5, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                Text("·")
                    .font(.jakarta(13))
                    .foregroundStyle(Color.sjBorder)
                Text("now")
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 6)

            // Cover(s) + title/subtitle + score badge (score omitted when nil --
            // sharing a bare album/mix rather than a rating of one)
            HStack(spacing: 13) {
                coverArea

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.jakarta(17, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(2)
                    Text(subtitle)
                        .font(.jakarta(14))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                if let score {
                    ScoreBadge(score: score)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, (reviewText?.isEmpty == false) ? 10 : 14)

            if let text = reviewText, !text.isEmpty {
                Text(text)
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 14)
            }
        }
        .frame(width: cardWidth)
        .background(Color.sjCream)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(
            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.sjBorder, lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) {
            Image("logo-flower")
                .resizable()
                .scaledToFit()
                .frame(width: 26, height: 26)
                .padding(12)
                .opacity(0.92)
        }
    }
}
