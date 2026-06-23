import SwiftUI
import Supabase

// Navigation value used by HomeView's NavigationStack
struct UserProfileDestination: Hashable {
    let userId: UUID
    let handle: String
}

// MARK: - View

struct UserProfileView: View {
    let userId: UUID
    let initialHandle: String

    // MARK: Local models

    private struct OtherProfile: Codable {
        let id: UUID
        let username: String?
        let displayName: String?
        let bio: String?
        enum CodingKeys: String, CodingKey {
            case id, username, bio; case displayName = "display_name"
        }
        var handle: String { username ?? displayName ?? "someone" }
        var displayLabel: String { displayName ?? username ?? "someone" }
    }

    struct ProfileRating: Codable, Identifiable {
        let id: UUID
        let score: Double?
        let createdAt: Date
        let releases: FeedRelease

        enum CodingKeys: String, CodingKey {
            case id, score, releases; case createdAt = "created_at"
        }
    }

    private struct SongRating: Identifiable {
        let releaseId: UUID
        let position: Int
        let score: Double?
        let trackTitle: String?
        let release: FeedRelease
        var id: String { "\(releaseId.uuidString)-\(position)" }
    }

    private enum RatedItem: Identifiable {
        case album(ProfileRating)
        case song(SongRating)

        var id: String {
            switch self {
            case .album(let r): return "a-\(r.id.uuidString)"
            case .song(let s):  return "s-\(s.id)"
            }
        }
        var score: Double? {
            switch self { case .album(let r): return r.score; case .song(let s): return s.score }
        }
        var displayTitle: String {
            switch self {
            case .album(let r): return r.releases.title
            case .song(let s):  return s.trackTitle ?? "Track \(s.position)"
            }
        }
        var artistLine: String {
            switch self {
            case .album(let r): return "\(r.releases.typeLabel) · \(r.releases.artist)"
            case .song(let s):  return "\(s.release.title) · \(s.release.artist)"
            }
        }
        var coverUrl: String? {
            switch self {
            case .album(let r): return r.releases.coverUrl
            case .song(let s):  return s.release.coverUrl
            }
        }
        var asRelease: Release {
            switch self {
            case .album(let r): return r.releases.asRelease
            case .song(let s):  return s.release.asRelease
            }
        }
        var isSong: Bool { if case .song = self { return true }; return false }
    }

    // MARK: State

    @State private var profile: OtherProfile?
    @State private var ratings: [ProfileRating] = []
    @State private var songRatings: [SongRating] = []
    @State private var ratingCount    = 0
    @State private var followerCount  = 0
    @State private var followingCount = 0
    @State private var isFollowing    = false
    @State private var isLoading      = true
    @State private var isTogglingFollow = false

    @State private var ratingSortOrder:  RatingSortOrder  = .recent
    @State private var ratingTypeFilter: RatingTypeFilter = .all
    @State private var showFollowModal     = false
    @State private var followModalInitTab: FollowMode = .followers

    private var currentUserId: UUID? { supabase.auth.currentUser?.id }

    // MARK: Filtered + sorted items

    private var filteredItems: [RatedItem] {
        let albums = ratings.map { RatedItem.album($0) }
        let songs  = songRatings.map { RatedItem.song($0) }
        let base: [RatedItem]
        switch ratingTypeFilter {
        case .all:    base = albums + songs
        case .albums: base = albums
        case .songs:  base = songs
        }
        switch ratingSortOrder {
        case .recent:       return base
        case .topRated:     return base.sorted { ($0.score ?? 0) > ($1.score ?? 0) }
        case .bottomRated:  return base.sorted { ($0.score ?? 0) < ($1.score ?? 0) }
        case .alphabetical: return base.sorted { $0.displayTitle < $1.displayTitle }
        }
    }

    // MARK: Body

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                profileHeader
                Divider().padding(.top, 20)
                ratingsSection
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("@\(profile?.handle ?? initialHandle)")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showFollowModal) {
            FollowListModal(userId: userId, initialTab: followModalInitTab)
        }
        .task { await loadAll() }
    }

    // MARK: Header

    private var profileHeader: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 80))
                .foregroundStyle(Color(uiColor: .systemGray3))
                .padding(.top, 24)

            VStack(spacing: 4) {
                Text(profile?.displayLabel ?? initialHandle)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Color.sjInk)

                Text("@\(profile?.handle ?? initialHandle)")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)
            }

            if let bio = profile?.bio, !bio.isEmpty {
                Text(bio)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            statsRow

            if let cid = currentUserId, cid != userId {
                followButton
            }
        }
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity)
    }

    private var statsRow: some View {
        HStack(spacing: 24) {
            statCell(value: ratingCount, label: "Ratings")

            Button {
                followModalInitTab = .followers
                showFollowModal = true
            } label: {
                statCell(value: followerCount, label: "Followers")
            }
            .buttonStyle(.plain)

            Button {
                followModalInitTab = .following
                showFollowModal = true
            } label: {
                statCell(value: followingCount, label: "Following")
            }
            .buttonStyle(.plain)
        }
    }

    private func statCell(value: Int, label: String) -> some View {
        VStack(spacing: 3) {
            Text("\(value)")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Color.sjMuted)
        }
    }

    private var followButton: some View {
        Button {
            Task { await toggleFollow() }
        } label: {
            if isTogglingFollow {
                ProgressView().scaleEffect(0.8)
                    .frame(width: 130, height: 36)
            } else {
                Text(isFollowing ? "Following" : "Follow")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(isFollowing ? Color.sjInk : .white)
                    .frame(width: 130, height: 36)
                    .background(isFollowing ? Color.sjBorder.opacity(0.4) : Color.sjAmber)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
            }
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.15), value: isFollowing)
    }

    // MARK: Ratings section

    @ViewBuilder
    private var ratingsSection: some View {
        if isLoading {
            ProgressView().padding(.top, 40)
        } else if ratings.isEmpty && songRatings.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "music.note.list")
                    .font(.system(size: 40))
                    .foregroundStyle(Color.sjBorder)
                Text("No ratings yet")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.top, 48)
        } else {
            let items = filteredItems
            LazyVStack(spacing: 0) {
                // Filter tabs + sort row
                HStack(spacing: 4) {
                    ForEach(RatingTypeFilter.allCases, id: \.self) { filter in
                        Button { ratingTypeFilter = filter } label: {
                            Text(filter.rawValue)
                                .font(.system(size: 12,
                                              weight: ratingTypeFilter == filter ? .semibold : .regular))
                                .foregroundStyle(ratingTypeFilter == filter ? Color.sjBlue : Color.sjMuted)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(ratingTypeFilter == filter
                                            ? Color.sjBlue.opacity(0.1) : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }
                    Spacer()
                    Menu {
                        ForEach(RatingSortOrder.allCases, id: \.self) { order in
                            Button { ratingSortOrder = order } label: {
                                Label(order.rawValue,
                                      systemImage: ratingSortOrder == order ? "checkmark" : "")
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "line.3.horizontal.decrease")
                            Text(ratingSortOrder.rawValue)
                        }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.sjAmber)
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 10)

                if items.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: ratingTypeFilter == .songs ? "music.note" : "square.grid.2x2")
                            .font(.system(size: 28)).foregroundStyle(Color.sjMuted)
                        Text("No \(ratingTypeFilter.rawValue.lowercased()) rated yet")
                            .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity).padding(.top, 40)
                } else {
                    ForEach(items) { item in
                        NavigationLink(value: item.asRelease) {
                            UserRatedItemRow(
                                coverUrl: item.coverUrl,
                                title: item.displayTitle,
                                artistLine: item.artistLine,
                                score: item.score,
                                isSong: item.isSong
                            )
                        }
                        .buttonStyle(.plain)
                        Divider().padding(.leading, 74)
                    }
                }
            }
            .padding(.top, 4)
        }
    }

    // MARK: Data loading

    private func loadAll() async {
        isLoading = true

        async let profileFetch: OtherProfile?         = loadProfile()
        async let ratingsFetch: [ProfileRating]       = loadRatings()
        async let countsFetch: (Int, Int, Int, Bool)  = loadCounts()
        async let songFetch: [SongRating]             = loadSongRatings()

        let (p, r, (rc, fwer, fwing, following), songs) =
            await (profileFetch, ratingsFetch, countsFetch, songFetch)

        profile       = p
        ratings       = r
        songRatings   = songs
        ratingCount   = rc + songs.count
        followerCount = fwer
        followingCount = fwing
        isFollowing   = following
        isLoading     = false
    }

    private func loadProfile() async -> OtherProfile? {
        try? await supabase
            .from("profiles")
            .select("id, username, display_name, bio")
            .eq("id", value: userId)
            .single()
            .execute()
            .value
    }

    private func loadRatings() async -> [ProfileRating] {
        (try? await supabase
            .from("ratings")
            .select("id, score, created_at, releases(id, title, artist, cover_url, release_type)")
            .eq("user_id", value: userId)
            .order("created_at", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []
    }

    private func loadSongRatings() async -> [SongRating] {
        struct SongRatingRaw: Codable {
            let releaseId: UUID
            let position: Int?
            let score: Double?
            let releases: FeedRelease
            enum CodingKeys: String, CodingKey {
                case score, releases, position
                case releaseId = "release_id"
            }
        }
        let raw: [SongRatingRaw] = (try? await supabase
            .from("track_ratings")
            .select("release_id, position, score, releases(id, title, artist, cover_url, release_type)")
            .eq("user_id", value: userId)
            .limit(60)
            .execute()
            .value) ?? []

        guard !raw.isEmpty else { return [] }

        struct TrackTitle: Codable {
            let releaseId: UUID; let position: Int?; let title: String?
            enum CodingKeys: String, CodingKey {
                case title, position; case releaseId = "release_id"
            }
        }
        let releaseIds = Array(Set(raw.map { $0.releaseId.uuidString }))
        let titles: [TrackTitle] = (try? await supabase
            .from("tracks")
            .select("release_id, position, title")
            .in("release_id", values: releaseIds)
            .execute()
            .value) ?? []

        let titleMap = Dictionary(uniqueKeysWithValues: titles.compactMap { t -> (String, String)? in
            guard let pos = t.position, let title = t.title else { return nil }
            return ("\(t.releaseId.uuidString)-\(pos)", title)
        })

        return raw.map { r in
            SongRating(
                releaseId: r.releaseId,
                position: r.position ?? 0,
                score: r.score,
                trackTitle: titleMap["\(r.releaseId.uuidString)-\(r.position ?? 0)"],
                release: r.releases
            )
        }
    }

    private func loadCounts() async -> (Int, Int, Int, Bool) {
        async let ratingsResp   = supabase.from("ratings").select("*", count: .exact).eq("user_id", value: userId).execute()
        async let followersResp = supabase.from("follows").select("*", count: .exact).eq("following_id", value: userId).execute()
        async let followingResp = supabase.from("follows").select("*", count: .exact).eq("follower_id", value: userId).execute()

        let rc    = (try? await ratingsResp)?.count  ?? 0
        let fwer  = (try? await followersResp)?.count ?? 0
        let fwing = (try? await followingResp)?.count ?? 0

        var following = false
        if let cid = currentUserId {
            let chk = try? await supabase.from("follows").select("*", count: .exact)
                .eq("follower_id", value: cid).eq("following_id", value: userId).execute()
            following = (chk?.count ?? 0) > 0
        }
        return (rc, fwer, fwing, following)
    }

    private func toggleFollow() async {
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
        } catch { /* silently handle */ }
    }
}

// MARK: - Unified rated item row

private struct UserRatedItemRow: View {
    let coverUrl: String?
    let title: String
    let artistLine: String
    let score: Double?
    var isSong: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: coverUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                default: Color.sjBorder
                }
            }
            .frame(width: 54, height: 54)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    if isSong {
                        Text("Song")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(Color.sjAmber)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjAmber.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
                Text(artistLine)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            scoreChip

            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.sjBorder)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var scoreChip: some View {
        if let score {
            HStack(spacing: 3) {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 10, height: 10).foregroundStyle(Color.sjAmber)
                Text(score.truncatingRemainder(dividingBy: 1) == 0
                     ? String(Int(score)) : String(format: "%.1f", score))
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.sjAmber)
            }
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Color.sjAmber.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        } else {
            HStack(spacing: 3) {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 10, height: 10)
                Image(systemName: "lock.fill").font(.system(size: 9))
            }
            .foregroundStyle(Color.sjMuted)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Color.sjMuted.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }
}
