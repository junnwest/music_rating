import SwiftUI
import Supabase

// Navigation value used by HomeView's NavigationStack
struct UserProfileDestination: Hashable {
    let userId: UUID
    let handle: String
}

// MARK: - Access status

// Mirrors get_profile_subtab_access's return shape exactly. Defaults
// (allVisible) are used only until the real RPC result arrives, so the page
// doesn't flash a locked state for a split second on every load.
struct ProfileSubtabAccess: Codable {
    let profileVisible: Bool
    let catalogVisible: Bool
    let libraryVisible: Bool
    let statsVisible: Bool

    enum CodingKeys: String, CodingKey {
        case profileVisible = "profile_visible"
        case catalogVisible = "catalog_visible"
        case libraryVisible = "library_visible"
        case statsVisible   = "stats_visible"
    }

    static let allVisible = ProfileSubtabAccess(
        profileVisible: true, catalogVisible: true, libraryVisible: true, statsVisible: true
    )

    // Fail-closed fallback for when the access RPC itself errors (network
    // failure, etc.) -- distinct from `allVisible` above, which is only ever
    // the pre-load placeholder while isLoading gates the whole view and is
    // never actually rendered. A transient failure should hide content, not
    // expose it.
    static let allHidden = ProfileSubtabAccess(
        profileVisible: false, catalogVisible: false, libraryVisible: false, statsVisible: false
    )
}

// MARK: - View model

@Observable
final class UserProfileViewModel {
    let userId: UUID
    init(userId: UUID) { self.userId = userId }

    private(set) var isLoading = true
    private(set) var access = ProfileSubtabAccess.allVisible

    struct OtherProfile: Codable {
        let id: UUID
        let username: String?
        let displayName: String?
        let bio: String?
        let avatarUrl: String?
        let badgeColor: String?
        let isVerified: Bool?
        enum CodingKeys: String, CodingKey {
            case id, username, bio
            case displayName = "display_name"
            case avatarUrl   = "avatar_url"
            case badgeColor  = "badge_color"
            case isVerified  = "is_verified"
        }
        var handle: String { username ?? displayName ?? String(localized: "someone") }
        var displayLabel: String { displayName ?? username ?? String(localized: "someone") }
    }

    private(set) var profile: OtherProfile?

    // Catalog and Stats are fetched SEPARATELY (not shared) -- they can have
    // independently different effective visibility (see migration
    // 20260706000013), so a single shared array can't represent "visible on
    // one tab, locked on the other."
    private(set) var catalogAlbums: [UserRating] = []
    private(set) var catalogSongs: [SongRatingRow] = []
    private(set) var statsAlbums: [UserRating] = []
    private(set) var statsSongs: [SongRatingRow] = []

    private(set) var mixes: [Mix] = []
    private(set) var mixItemCounts: [UUID: Int] = [:]

    private(set) var followerCount  = 0
    private(set) var followingCount = 0
    private(set) var isFollowing = false
    private(set) var isBlocked   = false
    var isTogglingFollow = false
    var isTogglingBlock  = false

    // Posts-mode (Rated tab, list/posts toggle) needs like/comment state for
    // catalogAlbums specifically -- mirrors ProfileViewModel's own load().
    var likeCounts: [UUID: Int] = [:]
    var commentCounts: [UUID: Int] = [:]
    var likedRatingIds: Set<UUID> = []

    var statsSnapshot: RatingStatsSnapshot {
        RatingStatsSnapshot.compute(ratings: statsAlbums, songRatings: statsSongs)
    }

    // Separate from statsSnapshot since Catalog and Stats are
    // independently-visible arrays.
    var catalogSnapshot: RatingStatsSnapshot {
        RatingStatsSnapshot.compute(ratings: catalogAlbums, songRatings: catalogSongs)
    }

    private var currentUserId: UUID? { supabase.auth.currentUser?.id }

    func load() async {
        isLoading = true

        async let profileFetch: OtherProfile? = loadProfile()
        async let accessFetch: ProfileSubtabAccess = loadAccess()
        async let countsFetch: (Int, Int, Bool, Bool) = loadCounts()

        let (p, a, (fwer, fwing, following, blocked)) = await (profileFetch, accessFetch, countsFetch)
        profile        = p
        access         = a
        followerCount  = fwer
        followingCount = fwing
        isFollowing    = following
        isBlocked      = blocked

        // Each RPC re-checks visibility itself (returns empty if disallowed)
        // -- gating on `access` here too is just avoiding pointless network
        // calls, not the actual security boundary.
        async let catalogTask: Void = access.catalogVisible ? loadCatalog() : noop()
        async let statsTask: Void   = access.statsVisible   ? loadStats()   : noop()
        async let mixesTask: Void   = access.libraryVisible ? loadMixes()   : noop()
        _ = await (catalogTask, statsTask, mixesTask)

        isLoading = false
    }

    private func noop() async {}

    private struct SubtabParams: Encodable {
        let pUserId: UUID
        let pSubtab: String
        enum CodingKeys: String, CodingKey { case pUserId = "p_user_id"; case pSubtab = "p_subtab" }
    }

    // The song-ratings RPC's shape (recording_id/track_title/nullable
    // release_groups) doesn't match SongRatingRow directly (that struct
    // isn't Codable -- it's built client-side elsewhere too), so this
    // decodes the raw RPC row and maps it below.
    private struct SongRatingRPCRow: Codable {
        let recordingId: UUID
        let score: Double?
        let trackTitle: String?
        let releaseGroups: ReleaseRef?
        enum CodingKeys: String, CodingKey {
            case recordingId = "recording_id", score
            case trackTitle = "track_title"
            case releaseGroups = "release_groups"
        }

        // Synthesizes a placeholder ReleaseRef when no release match exists
        // -- mirrors the fallback the old client-side 2-step fetch used
        // (`rg?.id ?? UUID()`, `rg?.title ?? ""`, etc.) rather than making
        // SongRatingRow.release Optional.
        func toRow() -> SongRatingRow {
            let ref = releaseGroups ?? ReleaseRef(
                id: UUID(), title: "", artist: "", coverUrl: nil,
                releaseType: nil, titleNative: nil, primaryArtist: nil
            )
            // get_profile_song_ratings doesn't return the track_ratings row id, review_text, or
            // created_at -- this view's Posts mode excludes songs entirely (album-only, by
            // design) and its List mode has no like/comment/date affordance for any item, so none
            // of these are ever actually read here. Placeholders are safe for now; add the real
            // columns to the RPC if this view ever needs song-post parity too.
            return SongRatingRow(ratingId: UUID(), recordingId: recordingId, score: score,
                                  reviewText: nil, trackTitle: trackTitle, release: ref, createdAt: Date())
        }
    }

    private func loadCatalog() async {
        async let albumsResp: [UserRating] = (try? await supabase
            .rpc("get_profile_album_ratings", params: SubtabParams(pUserId: userId, pSubtab: "catalog"))
            .execute().value) ?? []
        async let songsResp: [SongRatingRPCRow] = (try? await supabase
            .rpc("get_profile_song_ratings", params: SubtabParams(pUserId: userId, pSubtab: "catalog"))
            .execute().value) ?? []
        let (albums, songs) = await (albumsResp, songsResp)
        catalogAlbums = albums
        catalogSongs  = songs.map { $0.toRow() }

        let ratingIds = albums.map(\.id.uuidString)
        guard !ratingIds.isEmpty else { return }
        struct RatingIdRow: Codable {
            let ratingId: UUID
            enum CodingKeys: String, CodingKey { case ratingId = "rating_id" }
        }
        if let rows: [RatingIdRow] = try? await supabase
            .from("rating_likes").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.ratingId, default: 0] += 1 }
            likeCounts = counts
        }
        if let rows: [RatingIdRow] = try? await supabase
            .from("rating_comments").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.ratingId, default: 0] += 1 }
            commentCounts = counts
        }
        if let uid = currentUserId,
           let rows: [RatingIdRow] = try? await supabase
            .from("rating_likes").select("rating_id")
            .eq("user_id", value: uid)
            .in("rating_id", values: ratingIds).execute().value {
            likedRatingIds = Set(rows.map(\.ratingId))
        }
    }

    private func loadStats() async {
        async let albumsResp: [UserRating] = (try? await supabase
            .rpc("get_profile_album_ratings", params: SubtabParams(pUserId: userId, pSubtab: "stats"))
            .execute().value) ?? []
        async let songsResp: [SongRatingRPCRow] = (try? await supabase
            .rpc("get_profile_song_ratings", params: SubtabParams(pUserId: userId, pSubtab: "stats"))
            .execute().value) ?? []
        let (albums, songs) = await (albumsResp, songsResp)
        statsAlbums = albums
        statsSongs  = songs.map { $0.toRow() }
    }

    private struct MixParams: Encodable {
        let pUserId: UUID
        enum CodingKeys: String, CodingKey { case pUserId = "p_user_id" }
    }

    private func loadMixes() async {
        struct MixRow: Codable {
            let id: UUID, userId: UUID, name: String, description: String?
            let isPublic: Bool, isDefault: Bool, createdAt: Date
            let itemCount: Int
            enum CodingKeys: String, CodingKey {
                case id, name, description
                case userId = "user_id", isPublic = "is_public"
                case isDefault = "is_default", createdAt = "created_at"
                case itemCount = "item_count"
            }
        }
        let rows: [MixRow] = (try? await supabase
            .rpc("get_profile_mixes", params: MixParams(pUserId: userId))
            .execute().value) ?? []
        mixes = rows.map { Mix(id: $0.id, userId: $0.userId, name: $0.name, isPublic: $0.isPublic,
                                isDefault: $0.isDefault, createdAt: $0.createdAt, description: $0.description) }
        var counts: [UUID: Int] = [:]
        for r in rows { counts[r.id] = r.itemCount }
        mixItemCounts = counts
    }

    private func loadProfile() async -> OtherProfile? {
        try? await supabase
            .from("profiles")
            .select("id, username, display_name, bio, avatar_url, badge_color, is_verified")
            .eq("id", value: userId)
            .single()
            .execute()
            .value
    }

    private struct AccessParams: Encodable {
        let pUserId: UUID
        enum CodingKeys: String, CodingKey { case pUserId = "p_user_id" }
    }

    private func loadAccess() async -> ProfileSubtabAccess {
        (try? await supabase
            .rpc("get_profile_subtab_access", params: AccessParams(pUserId: userId))
            .single()
            .execute()
            .value) ?? .allHidden
    }

    private func loadCounts() async -> (Int, Int, Bool, Bool) {
        async let followersResp = supabase.from("follows").select("*", count: .exact).eq("following_id", value: userId).execute()
        async let followingResp = supabase.from("follows").select("*", count: .exact).eq("follower_id", value: userId).execute()

        let fwer  = (try? await followersResp)?.count ?? 0
        let fwing = (try? await followingResp)?.count ?? 0

        var following = false
        var blocked   = false
        if let cid = currentUserId {
            struct FollowRow: Codable { let followerId: UUID; enum CodingKeys: String, CodingKey { case followerId = "follower_id" } }
            struct BlockRow:  Codable { let blockedId: UUID;  enum CodingKeys: String, CodingKey { case blockedId  = "blocked_id"  } }
            let followRows: [FollowRow] = (try? await supabase.from("follows").select("follower_id")
                .eq("follower_id", value: cid).eq("following_id", value: userId).execute().value) ?? []
            following = !followRows.isEmpty
            let blockRows: [BlockRow] = (try? await supabase.from("blocked_users").select("blocked_id")
                .eq("blocker_id", value: cid).eq("blocked_id", value: userId).execute().value) ?? []
            blocked = !blockRows.isEmpty
        }
        return (fwer, fwing, following, blocked)
    }

    func toggleBlock() async {
        guard let cid = currentUserId else { return }
        isTogglingBlock = true
        defer { isTogglingBlock = false }
        if isBlocked {
            try? await supabase.from("blocked_users").delete()
                .eq("blocker_id", value: cid).eq("blocked_id", value: userId).execute()
            isBlocked = false
        } else {
            struct Payload: Encodable {
                let blockerId: UUID; let blockedId: UUID
                enum CodingKeys: String, CodingKey {
                    case blockerId = "blocker_id"; case blockedId = "blocked_id"
                }
            }
            try? await supabase.from("blocked_users")
                .insert(Payload(blockerId: cid, blockedId: userId)).execute()
            isBlocked = true
        }
    }

    func toggleFollow() async {
        guard let cid = currentUserId else { return }
        isTogglingFollow = true
        defer { isTogglingFollow = false }
        do {
            if isFollowing {
                try await supabase.from("follows").delete()
                    .eq("follower_id", value: cid)
                    .eq("following_id", value: userId)
                    .execute()
                isFollowing = false
                followerCount = max(0, followerCount - 1)
            } else {
                struct Payload: Encodable {
                    let followerId: UUID; let followingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case followerId = "follower_id"; case followingId = "following_id"
                    }
                }
                try await supabase.from("follows")
                    .insert(Payload(followerId: cid, followingId: userId))
                    .execute()
                isFollowing = true
                followerCount += 1
            }
            NotificationCenter.default.post(name: .followChanged, object: nil)
            // A follow/unfollow can change what's visible (Private ==
            // followers-only) -- reload access + whatever just unlocked.
            await load()
        } catch { /* silently handle */ }
    }

    func toggleLike(ratingId: UUID) async {
        guard let userId = currentUserId else { return }
        let wasLiked = likedRatingIds.contains(ratingId)
        if wasLiked {
            likedRatingIds.remove(ratingId)
            likeCounts[ratingId] = max(0, (likeCounts[ratingId] ?? 1) - 1)
        } else {
            likedRatingIds.insert(ratingId)
            likeCounts[ratingId] = (likeCounts[ratingId] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("rating_likes").delete()
                    .eq("user_id", value: userId).eq("rating_id", value: ratingId).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let ratingId: UUID
                    enum CodingKeys: String, CodingKey { case userId = "user_id"; case ratingId = "rating_id" }
                }
                try await supabase.from("rating_likes")
                    .insert(Payload(userId: userId, ratingId: ratingId)).execute()
            }
        } catch { /* best-effort, matches ProfileViewModel's own toggleLike */ }
    }

    func notInterested(rating: UserRating) async {
        catalogAlbums.removeAll { $0.id == rating.id }
        await NotInterested.markAlbum(releaseGroupId: rating.releases.id)
    }
}

// MARK: - View

struct UserProfileView: View {
    let userId: UUID
    let initialHandle: String

    @State private var vm: UserProfileViewModel
    @State private var activeTab: ProfileTab = .rated
    @State private var ratingSortOrder:   RatingSortOrder  = .recent
    @State private var ratingTypeFilter:  RatingTypeFilter = .all
    @State private var ratingDisplayMode: RatingDisplayMode = .posts
    @State private var showFollowModal = false
    @State private var followModalInitTab: FollowMode = .followers
    // Same height-floor purpose as ProfileView's identical pair -- see SwipeableTabPager's
    // minHeight parameter.
    @State private var heroHeight: CGFloat = 0
    @State private var tabMinHeight: CGFloat = 0

    init(userId: UUID, initialHandle: String) {
        self.userId = userId
        self.initialHandle = initialHandle
        _vm = State(initialValue: UserProfileViewModel(userId: userId))
    }

    private var currentUserId: UUID? { supabase.auth.currentUser?.id }

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !vm.access.profileVisible {
                ScrollView {
                    profileHeaderCore
                    SubtabLockedView(
                        headline: String(format: String(localized: "@%@'s profile is private"), vm.profile?.handle ?? initialHandle),
                        isFollowing: vm.isFollowing,
                        onFollow: { Task { await vm.toggleFollow() } }
                    )
                    .padding(.top, 20)
                }
            } else {
                GeometryReader { outerGeo in
                    ScrollView(showsIndicators: false) {
                        VStack(spacing: 0) {
                            VStack(spacing: 0) {
                                profileHeaderCore
                                Divider().padding(.top, 20)
                                tabBar
                            }
                            .background(
                                GeometryReader { heroGeo in
                                    Color.clear
                                        .onAppear { heroHeight = heroGeo.size.height }
                                        .onChange(of: heroGeo.size.height) { _, newValue in
                                            heroHeight = newValue
                                        }
                                }
                            )
                            swipeableTabContent
                        }
                    }
                    .onAppear { tabMinHeight = max(0, outerGeo.size.height - heroHeight) }
                    .onChange(of: outerGeo.size.height) { _, newValue in
                        tabMinHeight = max(0, newValue - heroHeight)
                    }
                    .onChange(of: heroHeight) { _, newValue in
                        tabMinHeight = max(0, outerGeo.size.height - newValue)
                    }
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("@" + (vm.profile?.handle ?? initialHandle))
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showFollowModal) {
            FollowListModal(userId: userId, initialTab: followModalInitTab)
        }
        .task { await vm.load() }
    }

    // MARK: Header

    private var profileHeaderCore: some View {
        VStack(spacing: 14) {
            Group {
                if let url = vm.profile?.avatarUrl {
                    CoverImage(url: url, cornerRadius: 40)
                        .frame(width: 80, height: 80)
                } else {
                    Image(systemName: "person.circle.fill")
                        .font(.jakarta(80))
                        .foregroundStyle(Color(uiColor: .systemGray3))
                }
            }
            .padding(.top, 24)
            .accessibilityHidden(true)

            VStack(spacing: 4) {
                Text(vm.profile?.displayLabel ?? initialHandle)
                    .font(.jakarta(22, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                // Badges sit next to the @handle (the account's actual
                // identity), not the display name.
                HStack(spacing: 5) {
                    Text("@" + (vm.profile?.handle ?? initialHandle))
                        .font(.jakarta(14))
                        .foregroundStyle(Color.sjMuted)
                    if let raw = vm.profile?.badgeColor, let badge = QuestBadgeColor(rawValue: raw) {
                        QuestBadgeView(color: badge.color)
                            .frame(width: 15, height: 15)
                            .accessibilityLabel(String(localized: "Quests complete"))
                    }
                    if vm.profile?.isVerified == true {
                        VerifiedBadgeView()
                            .frame(width: 15, height: 15)
                            .accessibilityLabel(String(localized: "Verified"))
                    }
                }
            }

            if vm.access.profileVisible, let bio = vm.profile?.bio, !bio.isEmpty {
                Text(bio)
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            if vm.access.profileVisible { statsRow }

            if let cid = currentUserId, cid != userId {
                if vm.isBlocked {
                    unblockButton
                } else {
                    followButton
                }
            }
        }
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity)
    }

    private var statsRow: some View {
        HStack(spacing: 24) {
            statCell(value: vm.catalogAlbums.count + vm.catalogSongs.count, label: "Ratings")
            Button {
                followModalInitTab = .followers
                showFollowModal = true
            } label: {
                statCell(value: vm.followerCount, label: "Followers")
            }
            .buttonStyle(.plain)
            Button {
                followModalInitTab = .following
                showFollowModal = true
            } label: {
                statCell(value: vm.followingCount, label: "Following")
            }
            .buttonStyle(.plain)
        }
    }

    private func statCell(value: Int, label: LocalizedStringKey) -> some View {
        VStack(spacing: 3) {
            Text("\(value)")
                .font(.jakarta(18, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.jakarta(12))
                .foregroundStyle(Color.sjMuted)
        }
    }

    private var unblockButton: some View {
        Button {
            Task { await vm.toggleBlock() }
        } label: {
            if vm.isTogglingBlock {
                ProgressView().scaleEffect(0.8).frame(width: 130, height: 36)
            } else {
                Text("Unblock")
                    .font(.jakarta(14, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 130, height: 36)
                    .background(Color.red.opacity(0.8))
                    .clipShape(RoundedRectangle(cornerRadius: 18))
            }
        }
        .buttonStyle(.plain)
    }

    private var followButton: some View {
        Button {
            Task { await vm.toggleFollow() }
        } label: {
            if vm.isTogglingFollow {
                ProgressView().scaleEffect(0.8).frame(width: 130, height: 36)
            } else {
                Text(vm.isFollowing ? "Following" : "Follow")
                    .font(.jakarta(14, weight: .semibold))
                    .foregroundStyle(vm.isFollowing ? Color.sjInk : .white)
                    .frame(width: 130, height: 36)
                    .background(vm.isFollowing ? Color.sjBorder.opacity(0.4) : Color.sjAmber)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
            }
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.15), value: vm.isFollowing)
        .sensoryFeedback(.impact(weight: .light), trigger: vm.isFollowing)
    }

    // MARK: Tab bar (mirrors ProfileView's own icon tab bar)

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(ProfileTab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { activeTab = tab }
                } label: {
                    VStack(spacing: 0) {
                        Image(systemName: activeTab == tab ? tab.activeIcon : tab.icon)
                            .font(.jakarta(20))
                            .foregroundStyle(activeTab == tab ? Color.sjInk : Color.sjMuted)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                        Rectangle()
                            .fill(activeTab == tab ? Color.sjAmber : Color.clear)
                            .frame(height: 1.5)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
            }
        }
        .padding(.top, 14)
    }

    // Floor, not a cap -- see ProfileView's identical comment on its own tabContent.
    private var swipeableTabContent: some View {
        SwipeableTabPager(selection: $activeTab, minHeight: tabMinHeight, content: tabPage)
    }

    @ViewBuilder
    private func tabPage(_ tab: ProfileTab) -> some View {
        switch tab {
        case .rated:
            if vm.access.catalogVisible {
                ratedTabContent
            } else {
                SubtabLockedView(
                    headline: String(localized: "This person's Catalog is private"),
                    isFollowing: vm.isFollowing,
                    onFollow: { Task { await vm.toggleFollow() } }
                )
            }
        case .lists:
            if vm.access.libraryVisible {
                foreignMixList
            } else {
                SubtabLockedView(
                    headline: String(localized: "This person's Library is private"),
                    isFollowing: vm.isFollowing,
                    onFollow: { Task { await vm.toggleFollow() } }
                )
            }
        case .stats:
            if vm.access.statsVisible {
                RatingStatsView(snapshot: vm.statsSnapshot)
                    .padding(.bottom, 32)
            } else {
                SubtabLockedView(
                    headline: String(localized: "This person's Stats are private"),
                    isFollowing: vm.isFollowing,
                    onFollow: { Task { await vm.toggleFollow() } }
                )
            }
        }
    }

    // MARK: Rated tab -- same filter/sort/display-mode controls as ProfileView

    private var filteredItems: [ProfileRatedItem] {
        let albums = vm.catalogAlbums.map { ProfileRatedItem.album($0) }
        let songs  = vm.catalogSongs.map { ProfileRatedItem.song($0) }
        let base: [ProfileRatedItem]
        switch ratingTypeFilter {
        case .all:    base = albums + songs
        case .albums: base = albums
        case .songs:  base = songs
        }
        switch ratingSortOrder {
        case .recent:       return base
        case .topRated:     return base.sorted { itemScore($0) > itemScore($1) }
        case .bottomRated:  return base.sorted { itemScore($0) < itemScore($1) }
        case .alphabetical: return base.sorted { $0.displayTitle < $1.displayTitle }
        }
    }

    private func itemScore(_ item: ProfileRatedItem) -> Double {
        item.score ?? 0
    }

    @ViewBuilder
    private var ratedTabContent: some View {
        let items = filteredItems
        let hasAny = !vm.catalogAlbums.isEmpty || !vm.catalogSongs.isEmpty

        if !hasAny {
            VStack(spacing: 12) {
                Image(systemName: "square.grid.2x2")
                    .font(.jakarta(36))
                    .foregroundStyle(Color.sjMuted)
                Text("No ratings yet")
                    .font(.jakarta(15))
                    .foregroundStyle(Color.sjMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
        } else {
            LazyVStack(spacing: 0) {
                HStack(spacing: 4) {
                    ForEach(RatingTypeFilter.allCases, id: \.self) { filter in
                        Button { ratingTypeFilter = filter } label: {
                            Text(LocalizedStringKey(filter.rawValue))
                                .font(.jakarta(12, weight: ratingTypeFilter == filter ? .semibold : .regular))
                                .foregroundStyle(ratingTypeFilter == filter ? Color.sjBlue : Color.sjMuted)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(ratingTypeFilter == filter ? Color.sjBlue.opacity(0.1) : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                    HStack(spacing: 2) {
                        ForEach([RatingDisplayMode.list, .posts], id: \.self) { mode in
                            Button { ratingDisplayMode = mode } label: {
                                Image(systemName: mode == .list ? "list.bullet" : "newspaper")
                                    .font(.jakarta(14))
                                    .foregroundStyle(ratingDisplayMode == mode ? Color.sjBlue : Color.sjMuted)
                                    .frame(width: 32, height: 28)
                                    .background(ratingDisplayMode == mode ? Color.sjBlue.opacity(0.1) : Color.clear)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(mode == .list ? String(localized: "List view") : String(localized: "Post view"))
                        }
                    }
                }
                .padding(.horizontal, 12).padding(.top, 8)

                HStack {
                    Text(String(format: String(localized: "%d %@"), items.count, ratingTypeFilter == .all ? String(localized: "ratings") : String(localized: String.LocalizationValue(ratingTypeFilter.rawValue)).lowercased()))
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjMuted)
                    Spacer()
                    Menu {
                        ForEach(RatingSortOrder.allCases, id: \.self) { order in
                            Button { ratingSortOrder = order } label: {
                                Label(LocalizedStringKey(order.rawValue),
                                      systemImage: ratingSortOrder == order ? "checkmark" : "")
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "line.3.horizontal.decrease")
                            Text(LocalizedStringKey(ratingSortOrder.rawValue))
                        }
                        .font(.jakarta(12, weight: .medium))
                        .foregroundStyle(Color.sjAmber)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 8)

                if items.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: ratingTypeFilter == .songs ? "music.note" : "square.grid.2x2")
                            .font(.jakarta(28)).foregroundStyle(Color.sjMuted)
                        Text(String(format: String(localized: "No %@ rated yet"), String(localized: String.LocalizationValue(ratingTypeFilter.rawValue)).lowercased()))
                            .font(.jakarta(14)).foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity).padding(.top, 40)
                } else if ratingDisplayMode == .list {
                    ForEach(items) { item in
                        ExpandableRatingListRow(
                            release: item.asRelease,
                            coverUrl: item.coverUrl,
                            title: item.displayTitle,
                            artistLine: item.artistLine,
                            score: item.score,
                            isSong: item.isSong,
                            releaseType: item.releaseType,
                            reviewText: item.reviewText,
                            createdAt: item.createdAt
                        )
                        // No delete/edit affordance -- viewer isn't the owner --
                        // but the standard long-press quick actions still apply.
                        .albumContextMenu(item.asRelease)
                    }
                } else {
                    let albumItems = items.filter { !$0.isSong }
                    if albumItems.isEmpty {
                        VStack(spacing: 10) {
                            Image(systemName: "newspaper")
                                .font(.jakarta(28)).foregroundStyle(Color.sjMuted)
                            Text("No album ratings yet")
                                .font(.jakarta(14)).foregroundStyle(Color.sjMuted)
                        }
                        .frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        ForEach(albumItems) { item in
                            if case .album(let rating) = item {
                                ProfilePostCard(
                                    rating: rating,
                                    likesCount: vm.likeCounts[rating.id] ?? 0,
                                    commentsCount: vm.commentCounts[rating.id] ?? 0,
                                    isLiked: vm.likedRatingIds.contains(rating.id),
                                    onLike: { await vm.toggleLike(ratingId: rating.id) },
                                    headerHandle: vm.profile?.handle ?? initialHandle,
                                    headerVerified: vm.profile?.isVerified == true,
                                    onNotInterested: { Task { await vm.notInterested(rating: rating) } }
                                )
                                .padding(.horizontal, 12)
                                .padding(.top, 8)
                            }
                        }
                        .padding(.bottom, 8)
                    }
                }
            }
            .padding(.top, 4)
        }
    }

    // MARK: Lists tab -- read-only, public mixes only

    private var foreignMixList: some View {
        Group {
            if vm.mixes.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "music.note.list")
                        .font(.jakarta(36))
                        .foregroundStyle(Color.sjBorder)
                    Text("No public mixes")
                        .font(.jakarta(15))
                        .foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, alignment: .top)
                .padding(.top, 40)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(vm.mixes) { mix in
                        // Direct destination, not NavigationLink(value:) --
                        // this view is pushed from several different
                        // NavigationStacks (Home, Search, comments, etc.)
                        // and only ProfileView.swift's own stack registers
                        // navigationDestination(for: Mix.self); a direct
                        // destination works regardless of which stack
                        // presented this page.
                        NavigationLink(destination: MixDetailView(mix: mix)) {
                            MixRow(mix: mix, count: vm.mixItemCounts[mix.id] ?? 0)
                        }
                        .buttonStyle(.plain)
                        Divider().padding(.leading, 18)
                    }
                }
                .padding(.top, 8)
            }
        }
    }
}

// MARK: - Locked-state placeholder

// Mirrors RankingsView.swift's RankingsLockedView convention (flower/lock
// glyph, bold headline, muted subtitle) but simpler -- no progress gauge,
// since this isn't a collective threshold. Private == followers-only, so
// following is the literal unlock path, hence the Follow button.
struct SubtabLockedView: View {
    let headline: String
    let isFollowing: Bool
    let onFollow: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image("icon-flower")
                .renderingMode(.template).resizable().scaledToFit()
                .frame(width: 32, height: 32)
                .foregroundStyle(Color.sjBlue)

            Text(headline)
                .font(.jakarta(16, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .multilineTextAlignment(.center)

            Text("Private accounts are only visible to followers.")
                .font(.jakarta(13))
                .foregroundStyle(Color.sjMuted)
                .multilineTextAlignment(.center)

            if !isFollowing {
                Button(action: onFollow) {
                    Text("Follow")
                        .font(.jakarta(14, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 130, height: 36)
                        .background(Color.sjAmber)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 32)
        .padding(.top, 48)
        .padding(.bottom, 40)
    }
}
