import SwiftUI

struct AlbumCard: View {
    let release: Release

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    ZStack {
                        Color.sjBorder
                        Image(systemName: "music.note")
                            .font(.system(size: 20))
                            .foregroundStyle(Color.sjMuted)
                    }
                }
            }
            .aspectRatio(1, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 2) {
                Text(release.displayTitle)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(release.displayArtist)
                    .font(.system(size: 11))
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
