import UIKit

/// App-wide in-memory image cache backed by NSCache.
/// Lives independently of the SwiftUI view hierarchy — images survive tab
/// switches, NavigationStack pops, and State invalidations without re-fetching.
/// NSCache automatically evicts entries under memory pressure.
final class ImageCache {
    static let shared = ImageCache()

    private let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.countLimit = 400
        c.totalCostLimit = 150 * 1024 * 1024  // 150 MB decoded pixels
        return c
    }()

    private init() {}

    subscript(url: URL) -> UIImage? {
        get { cache.object(forKey: url.absoluteString as NSString) }
        set {
            guard let img = newValue else {
                cache.removeObject(forKey: url.absoluteString as NSString)
                return
            }
            // Cost = decoded bytes (width × height × scale² × 4 channels)
            let cost = Int(img.size.width * img.size.height * img.scale * img.scale * 4)
            cache.setObject(img, forKey: url.absoluteString as NSString, cost: cost)
        }
    }

    /// Fire-and-forget background prefetch for a list of cover URLs.
    /// Skips URLs already in cache; limits concurrency to avoid flooding the network.
    static func prefetch(_ urls: [URL]) {
        let missing = urls.prefix(60).filter { ImageCache.shared[$0] == nil }
        guard !missing.isEmpty else { return }
        Task.detached(priority: .utility) {
            await withTaskGroup(of: Void.self) { group in
                for url in missing {
                    group.addTask {
                        guard ImageCache.shared[url] == nil,
                              let (data, resp) = try? await URLSession.shared.data(from: url),
                              (resp as? HTTPURLResponse)?.statusCode == 200,
                              let img = UIImage(data: data) else { return }
                        ImageCache.shared[url] = img
                    }
                }
            }
        }
    }
}
