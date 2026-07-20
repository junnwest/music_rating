import UIKit
import CryptoKit

/// App-wide two-tier image cache: NSCache in memory + a persistent disk layer
/// in Caches/, both keyed by the ORIGINAL request URL.
///
/// The disk tier exists because ~95% of covers are CoverArtArchive URLs that
/// 307-redirect to archive.org — the redirect itself takes ~0.5–1.5s and is
/// never HTTP-cacheable, so relying on URLCache still pays the redirect hop
/// for every cover after each app relaunch (NSCache dies with the process).
/// Keying our own disk copy by the pre-redirect URL skips the network
/// entirely for any cover the app has ever seen.
final class ImageCache {
    static let shared = ImageCache()

    /// Dedicated session for cover fetches. Nearly every cover lives behind
    /// one host (coverartarchive.org, a 3-hop redirect chain totalling
    /// ~1.6s per image), so the default 6-connections-per-host cap directly
    /// throttles how many first-time covers can be in flight. System URLCache
    /// is disabled — this class owns its own disk tier keyed by the
    /// pre-redirect URL, and double-storing the bytes helps nothing (the
    /// redirect hops themselves are never HTTP-cacheable anyway).
    static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpMaximumConnectionsPerHost = 12
        config.timeoutIntervalForRequest = 20
        config.urlCache = nil
        return URLSession(configuration: config)
    }()

    private let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.countLimit = 400
        c.totalCostLimit = 150 * 1024 * 1024  // 150 MB decoded pixels
        return c
    }()

    private let diskDirectory: URL

    private init() {
        diskDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CoverImages", isDirectory: true)
        try? FileManager.default.createDirectory(at: diskDirectory, withIntermediateDirectories: true)
        pruneDiskIfNeeded()
    }

    // MARK: Memory tier (synchronous — used for first-frame renders)

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

    // MARK: Disk tier

    private func diskPath(for url: URL) -> URL {
        let digest = SHA256.hash(data: Data(url.absoluteString.utf8))
        let name = digest.map { String(format: "%02x", $0) }.joined()
        return diskDirectory.appendingPathComponent(name)
    }

    /// Memory → disk lookup. A disk hit is decoded off the caller's context
    /// and promoted into memory. Returns nil only if the image was never
    /// fetched (or was pruned).
    func image(for url: URL) async -> UIImage? {
        if let hit = self[url] { return hit }
        let path = diskPath(for: url)
        let loaded: UIImage? = await Task.detached(priority: .userInitiated) {
            guard let data = try? Data(contentsOf: path), let img = UIImage(data: data) else { return nil }
            return img
        }.value
        if let loaded { self[url] = loaded }
        return loaded
    }

    /// Stores in memory immediately and on disk in the background. `data` is
    /// the original encoded bytes (jpeg/png), not a re-encode.
    func store(_ image: UIImage, data: Data, for url: URL) {
        self[url] = image
        let path = diskPath(for: url)
        Task.detached(priority: .utility) {
            try? data.write(to: path)
        }
    }

    /// Keeps the disk tier bounded: covers are ~10–25 KB thumbnails, so 4,000
    /// files ≈ 60–100 MB worst case. Prunes the oldest quarter when over.
    private func pruneDiskIfNeeded() {
        let dir = diskDirectory
        Task.detached(priority: .background) {
            let fm = FileManager.default
            guard let files = try? fm.contentsOfDirectory(
                at: dir, includingPropertiesForKeys: [.contentModificationDateKey]
            ), files.count > 4000 else { return }
            let dated = files.compactMap { file -> (URL, Date)? in
                guard let date = try? file.resourceValues(forKeys: [.contentModificationDateKey])
                    .contentModificationDate else { return nil }
                return (file, date)
            }
            for (file, _) in dated.sorted(by: { $0.1 < $1.1 }).prefix(files.count / 4) {
                try? fm.removeItem(at: file)
            }
        }
    }

    // MARK: Prefetch

    /// Fire-and-forget background prefetch for a list of cover URLs.
    /// Memory/disk hits are promoted without touching the network; misses are
    /// fetched by a pool of 8 workers pulling from the list IN ORDER (so the
    /// first-listed = first-visible covers land first). A worker pool, not
    /// barriered batches — one slow CAA redirect chain never stalls the other
    /// seven lanes.
    static func prefetch(_ urls: [URL]) {
        var seen = Set<URL>()
        let unique = urls.filter { shared[$0] == nil && seen.insert($0).inserted }
        guard !unique.isEmpty else { return }
        let queue = PrefetchQueue(urls: unique)
        Task.detached(priority: .utility) {
            await withTaskGroup(of: Void.self) { group in
                for _ in 0..<min(8, unique.count) {
                    group.addTask {
                        while let url = await queue.next() {
                            if shared[url] != nil { continue }
                            if await shared.image(for: url) != nil { continue }
                            guard let (data, resp) = try? await session.data(from: url),
                                  (resp as? HTTPURLResponse)?.statusCode == 200,
                                  let img = UIImage(data: data) else { continue }
                            shared.store(img, data: data, for: url)
                        }
                    }
                }
            }
        }
    }
}

private actor PrefetchQueue {
    private var urls: [URL]
    private var index = 0

    init(urls: [URL]) { self.urls = urls }

    func next() -> URL? {
        guard index < urls.count else { return nil }
        defer { index += 1 }
        return urls[index]
    }
}
