import SwiftUI

/// The Instagram Story sticker card — mirrors the real post layout (avatar +
/// username + timestamp, then cover + title + type·artist + score), minus
/// the ⋯ menu and like/comment bar, per the approved design.
///
/// `coverImage` is a pre-loaded `UIImage`, not a URL: this view gets rendered
/// to a flat image via `ImageRenderer`, which snapshots whatever is *already*
/// on screen — an async `CoverImage`/`AsyncImage` load racing the snapshot
/// would export a blank shimmer placeholder instead of the actual cover.
/// The caller downloads the cover first (see `InstagramShare.downloadImage`)
/// and hands it in already resolved.
struct ShareCardView: View {
    let username: String
    let coverImage: UIImage?
    let title: String
    let typeAndArtist: String
    let score: Double
    let reviewText: String?

    private let cardWidth: CGFloat = 320

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header — avatar + username + "now", no ⋯ menu
            HStack(spacing: 9) {
                Image(systemName: "person.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(Color(uiColor: .systemGray3))
                Text("@\(username)")
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                Text("·")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjBorder)
                Text("now")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 6)

            // Album row — cover + title/type·artist + score badge
            HStack(spacing: 13) {
                Group {
                    if let coverImage {
                        Image(uiImage: coverImage).resizable().scaledToFill()
                    } else {
                        Color.sjBorder
                    }
                }
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 10))

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(2)
                    Text(typeAndArtist)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                ScoreBadge(score: score)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, (reviewText?.isEmpty == false) ? 10 : 14)

            if let text = reviewText, !text.isEmpty {
                Text(text)
                    .font(.system(size: 14))
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
