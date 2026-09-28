import SwiftUI
import Observation
import Supabase

// MARK: - Models

struct FeedItem: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let score: Double?
    let reviewText: String?
    let createdAt: Date
    let releases: FeedRelease
    let profiles: FeedProfile?

    var displayScore: Double? { score }

    enum CodingKeys: String, CodingKey {
        case id, score, profiles
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
    let badgeColor: String?
    let foundingNumber: Int?
    var avatarUrl: String? = nil
    var featuredBadge: String? = nil
    enum CodingKeys: String, CodingKey {
        case username; case displayName = "display_name"; case isBot = "is_bot"
        case isVerified = "is_verified"
        case badgeColor = "badge_color"; case foundingNumber = "founding_number"
        case avatarUrl = "avatar_url"; case featuredBadge = "featured_badge"
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
    var serverKey: String {
        switch self {
        case .rating(let item): return "rating:" + item.id.uuidString.lowercased()
        case .mixShare(let post): return "mix:" + post.id.uuidString.lowercased()
        }
    }

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

    /// Drops a deleted own mix post from both feeds.
    func removeMixShare(id: UUID) {
        let keep: (FeedPost) -> Bool = { if case .mixShare(let s) = $0 { return s.id != id }; return true }
        exploreFeed = exploreFeed.filter(keep)
        followingFeed = followingFeed.filter(keep)
    }
    var isLoadingExplore   = true
    var isLoadingFollowing = true
    var isLoading: Bool { isLoadingExplore }

    var likedPostIds:           Set<UUID>  = []
    var savedReleaseIds:        Set<UUID>  = []
    var myScores:               [UUID: Double] = [:]
    var likeCounts:            [UUID: Int] = [:]
    var commentCounts:         [UUID: Int] = [:]
    var unreadNotificationCount: Int       = 0
    var hasUnreadNotifications: Bool { unreadNotificationCount > 0 }
    var blockedUserIds:         Set<UUID>  = []

    private var hasLoadedExplore   = false
    private var hasLoadedFollowing = false

    var exploreCursor: String?
    var followingCursor: String?
    var loadingMore = false
    var feedErrors: Set<String> = []
    private var feedSessions: [String: String] = [:]
    private var feedGeneration: [String: Int] = [:]
    private var observedPosts: Set<String> = []
    private var impressionTasks: [String: Task<Void, Never>] = [:]

    func setVisible(_ post: FeedPost, explore: Bool, visible: Bool) {
        let key = (explore ? "explore:" : "following:") + post.serverKey
        impressionTasks[key]?.cancel()
        impressionTasks[key] = nil
        if visible {
            impressionTasks[key] = Task { await observe(post, explore: explore) }
        }
    }
    var currentUserId: UUID? { supabase.auth.currentUser?.id }

    func load() async {
        await withTaskGroup(of: Void.self) { g in
            g.addTask { await self.loadExplore() }
            g.addTask { await self.loadFollowing() }
            g.addTask { await self.refreshNotificationBadge() }
        }
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

    func notInterested(item: FeedItem) async {
        exploreFeed.removeAll { post in
            if case .rating(let rating) = post { return rating.releases.id == item.releases.id }
            return false
        }
        await NotInterested.markAlbum(releaseGroupId: item.releases.id)
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
            .select("*", head: true, count: .exact)
            .eq("user_id", value: userId)

        if let lastSeen = profile?.notificationsLastSeenAt {
            query = query.gt("created_at", value: lastSeen.ISO8601Format())
        }

        unreadNotificationCount = (try? await query.execute())?.count ?? 0
    }

    // Not private -- reused by ProfileViewModel to fetch the current user's
    // own mix shares for the profile posts feed.
    static let mixShareSelect =
        "id, user_id, mix_id, caption, created_at, mixes(id, name, description), profiles!mix_shares_user_id_fkey(username, display_name, avatar_url, is_bot, is_verified, badge_color, founding_number, featured_badge)"

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
        await fetchHomePage(explore: true, append: false)
        await refreshNotificationBadge()
    }

    func loadExplore() async {
        guard !hasLoadedExplore else { return }
        await fetchHomePage(explore: true, append: false)
    }

    func refreshFollowing() async { await fetchHomePage(explore: false, append: false) }

    func loadFollowing() async {
        guard !hasLoadedFollowing else { return }
        await fetchHomePage(explore: false, append: false)
    }

    func loadMore(explore: Bool) async {
        guard !loadingMore, (explore ? exploreCursor : followingCursor) != nil else { return }
        loadingMore = true
        await fetchHomePage(explore: explore, append: true)
        loadingMore = false
    }

    private func fetchHomePage(explore: Bool, append: Bool) async {
        let tab = explore ? "explore" : "following"
        let viewer = currentUserId
        let generation = (feedGeneration[tab] ?? 0) + 1
        feedGeneration[tab] = generation
        if !append {
            if explore { isLoadingExplore = exploreFeed.isEmpty }
            else { isLoadingFollowing = followingFeed.isEmpty }
        }
        feedErrors.remove(tab)
        var query = ["tab": tab]
        var responseStatus = 200
        if append, let cursor = explore ? exploreCursor : followingCursor { query["cursor"] = cursor }
        let page: HomeFeedResponse? = await WebAPI.get("api/feed/home", authed: viewer != nil,
            query: query, dateDecodingStrategy: HomeFeedResponse.dateStrategy,
            onStatus: { responseStatus = $0 })
        guard viewer == currentUserId, feedGeneration[tab] == generation else { return }
        if responseStatus == 410 && append {
            await fetchHomePage(explore: explore, append: false)
            return
        }
        if explore { isLoadingExplore = false } else { isLoadingFollowing = false }
        guard let page else { feedErrors.insert(tab); return }
        let posts = page.entries.compactMap(\.feedPost).filter { !blockedUserIds.contains($0.userId) }
        let existing = append ? (explore ? exploreFeed : followingFeed) : []
        var ids = Set(existing.map(\.id))
        let combined = existing + posts.filter { ids.insert($0.id).inserted }
        if explore { exploreFeed = combined; exploreCursor = page.nextCursor; hasLoadedExplore = true }
        else { followingFeed = combined; followingCursor = page.nextCursor; hasLoadedFollowing = true }
        for post in posts {
            feedSessions[tab + ":" + post.serverKey] = page.sessionId
            likeCounts[post.socialKey] = page.likeCounts[post.serverKey] ?? 0
            commentCounts[post.socialKey] = page.commentCounts[post.serverKey] ?? 0
            if page.likedKeys.contains(post.serverKey) { likedPostIds.insert(post.socialKey) }
            else { likedPostIds.remove(post.socialKey) }
        }
        // Only personal save/score state is hydrated locally. Ordering and
        // human engagement counts are exclusively supplied by the server.
        await loadSocialData(for: posts.compactMap { if case .rating(let item) = $0 { return item }; return nil })
    }

    func observe(_ post: FeedPost, explore: Bool) async {
        guard currentUserId != nil else { return }
        let tab = explore ? "explore" : "following"
        guard let session = feedSessions[tab + ":" + post.serverKey] else { return }
        let observation = session + ":" + post.serverKey
        guard !observedPosts.contains(observation) else { return }
        do { try await Task.sleep(for: .seconds(1)) } catch { return }
        let active = await MainActor.run { UIApplication.shared.applicationState == .active }
        guard !Task.isCancelled, active else { return }
        observedPosts.insert(observation)
        struct Impression: Encodable { let sessionId: String; let keys: [String] }
        await WebAPI.post("api/feed/impressions", body: Impression(sessionId: session, keys: [post.serverKey]), authed: true)
    }

    private func loadSocialData(for items: [FeedItem]) async {
        guard !items.isEmpty else { return }
        let releaseIds = items.map(\.releases.id.uuidString)

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

        let userId = currentUserId
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
    // The user's manual rating precision (0.5 half-star / 0.1 decimal) -- was never threaded
    // this far before, so every rate button on this tab silently used FlowerRateControl's own
    // 0.5 default regardless of the account's actual setting. See FeedCard below for where it
    // actually reaches the button.
    let ratingStep: Double
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
                .font(.jakarta(13))
                .foregroundStyle(Color.sjMuted)
                .multilineTextAlignment(.center)
            FindPeopleLinkButton()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 16)
    }

    private var bellButton: some View {
        NavigationLink(value: NotificationsDestination()) {
            Image("icon-bell")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 19, height: 19)
                .foregroundStyle(Color.sjInk)
                .frame(width: 36, height: 36)
                .background {
                    Circle()
                        .fill(Color.clear)
                        .glassEffect(.regular, in: Circle())
                }
                .overlay(alignment: .topTrailing) {
                    if viewModel.hasUnreadNotifications {
                        // Circle for 1-9, stretches into a pill for 10+.
                        Text(viewModel.unreadNotificationCount > 99 ? "99+" : "\(viewModel.unreadNotificationCount)")
                            .font(.jakarta(10, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .padding(.horizontal, 4)
                            .frame(minWidth: 16, minHeight: 16)
                            .background(Capsule().fill(.red))
                            .fixedSize()
                            .offset(x: 5, y: -4)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(String(localized: "Notifications"))
        .accessibilityHint(viewModel.hasUnreadNotifications
            ? String(format: String(localized: "%d unread notifications"), viewModel.unreadNotificationCount)
            : "")
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
                .font(.jakarta(17, weight: activeTab == tab ? .bold : .regular))
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
        } else if posts.isEmpty && viewModel.feedErrors.contains(isExplore ? "explore" : "following") {
            VStack(spacing: 14) {
                Text("Couldn't load your feed.").foregroundStyle(Color.sjMuted)
                Button("Retry") {
                    Task { if isExplore { await viewModel.refreshExplore() } else { await viewModel.refreshFollowing() } }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if posts.isEmpty && (isExplore ? viewModel.exploreCursor : viewModel.followingCursor) == nil {
            VStack(spacing: 14) {
                Image("icon-list-music")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 44, height: 44)
                    .foregroundStyle(Color.sjBorder)
                Text(emptyMessage)
                    .font(.jakarta(15)).foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center).padding(.horizontal, 40)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 10) {
                        Color.clear.frame(height: 0).id("feed-top")
                        ForEach(posts) { post in
                            postCard(post, isExplore: isExplore)
                                .onScrollVisibilityChange(threshold: 0.5) { visible in
                                    viewModel.setVisible(post, explore: isExplore, visible: visible)
                                }
                        }
                        if (isExplore ? viewModel.exploreCursor : viewModel.followingCursor) != nil {
                            Button {
                                Task { await viewModel.loadMore(explore: isExplore) }
                            } label: {
                                if viewModel.loadingMore { ProgressView() }
                                else { Text(viewModel.feedErrors.contains(isExplore ? "explore" : "following") ? "Retry" : "Load more") }
                            }
                            .disabled(viewModel.loadingMore)
                            .padding(.vertical, 16)
                        } else if viewModel.feedErrors.contains(isExplore ? "explore" : "following") {
                            Button("Retry") {
                                Task { if isExplore { await viewModel.refreshExplore() } else { await viewModel.refreshFollowing() } }
                            }.padding(.vertical, 16)
                        } else {
                            Text("You're all caught up.").font(.jakarta(13)).foregroundStyle(Color.sjMuted).padding(.vertical, 16)
                            if !isExplore { followingFeedFooter }
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
    private func postCard(_ post: FeedPost, isExplore: Bool) -> some View {
        switch post {
        case .rating(let item):
            ratingCard(item, isExplore: isExplore)
        case .mixShare(let share):
            mixShareCard(share)
        }
    }

    private func ratingCard(_ item: FeedItem, isExplore: Bool) -> some View {
        // if/else, not `isExplore ? { … } : nil` -- with default MainActor
        // isolation the ternary form crashes the type checker ("failed to
        // produce diagnostic"), confirmed 2026-09-28 on the Home feed rebuild.
        let notInterested: (() async -> Void)?
        if isExplore {
            notInterested = { await viewModel.notInterested(item: item) }
        } else {
            notInterested = nil
        }
        return FeedCard(
            item: item,
            currentUserId: viewModel.currentUserId,
            isLiked: viewModel.likedPostIds.contains(item.id),
            isSaved: viewModel.savedReleaseIds.contains(item.releases.id),
            likesCount: viewModel.likeCounts[item.id] ?? 0,
            commentsCount: viewModel.commentCounts[item.id] ?? 0,
            onLike: { await viewModel.toggleLike(for: item) },
            onSave: { await viewModel.toggleSave(for: item) },
            onBlock: { await viewModel.blockUser(userId: item.userId) },
            onNotInterested: notInterested,
            onOwnProfileTap: onOwnProfileTap,
            myScore: viewModel.myScores[item.releases.id],
            onMyScoreChange: { viewModel.myScores[item.releases.id] = $0 },
            ratingStep: ratingStep
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
            onOwnProfileTap: onOwnProfileTap,
            onDeleted: { viewModel.removeMixShare(id: share.id) }
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
    @State private var requestedIds: Set<UUID> = []

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
                    Image("icon-users")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 44, height: 44)
                        .foregroundStyle(Color.sjBorder)
                    Text("No suggestions right now.")
                        .font(.jakarta(15)).foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(suggestions) { user in
                            SuggestedUserRow(
                                user: user,
                                state: followedIds.contains(user.id) ? .following
                                     : requestedIds.contains(user.id) ? .requested : .none,
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

        async let requestedTask = FollowService.outgoingRequestIds()

        let (rows, following, requested) = await (rowsTask, followingTask, requestedTask)
        followedIds = Set(following.map(\.followingId))
        requestedIds = requested
        suggestions = rows.map {
            SuggestedUser(id: $0.id, username: $0.username, displayName: $0.displayName,
                          avatarUrl: $0.avatarUrl, ratingCount: $0.ratingCount)
        }
        isLoading = false
    }

    // Following a private account sends a request instead (DB trigger);
    // FollowService reports which one happened.
    private func toggleFollow(_ user: SuggestedUser) async {
        if followedIds.contains(user.id) || requestedIds.contains(user.id) {
            followedIds.remove(user.id)
            requestedIds.remove(user.id)
            await FollowService.unfollow(user.id)
        } else {
            followedIds.insert(user.id)
            let result = await FollowService.follow(user.id)
            if result != .following { followedIds.remove(user.id) }
            if result == .requested { requestedIds.insert(user.id) }
        }
    }
}

private struct SuggestedUserRow: View {
    let user: FindPeopleView.SuggestedUser
    let state: FollowState
    let onToggle: () async -> Void

    private var handle: String { user.username ?? user.displayName ?? "" }

    private var label: LocalizedStringKey {
        switch state {
        case .following: return "Following"
        case .requested: return "Requested"
        case .none:      return "Follow"
        }
    }

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
                            DefaultAvatarView(size: 44)
                        }
                    }
                    .frame(width: 44, height: 44).clipShape(Circle())
                    .accessibilityHidden(true) // name text alongside already describes it

                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.displayName ?? user.username ?? String(localized: "User"))
                            .font(.jakarta(14, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(1)
                        if let u = user.username {
                            Text("@" + u)
                                .font(.jakarta(12))
                                .foregroundStyle(Color.sjMuted)
                                .lineLimit(1)
                        }
                        Text(String(format: String(localized: "%d ratings"), user.ratingCount))
                            .font(.jakarta(11))
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
                Text(label)
                    .font(.jakarta(12, weight: .semibold))
                    .foregroundStyle(state != .none ? Color.sjMuted : Color.sjCream)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 6)
                    .background(state != .none ? Color.sjBorder.opacity(0.4) : Color.sjAmber)
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
    let onNotInterested: (() async -> Void)?
    let onOwnProfileTap: () -> Void
    var ownRatingActions: OwnRatingMenuActions? = nil
    var myScore: Double? = nil
    var onMyScoreChange: ((Double?) -> Void)? = nil
    /// True while a rating is still mid-flow (drag committed, "Done" not yet
    /// tapped) -- the rating exists but isn't finalized, so this hides the
    /// like/comment action bar (nothing to interact with on an unfinished
    /// post) and skips this view's own card background/corner/shadow, so a
    /// caller can embed it directly above its own continuation content
    /// (comment/mix/Done) inside one shared card instead of two stacked
    /// ones. Default false renders the normal, complete, standalone card.
    var isDraft: Bool = false
    /// Ties this card's `ScoreBadge` geometry to a matching id elsewhere in
    /// the host view (typically the `MorphingRateButton` flower that just
    /// committed this exact rating), so the badge lands as a continuation of
    /// that flower's morph instead of appearing as an unrelated new view.
    /// nil (the normal case, every other caller) opts out entirely.
    var matchedGeometryNamespace: Namespace.ID? = nil
    /// The user's manual rating precision -- appended at the end (rather than nearer
    /// myScore/onMyScoreChange, which it's logically related to) so every existing call site
    /// stays valid without reordering; defaults to 0.5 only as a last-resort fallback, every
    /// real caller should pass the account's actual setting.
    var ratingStep: Double = 0.5

    @State private var activeSheet: CardSheet?
    @State private var showBlockConfirm = false
    @State private var userMixCount: Int? = nil
    @State private var prefetchedComments: [RatingComment]? = nil

    private var isOwnPost: Bool {
        guard let cid = currentUserId else { return false }
        return item.userId == cid
    }

    private var cardContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            cardHeader
            albumSection
            if let text = item.reviewText, !text.isEmpty {
                Text(text)
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }
            if !isDraft {
                actionBar
            }
        }
    }

    var body: some View {
        Group {
            if isDraft {
                cardContent
            } else {
                cardContent
                    .background(Color.sjSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 1)
            }
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .comments:
                CommentSheetView(ratingId: item.id, preloaded: prefetchedComments)
                    .presentationDetents([.large])  // large only: see CommentInputField
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
                .select("id, user_id, content, created_at, profiles!rating_comments_user_id_fkey(username, display_name, avatar_url)")
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

            Text("·").font(.jakarta(13)).foregroundStyle(Color.sjBorder)

            Text(item.createdAt.relativeTimeString)
                .font(.jakarta(12)).foregroundStyle(Color.sjMuted)

            Spacer(minLength: 0)

            Menu {
                if let own = ownRatingActions {
                    Button { own.onShare() } label: { Label("Share", image: "icon-share") }
                    Button { own.onEdit() } label: { Label("Edit", image: "icon-square-pen") }
                    Button { own.onAddToMix() } label: { Label("Add to Mix", image: "icon-bookmark") }
                    Button { own.onEditComment() } label: { Label("Edit Comment", image: "icon-message-square") }
                    Divider()
                    Button(role: .destructive) { own.onDelete() } label: { Label("Delete", image: "icon-trash") }
                } else {
                    Button { activeSheet = .addRating } label: {
                        Label("Add", image: "icon-plus")
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
                        if isSaved {
                            Label("Saved", image: "icon-bookmark-filled")
                        } else {
                            Label("Save", image: "icon-bookmark")
                        }
                    }
                    ShareLink(
                        item: URL(string: "https://sillajuku.com/r/\(item.id)")!,
                        subject: Text(item.releases.displayTitle + " · " + item.releases.displayArtist),
                        message: Text("Check out this rating on sillajuku")
                    ) {
                        Label("Share", image: "icon-share")
                    }
                    if !isOwnPost {
                        if let onNotInterested {
                            Button { Task { await onNotInterested() } } label: {
                                Label("Not Interested", image: "icon-thumbs-down")
                            }
                        }
                        Divider()
                        Button(role: .destructive) { activeSheet = .report } label: { Label("Report", image: "icon-flag") }
                        Button(role: .destructive) { showBlockConfirm = true } label: { Label("Block this user", image: "icon-hand") }
                    }
                }
            } label: {
                Image("icon-more-horizontal")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 14, height: 14)
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
        let icon = UserAvatarView(url: item.profiles?.avatarUrl, size: 30)
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
                .font(.jakarta(13.5, weight: .semibold))
                .foregroundStyle(Color.sjInk)
                .lineLimit(1)
                // One line always: shrink (to 65%, enough for even a wide 20-char handle on a
                .minimumScaleFactor(0.65)  // 375pt phone) before the rest of the row gives way.
                .layoutPriority(1)
            PostBadgeView(isVerified: item.profiles?.isVerified == true,
                          foundingNumber: item.profiles?.foundingNumber,
                          badgeColor: item.profiles?.badgeColor,
                          featured: item.profiles?.featuredBadge)
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

                    if currentUserId != nil {
                        AlbumRateButton(
                            release: item.releases.asRelease,
                            initialScore: myScore,
                            ratingStep: ratingStep,
                            onScoreChange: onMyScoreChange,
                            size: 26
                        )
                        .offset(x: 3, y: 3)
                    }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(item.releases.displayTitle)
                        .font(.jakarta(14, weight: .bold))
                        .foregroundStyle(Color.sjInk).lineLimit(2)

                    Text(item.releases.typeLabel + " · " + item.releases.displayArtist)
                        .font(.jakarta(11.5)).foregroundStyle(Color.sjMuted).lineLimit(1)
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
            if let matchedGeometryNamespace {
                ScoreBadge(score: score)
                    .matchedGeometryEffect(id: "scoreBadge", in: matchedGeometryNamespace)
            } else {
                ScoreBadge(score: score)
            }
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
                    Image(isLiked ? "icon-heart-filled" : "icon-heart")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 19, height: 19)
                        .foregroundStyle(isLiked ? .red : Color.sjInk)
                }
                .buttonStyle(.plain)
                .animation(.easeInOut(duration: 0.15), value: isLiked)
                .accessibilityLabel(isLiked ? String(localized: "Unlike") : String(localized: "Like"))
                .sensoryFeedback(.impact(weight: .light), trigger: isLiked)

                if likesCount > 0 {
                    Button { activeSheet = .likers } label: {
                        Text("\(likesCount)")
                            .font(.jakarta(14, weight: .medium))
                            .foregroundStyle(isLiked ? .red : Color.sjMuted)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            // Comment group: icon + count
            HStack(spacing: 5) {
                Button { activeSheet = .comments } label: {
                    Image("icon-message-circle")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 19, height: 19)
                        .foregroundStyle(Color.sjInk)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "View comments"))

                if commentsCount > 0 {
                    Text("\(commentsCount)")
                        .font(.jakarta(14, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                }
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
            var avatarUrl: String? = nil
            enum CodingKeys: String, CodingKey {
                case id, username
                case displayName = "display_name"; case avatarUrl = "avatar_url"
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
                        Image("icon-heart")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 36, height: 36)
                            .foregroundStyle(Color.sjBorder)
                        Text("No likes yet").font(.jakarta(15)).foregroundStyle(Color.sjMuted)
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
                                UserAvatarView(url: liker.profiles?.avatarUrl, size: 32)
                                Text("@" + (liker.profiles?.handle ?? String(localized: "someone")))
                                    .font(.jakarta(14, weight: .semibold))
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
            .from("rating_likes").select("user_id, profiles!rating_likes_user_id_fkey(id, username, display_name, avatar_url)")
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
            var avatarUrl: String? = nil
            enum CodingKeys: String, CodingKey {
                case id, username
                case displayName = "display_name"; case avatarUrl = "avatar_url"
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
                        Image("icon-heart")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 36, height: 36)
                            .foregroundStyle(Color.sjBorder)
                        Text("No likes yet").font(.jakarta(15)).foregroundStyle(Color.sjMuted)
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
                                UserAvatarView(url: liker.profiles?.avatarUrl, size: 32)
                                Text("@" + (liker.profiles?.handle ?? String(localized: "someone")))
                                    .font(.jakarta(14, weight: .semibold))
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
            .from("track_rating_likes").select("user_id, profiles!track_rating_likes_user_id_fkey(id, username, display_name, avatar_url)")
            .eq("track_rating_id", value: trackRatingId).execute().value) ?? []
        isLoading = false
    }
}

// MARK: - Shared Find People button

struct FindPeopleLinkButton: View {
    var body: some View {
        NavigationLink(value: FindPeopleDestination()) {
            HStack(spacing: 8) {
                Image("icon-user-plus")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 14, height: 14)
                Text("Find people to follow")
                    .font(.jakarta(14, weight: .semibold))
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
                        Image("icon-check-circle")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 44, height: 44)
                            .foregroundStyle(Color.sjBlue)
                        Text("Report submitted")
                            .font(.jakarta(16, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                        Text("Thanks for helping keep sillajuku safe.")
                            .font(.jakarta(14))
                            .foregroundStyle(Color.sjMuted)
                            .multilineTextAlignment(.center)
                        Button("Done") { dismiss() }
                            .font(.jakarta(15, weight: .semibold))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.top, 4)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(.bottom, 40)
                } else {
                    if let error = errorMessage {
                        Text(error)
                            .font(.jakarta(13))
                            .foregroundStyle(.red)
                            .padding(.horizontal, 20)
                            .padding(.bottom, 8)
                    }
                    Text("Why are you reporting this post?")
                        .font(.jakarta(13))
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
                                    .font(.jakarta(15))
                                    .foregroundStyle(Color.sjInk)
                                Spacer()
                                if isSubmitting {
                                    ProgressView().scaleEffect(0.8)
                                } else {
                                    Image("icon-chevron-right")
                                        .renderingMode(.template)
                                        .resizable().scaledToFit()
                                        .frame(width: 12, height: 12)
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
    HomeView(viewModel: HomeViewModel(), scrollToTopTrigger: UUID(), ratingStep: 0.5, onOwnProfileTap: {})
}
