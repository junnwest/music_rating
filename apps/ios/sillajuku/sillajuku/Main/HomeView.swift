import SwiftUI
import Observation
import Supabase

// MARK: - Models

struct FeedItem: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let score: Double?
    let eloScore: Double?
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

    enum CodingKeys: String, CodingKey {
        case id, title
        case artist      = "artist_display"
        case coverUrl    = "cover_url"
        case releaseType = "release_group_type"
    }

    var typeLabel: String {
        switch releaseType?.lowercased() {
        case "album":  return "Album"
        case "single": return "Single"
        case "ep":     return "EP"
        default:       return "Release"
        }
    }

    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl,
                releaseType: releaseType, releaseDate: nil, titleNative: nil, artistNative: nil,
                tracklist: nil, totalTracks: nil)
    }
}

struct FeedProfile: Codable {
    let username: String?
    let displayName: String?
    enum CodingKeys: String, CodingKey { case username; case displayName = "display_name" }
    var handle: String { username ?? displayName ?? "someone" }
}

// MARK: - ViewModel

@Observable
class HomeViewModel {
    var exploreItems:   [FeedItem] = []
    var followingItems: [FeedItem] = []
    var isLoadingExplore   = true
    var isLoadingFollowing = true
    var isLoading: Bool { isLoadingExplore }

    var likedRatingIds:         Set<UUID>  = []
    var savedReleaseIds:        Set<UUID>  = []
    var likeCounts:            [UUID: Int] = [:]
    var commentCounts:         [UUID: Int] = [:]
    var hasUnreadNotifications: Bool       = false
    var blockedUserIds:         Set<UUID>  = []

    private var hasLoadedExplore   = false
    private var hasLoadedFollowing = false

    private static let feedSelect =
        "id, user_id, score, elo_score, created_at, release_groups(id, title, artist_display, cover_url, release_group_type), profiles!ratings_user_id_fkey(username, display_name)"

    // Personalization signals (populated before explore loads)
    private var followingIds:  Set<UUID>   = []
    private var likedArtists:  Set<String> = []

    var currentUserId: UUID? { supabase.auth.currentUser?.id }

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
        let (ids, artists, blocked) = await (followsTask, artistsTask, blockedTask)
        followingIds  = Set(ids)
        likedArtists  = Set(artists)
        blockedUserIds = Set(blocked)
    }

    func blockUser(userId: UUID) async {
        guard let me = currentUserId, userId != me else { return }
        blockedUserIds.insert(userId)
        exploreItems.removeAll   { $0.userId == userId }
        followingItems.removeAll { $0.userId == userId }
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

    private func ranked(_ items: [FeedItem]) -> [FeedItem] {
        items
            .map { item -> (FeedItem, Double) in
                var s = 0.0
                if followingIds.contains(item.userId)      { s += 8 }
                if likedArtists.contains(item.releases.artist) { s += 5 }
                s += log(Double((likeCounts[item.id]    ?? 0) + 1)) * 5
                s += log(Double((commentCounts[item.id] ?? 0) + 1)) * 3
                let ageHours = -item.createdAt.timeIntervalSinceNow / 3600
                if ageHours < 12       { s += 3 }
                else if ageHours < 72  { s += 1.5 }
                else if ageHours < 336 { s += 0.5 }
                return (item, s)
            }
            .sorted { $0.1 > $1.1 }
            .map(\.0)
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

    func refreshExplore() async {
        guard let pool: [FeedItem] = try? await supabase
            .from("ratings").select(Self.feedSelect)
            .order("created_at", ascending: false).limit(150)
            .execute().value else { return }
        likedRatingIds = []
        savedReleaseIds = []
        likeCounts = [:]
        commentCounts = [:]
        let filtered = pool.filter { !blockedUserIds.contains($0.userId) }
        await loadSocialData(for: filtered)
        exploreItems = Array(ranked(filtered).prefix(60))
        hasLoadedExplore = true
        await refreshNotificationBadge()
    }

    func loadExplore() async {
        guard !hasLoadedExplore else { return }
        hasLoadedExplore = true
        isLoadingExplore = true
        let pool: [FeedItem] = (try? await supabase
            .from("ratings").select(Self.feedSelect)
            .order("created_at", ascending: false).limit(150)
            .execute().value) ?? []
        let filtered = pool.filter { !blockedUserIds.contains($0.userId) }
        await loadSocialData(for: filtered)
        exploreItems = Array(ranked(filtered).prefix(60))
        isLoadingExplore = false
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

        let items: [FeedItem] = (try? await supabase
            .from("ratings").select(Self.feedSelect)
            .in("user_id", values: ids)
            .order("created_at", ascending: false).limit(60).execute().value) ?? []
        let filtered = items.filter { !blockedUserIds.contains($0.userId) }
        followingItems = filtered
        isLoadingFollowing = false
        await loadSocialData(for: filtered)
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

        if let rows: [RatingIdRow] = try? await supabase
            .from("rating_likes").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.ratingId, default: 0] += 1 }
            for (k, v) in counts { likeCounts[k] = v }
        }

        if let rows: [RatingIdRow] = try? await supabase
            .from("rating_comments").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.ratingId, default: 0] += 1 }
            for (k, v) in counts { commentCounts[k] = v }
        }

        guard let userId = currentUserId else { return }

        if let rows: [RatingIdRow] = try? await supabase
            .from("rating_likes").select("rating_id")
            .eq("user_id", value: userId)
            .in("rating_id", values: ratingIds).execute().value {
            for r in rows { likedRatingIds.insert(r.ratingId) }
        }

        if let rows: [ReleaseIdRow] = try? await supabase
            .from("saved_releases").select("release_id")
            .eq("user_id", value: userId)
            .in("release_id", values: releaseIds).execute().value {
            for r in rows { savedReleaseIds.insert(r.releaseId) }
        }
    }

    func toggleLike(for item: FeedItem) async {
        guard let userId = currentUserId else { return }
        let wasLiked = likedRatingIds.contains(item.id)
        if wasLiked {
            likedRatingIds.remove(item.id)
            likeCounts[item.id] = max(0, (likeCounts[item.id] ?? 1) - 1)
        } else {
            likedRatingIds.insert(item.id)
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
            if wasLiked { likedRatingIds.insert(item.id); likeCounts[item.id] = (likeCounts[item.id] ?? 0) + 1 }
            else { likedRatingIds.remove(item.id); likeCounts[item.id] = max(0, (likeCounts[item.id] ?? 1) - 1) }
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
    @State private var showNotifications      = false

    var body: some View {
        NavigationStack {
            feedContent
                .overlay(alignment: .top) { floatingHeader }
                .background(Color.sjCream.ignoresSafeArea())
                .navigationBarHidden(true)
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
            .navigationDestination(for: FindPeopleDestination.self) { _ in FindPeopleView() }
            .navigationDestination(isPresented: $showNotifications) {
                NotificationsView()
                    .onDisappear { Task { await viewModel.refreshNotificationBadge() } }
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
            HStack(spacing: 28) {
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
        .padding(.top, 12)
        .padding(.bottom, 10)
        .contentShape(Rectangle())
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
        Button { showNotifications = true } label: {
            Image(systemName: "bell")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(Color.sjInk)
                .frame(width: 36, height: 36)
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
    }

    private func feedTabButton(_ tab: FeedTab, label: String) -> some View {
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
        }
        .buttonStyle(.plain)
    }

    // MARK: Feed content (swipeable)

    private var feedContent: some View {
        TabView(selection: $activeTab) {
            feedList(items: viewModel.exploreItems, isLoading: viewModel.isLoadingExplore,
                     emptyMessage: "No ratings yet — be the first!",
                     scrollTrigger: exploreScrollTrigger, isExplore: true)
                .tag(FeedTab.explore)

            feedList(items: viewModel.followingItems, isLoading: viewModel.isLoadingFollowing,
                     emptyMessage: "Follow people to see their ratings here.",
                     scrollTrigger: followingScrollTrigger, isExplore: false)
                .tag(FeedTab.following)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .animation(.easeInOut(duration: 0.18), value: activeTab)
        // Clear background so the inner page TabView doesn't paint a white/grey block
        // that sits between the glass tab bar and the scroll content
        .background(Color.clear)
    }

    @ViewBuilder
    private func feedList(items: [FeedItem], isLoading: Bool, emptyMessage: String, scrollTrigger: UUID, isExplore: Bool) -> some View {
        if isLoading {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if items.isEmpty {
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
                        ForEach(items) { item in
                            FeedCard(
                                item: item,
                                currentUserId: viewModel.currentUserId,
                                isLiked: viewModel.likedRatingIds.contains(item.id),
                                isSaved: viewModel.savedReleaseIds.contains(item.releases.id),
                                likesCount: viewModel.likeCounts[item.id] ?? 0,
                                commentsCount: viewModel.commentCounts[item.id] ?? 0,
                                onLike: { await viewModel.toggleLike(for: item) },
                                onSave: { await viewModel.toggleSave(for: item) },
                                onBlock: { await viewModel.blockUser(userId: item.userId) },
                                onOwnProfileTap: onOwnProfileTap
                            )
                        }
                        if !isExplore {
                            followingFeedFooter
                        }
                    }
                    .padding(.horizontal, 16)
                    // Extra space so the last card is fully above the glass tab bar
                    .padding(.bottom, 100)
                }
                // Top margin pushes PTR spinner below the floating header
                .contentMargins(.top, 90, for: .scrollContent)
                .refreshable {
                    if isExplore { await viewModel.refreshExplore() }
                }
                .onChange(of: scrollTrigger) { _, _ in
                    withAnimation { proxy.scrollTo("feed-top", anchor: .top) }
                }
            }
        }
    }
}

// MARK: - Find people

struct FindPeopleDestination: Hashable {}

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
                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .success(let img): img.resizable().scaledToFill()
                                default: Color.sjBorder
                                }
                            }
                        } else {
                            Image(systemName: "person.circle.fill")
                                .resizable().scaledToFit()
                                .foregroundStyle(Color(uiColor: .systemGray3))
                        }
                    }
                    .frame(width: 44, height: 44).clipShape(Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        Text(user.displayName ?? user.username ?? "User")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                        if let u = user.username {
                            Text("@\(u)")
                                .font(.system(size: 12))
                                .foregroundStyle(Color.sjMuted)
                        }
                        Text("\(user.ratingCount) ratings")
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

private struct FeedCard: View {
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
                    subject: Text("\(item.releases.title) · \(item.releases.artist)"),
                    message: Text("Check out this rating on sillajuku")
                ) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                if !isOwnPost {
                    Divider()
                    Button(role: .destructive) { activeSheet = .report } label: { Label("Report", systemImage: "flag") }
                    Button(role: .destructive) { showBlockConfirm = true } label: { Label("Block this user", systemImage: "hand.raised") }
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.sjMuted)
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
        }
        .padding(.leading, 14).padding(.trailing, 4)
        .padding(.top, 12).padding(.bottom, 10)
    }

    @ViewBuilder
    private var avatarLink: some View {
        let icon = Image(systemName: "person.circle.fill")
            .font(.system(size: 30))
            .foregroundStyle(Color(uiColor: .systemGray3))

        if isOwnPost {
            Button { onOwnProfileTap() } label: { icon }
                .buttonStyle(.plain)
        } else if let profile = item.profiles {
            NavigationLink(value: UserProfileDestination(userId: item.userId, handle: profile.handle)) {
                icon
            }
            .buttonStyle(.plain)
        } else {
            icon
        }
    }

    @ViewBuilder
    private var usernameLink: some View {
        let label = Text("@\(item.profiles?.handle ?? "someone")")
            .font(.system(size: 13.5, weight: .semibold))
            .foregroundStyle(Color.sjInk)

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
                CoverImage(url: item.releases.coverUrl)
                    .frame(width: 80, height: 80)

                VStack(alignment: .leading, spacing: 4) {
                    Text(item.releases.title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.sjInk).lineLimit(2)

                    Text("\(item.releases.typeLabel) · \(item.releases.artist)")
                        .font(.system(size: 13)).foregroundStyle(Color.sjMuted).lineLimit(1)

                    scoreView.padding(.top, 4)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.sjBorder)
            }
            .padding(.horizontal, 14).padding(.bottom, 14)
            .contentShape(Rectangle())  // makes the full row tappable, including empty space
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var scoreView: some View {
        if let score = item.displayScore {
            HStack(spacing: 5) {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 12, height: 12).foregroundStyle(Color.sjAmber)
                Text(scoreLabel(score))
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(Color.sjAmber)
            }
            .frame(minHeight: 26)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(Color.sjAmber.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 7))
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
                        .font(.system(size: 19))
                        .foregroundStyle(isLiked ? .red : Color.sjMuted)
                }
                .buttonStyle(.plain)
                .animation(.easeInOut(duration: 0.15), value: isLiked)

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
                    Image(systemName: "bubble.right")
                        .font(.system(size: 19))
                        .foregroundStyle(Color.sjMuted)
                }
                .buttonStyle(.plain)

                Text("\(commentsCount)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.sjMuted)
            }

            Spacer(minLength: 0)
        }
        .padding(.leading, 14)
        .padding(.vertical, 8)
    }

    private func scoreLabel(_ s: Double) -> String {
        s.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(s)) : String(format: "%.1f", s)
    }
}

// MARK: - Likers sheet

struct LikersSheetView: View {
    let ratingId: UUID

    private struct LikerRow: Codable {
        let profiles: LikerProfile?
        struct LikerProfile: Codable {
            let username: String?
            let displayName: String?
            enum CodingKeys: String, CodingKey { case username; case displayName = "display_name" }
            var handle: String { username ?? displayName ?? "someone" }
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
                        HStack(spacing: 11) {
                            Image(systemName: "person.circle.fill")
                                .font(.system(size: 32))
                                .foregroundStyle(Color(uiColor: .systemGray3))
                            Text("@\(liker.profiles?.handle ?? "someone")")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Color.sjInk)
                        }
                        .padding(.vertical, 4)
                        .listRowBackground(Color.sjSurface)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Color.sjCream.ignoresSafeArea())
                }
            }
            .navigationTitle("\(likers.count) Like\(likers.count == 1 ? "" : "s")")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        likers = (try? await supabase
            .from("rating_likes").select("profiles!rating_likes_user_id_fkey(username, display_name)")
            .eq("rating_id", value: ratingId).execute().value) ?? []
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

    private let reasons = ["Spam", "Inappropriate Content", "Harassment", "Other"]

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

                    ForEach(reasons, id: \.self) { reason in
                        Button {
                            guard !isSubmitting else { return }
                            Task { await submit(reason: reason) }
                        } label: {
                            HStack {
                                Text(reason)
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
