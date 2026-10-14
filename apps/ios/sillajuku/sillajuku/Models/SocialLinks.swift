import Foundation

// Profile social links (migration 20261013000000). Mirrored by the DB CHECK
// (_sj_social_links_valid) and the web app (lib/socialLinks.ts). Keep all
// three in sync if the rules or the platform list change.
enum SocialLinks {
    static let maxCount = 5
    static let maxLength = 300

    private static let dbPattern = #"^https?://[^\s/?#]+\.[^\s/?#]+([/?#]\S*)?$"#

    // Host suffix → label + asset. First match wins, so subdomains go before
    // their parent. `icon` names Assets.xcassets/social-*; nil = generic link.
    private static let platforms: [(hosts: [String], label: String, icon: String?)] = [
        (["youtube.com", "youtu.be"], "YouTube", "social-youtube"),
        (["instagram.com"], "Instagram", "social-instagram"),
        (["tiktok.com"], "TikTok", "social-tiktok"),
        (["x.com", "twitter.com"], "X", "social-x"),
        (["threads.net", "threads.com"], "Threads", "social-threads"),
        (["facebook.com"], "Facebook", "social-facebook"),
        (["spotify.com"], "Spotify", "social-spotify"),
        (["music.apple.com"], "Apple Music", "social-applemusic"),
        (["soundcloud.com"], "SoundCloud", "social-soundcloud"),
        (["bandcamp.com"], "Bandcamp", "social-bandcamp"),
        (["melon.com"], "Melon", nil),
        (["twitch.tv"], "Twitch", "social-twitch"),
        (["chzzk.naver.com"], "CHZZK", nil),
        (["sooplive.co.kr", "afreecatv.com"], "SOOP", nil),
        (["blog.naver.com"], "Naver Blog", "social-naver"),
    ]

    private static func matchesDB(_ value: String) -> Bool {
        value.range(of: dbPattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Turns what a user typed into a storable URL, or nil if it isn't one.
    static func normalize(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if value.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*:", options: .regularExpression) == nil {
            value = "https://" + value
        }
        guard let url = URL(string: value),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http" else { return nil }
        let out = url.absoluteString
        guard out.count <= maxLength, matchesDB(out) else { return nil }
        return out
    }

    /// Label (platform name, or the bare host) and asset name (nil = generic link).
    static func platform(for urlString: String) -> (label: String, icon: String?) {
        guard var host = URL(string: urlString)?.host?.lowercased() else { return (urlString, nil) }
        for prefix in ["www.", "m."] where host.hasPrefix(prefix) {
            host.removeFirst(prefix.count)
        }
        let match = platforms.first { p in p.hosts.contains { host == $0 || host.hasSuffix("." + $0) } }
        return (match?.label ?? host, match?.icon)
    }

    /// Only links that are safe to open (defends against old/bad rows).
    static func renderable(_ links: [String]?) -> [URL] {
        (links ?? []).filter(matchesDB).prefix(maxCount).compactMap(URL.init(string:))
    }
}
