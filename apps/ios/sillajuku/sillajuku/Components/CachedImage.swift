import SwiftUI
import UIKit

/// NSCache-backed async image that replaces AsyncImage everywhere in the app.
///
/// Key difference from AsyncImage:
///   - The cache check in `init` sets the initial @State value synchronously,
///     so cached images render on the very first frame — no placeholder flash
///     when switching tabs or scrolling back through a list.
///   - The app-level NSCache lives independently of the SwiftUI view hierarchy,
///     so images survive view destruction/recreation without re-fetching.
struct CachedImage<Placeholder: View>: View {
    private let url: URL?
    private let placeholder: () -> Placeholder

    @State private var image: UIImage?

    init(url: URL?, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.placeholder = placeholder
        // Synchronous cache hit → image is set before the first render
        if let url, let cached = ImageCache.shared[url] {
            _image = State(initialValue: cached)
        }
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable()
            } else {
                placeholder()
            }
        }
        .task(id: url?.absoluteString) {
            guard let url else { image = nil; return }
            if let cached = ImageCache.shared[url] { image = cached; return }
            image = nil  // show placeholder while fetching
            // Disk tier before network: skips CAA's uncacheable ~1s redirect
            // hop for any cover the app has ever fetched (see ImageCache).
            if let disk = await ImageCache.shared.image(for: url) { image = disk; return }
            guard let (data, _) = try? await ImageCache.session.data(from: url),
                  let uiImage = UIImage(data: data) else { return }
            ImageCache.shared.store(uiImage, data: data, for: url)
            image = uiImage
        }
    }
}
