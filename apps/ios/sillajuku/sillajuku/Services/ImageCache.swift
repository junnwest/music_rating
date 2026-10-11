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

    // MARK: Network fetch

    /// Cover Art Archive (and the archive.org hosts it redirects to) is ~60% of
    /// covers and slow direct: 2.9s median, up to 6.7s, with occasional 500s
    /// (measured 2026-10-11). The web app's `/api/img` proxy follows that
    /// redirect server-side and is edge-cached for a year: 0.11s on a cache hit.
    /// iOS used it once, but the proxy 502'd in prod (archive.org blocked
    /// Vercel's edge IPs) and iOS was reverted on 2026-07-08; the proxy has
    /// since moved to the Node runtime and works again.
    /// ManiaDB too, for correctness rather than speed: its art is http-only (its
    /// https answers 403), and App Transport Security blocks plain http, so a
    /// direct load always fails on iOS. Matches web's `Cover.tsx` proxied hosts.
    private static func needsProxy(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "coverartarchive.org" || host == "archive.org" || host.hasSuffix(".archive.org")
            || host == "maniadb.com" || host.hasSuffix(".maniadb.com")
    }

    private static func proxied(_ url: URL) -> URL? {
        var c = URLComponents(url: Config.webBaseURL.appendingPathComponent("api/img"), resolvingAgainstBaseURL: false)
        c?.queryItems = [URLQueryItem(name: "url", value: url.absoluteString)]
        return c?.url
    }

    private static func download(_ url: URL) async -> (UIImage, Data)? {
        guard let (data, resp) = try? await session.data(from: url),
              (resp as? HTTPURLResponse)?.statusCode == 200,
              let img = UIImage(data: data) else { return nil }
        return (img, data)
    }

    /// Downloads a cover, through the proxy for CAA/ManiaDB URLs, falling back to the
    /// direct URL if the proxy fails (as web's `Cover.tsx` does). Callers key
    /// the cache on the ORIGINAL url, so existing disk entries stay valid.
    static func fetch(_ url: URL) async -> (UIImage, Data)? {
        if needsProxy(url), let viaProxy = proxied(url), let hit = await download(viaProxy) { return hit }
        return await download(url)
    }

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
                            guard let (img, data) = await fetch(url) else { continue }
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
