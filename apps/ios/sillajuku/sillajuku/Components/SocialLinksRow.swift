import SwiftUI

/// A profile's outside links (YouTube, Instagram, a streaming channel...) as
/// tappable chips under the bio. Port of web's `ProfileLinks` in ProfileView.
struct SocialLinksRow: View {
    let links: [String]?
    var alignment: HorizontalAlignment = .leading

    var body: some View {
        let urls = SocialLinks.renderable(links)
        if !urls.isEmpty {
            // Fits on one line → laid out in place (so it can center);
            // otherwise scrolls sideways rather than wrapping.
            ViewThatFits(in: .horizontal) {
                chips(urls)
                ScrollView(.horizontal, showsIndicators: false) { chips(urls) }
            }
            .frame(maxWidth: .infinity, alignment: alignment == .center ? .center : .leading)
        }
    }

    private func chips(_ urls: [URL]) -> some View {
        HStack(spacing: 6) {
            ForEach(urls, id: \.self) { url in
                let platform = SocialLinks.platform(for: url.absoluteString)
                Link(destination: url) {
                    HStack(spacing: 4) {
                        Image(platform.icon ?? "icon-link")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 12, height: 12)
                            .foregroundStyle(platform.icon == nil ? Color.sjMuted : Color.sjInk)
                        Text(platform.label)
                            .font(.jakarta(12, weight: .medium))
                            .foregroundStyle(Color.sjInk)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .overlay(Capsule().stroke(Color.sjBorder, lineWidth: 1))
                }
                .accessibilityHint(url.absoluteString)
            }
        }
        .padding(1)
    }
}
