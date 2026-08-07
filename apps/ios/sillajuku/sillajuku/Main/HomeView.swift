import SwiftUI
import Observation
import Supabase

// MARK: - Models

struct FeedItem: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let score: Double?
    let eloScore: Double?
    let reviewText: String?
    let createdAt: Date
    let releases: FeedRelease
    let profiles: FeedProfile?

    var displayScore: Double? {
        if let s = score { return s }
        if let e = eloScore { return Elo.toScore(e) }
        return nil
    }

    enum CodingKeys: String, CodingKey {
        case id, score, profiles
        case eloScore  = "elo_score"
        case reviewText = "review_text"
        case releases  = "release_groups"
        case userId    = "user_id"
        case createdAt = "created_at"
    }
}

struct FeedRelease: Codable, Identifiable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    let releaseType: String?
    let titleNative: String?
    let primaryArtist: NativeArtistRef?

    enum CodingKeys: String, CodingKey {
        case id, title
        case artist        = "artist_display"
        case coverUrl      = "cover_url"
        case releaseType   = "release_group_type"
        case titleNative   = "native_title"
        case primaryArtist = "artists"
    }

    var artistNative: String? { primaryArtist?.nameNative }
    var displayTitle: String { titleNative?.isPredominantlyHangul == true ? titleNative! : title }
    var displayArtist: String { artistNative?.isPredominantlyHangul == true ? artistNative! : artist }

    var typeLabel: String {
        switch releaseType?.lowercased() {
        case "album":  return String(localized: "Album")
        case "single": return String(localized: "Single")
        case "ep":     return String(localized: "EP")
        default:       return String(localized: "Release")
        }
    }

    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl,
                releaseType: releaseType, releaseDate: nil, titleNative: titleNative, artistNative: artistNative,
                tracklist: nil, totalTracks: nil)
    }
}

/// The joined artist relation used solely to pull the primary artist's native (Korean) name.
struct NativeArtistRef: Codable, Hashable {
    let nameNative: String?
    enum CodingKeys: String, CodingKey { case nameNative = "name_native" }
}

struct FeedProfile: Codable {
    let username: String?
    let displayName: String?
    let isBot: Bool?
    let isVerified: Bool?
    enum CodingKeys: String, CodingKey {
        case username; case displayName = "display_name"; case isBot = "is_bot"
        case isVerified = "is_verified"
    }
    var handle: String { username ?? displayName ?? String(localized: "someone") }
}

// A mix shared to the feed as a post (a "repost" -- anyone viewing a public
// mix can share it, not just its owner). Distinct from a rating post but
// rendered in the same merged feed via FeedPost.
struct MixSharePost: Identifiable {
    let id: UUID
    let userId: UUID
    let mixId: UUID
    let caption: String?
    let createdAt: Date
    let mixName: String
    let mixDescription: String?
    let profile: FeedProfile?
    var coverUrls: [String?] = []
}

// The feed mixes two kinds of posts (ratings + mix shares) sorted together
// -- the first time this feed needs more than one source, so this enum is
// the discriminator rather than adding a `postType` flag to FeedItem itself.
enum FeedPost: Identifiable {
    case rating(FeedItem)
    case mixShare(MixSharePost)

    var id: String {
        switch self {
        case .rating(let i):   return "rating-\(i.id.uuidString)"
        case .mixShare(let s): return "mixshare-\(s.id.uuidString)"
        }
    }

    // Key into HomeViewModel's shared likeCounts/commentCounts/likedPostIds --
    // safe across both rating_likes and mix_share_likes since UUIDs are
    // globally unique regardless of source table.
    var socialKey: UUID {
        switch self {
        case .rating(let i):   return i.id
        case .mixShare(let s): return s.id
        }
    }

    var userId: UUID {
        switch self {
        case .rating(let i):   return i.userId
        case .mixShare(let s): return s.userId
        }
    }

    var createdAt: Date {
        switch self {
        case .rating(let i):   return i.createdAt
        case .mixShare(let s): return s.createdAt
        }
    }

    var isBot: Bool? {
        switch self {
        case .rating(let i):   return i.profiles?.isBot
        case .mixShare(let s): return s.profile?.isBot
        }
    }

    // Used only by ranked()'s artist-affinity bonus; mix shares have no
    // single release, so that scoring term simply doesn't fire for them.
    var releaseArtist: String? {
        switch self {
        case .rating(let i): return i.releases.artist
        case .mixShare:      return nil
        }
    }
}

// MARK: - ViewModel

@Observable
class HomeViewModel {
    var exploreFeed:   [FeedPost] = []
    var followingFeed: [FeedPost] = []
    var isLoadingExplore   = true
    var isLoadingFollowing = true
    var isLoading: Bool { isLoadingExplore }

    var likedPostIds:           Set<UUID>  = []
    var savedReleaseIds:        Set<UUID>  = []
    var myScores:               [UUID: Double] = [:]
    var likeCounts:            [UUID: Int] = [:]
    var commentCounts:         [UUID: Int] = [:]
    var hasUnreadNotifications: Bool       = false
    var blockedUserIds:         Set<UUID>  = []

    private var hasLoadedExplore   = false
    private var hasLoadedFollowing = false

    private static let feedSelect =
        "id, user_id, score, elo_score, review_text, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native)), profiles!ratings_user_id_fkey(username, display_name, is_bot, is_verified)"

    // Explore's fetch is split by is_bot BEFORE ranking, not just re-ranked after — with
    // bot ratings' recency-biased backdating, a human rating usually wouldn't survive into
    // a single latest-150 window at all, so re-ranking downstream of an already-all-bot pool
    // wouldn't help. Slots sized so a thin real-user base still shows every human item that
    // exists; humanSlotEvery below governs how those get interleaved into the visible order.
    private static let exploreHumanFetchLimit = 40
    private static let exploreBotFetchLimit   = 110
    // Ratio used when interleaving humanItems/botItems back together in ranked() — 1 human
    // slot per N bot slots. Named/tunable here since it'll want revisiting as the real user
    // base grows relative to the bot population.
    private static let humanSlotEvery = 3

    // Personalization signals (populated before explore loads)
    private var followingIds:  Set<UUID>   = []
    private var likedArtists:  Set<String> = []

    var currentUserId: UUID? { supabase.auth.currentUser?.id }
    // Gates the drag-to-rate gauge on post covers -- a direct score doesn't
    // fit the Instinct (pairwise/Elo) rating model. Mirrors web's page-level
    // `ratingMode !== 'instinct'` check.
    var ratingMode: String = "manual"

    func load() async {
        await loadPersonalization()   // must run before explore so ranking has signals
        await withTaskGroup(of: Void.self) { g in
            g.addTask { await self.loadExplore() }
            g.addTask { await self.loadFollowing() }
            g.addTask { await self.refreshNotificationBadge() }
        }
    }

    private func loadPersonalization() async {
        guard let userId = currentUserId else { return }
        async let followsTask: [UUID] = {
            struct Row: Codable {
                let followingId: UUID
                enum CodingKeys: String, CodingKey { case followingId = "following_id" }
            }
            let rows: [Row] = (try? await supabase
                .from("follows").select("following_id")
                .eq("follower_id", value: userId).execute().value) ?? []
            return rows.map(\.followingId)
        }()
        async let artistsTask: [String] = {
            struct R: Codable {
                let releaseGroups: AR
                struct AR: Codable {
                    let artist: String
                    enum CodingKeys: String, CodingKey { case artist = "artist_display" }
                }
                enum CodingKeys: String, CodingKey { case releaseGroups = "release_groups" }
            }
            let rows: [R] = (try? await supabase
                .from("ratings").select("release_groups(artist_display)")
                .eq("user_id", value: userId).gte("score", value: 4.0)
                .execute().value) ?? []
            return rows.map(\.releaseGroups.artist)
        }()
        async let blockedTask: [UUID] = {
            struct Row: Codable {
                let blockedId: UUID
                enum CodingKeys: String, CodingKey { case blockedId = "blocked_id" }
            }
            let rows: [Row] = (try? await supabase
                .from("blocked_users").select("blocked_id")
                .eq("blocker_id", value: userId).execute().value) ?? []
            return rows.map(\.blockedId)
        }()
        async let ratingModeTask: String = {
            struct P: Decodable {
                let ratingMode: String?
                enum CodingKeys: String, CodingKey { case ratingMode = "rating_mode" }
            }
            let p: P? = try? await supabase
                .from("profiles").select("rating_mode")
                .eq("id", value: userId).single().execute().value
            return p?.ratingMode ?? "manual"
        }()
        let (ids, artists, blocked, mode) = await (followsTask, artistsTask, blockedTask, ratingModeTask)
        followingIds  = Set(ids)
        likedArtists  = Set(artists)
        blockedUserIds = Set(blocked)
        ratingMode    = mode
    }

    // HomeViewModel is hoisted once at MainTabView and lives for the whole session
    // (unlike AlbumDetailView/SearchView/RankingsView, which are pushed destinations
    // that re-fetch rating_mode fresh on every appearance), so its one-time fetch in
    // loadPersonalization() above goes stale the moment the user flips modes in
    // Settings. Called from HomeView's .onReceive(.sjProfileUpdated).
    func refreshRatingMode() async {
        guard let userId = currentUserId else { return }
        struct P: Decodable {
            let ratingMode: String?
            enum CodingKeys: String, CodingKey { case ratingMode = "rating_mode" }
        }
        let p: P? = try? await supabase
            .from("profiles").select("rating_mode")
            .eq("id", value: userId).single().execute().value
        ratingMode = p?.ratingMode ?? "manual"
    }

    func blockUser(userId: UUID) async {
        guard let me = currentUserId, userId != me else { return }
        blockedUserIds.insert(userId)
        exploreFeed.removeAll   { $0.userId == userId }
        followingFeed.removeAll { $0.userId == userId }
        struct Payload: Encodable {
            let blockerId: UUID; let blockedId: UUID
            enum CodingKeys: String, CodingKey {
                case blockerId = "blocker_id"; case blockedId = "blocked_id"
            }
        }
        _ = try? await supabase.from("blocked_users")
            .insert(Payload(blockerId: me, blockedId: userId))
            .execute()
    }

    private func ranked(_ posts: [FeedPost]) -> [FeedPost] {
        let scored = posts
            .map { post -> (FeedPost, Double) in
                var s = 0.0
                if followingIds.contains(post.userId) { s += 8 }
                if let artist = post.releaseArtist, likedArtists.contains(artist) { s += 5 }
                s += log(Double((likeCounts[post.socialKey]    ?? 0) + 1)) * 5
                s += log(Double((commentCounts[post.socialKey] ?? 0) + 1)) * 3
                let ageHours = -post.createdAt.timeIntervalSinceNow / 3600
                if ageHours < 12       { s += 3 }
                else if ageHours < 72  { s += 1.5 }
                else if ageHours < 336 { s += 0.5 }
                return (post, s)
            }
            .sorted { $0.1 > $1.1 }
            .map(\.0)

        // Guarantee human presence near the top rather than relying on the score bonuses
        // above to overcome a large bot:human volume ratio on their own — split the
        // already-scored order into humans/bots (each stays internally sorted by score,
        // since filter preserves order) and interleave at a fixed ratio. Unknown/missing
        // is_bot defaults to the bot lane, never the guaranteed-human one. Degrades to
        // today's all-bot order when the fetched pool has no human items.
        let humans = scored.filter { $0.isBot == false }
        guard !humans.isEmpty else { return scored }
        let bots = scored.filter { $0.isBot != false }

        var result: [FeedPost] = []
        var hi = 0, bi = 0
        while hi < humans.count || bi < bots.count {
            if hi < humans.count { result.append(humans[hi]); hi += 1 }
            for _ in 0..<Self.humanSlotEvery where bi < bots.count { result.append(bots[bi]); bi += 1 }
        }
        return result
    }

    func refreshNotificationBadge() async {
        guard let userId = currentUserId else { return }

        struct LastSeen: Decodable {
            let notificationsLastSeenAt: Date?
            enum CodingKeys: String, CodingKey {
                case notificationsLastSeenAt = "notifications_last_seen_at"
            }
        }
        let profile: LastSeen? = try? await supabase
            .from("profiles").select("notifications_last_seen_at")
            .eq("id", value: userId).single().execute().value

        var query = supabase
            .from("notifications")
            .select("*", count: .exact)
            .eq("user_id", value: userId)

        if let lastSeen = profile?.notificationsLastSeenAt {
            query = query.gt("created_at", value: lastSeen.ISO8601Format())
        }

        let count = (try? await query.execute())?.count ?? 0
        hasUnreadNotifications = count > 0
    }

    // Same relations as feedSelect but WITHOUT the release_groups/artists embed
    // -- with ~10k bot-authored ratings (>99% of the table), adding that embed
    // to a query that also does ORDER BY created_at + an inner-joined is_bot
    // filter makes Postgres blow its statement timeout (57014), confirmed live:
    // the identical query with the embed removed returns in <1s. release_groups
    // are fetched separately below and stitched back in client-side instead.
    private static let feedSelectLiteBotFilterable =
        "id, user_id, score, elo_score, review_text, created_at, release_group_id, profiles!ratings_user_id_fkey!inner(username, display_name, is_bot, is_verified)"

    private struct FeedItemLite: Codable {
        let id: UUID
        let userId: UUID
        let score: Double?
        let eloScore: Double?
        let reviewText: String?
        let createdAt: Date
        let releaseGroupId: UUID
        let profiles: FeedProfile?
        enum CodingKeys: String, CodingKey {
            case id, score, profiles
            case userId        = "user_id"
            case eloScore       = "elo_score"
            case reviewText     = "review_text"
            case createdAt      = "created_at"
            case releaseGroupId = "release_group_id"
        }
    }

    private static let releaseGroupSelect =
        "id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native)"

    private func fetchReleaseGroups(ids: [String]) async -> [UUID: FeedRelease] {
        guard !ids.isEmpty else { return [:] }
        let rows: [FeedRelease] = (try? await supabase
            .from("release_groups").select(Self.releaseGroupSelect)
            .in("id", values: ids)
            .execute().value) ?? []
        return Dictionary(uniqueKeysWithValues: rows.map { ($0.id, $0) })
    }

    /// Fetches the Explore pool split by is_bot BEFORE any ranking — see the comment on
    /// exploreHumanFetchLimit/exploreBotFetchLimit for why this has to happen at fetch time.
    /// Throws (rather than swallowing per-query) so callers keep their existing try?/guard
    /// failure semantics instead of silently treating a real fetch failure as "zero results".
    private func fetchExplorePool() async throws -> [FeedItem] {
        async let humanTask: [FeedItemLite] = try await supabase
            .from("ratings").select(Self.feedSelectLiteBotFilterable)
            .eq("profiles.is_bot", value: false)
            .order("created_at", ascending: false).limit(Self.exploreHumanFetchLimit)
            .execute().value
        async let botTask: [FeedItemLite] = try await supabase
            .from("ratings").select(Self.feedSelectLiteBotFilterable)
            .eq("profiles.is_bot", value: true)
            .order("created_at", ascending: false).limit(Self.exploreBotFetchLimit)
            .execute().value
        let lite = try await (humanTask + botTask)
        let releaseGroups = await fetchReleaseGroups(ids: Array(Set(lite.map(\.releaseGroupId.uuidString))))
        return lite.compactMap { item in
            guard let release = releaseGroups[item.releaseGroupId] else { return nil }
            return FeedItem(id: item.id, userId: item.userId, score: item.score, eloScore: item.eloScore,
                             reviewText: item.reviewText, createdAt: item.createdAt,
                             releases: release, profiles: item.profiles)
        }
    }

    // Not private -- reused by ProfileViewModel to fetch the current user's
    // own mix shares for the profile posts feed.
    static let mixShareSelect =
        "id, user_id, mix_id, caption, created_at, mixes(id, name, description), profiles!mix_shares_user_id_fkey(username, display_name, is_bot, is_verified)"

    struct MixShareRow: Codable {
        let id: UUID
        let userId: UUID
        let mixId: UUID
        let caption: String?
        let createdAt: Date
        let mixes: MixRef
        let profiles: FeedProfile?
        struct MixRef: Codable { let id: UUID; let name: String; let description: String? }
        enum CodingKeys: String, CodingKey {
            case id, caption, profiles, mixes
            case userId = "user_id"; case mixId = "mix_id"; case createdAt = "created_at"
        }
    }

    /// Bulk-resolves up to 10 cover URLs per mix via get_mix_covers (a single
    /// window-function RPC call regardless of how many/large the mixes are)
    /// and stitches them onto the already-fetched share rows. Static (no
    /// instance state used) so ProfileViewModel can call it too.
    static func hydrateCovers(_ rows: [MixShareRow]) async -> [MixSharePost] {
        guard !rows.isEmpty else { return [] }
        struct CoverRow: Decodable {
            let mixId: UUID
            let coverUrl: String?
            enum CodingKeys: String, CodingKey { case mixId = "mix_id"; case coverUrl = "cover_url" }
        }
        struct Params: Encodable {
            let pMixIds: [String]
            let pLimit: Int
            enum CodingKeys: String, CodingKey { case pMixIds = "p_mix_ids"; case pLimit = "p_limit" }
        }
        let mixIds = Array(Set(rows.map(\.mixId.uuidString)))
        let covers: [CoverRow] = (try? await supabase
            .rpc("get_mix_covers", params: Params(pMixIds: mixIds, pLimit: 10))
            .execute().value) ?? []
        var byMix: [UUID: [String?]] = [:]
        for c in covers { byMix[c.mixId, default: []].append(c.coverUrl) }
        return rows.map {
            MixSharePost(id: $0.id, userId: $0.userId, mixId: $0.mixId, caption: $0.caption,
                         createdAt: $0.createdAt, mixName: $0.mixes.name, mixDescription: $0.mixes.description,
                         profile: $0.profiles, coverUrls: byMix[$0.mixId] ?? [])
        }
    }

    private func fetchExploreMixShares(limit: Int = 30) async throws -> [MixSharePost] {
        let rows: [MixShareRow] = try await supabase
            .from("mix_shares").select(Self.mixShareSelect)
            .order("created_at", ascending: false).limit(limit)
            .execute().value
        return await Self.hydrateCovers(rows)
    }

    private func fetchFollowingMixShares(userIds: [String], limit: Int = 60) async -> [MixSharePost] {
        guard !userIds.isEmpty else { return [] }
        let rows: [MixShareRow] = (try? await supabase
            .from("mix_shares").select(Self.mixShareSelect)
            .in("user_id", values: userIds)
            .order("created_at", ascending: false).limit(limit)
            .execute().value) ?? []
        return await Self.hydrateCovers(rows)
    }

    private func loadMixShareSocialData(for shares: [MixSharePost]) async {
        guard !shares.isEmpty else { return }
        let shareIds = shares.map(\.id.uuidString)
        struct IdRow: Codable {
            let mixShareId: UUID
            enum CodingKeys: String, CodingKey { case mixShareId = "mix_share_id" }
        }
        async let likesTask: [IdRow]? = try? await supabase
            .from("mix_share_likes").select("mix_share_id")
            .in("mix_share_id", values: shareIds).execute().value
        async let commentsTask: [IdRow]? = try? await supabase
            .from("mix_share_comments").select("mix_share_id")
            .in("mix_share_id", values: shareIds).execute().value
        let userId = currentUserId
        async let myLikesTask: [IdRow]? = {
            guard let userId else { return nil }
            return try? await supabase
                .from("mix_share_likes").select("mix_share_id")
                .eq("user_id", value: userId)
                .in("mix_share_id", values: shareIds).execute().value
        }()

        if let rows = await likesTask {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.mixShareId, default: 0] += 1 }
            for (k, v) in counts { likeCounts[k] = v }
        }
        if let rows = await commentsTask {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.mixShareId, default: 0] += 1 }
            for (k, v) in counts { commentCounts[k] = v }
        }
        if let rows = await myLikesTask {
            for r in rows { likedPostIds.insert(r.mixShareId) }
        }
    }

    func toggleMixShareLike(for post: MixSharePost) async {
        guard let userId = currentUserId else { return }
        let wasLiked = likedPostIds.contains(post.id)
        if wasLiked {
            likedPostIds.remove(post.id)
            likeCounts[post.id] = max(0, (likeCounts[post.id] ?? 1) - 1)
        } else {
            likedPostIds.insert(post.id)
            likeCounts[post.id] = (likeCounts[post.id] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("mix_share_likes").delete()
                    .eq("user_id", value: userId).eq("mix_share_id", value: post.id).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let mixShareId: UUID
                    enum CodingKeys: String, CodingKey { case userId = "user_id"; case mixShareId = "mix_share_id" }
                }
                try await supabase.from("mix_share_likes")
                    .insert(Payload(userId: userId, mixShareId: post.id)).execute()
            }
        } catch {
            print("HomeViewModel.toggleMixShareLike failed for share \(post.id): \(error)")
            if wasLiked { likedPostIds.insert(post.id); likeCounts[post.id] = (likeCounts[post.id] ?? 0) + 1 }
            else { likedPostIds.remove(post.id); likeCounts[post.id] = max(0, (likeCounts[post.id] ?? 1) - 1) }
        }
    }

    func refreshExplore() async {
        guard let ratingPool = try? await fetchExplorePool() else { return }
        let sharePool = (try? await fetchExploreMixShares()) ?? []
        likedPostIds = []
        savedReleaseIds = []
        myScores = [:]
        likeCounts = [:]
        commentCounts = [:]
        let filteredRatings = ratingPool.filter { !blockedUserIds.contains($0.userId) }
        let filteredShares  = sharePool.filter  { !blockedUserIds.contains($0.userId) }
        await loadSocialData(for: filteredRatings)
        await loadMixShareSocialData(for: filteredShares)
        let combined = filteredRatings.map(FeedPost.rating) + filteredShares.map(FeedPost.mixShare)
        exploreFeed = Array(ranked(combined).prefix(60))
        hasLoadedExplore = true
        await refreshNotificationBadge()
    }

    func loadExplore() async {
        guard !hasLoadedExplore else { return }
        hasLoadedExplore = true
        isLoadingExplore = true
        async let ratingPoolTask = fetchExplorePool()
        async let sharePoolTask  = fetchExploreMixShares()
        let ratingPool = (try? await ratingPoolTask) ?? []
        let sharePool  = (try? await sharePoolTask) ?? []
        let filteredRatings = ratingPool.filter { !blockedUserIds.contains($0.userId) }
        let filteredShares  = sharePool.filter  { !blockedUserIds.contains($0.userId) }
        await loadSocialData(for: filteredRatings)
        await loadMixShareSocialData(for: filteredShares)
        let combined = filteredRatings.map(FeedPost.rating) + filteredShares.map(FeedPost.mixShare)
        exploreFeed = Array(ranked(combined).prefix(60))
        isLoadingExplore = false
    }

    func refreshFollowing() async {
        guard let userId = currentUserId else { return }
        struct FollowRow: Codable {
            let followingId: UUID
            enum CodingKeys: String, CodingKey { case followingId = "following_id" }
        }
        let rows: [FollowRow] = (try? await supabase
            .from("follows").select("following_id")
            .eq("follower_id", value: userId).execute().value) ?? []
        let ids = rows.map(\.followingId.uuidString)
        guard !ids.isEmpty else { followingFeed = []; return }
        async let itemsTask: [FeedItem] = (try? await supabase
            .from("ratings").select(Self.feedSelect)
            .in("user_id", values: ids)
            .order("created_at", ascending: false).limit(60).execute().value) ?? []
        async let sharesTask = fetchFollowingMixShares(userIds: ids)
        let (items, shares) = await (itemsTask, sharesTask)
        let filteredRatings = items.filter  { !blockedUserIds.contains($0.userId) }
        let filteredShares  = shares.filter { !blockedUserIds.contains($0.userId) }
        followingFeed = (filteredRatings.map(FeedPost.rating) + filteredShares.map(FeedPost.mixShare))
            .sorted { $0.createdAt > $1.createdAt }
        hasLoadedFollowing = true
    }

    func loadFollowing() async {
        guard !hasLoadedFollowing else { return }
        hasLoadedFollowing = true
        isLoadingFollowing = true
        guard let userId = currentUserId else { isLoadingFollowing = false; return }

        struct FollowRow: Codable {
            let followingId: UUID
            enum CodingKeys: String, CodingKey { case followingId = "following_id" }
        }
        let rows: [FollowRow] = (try? await supabase
            .from("follows").select("following_id")
            .eq("follower_id", value: userId).execute().value) ?? []
        let ids = rows.map(\.followingId.uuidString)
        guard !ids.isEmpty else { isLoadingFollowing = false; return }

        async let itemsTask: [FeedItem] = (try? await supabase
            .from("ratings").select(Self.feedSelect)
            .in("user_id", values: ids)
            .order("created_at", ascending: false).limit(60).execute().value) ?? []
        async let sharesTask = fetchFollowingMixShares(userIds: ids)
        let (items, shares) = await (itemsTask, sharesTask)

        let filteredRatings = items.filter  { !blockedUserIds.contains($0.userId) }
        let filteredShares  = shares.filter { !blockedUserIds.contains($0.userId) }
        followingFeed = (filteredRatings.map(FeedPost.rating) + filteredShares.map(FeedPost.mixShare))
            .sorted { $0.createdAt > $1.createdAt }
        isLoadingFollowing = false
        await loadSocialData(for: filteredRatings)
        await loadMixShareSocialData(for: filteredShares)
    }

    private func loadSocialData(for items: [FeedItem]) async {
        guard !items.isEmpty else { return }
        let ratingIds  = items.map(\.id.uuidString)
        let releaseIds = items.map(\.releases.id.uuidString)

        struct RatingIdRow: Codable {
            let ratingId: UUID
            enum CodingKeys: String, CodingKey { case ratingId = "rating_id" }
        }
        struct ReleaseIdRow: Codable {
            let releaseId: UUID
            enum CodingKeys: String, CodingKey { case releaseId = "release_id" }
        }
        struct MyRatingRow: Codable {
            let releaseGroupId: UUID
            let score: Double?
            enum CodingKeys: String, CodingKey {
                case releaseGroupId = "release_group_id"; case score
            }
        }

        async let likesTask: [RatingIdRow]? = try? await supabase
            .from("rating_likes").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value
        async let commentsTask: [RatingIdRow]? = try? await supabase
            .from("rating_comments").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value

        let userId = currentUserId
        async let myLikesTask: [RatingIdRow]? = {
            guard let userId else { return nil }
            return try? await supabase
                .from("rating_likes").select("rating_id")
                .eq("user_id", value: userId)
                .in("rating_id", values: ratingIds).execute().value
        }()
        async let savedTask: [ReleaseIdRow]? = {
            guard let userId else { return nil }
            return try? await supabase
                .from("saved_releases").select("release_id")
                .eq("user_id", value: userId)
                .in("release_id", values: releaseIds).execute().value
        }()
        // The viewer's own manual rating for each release shown in the feed --
        // separate from item.displayScore, which is the *post author's* score.
        // Feeds a rated card's cover button its score instead of the unrated
        // flower (AlbumRateButton has no way to know this unless we pass it).
        async let myRatingsTask: [MyRatingRow]? = {
            guard let userId else { return nil }
            return try? await supabase
                .from("ratings").select("release_group_id, score")
                .eq("user_id", value: userId)
                .in("release_group_id", values: releaseIds).execute().value
        }()

        if let rows = await likesTask {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.ratingId, default: 0] += 1 }
            for (k, v) in counts { likeCounts[k] = v }
        }
        if let rows = await commentsTask {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.ratingId, default: 0] += 1 }
            for (k, v) in counts { commentCounts[k] = v }
        }
        if let rows = await myLikesTask {
            for r in rows { likedPostIds.insert(r.ratingId) }
        }
        if let rows = await savedTask {
            for r in rows { savedReleaseIds.insert(r.releaseId) }
        }
        if let rows = await myRatingsTask {
            for r in rows { if let s = r.score { myScores[r.releaseGroupId] = s } }
        }
    }

    func toggleLike(for item: FeedItem) async {
        guard let userId = currentUserId else { return }
        let wasLiked = likedPostIds.contains(item.id)
        if wasLiked {
            likedPostIds.remove(item.id)
            likeCounts[item.id] = max(0, (likeCounts[item.id] ?? 1) - 1)
        } else {
            likedPostIds.insert(item.id)
            likeCounts[item.id] = (likeCounts[item.id] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("rating_likes").delete()
                    .eq("user_id", value: userId).eq("rating_id", value: item.id).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let ratingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case ratingId = "rating_id"
                    }
                }
                try await supabase.from("rating_likes")
                    .insert(Payload(userId: userId, ratingId: item.id)).execute()
            }
        } catch {
            if wasLiked { likedPostIds.insert(item.id); likeCounts[item.id] = (likeCounts[item.id] ?? 0) + 1 }
            else { likedPostIds.remove(item.id); likeCounts[item.id] = max(0, (likeCounts[item.id] ?? 1) - 1) }
        }
    }

    func toggleSave(for item: FeedItem) async {
        guard let userId = currentUserId else { return }
        let releaseId = item.releases.id
        let wasSaved = savedReleaseIds.contains(releaseId)

        if wasSaved { savedReleaseIds.remove(releaseId) }
        else { savedReleaseIds.insert(releaseId) }

        do {
            if wasSaved {
                try await supabase.from("saved_releases").delete()
                    .eq("user_id", value: userId).eq("release_id", value: releaseId).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let releaseId: UUID
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case releaseId = "release_id"
                    }
                }
                try await supabase.from("saved_releases")
                    .insert(Payload(userId: userId, releaseId: releaseId)).execute()
            }
        } catch {
            // Rollback
            if wasSaved { savedReleaseIds.insert(releaseId) }
            else { savedReleaseIds.remove(releaseId) }
        }
    }
}

// MARK: - View

enum FeedTab: Hashable { case explore, following }

struct HomeView: View {
    var viewModel: HomeViewModel
    let scrollToTopTrigger: UUID
    let onOwnProfileTap: () -> Void

    @State private var activeTab: FeedTab = .explore
    @State private var exploreScrollTrigger   = UUID()
    @State private var followingScrollTrigger = UUID()
    @Namespace private var tabBubbleNamespace
    @State private var topSafeAreaInset: CGFloat = 0

    var body: some View {
        NavigationStack {
            feedContent
                .overlay(alignment: .top) { floatingHeader }
                .background(Color.sjCream.ignoresSafeArea())
                // Lets scrolled cards actually pass behind the glass header/status bar
                // instead of stopping dead at the safe-area line (see topSafeAreaInset,
                // captured below, which keeps the header/content resting position unchanged).
                .ignoresSafeArea(edges: .top)
                .navigationBarHidden(true)
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
            .navigationDestination(for: ArtistDestination.self) { ArtistPageView(artist: $0) }
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
            .navigationDestination(for: FindPeopleDestination.self) { _ in FindPeopleView() }
            .navigationDestination(for: AlbumPostDestination.self) { AlbumPostDetailView(ratingId: $0.ratingId) }
            .navigationDestination(for: SongPostDestination.self) { SongPostDetailView(ratingId: $0.ratingId) }
            // Value-based push (not `.navigationDestination(isPresented:)`) --
            // isPresented mixed with the for:-based pushes above left this
            // NavigationStack in a broken state where NotificationsView's own
            // NavigationLinks (to a release/profile/mix) updated the back
            // button's title but never actually completed the visual push.
            .navigationDestination(for: NotificationsDestination.self) { _ in
                NotificationsView()
                    .onDisappear { Task { await viewModel.refreshNotificationBadge() } }
            }
        }
        // Captured here (outside the .ignoresSafeArea(edges: .top) chain above, so it
        // still sees the real device safe area) and reused to keep the header/feed's
        // resting position identical across devices while letting scrolled content
        // pass up behind the status bar.
        .background {
            GeometryReader { geo in
                // Tracked, not sampled once: on device the first layout pass can
                // report inset 0 (insets propagate a frame late), and a one-shot
                // onAppear froze that 0 -- pinning the header into the status bar.
                Color.clear
                    .onAppear { topSafeAreaInset = geo.safeAreaInsets.top }
                    .onChange(of: geo.safeAreaInsets.top) { _, newInset in
                        topSafeAreaInset = newInset
                    }
            }
        }
        .onChange(of: scrollToTopTrigger) { _, _ in
            if activeTab == .explore { exploreScrollTrigger = UUID() }
            else { followingScrollTrigger = UUID() }
        }
        // Settings' rating-mode toggle posts this after saving. HomeViewModel is
        // hoisted once and never otherwise re-fetches rating_mode, so without this
        // the feed's flower (manual-only) rate buttons would keep showing after
        // switching to Instinct until the next full app launch.
        .onReceive(NotificationCenter.default.publisher(for: .sjProfileUpdated)) { _ in
            Task { await viewModel.refreshRatingMode() }
        }
    }

    // MARK: Floating header — centered tabs + trailing bell

    private var floatingHeader: some View {
        ZStack {
            // Centered tab switcher
            HStack(spacing: 4) {
                feedTabButton(.explore,   label: "Explore")
                feedTabButton(.following, label: "Following")
            }
            // Bell pinned to trailing edge; explicit frame ensures ZStack fills screen width
            HStack {
                Spacer(minLength: 0)
                bellButton
                    .padding(.trailing, 16)
            }
        }
        .frame(maxWidth: .infinity)
        // feedContent now ignores the top safe area (see body), so this has to
        // account for it manually to keep the tab row sitting where it always did.
        .padding(.top, topSafeAreaInset + 12)
        .padding(.bottom, 10)
        .contentShape(Rectangle())
        // iOS 26's automatic scroll-edge effect (.scrollEdgeEffectStyle) only engages
        // behind real system chrome (native toolbar/tab bar) -- verified on-device that
        // it produces zero blur/dim behind this custom overlay header. So this is a
        // manual material, tapered via a gradient mask (fully opaque right at the status
        // bar, fading to nothing by the row's midpoint) rather than a flat block, so it
        // reads as a soft graduated melt instead of a hard-edged panel.
        .background {
            Rectangle()
                .fill(.ultraThinMaterial)
                .mask {
                    LinearGradient(
                        stops: [
                            .init(color: .black,            location: 0.0),
                            .init(color: .black.opacity(0.5), location: 0.35),
                            .init(color: .clear,             location: 0.75)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
                .ignoresSafeArea(edges: .top)
        }
    }

    private var followingFeedFooter: some View {
        VStack(spacing: 12) {
            Divider()
            Text("Follow more people to keep your feed fresh.")
                .font(.system(size: 13))
                .foregroundStyle(Color.sjMuted)
                .multilineTextAlignment(.center)
            FindPeopleLinkButton()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }

    private var bellButton: some View {
        NavigationLink(value: NotificationsDestination()) {
            Image(systemName: "bell")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(Color.sjInk)
                .frame(width: 36, height: 36)
                .background {
                    Circle()
                        .fill(Color.clear)
                        .glassEffect(.regular, in: Circle())
                }
                .overlay(alignment: .topTrailing) {
                    if viewModel.hasUnreadNotifications {
                        Circle()
                            .fill(.red)
                            .frame(width: 9, height: 9)
                            .offset(x: 3, y: -3)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(String(localized: "Notifications"))
        .accessibilityHint(viewModel.hasUnreadNotifications ? String(localized: "Unread notifications") : "")
    }

    private func feedTabButton(_ tab: FeedTab, label: LocalizedStringKey) -> some View {
        Button {
            if activeTab == tab {
                if tab == .explore { exploreScrollTrigger = UUID() }
                else               { followingScrollTrigger = UUID() }
            } else {
                withAnimation(.easeInOut(duration: 0.18)) { activeTab = tab }
            }
        } label: {
            Text(label)
                .font(.system(size: 17, weight: activeTab == tab ? .bold : .regular))
                .foregroundStyle(activeTab == tab ? Color.sjInk : Color.sjMuted)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background {
                    if activeTab == tab {
                        Capsule()
                            .fill(Color.clear)
                            .glassEffect(.regular, in: Capsule())
                            .matchedGeometryEffect(id: "activeTabBubble", in: tabBubbleNamespace)
                    }
                }
        }
        .buttonStyle(.plain)
    }

    // MARK: Feed content (swipeable)

    // Confirmed via UI testing (2026-07-23): TabView(.page)'s `selection` binding does
    // not reliably respond to a programmatic (code-driven) change here -- a real swipe
    // paged correctly (proving the pages/data were always fine), but setting `activeTab`
    // from feedTabButton's action, in any of several forms (plain, withAnimation,
    // deferred to the next run loop), left the page visually stuck. This is a
    // long-documented TabView(.page) limitation, not something fixable by adjusting
    // animations around it. Replaced with the modern ScrollView + `.scrollPosition(id:)`
    // + `.scrollTargetBehavior(.paging)` combination Apple introduced specifically to
    // support two-way (view <-> state) programmatic control, which a plain `TabView`
    // page style does not guarantee.
    private var feedContent: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 0) {
                feedList(posts: viewModel.exploreFeed, isLoading: viewModel.isLoadingExplore,
                         emptyMessage: "No ratings yet — be the first!",
                         scrollTrigger: exploreScrollTrigger, isExplore: true)
                    .containerRelativeFrame(.horizontal)
                    .id(FeedTab.explore)

                feedList(posts: viewModel.followingFeed, isLoading: viewModel.isLoadingFollowing,
                         emptyMessage: "Follow people to see their ratings here.",
                         scrollTrigger: followingScrollTrigger, isExplore: false)
                    .containerRelativeFrame(.horizontal)
                    .id(FeedTab.following)
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .scrollPosition(id: Binding(
            get: { Optional(activeTab) },
            set: { if let newValue = $0 { activeTab = newValue } }
        ))
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        // Clear background so the inner scroll view doesn't paint a white/grey block
        // that sits between the glass tab bar and the scroll content
        .background(Color.clear)
    }

    @ViewBuilder
    private func feedList(posts: [FeedPost], isLoading: Bool, emptyMessage: LocalizedStringKey, scrollTrigger: UUID, isExplore: Bool) -> some View {
        if isLoading {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if posts.isEmpty {
            VStack(spacing: 14) {
                Image(systemName: "music.note.list")
                    .font(.system(size: 44)).foregroundStyle(Color.sjBorder)
                Text(emptyMessage)
                    .font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center).padding(.horizontal, 40)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 10) {
                        Color.clear.frame(height: 0).id("feed-top")
                        ForEach(posts) { post in
                            postCard(post)
                        }
                        if !isExplore {
                            followingFeedFooter
                        }
                    }
                    .padding(.horizontal, 16)
                    // Extra space so the last card is fully above the glass tab bar
                    .padding(.bottom, 100)
                }
                // feedContent ignores the top safe area so cards can scroll up behind
                // the glass header (see body); this keeps their resting position exactly
                // where it'd be if the ScrollView still respected the safe area normally.
                .contentMargins(.top, topSafeAreaInset + 52, for: .scrollContent)
                .refreshable {
                    if isExplore { await viewModel.refreshExplore() }
                    else { await viewModel.refreshFollowing() }
                }
                .onChange(of: scrollTrigger) { _, _ in
                    withAnimation { proxy.scrollTo("feed-top", anchor: .top) }
                }
            }
        }
    }

    // Split out of feedList's ForEach closure and further split by case --
    // a switch with multiple many-argument view initializers inline inside
    // a ForEach/LazyVStack/ScrollView closure is a known trigger for the
    // Swift type-checker to blow up (runaway memory instead of a fast
    // error). Named functions type-check independently, so this keeps each
    // branch cheap to solve.
    @ViewBuilder
    private func postCard(_ post: FeedPost) -> some View {
        switch post {
        case .rating(let item):
            ratingCard(item)
        case .mixShare(let share):
            mixShareCard(share)
        }
    }

    private func ratingCard(_ item: FeedItem) -> some View {
        FeedCard(
            item: item,
            currentUserId: viewModel.currentUserId,
            isLiked: viewModel.likedPostIds.contains(item.id),
            isSaved: viewModel.savedReleaseIds.contains(item.releases.id),
            likesCount: viewModel.likeCounts[item.id] ?? 0,
            commentsCount: viewModel.commentCounts[item.id] ?? 0,
            onLike: { await viewModel.toggleLike(for: item) },
            onSave: { await viewModel.toggleSave(for: item) },
            onBlock: { await viewModel.blockUser(userId: item.userId) },
            onOwnProfileTap: onOwnProfileTap,
            ratingMode: viewModel.ratingMode,
            myScore: viewModel.myScores[item.releases.id],
            onMyScoreChange: { viewModel.myScores[item.releases.id] = $0 }
        )
    }

    private func mixShareCard(_ share: MixSharePost) -> some View {
        MixShareCard(
            post: share,
            currentUserId: viewModel.currentUserId,
            isLiked: viewModel.likedPostIds.contains(share.id),
            likesCount: viewModel.likeCounts[share.id] ?? 0,
            commentsCount: viewModel.commentCounts[share.id] ?? 0,
            onLike: { await viewModel.toggleMixShareLike(for: share) },
            onBlock: { await viewModel.blockUser(userId: share.userId) },
            onOwnProfileTap: onOwnProfileTap
        )
    }
}

// MARK: - Find people

struct FindPeopleDestination: Hashable {}

struct NotificationsDestination: Hashable {}

struct FindPeopleView: View {
    @State private var suggestions: [SuggestedUser] = []
    @State private var isLoading = true
    @State private var followedIds: Set<UUID> = []

    struct SuggestedUser: Identifiable {
        let id: UUID
        let username: String?
        let displayName: String?
        let avatarUrl: String?
        let ratingCount: Int
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if suggestions.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "person.2")
                        .font(.system(size: 44)).foregroundStyle(Color.sjBorder)
                    Text("No suggestions right now.")
                        .font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(suggestions) { user in
                            SuggestedUserRow(
                                user: user,
                                isFollowed: followedIds.contains(user.id),
                                onToggle: { await toggleFollow(user) }
                            )
                            .padding(.horizontal, 16)
                            .background(Color.sjSurface)
                            if user.id != suggestions.last?.id {
                                Divider()
                            }
                        }
                    }
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Find People")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        guard let me = supabase.auth.currentUser?.id else { isLoading = false; return }

        struct Row: Codable {
            let id: UUID
            let username: String?
            let displayName: String?
            let avatarUrl: String?
            let ratingCount: Int
            enum CodingKeys: String, CodingKey {
                case id, username
                case displayName = "display_name"
                case avatarUrl   = "avatar_url"
                case ratingCount = "rating_count"
            }
        }

        struct FollowRow: Codable {
            let followingId: UUID
            enum CodingKeys: String, CodingKey { case followingId = "following_id" }
        }

        async let rowsTask: [Row] = (try? await supabase
            .rpc("get_suggested_users", params: ["p_user_id": me.uuidString])
            .execute().value) ?? []

        async let followingTask: [FollowRow] = (try? await supabase
            .from("follows").select("following_id").eq("follower_id", value: me).execute().value) ?? []

        let (rows, following) = await (rowsTask, followingTask)
        followedIds = Set(following.map(\.followingId))
        suggestions = rows.map {
            SuggestedUser(id: $0.id, username: $0.username, displayName: $0.displayName,
                          avatarUrl: $0.avatarUrl, ratingCount: $0.ratingCount)
        }
        isLoading = false
    }

    private func toggleFollow(_ user: SuggestedUser) async {
        guard let me = supabase.auth.currentUser?.id else { return }
        struct Payload: Encodable { let followerId, followingId: UUID
            enum CodingKeys: String, CodingKey { case followerId = "follower_id"; case followingId = "following_id" }
        }
        if followedIds.contains(user.id) {
            followedIds.remove(user.id)
            _ = try? await supabase.from("follows")
                .delete().eq("follower_id", value: me).eq("following_id", value: user.id).execute()
        } else {
            followedIds.insert(user.id)
            _ = try? await supabase.from("follows")
                .insert(Payload(followerId: me, followingId: user.id)).execute()
        }
        NotificationCenter.default.post(name: .followChanged, object: nil)
    }
}

private struct SuggestedUserRow: View {
    let user: FindPeopleView.SuggestedUser
    let isFollowed: Bool
    let onToggle: () async -> Void

    private var handle: String { user.username ?? user.displayName ?? "" }

    var body: some View {
        HStack(spacing: 12) {
            // Left: tapping navigates to the user's profile
            NavigationLink(value: UserProfileDestination(userId: user.id, handle: handle)) {
                HStack(spacing: 12) {
                    Group {
                        if let url = user.avatarUrl.flatMap(URL.init) {
                            CachedImage(url: url) { Color.sjBorder }
                                .scaledToFill()
                        } else {
                            Image(systemName: "person.circle.fill")
                                .resizable().scaledToFit()
                                .foregroundStyle(Color(uiColor: .systemGray3))
                        }
                    }
                    .frame(width: 44, height: 44).clipShape(Circle())
                    .accessibilityHidden(true) // name text alongside already describes it

                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.displayName ?? user.username ?? String(localized: "User"))
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(1)
                        if let u = user.username {
                            Text("@" + u)
                                .font(.system(size: 12))
                                .foregroundStyle(Color.sjMuted)
                                .lineLimit(1)
                        }
                        Text(String(format: String(localized: "%d ratings"), user.ratingCount))
                            .font(.system(size: 11))
                            .foregroundStyle(Color.sjMuted)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer()

            // Right: follow toggle — outside NavigationLink so it doesn't navigate
            Button {
                Task { await onToggle() }
            } label: {
                Text(isFollowed ? "Following" : "Follow")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(isFollowed ? Color.sjMuted : Color.sjCream)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(isFollowed ? Color.sjBorder.opacity(0.4) : Color.sjAmber)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 10)
    }
}

// MARK: - Feed card

private enum CardSheet: Identifiable {
    case comments, likers, addRating, mixPicker, report
    var id: Self { self }
}

// Not private -- reused by AlbumDetailView's "other ratings" section, which
// renders posts scoped to a single release in the same visual format as the
// home feed.
/// Menu actions for rendering the current user's own rating as a card on the
/// album detail page -- when set, FeedCard's ellipsis menu shows these instead
/// of the feed actions (Add/Save/Share-link), which don't make sense there.
struct OwnRatingMenuActions {
    let onShare: () -> Void
    let onEdit: () -> Void
    let onAddToMix: () -> Void
    let onEditComment: () -> Void
    let onDelete: () -> Void
}

struct FeedCard: View {
    let item: FeedItem
    let currentUserId: UUID?
    let isLiked: Bool
    let isSaved: Bool
    let likesCount: Int
    let commentsCount: Int
    let onLike: () async -> Void
    let onSave: () async -> Void
    let onBlock: () async -> Void
    let onOwnProfileTap: () -> Void
    var ratingMode: String = "manual"
    var ownRatingActions: OwnRatingMenuActions? = nil
    var myScore: Double? = nil
    var onMyScoreChange: ((Double?) -> Void)? = nil

    @State private var activeSheet: CardSheet?
    @State private var showBlockConfirm = false
    @State private var userMixCount: Int? = nil
    @State private var prefetchedComments: [RatingComment]? = nil

    private var isOwnPost: Bool {
        guard let cid = currentUserId else { return false }
        return item.userId == cid
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            cardHeader
            albumSection
            if let text = item.reviewText, !text.isEmpty {
                Text(text)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }
            actionBar
        }
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 1)
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .comments:
                CommentSheetView(ratingId: item.id, preloaded: prefetchedComments)
                    .presentationDetents([.fraction(0.67), .large])
                    .presentationDragIndicator(.visible)
            case .likers:
                LikersSheetView(ratingId: item.id)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            case .addRating:
                NavigationStack { AlbumDetailView(release: item.releases.asRelease) }
                    .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
                    .navigationDestination(for: ArtistDestination.self) { ArtistPageView(artist: $0) }
                    .presentationDragIndicator(.visible)
            case .mixPicker:
                MixPickerView(releaseId: item.releases.id, releaseTitle: item.releases.title)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            case .report:
                ReportSheet(reportedUserId: item.userId, ratingId: item.id)
                    .presentationDetents([.medium])
                    .presentationDragIndicator(.visible)
            }
        }
        .confirmationDialog(
            "Block this user?",
            isPresented: $showBlockConfirm,
            titleVisibility: .visible
        ) {
            Button("Block", role: .destructive) { Task { await onBlock() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Their posts won't appear in your feed.")
        }
        .task {
            guard let userId = currentUserId else { return }
            let resp = try? await supabase
                .from("mixes")
                .select("*", count: .exact)
                .eq("user_id", value: userId)
                .execute()
            userMixCount = resp?.count ?? 0
        }
        .task(id: item.id) {
            guard commentsCount > 0, prefetchedComments == nil else { return }
            prefetchedComments = (try? await supabase
                .from("rating_comments")
                .select("id, user_id, content, created_at, profiles!rating_comments_user_id_fkey(username, display_name)")
                .eq("rating_id", value: item.id)
                .order("created_at", ascending: true)
                .execute()
                .value) ?? []
        }
    }

    // MARK: Header

    private var cardHeader: some View {
        HStack(spacing: 9) {
            // Avatar — own → switch profile tab; other → navigate to their profile
            avatarLink

            // Username — same navigation as avatar
            usernameLink

            Text("·").font(.system(size: 13)).foregroundStyle(Color.sjBorder)

            Text(item.createdAt.relativeTimeString)
                .font(.system(size: 12)).foregroundStyle(Color.sjMuted)

            Spacer(minLength: 0)

            Menu {
                if let own = ownRatingActions {
                    Button { own.onShare() } label: { Label("Share", systemImage: "square.and.arrow.up") }
                    Button { own.onEdit() } label: { Label("Edit", systemImage: "square.and.pencil") }
                    Button { own.onAddToMix() } label: { Label("Add to Mix", systemImage: "bookmark") }
                    Button { own.onEditComment() } label: { Label("Edit Comment", systemImage: "bubble.right") }
                    Divider()
                    Button(role: .destructive) { own.onDelete() } label: { Label("Delete", systemImage: "trash") }
                } else {
                    Button { activeSheet = .addRating } label: {
                        Label("Add", systemImage: "plus")
                    }
                    Button {
                        // If user has only the default Listen Later mix, save immediately.
                        // If they have custom mixes (count > 1), show the mix picker.
                        let count = userMixCount ?? 0
                        if count > 1 {
                            activeSheet = .mixPicker
                        } else {
                            Task { await onSave() }
                        }
                    } label: {
                        Label(isSaved ? "Saved" : "Save",
                              systemImage: isSaved ? "bookmark.fill" : "bookmark")
                    }
                    ShareLink(
                        item: URL(string: "https://sillajuku.com/r/\(item.id)")!,
                        subject: Text(item.releases.displayTitle + " · " + item.releases.displayArtist),
                        message: Text("Check out this rating on sillajuku")
                    ) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    if !isOwnPost {
                        Divider()
                        Button(role: .destructive) { activeSheet = .report } label: { Label("Report", systemImage: "flag") }
                        Button(role: .destructive) { showBlockConfirm = true } label: { Label("Block this user", systemImage: "hand.raised") }
                    }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.sjMuted)
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel(String(localized: "More options"))
        }
        .padding(.leading, 14).padding(.trailing, 4)
        .padding(.top, 10).padding(.bottom, 6)
    }

    @ViewBuilder
    private var avatarLink: some View {
        let icon = Image(systemName: "person.circle.fill")
            .font(.system(size: 30))
            .foregroundStyle(Color(uiColor: .systemGray3))
        let handle = item.profiles?.handle
        let label = handle.map { String(format: String(localized: "View @%@'s profile"), $0) }
            ?? String(localized: "View profile")

        if isOwnPost {
            Button { onOwnProfileTap() } label: { icon }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "Your profile"))
        } else if let profile = item.profiles {
            NavigationLink(value: UserProfileDestination(userId: item.userId, handle: profile.handle)) {
                icon
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        } else {
            icon
        }
    }

    @ViewBuilder
    private var usernameLink: some View {
        let label = HStack(spacing: 4) {
            Text("@" + (item.profiles?.handle ?? String(localized: "someone")))
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(Color.sjInk)
            if item.profiles?.isVerified == true {
                VerifiedBadgeView()
                    .frame(width: 13, height: 13)
                    .accessibilityLabel(String(localized: "Verified"))
            }
        }

        if isOwnPost {
            Button { onOwnProfileTap() } label: { label }
                .buttonStyle(.plain)
        } else if let profile = item.profiles {
            NavigationLink(value: UserProfileDestination(userId: item.userId, handle: profile.handle)) {
                label
            }
            .buttonStyle(.plain)
        } else {
            label
        }
    }

    // MARK: Album — full block tappable

    private var albumSection: some View {
        NavigationLink(value: item.releases.asRelease) {
            HStack(spacing: 13) {
                ZStack(alignment: .bottomTrailing) {
                    CoverImage(url: item.releases.coverUrl)
                        .frame(width: 66, height: 66)
                        .accessibilityHidden(true) // title/artist text alongside already describes it

                    if ratingMode != "instinct", currentUserId != nil {
                        AlbumRateButton(
                            release: item.releases.asRelease,
                            initialScore: myScore,
                            onScoreChange: onMyScoreChange,
                            size: 26
                        )
                        .offset(x: 3, y: 3)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(item.releases.displayTitle)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.sjInk).lineLimit(2)

                    Text(item.releases.typeLabel + " · " + item.releases.displayArtist)
                        .font(.system(size: 11.5)).foregroundStyle(Color.sjMuted).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                scoreView
            }
            .padding(.horizontal, 14).padding(.bottom, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var scoreView: some View {
        if let score = item.displayScore {
            ScoreBadge(score: score)
        } else {
            EmptyView()
        }
    }

    // MARK: Action bar — compact

    private var actionBar: some View {
        HStack(spacing: 16) {
            // Like group: icon (toggles) + count (opens likers)
            HStack(spacing: 5) {
                Button { Task { await onLike() } } label: {
                    Image(systemName: isLiked ? "heart.fill" : "heart")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(isLiked ? .red : Color.sjInk)
                }
                .buttonStyle(.plain)
                .animation(.easeInOut(duration: 0.15), value: isLiked)
                .accessibilityLabel(isLiked ? String(localized: "Unlike") : String(localized: "Like"))

                Button { activeSheet = .likers } label: {
                    Text("\(likesCount)")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(isLiked ? .red : Color.sjMuted)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            // Comment group: icon + count
            HStack(spacing: 5) {
                Button { activeSheet = .comments } label: {
                    Image(systemName: "bubble.left")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(Color.sjInk)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "View comments"))

                Text("\(commentsCount)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.sjMuted)
            }

            Spacer(minLength: 0)
        }
        .padding(.leading, 14)
        .padding(.vertical, 6)
    }
}

// MARK: - Likers sheet

struct LikersSheetView: View {
    let ratingId: UUID

    private struct LikerRow: Codable {
        let userId: UUID
        let profiles: LikerProfile?
        struct LikerProfile: Codable {
            let id: UUID
            let username: String?
            let displayName: String?
            enum CodingKeys: String, CodingKey {
                case id, username
                case displayName = "display_name"
            }
            var handle: String { username ?? displayName ?? String(localized: "someone") }
        }
        enum CodingKeys: String, CodingKey {
            case userId = "user_id"; case profiles
        }
    }

    @State private var likers: [LikerRow] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if likers.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "heart").font(.system(size: 36)).foregroundStyle(Color.sjBorder)
                        Text("No likes yet").font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.sjCream.ignoresSafeArea())
                } else {
                    List(Array(likers.enumerated()), id: \.offset) { _, liker in
                        NavigationLink(value: UserProfileDestination(
                            userId: liker.profiles?.id ?? liker.userId,
                            handle: liker.profiles?.handle ?? String(localized: "someone")
                        )) {
                            HStack(spacing: 11) {
                                Image(systemName: "person.circle.fill")
                                    .font(.system(size: 32))
                                    .foregroundStyle(Color(uiColor: .systemGray3))
                                Text("@" + (liker.profiles?.handle ?? String(localized: "someone")))
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Color.sjInk)
                            }
                            .padding(.vertical, 4)
                        }
                        .listRowBackground(Color.sjSurface)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Color.sjCream.ignoresSafeArea())
                }
            }
            .navigationTitle(likers.count == 1 ? String(localized: "1 Like") : String(format: String(localized: "%d Likes"), likers.count))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        likers = (try? await supabase
            .from("rating_likes").select("user_id, profiles!rating_likes_user_id_fkey(id, username, display_name)")
            .eq("rating_id", value: ratingId).execute().value) ?? []
        isLoading = false
    }
}

// 1:1 mirror of LikersSheetView, targeting track_rating_likes/track_rating_id instead of
// rating_likes/rating_id -- song ratings have their own likes table (migration 20260713000001).
struct SongLikersSheetView: View {
    let trackRatingId: UUID

    private struct LikerRow: Codable {
        let userId: UUID
        let profiles: LikerProfile?
        struct LikerProfile: Codable {
            let id: UUID
            let username: String?
            let displayName: String?
            enum CodingKeys: String, CodingKey {
                case id, username
                case displayName = "display_name"
            }
            var handle: String { username ?? displayName ?? String(localized: "someone") }
        }
        enum CodingKeys: String, CodingKey {
            case userId = "user_id"; case profiles
        }
    }

    @State private var likers: [LikerRow] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if likers.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "heart").font(.system(size: 36)).foregroundStyle(Color.sjBorder)
                        Text("No likes yet").font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.sjCream.ignoresSafeArea())
                } else {
                    List(Array(likers.enumerated()), id: \.offset) { _, liker in
                        NavigationLink(value: UserProfileDestination(
                            userId: liker.profiles?.id ?? liker.userId,
                            handle: liker.profiles?.handle ?? String(localized: "someone")
                        )) {
                            HStack(spacing: 11) {
                                Image(systemName: "person.circle.fill")
                                    .font(.system(size: 32))
                                    .foregroundStyle(Color(uiColor: .systemGray3))
                                Text("@" + (liker.profiles?.handle ?? String(localized: "someone")))
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Color.sjInk)
                            }
                            .padding(.vertical, 4)
                        }
                        .listRowBackground(Color.sjSurface)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Color.sjCream.ignoresSafeArea())
                }
            }
            .navigationTitle(likers.count == 1 ? String(localized: "1 Like") : String(format: String(localized: "%d Likes"), likers.count))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        likers = (try? await supabase
            .from("track_rating_likes").select("user_id, profiles!track_rating_likes_user_id_fkey(id, username, display_name)")
            .eq("track_rating_id", value: trackRatingId).execute().value) ?? []
        isLoading = false
    }
}

// MARK: - Shared Find People button

struct FindPeopleLinkButton: View {
    var body: some View {
        NavigationLink(value: FindPeopleDestination()) {
            HStack(spacing: 8) {
                Image(systemName: "person.badge.plus")
                    .font(.system(size: 14, weight: .semibold))
                Text("Find people to follow")
                    .font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(Color.sjBlue)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(Color.sjBlue.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Report Sheet

private struct ReportSheet: View {
    let reportedUserId: UUID
    let ratingId: UUID
    @Environment(\.dismiss) private var dismiss
    @State private var submitted = false
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private let reasons: [(LocalizedStringKey, String)] = [
        ("Spam", "Spam"), ("Inappropriate Content", "Inappropriate Content"),
        ("Harassment", "Harassment"), ("Other", "Other"),
    ]

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                if submitted {
                    VStack(spacing: 14) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 44))
                            .foregroundStyle(Color.sjBlue)
                        Text("Report submitted")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                        Text("Thanks for helping keep sillajuku safe.")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.sjMuted)
                            .multilineTextAlignment(.center)
                        Button("Done") { dismiss() }
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.bottom, 40)
                } else {
                    if let error = errorMessage {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundStyle(.red)
                            .padding(.horizontal, 20)
                            .padding(.bottom, 8)
                    }
                    Text("Why are you reporting this post?")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjMuted)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 12)

                    Divider()

                    ForEach(reasons, id: \.1) { label, reason in
                        Button {
                            guard !isSubmitting else { return }
                            Task { await submit(reason: reason) }
                        } label: {
                            HStack {
                                Text(label)
                                    .font(.system(size: 15))
                                    .foregroundStyle(Color.sjInk)
                                Spacer()
                                if isSubmitting {
                                    ProgressView().scaleEffect(0.8)
                                } else {
                                    Image(systemName: "chevron.right")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(Color.sjMuted)
                                }
                            }
                            .padding(.horizontal, 20)
                            .padding(.vertical, 14)
                            .frame(maxWidth: .infinity)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
                Spacer()
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Report Post")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func submit(reason: String) async {
        guard let reporterId = supabase.auth.currentUser?.id else { return }
        isSubmitting = true
        errorMessage = nil
        struct Payload: Encodable {
            let reporterId: UUID; let reportedUserId: UUID
            let ratingId: UUID; let reason: String
            enum CodingKeys: String, CodingKey {
                case reporterId = "reporter_id"
                case reportedUserId = "reported_user_id"
                case ratingId = "rating_id"
                case reason
            }
        }
        do {
            try await supabase.from("reports")
                .insert(Payload(reporterId: reporterId, reportedUserId: reportedUserId,
                                ratingId: ratingId, reason: reason))
                .execute()
            submitted = true
        } catch {
            print("Report submit error: \(error)")
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }
}

#Preview {
    HomeView(viewModel: HomeViewModel(), scrollToTopTrigger: UUID(), onOwnProfileTap: {})
}
