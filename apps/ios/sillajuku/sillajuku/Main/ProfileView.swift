import SwiftUI
import Observation
import Supabase

// MARK: - Shared Elo helper (Instinct mode: converts Elo → 0–5 display score)

private func eloToDisplayScore(_ elo: Double) -> Double {
    let raw = 5.0 / (1.0 + pow(10.0, (1500.0 - elo) / 250.0))
    return (raw * 10).rounded() / 10.0
}

// MARK: - Models

struct UserRating: Codable, Identifiable {
    let id: UUID
    let score: Double?
    let eloScore: Double?
    let reviewText: String?
    let createdAt: Date
    let releases: ReleaseRef

    enum CodingKeys: String, CodingKey {
        case id, score
        case releases   = "release_groups"
        case eloScore   = "elo_score"
        case reviewText = "review_text"
        case createdAt  = "created_at"
    }
}

struct SongRatingRow: Identifiable {
    let recordingId: UUID
    let score: Double?
    let eloScore: Double?
    let trackTitle: String?
    let release: ReleaseRef

    var id: String { recordingId.uuidString }
}

struct ScoreBucket: Identifiable {
    let score: Double
    let count: Int
    var id: Double { score }
}

struct ArtistCount: Identifiable {
    let artist: String
    let count: Int
    var id: String { artist }
}

struct ReleaseRef: Codable, Identifiable {
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

// MARK: - Tab

enum ProfileTab: CaseIterable {
    case rated, lists, stats

    var icon: String {
        switch self {
        case .rated: return "square.grid.2x2"
        case .lists: return "music.note.list"
        case .stats: return "chart.bar"
        }
    }

    var activeIcon: String {
        switch self {
        case .rated: return "square.grid.2x2.fill"
        case .lists: return "music.note.list"
        case .stats: return "chart.bar.fill"
        }
    }
}

// MARK: - Follow model

struct FollowProfile: Codable, Identifiable {
    let id: UUID
    let username: String?
    let displayName: String?
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case id, username
        case displayName = "display_name"
        case avatarUrl   = "avatar_url"
    }
}

// MARK: - ViewModel

@Observable
class ProfileViewModel {
    var profile: Profile?
    var ratings: [UserRating] = []
    var songRatings: [SongRatingRow] = []
    var isLoading = true
    private var hasLoaded = false

    var instinctAlbumCount: Int { ratings.filter { $0.eloScore != nil }.count }
    var manualRatingCount:  Int { ratings.filter { $0.score != nil }.count }
    var instinctRatingCount: Int { ratings.filter { $0.eloScore != nil }.count }

    var totalRatings: Int { ratings.count + songRatings.count }
    var avgScore: Double {
        let albumScores = ratings.compactMap(\.score)
        let songScores  = songRatings.compactMap(\.score)
        let all = albumScores + songScores
        guard !all.isEmpty else { return 0 }
        return all.reduce(0, +) / Double(all.count)
    }

    var scoreDistribution: [ScoreBucket] {
        let albumScores: [Double] = ratings.compactMap { r in
            if let s = r.score { return s }
            if let e = r.eloScore, instinctAlbumCount >= 5 { return eloToDisplayScore(e) }
            return nil
        }
        let songScores: [Double] = songRatings.compactMap(\.score)
        var counts: [Double: Int] = [:]
        for s in albumScores + songScores {
            let bucket = max(0.5, min(5.0, (s * 2).rounded() / 2))
            counts[bucket, default: 0] += 1
        }
        return stride(from: 0.5, through: 5.0, by: 0.5).map { b in
            ScoreBucket(score: b, count: counts[b] ?? 0)
        }
    }

    var topArtists: [ArtistCount] {
        var counts: [String: Int] = [:]
        for r in ratings { counts[r.releases.artist, default: 0] += 1 }
        return counts.sorted { $0.value > $1.value }.prefix(5).map {
            ArtistCount(artist: $0.key, count: $0.value)
        }
    }

    var likeCounts:    [UUID: Int] = [:]
    var commentCounts: [UUID: Int] = [:]

    var followingCount = 0
    var followerCount  = 0

    func deleteRating(_ item: ProfileRatedItem) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        switch item {
        case .album(let r):
            ratings.removeAll { $0.id == r.id }
            _ = try? await supabase.from("ratings").delete().eq("id", value: r.id).execute()
        case .song(let r):
            songRatings.removeAll { $0.recordingId == r.recordingId }
            _ = try? await supabase.from("track_ratings")
                .delete()
                .eq("user_id", value: userId)
                .eq("recording_id", value: r.recordingId)
                .execute()
        }
    }

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        guard let user = supabase.auth.currentUser else { isLoading = false; return }
        isLoading = true

        profile = try? await supabase
            .from("profiles")
            .select("id, display_name, username, rating_mode, manual_rating_step, bio, avatar_url, notify_likes, notify_replies, notify_followers, notify_rankings, notify_capsule, profile_visibility, catalog_visibility, listen_later_visibility")
            .eq("id", value: user.id)
            .single()
            .execute()
            .value

        ratings = (try? await supabase
            .from("ratings")
            .select("id, score, elo_score, review_text, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))")
            .eq("user_id", value: user.id)
            .order("created_at", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []

        // Fetch like + comment counts for the posts display mode
        let ratingIds = ratings.map(\.id.uuidString)
        if !ratingIds.isEmpty {
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
        }

        // Song ratings — Step 1: recording_id + score + recording title/artist
        struct TrackRatingNew: Codable {
            let recordingId: UUID
            let score: Double?
            let recordings: RecordingInfo
            struct RecordingInfo: Codable {
                let id: UUID; let title: String; let artistDisplay: String?
                enum CodingKeys: String, CodingKey {
                    case id, title; case artistDisplay = "artist_display"
                }
            }
            enum CodingKeys: String, CodingKey {
                case recordingId = "recording_id"; case score; case recordings
            }
        }
        let rawSongs: [TrackRatingNew] = (try? await supabase
            .from("track_ratings")
            .select("recording_id, score, recordings(id, title, artist_display)")
            .eq("user_id", value: user.id)
            .order("created_at", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []

        if !rawSongs.isEmpty {
            // Step 2: get release group cover art via release_tracks
            struct RTCoverRow: Codable {
                let recordingId: UUID
                let releases: CoverRelRow?
                struct CoverRelRow: Codable {
                    let isCanonical: Bool?
                    let releaseGroups: RGCover?
                    struct RGCover: Codable {
                        let id: UUID; let title: String; let artistDisplay: String?; let coverUrl: String?
                        let titleNative: String?; let primaryArtist: NativeArtistRef?
                        enum CodingKeys: String, CodingKey {
                            case id, title; case artistDisplay = "artist_display"; case coverUrl = "cover_url"
                            case titleNative = "native_title"; case primaryArtist = "artists"
                        }
                    }
                    enum CodingKeys: String, CodingKey {
                        case isCanonical = "is_canonical"; case releaseGroups = "release_groups"
                    }
                }
                enum CodingKeys: String, CodingKey {
                    case recordingId = "recording_id"; case releases
                }
            }
            let coverRows: [RTCoverRow] = (try? await supabase
                .from("release_tracks")
                .select("recording_id, releases(is_canonical, release_groups(id, title, artist_display, cover_url, native_title, artists!release_groups_primary_artist_id_fkey(name_native)))")
                .in("recording_id", values: rawSongs.map(\.recordingId.uuidString))
                .execute()
                .value) ?? []

            var rgMap: [UUID: RTCoverRow.CoverRelRow.RGCover] = [:]
            for row in coverRows {
                guard let rel = row.releases, let rg = rel.releaseGroups else { continue }
                if rel.isCanonical == true || rgMap[row.recordingId] == nil { rgMap[row.recordingId] = rg }
            }

            songRatings = rawSongs.map { r in
                let rg = rgMap[r.recordingId]
                let ref = ReleaseRef(
                    id:            rg?.id ?? UUID(),
                    title:         rg?.title ?? "",
                    artist:        rg?.artistDisplay ?? r.recordings.artistDisplay ?? "",
                    coverUrl:      rg?.coverUrl,
                    releaseType:   nil,
                    titleNative:   rg?.titleNative,
                    primaryArtist: rg?.primaryArtist
                )
                return SongRatingRow(
                    recordingId: r.recordingId,
                    score:       r.score,
                    eloScore:    nil,
                    trackTitle:  r.recordings.title,
                    release:     ref
                )
            }
        }

        if let r = try? await supabase.from("follows")
            .select("*", head: true, count: .exact)
            .eq("follower_id", value: user.id).execute() {
            followingCount = r.count ?? 0
        }
        if let r = try? await supabase.from("follows")
            .select("*", head: true, count: .exact)
            .eq("following_id", value: user.id).execute() {
            followerCount = r.count ?? 0
        }

        isLoading = false
    }

    func reload() async {
        hasLoaded = false
        await load()
    }

    func signOut() async {
        SpotifyService.clearCache()
        try? await supabase.auth.signOut()
    }
}

// MARK: - View

enum RatingSortOrder: String, CaseIterable {
    case recent       = "Recent"
    case topRated     = "Top Rated"
    case bottomRated  = "Bottom Rated"
    case alphabetical = "A–Z"
}

enum RatingTypeFilter: String, CaseIterable {
    case all    = "All"
    case albums = "Albums"
    case songs  = "Songs"
}

enum RatingDisplayMode {
    case list, posts
}

// Unified item type for the rated list (albums + songs together)
enum ProfileRatedItem: Identifiable {
    case album(UserRating)
    case song(SongRatingRow)

    var id: String {
        switch self {
        case .album(let r): return "a-\(r.id)"
        case .song(let r):  return "s-\(r.id)"
        }
    }
    var score: Double? {
        switch self { case .album(let r): return r.score; case .song(let r): return r.score }
    }
    var eloScore: Double? {
        switch self { case .album(let r): return r.eloScore; case .song(let r): return r.eloScore }
    }
    var displayTitle: String {
        switch self {
        case .album(let r): return r.releases.title
        case .song(let r):  return r.trackTitle ?? "Unknown Track"
        }
    }
    var artistLine: String {
        switch self {
        case .album(let r): return r.releases.artist
        case .song(let r):  return "\(r.release.title) · \(r.release.artist)"
        }
    }
    var coverUrl: String? {
        switch self {
        case .album(let r): return r.releases.coverUrl
        case .song(let r):  return r.release.coverUrl
        }
    }
    var asRelease: Release {
        switch self {
        case .album(let r): return r.releases.asRelease
        case .song(let r):  return r.release.asRelease
        }
    }
    var isSong: Bool { if case .song = self { return true }; return false }
    var releaseType: String? {
        switch self {
        case .album(let r): return r.releases.releaseType
        case .song: return nil
        }
    }
}

struct ProfileView: View {
    var viewModel: ProfileViewModel
    @State private var activeTab: ProfileTab = .rated
    @State private var showSettings       = false
    @State private var showEditProfile    = false
    @State private var showShareSheet     = false
    @State private var showFollowModal    = false
    @State private var showUserSearch     = false
    @State private var followModalInitTab: FollowMode = .following
    @State private var mixLibVM           = MixLibraryViewModel()
    @State private var ratingSortOrder:    RatingSortOrder = .recent
    @State private var ratingTypeFilter:   RatingTypeFilter = .all
    @State private var ratingDisplayMode:  RatingDisplayMode = .list
    @State private var pendingDeleteItem:  ProfileRatedItem? = nil

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    profileContent
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationBarHidden(true)
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
            .navigationDestination(for: Mix.self) { MixDetailView(mix: $0) }
            .sheet(isPresented: $showSettings) {
                SettingsView(viewModel: viewModel)
            }
            .sheet(isPresented: $showEditProfile, onDismiss: {
                Task { await viewModel.reload() }
            }) {
                EditProfileView(profile: viewModel.profile)
            }
            .sheet(isPresented: $showShareSheet) {
                ShareSheet(url: profileURL, username: viewModel.profile?.username ?? "sillajuku")
            }
            .sheet(isPresented: $showFollowModal) {
                if let id = viewModel.profile?.id {
                    FollowListModal(userId: id, initialTab: followModalInitTab)
                }
            }
            .sheet(isPresented: $showUserSearch) {
                UserSearchSheet()
            }
        }
        .task { await viewModel.load() }
        .onReceive(NotificationCenter.default.publisher(for: .ratingChanged)) { _ in
            Task { await viewModel.reload() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .followChanged)) { _ in
            Task { await viewModel.reload() }
        }
    }

    private var profileURL: URL {
        let username = viewModel.profile?.username ?? ""
        let path = username.isEmpty ? "" : "/profile/\(username)"
        return URL(string: "https://sillajuku.com\(path)") ?? URL(string: "https://sillajuku.com")!
    }

    // MARK: - Content

    private var profileContent: some View {
        VStack(spacing: 0) {
            customNavBar
            headerRow
            nameRow
            actionButtons
            tabBar

            TabView(selection: $activeTab) {
                ScrollView(showsIndicators: false) {
                    ratedGrid.padding(.bottom, 32)
                }
                .tag(ProfileTab.rated)

                ScrollView(showsIndicators: false) {
                    listsPlaceholder.padding(.bottom, 32)
                }
                .tag(ProfileTab.lists)

                ScrollView(showsIndicators: false) {
                    statsContent.padding(.bottom, 32)
                }
                .tag(ProfileTab.stats)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
    }

    private var customNavBar: some View {
        ZStack {
            Text(viewModel.profile.flatMap { $0.username }.map { "@\($0)" } ?? "Profile")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.sjInk)
                .frame(maxWidth: .infinity, alignment: .center)

            HStack {
                Button { showUserSearch = true } label: {
                    Image(systemName: "person.badge.plus")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.sjInk)
                }
                Spacer()
                Button { showSettings = true } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.sjInk)
                }
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    // MARK: - Header row

    private var headerRow: some View {
        HStack(spacing: 16) {
            avatarCircle
                .frame(width: 76, height: 76)

            HStack(spacing: 0) {
                ProfileStatCell(value: "\(viewModel.totalRatings)", label: "Rated")
                Button {
                    followModalInitTab = .following
                    showFollowModal = true
                } label: {
                    ProfileStatCell(value: "\(viewModel.followingCount)", label: "Following")
                }
                .buttonStyle(.plain)
                Button {
                    followModalInitTab = .followers
                    showFollowModal = true
                } label: {
                    ProfileStatCell(value: "\(viewModel.followerCount)", label: "Followers")
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
    }

    private var avatarCircle: some View {
        Group {
            if let urlStr = viewModel.profile?.avatarUrl, let url = URL(string: urlStr) {
                CachedImage(url: url) { defaultAvatar }
                    .scaledToFill()
                    .clipShape(Circle())
            } else {
                defaultAvatar
            }
        }
    }

    private var defaultAvatar: some View {
        Image(systemName: "person.circle.fill")
            .resizable()
            .scaledToFit()
            .foregroundStyle(Color(uiColor: .systemGray3))
    }

    // MARK: - Display name + bio

    private var nameRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let name = viewModel.profile?.displayName, !name.isEmpty {
                Text(name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
            }
            if let bio = viewModel.profile?.bio, !bio.isEmpty {
                Text(bio)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.top, 10)
    }

    // MARK: - Action buttons

    private var actionButtons: some View {
        HStack(spacing: 8) {
            Button("Edit profile") { showEditProfile = true }
                .buttonStyle(ProfileActionButtonStyle())
            Button("Share profile") { showShareSheet = true }
                .buttonStyle(ProfileActionButtonStyle())
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
    }

    // MARK: - Icon tab bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(ProfileTab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { activeTab = tab }
                } label: {
                    VStack(spacing: 0) {
                        Image(systemName: activeTab == tab ? tab.activeIcon : tab.icon)
                            // bookmark is a tall narrow symbol — use smaller size to balance it
                            .font(.system(size: 20))
                            .foregroundStyle(activeTab == tab ? Color.sjInk : Color.sjMuted)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)

                        // Amber underline on the active tab only
                        Rectangle()
                            .fill(activeTab == tab ? Color.sjAmber : Color.clear)
                            .frame(height: 1.5)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 14)
    }

    // MARK: - Tab content

    private var filteredItems: [ProfileRatedItem] {
        let albums = viewModel.ratings.map { ProfileRatedItem.album($0) }
        let songs  = viewModel.songRatings.map { ProfileRatedItem.song($0) }
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
        if let s = item.score { return s }
        if let e = item.eloScore { return eloToDisplayScore(e) }
        return 0
    }

    @ViewBuilder
    private var ratedGrid: some View {
        let items = filteredItems
        let hasAny = !viewModel.ratings.isEmpty || !viewModel.songRatings.isEmpty

        if !hasAny {
            VStack(spacing: 12) {
                Image(systemName: "square.grid.2x2")
                    .font(.system(size: 36))
                    .foregroundStyle(Color.sjMuted)
                Text("No ratings yet")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
        } else {
            LazyVStack(spacing: 0) {
                // Type filter tabs + display mode toggle
                HStack(spacing: 4) {
                    ForEach(RatingTypeFilter.allCases, id: \.self) { filter in
                        Button {
                            ratingTypeFilter = filter
                        } label: {
                            Text(LocalizedStringKey(filter.rawValue))
                                .font(.system(size: 12, weight: ratingTypeFilter == filter ? .semibold : .regular))
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
                                    .font(.system(size: 14))
                                    .foregroundStyle(ratingDisplayMode == mode ? Color.sjBlue : Color.sjMuted)
                                    .frame(width: 32, height: 28)
                                    .background(ratingDisplayMode == mode ? Color.sjBlue.opacity(0.1) : Color.clear)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)

                // Count + sort
                HStack {
                    Text(String(format: String(localized: "%d %@"), items.count, ratingTypeFilter == .all ? String(localized: "ratings") : String(localized: String.LocalizationValue(ratingTypeFilter.rawValue)).lowercased()))
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                    Spacer()
                    Menu {
                        ForEach(RatingSortOrder.allCases, id: \.self) { order in
                            Button {
                                ratingSortOrder = order
                            } label: {
                                Label(LocalizedStringKey(order.rawValue),
                                      systemImage: ratingSortOrder == order ? "checkmark" : "")
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "line.3.horizontal.decrease")
                            Text(LocalizedStringKey(ratingSortOrder.rawValue))
                        }
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.sjAmber)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)

                if items.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: ratingTypeFilter == .songs ? "music.note" : "square.grid.2x2")
                            .font(.system(size: 28))
                            .foregroundStyle(Color.sjMuted)
                        Text(String(format: String(localized: "No %@ rated yet"), String(localized: String.LocalizationValue(ratingTypeFilter.rawValue)).lowercased()))
                            .font(.system(size: 14))
                            .foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                } else if ratingDisplayMode == .list {
                    ForEach(items) { item in
                        NavigationLink(value: item.asRelease) {
                            RatingListRow(
                                coverUrl: item.coverUrl,
                                title: item.displayTitle,
                                artistLine: item.artistLine,
                                score: item.score,
                                eloScore: item.eloScore,
                                instinctCount: viewModel.instinctAlbumCount,
                                isSong: item.isSong,
                                releaseType: item.releaseType
                            )
                        }
                        .buttonStyle(.plain)
                        .contextMenu {
                            Button(role: .destructive) {
                                pendingDeleteItem = item
                            } label: {
                                Label("Delete Rating", systemImage: "trash")
                            }
                        }
                        Divider().padding(.leading, 70)
                    }
                } else {
                    // Posts display — album ratings only
                    let albumItems = items.filter { !$0.isSong }
                    if albumItems.isEmpty {
                        VStack(spacing: 10) {
                            Image(systemName: "newspaper")
                                .font(.system(size: 28)).foregroundStyle(Color.sjMuted)
                            Text("No album ratings yet")
                                .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                        }
                        .frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        ForEach(albumItems) { item in
                            if case .album(let rating) = item {
                                NavigationLink(value: rating.releases.asRelease) {
                                    ProfilePostCard(
                                        rating: rating,
                                        likesCount: viewModel.likeCounts[rating.id] ?? 0,
                                        commentsCount: viewModel.commentCounts[rating.id] ?? 0,
                                        instinctAlbumCount: viewModel.instinctAlbumCount
                                    )
                                }
                                .buttonStyle(.plain)
                                .padding(.horizontal, 12)
                                .padding(.top, 8)
                                .contextMenu {
                                    Button(role: .destructive) {
                                        pendingDeleteItem = item
                                    } label: {
                                        Label("Delete Rating", systemImage: "trash")
                                    }
                                }
                            }
                        }
                        .padding(.bottom, 8)
                    }
                }
            }
            .padding(.top, 4)
            .confirmationDialog(
                "Delete Rating?",
                isPresented: Binding(
                    get: { pendingDeleteItem != nil },
                    set: { if !$0 { pendingDeleteItem = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let item = pendingDeleteItem {
                        Task { await viewModel.deleteRating(item) }
                    }
                    pendingDeleteItem = nil
                }
                Button("Cancel", role: .cancel) { pendingDeleteItem = nil }
            } message: {
                Text("This will permanently remove this rating.")
            }
        }
    }

    @ViewBuilder
    private var listsPlaceholder: some View {
        if let profile = viewModel.profile {
            MixLibraryView(userId: profile.id, viewModel: mixLibVM)
        }
    }

    private var statsContent: some View {
        Group {
            if viewModel.totalRatings == 0 {
                VStack(spacing: 12) {
                    Image(systemName: "chart.bar")
                        .font(.system(size: 36))
                        .foregroundStyle(Color.sjMuted)
                    Text("Rate some albums to see your stats")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.sjMuted)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 60)
            } else {
                VStack(alignment: .leading, spacing: 24) {
                    statsNumbersRow
                    scoreHistogramSection
                    if !viewModel.topArtists.isEmpty {
                        topArtistsSection
                    }
                    if viewModel.instinctRatingCount > 0 || viewModel.manualRatingCount > 0 {
                        ratingModeSection
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
            }
        }
    }

    private var statsNumbersRow: some View {
        HStack(spacing: 0) {
            statsCell(value: "\(viewModel.ratings.count)", label: "Albums")
            Divider().frame(height: 30)
            statsCell(value: "\(viewModel.songRatings.count)", label: "Songs")
            Divider().frame(height: 30)
            statsCell(value: String(format: "%.2f", viewModel.avgScore), label: "Avg Score")
        }
        .padding(.vertical, 14)
        .background(Color.sjInk.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func statsCell(value: String, label: LocalizedStringKey) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity)
    }

    private var scoreHistogramSection: some View {
        let buckets = viewModel.scoreDistribution
        let maxCount = max(1, buckets.map(\.count).max() ?? 1)
        return VStack(alignment: .leading, spacing: 10) {
            statSectionHeader("Score Distribution")
            VStack(spacing: 2) {
                // Count labels + bars — separated so bar bottoms are truly aligned
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(buckets) { bucket in
                        VStack(spacing: 2) {
                            // Space character keeps this row the same height for every column
                            Text(bucket.count > 0 ? "\(bucket.count)" : " ")
                                .font(.system(size: 8))
                                .foregroundStyle(Color.sjMuted)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(bucket.count > 0
                                      ? Color.sjBlue.opacity(0.75)
                                      : Color.sjInk.opacity(0.07))
                                .frame(height: max(4, CGFloat(bucket.count) / CGFloat(maxCount) * 72))
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
                // Flat axis line
                Rectangle()
                    .fill(Color.sjBorder.opacity(0.6))
                    .frame(height: 1)
                // X-axis labels in their own row — always flat
                HStack(spacing: 3) {
                    ForEach(buckets) { bucket in
                        Text(bucket.score.truncatingRemainder(dividingBy: 1) == 0
                             ? "\(Int(bucket.score))" : "")
                            .font(.system(size: 9))
                            .foregroundStyle(Color.sjMuted)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private var topArtistsSection: some View {
        let artists = viewModel.topArtists
        let maxCount = CGFloat(artists.first?.count ?? 1)
        return VStack(alignment: .leading, spacing: 10) {
            statSectionHeader("Top Artists")
            VStack(spacing: 0) {
                ForEach(artists) { item in
                    HStack(spacing: 10) {
                        Text(item.artist)
                            .font(.system(size: 13))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        GeometryReader { geo in
                            let w = geo.size.width * CGFloat(item.count) / maxCount
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.sjBlue.opacity(0.3))
                                .frame(width: max(6, w), height: 8)
                                .frame(maxHeight: .infinity)
                        }
                        .frame(width: 80, height: 16)
                        Text("\(item.count)")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                            .frame(width: 24, alignment: .trailing)
                    }
                    .padding(.vertical, 7)
                    if item.id != artists.last?.id { Divider() }
                }
            }
        }
    }

    private var ratingModeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            statSectionHeader("Rating Mode")
            HStack(spacing: 10) {
                if viewModel.instinctRatingCount > 0 {
                    modePill(label: "Instinct", count: viewModel.instinctRatingCount)
                }
                if viewModel.manualRatingCount > 0 {
                    modePill(label: "Manual", count: viewModel.manualRatingCount)
                }
            }
        }
    }

    private func modePill(label: LocalizedStringKey, count: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(count)")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.sjBlue.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func statSectionHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .textCase(.uppercase)
            .tracking(0.5)
    }
}

// MARK: - Share sheet wrapper

import LinkPresentation

private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    let username: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let item = ProfileShareItem(url: url, username: username)
        let vc = UIActivityViewController(activityItems: [item], applicationActivities: nil)
        vc.excludedActivityTypes = [
            .addToReadingList,
            .assignToContact,
            .markupAsPDF,
            .openInIBooks,
            .print,
            .saveToCameraRoll,
        ]
        return vc
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

private class ProfileShareItem: NSObject, UIActivityItemSource {
    let url: URL
    let username: String

    init(url: URL, username: String) {
        self.url = url
        self.username = username
        super.init()
    }

    func activityViewControllerPlaceholderItem(_ ac: UIActivityViewController) -> Any { url }

    func activityViewController(_ ac: UIActivityViewController,
                                 itemForActivityType type: UIActivity.ActivityType?) -> Any? { url }

    func activityViewControllerLinkMetadata(_ ac: UIActivityViewController) -> LPLinkMetadata? {
        let meta = LPLinkMetadata()
        meta.originalURL = url
        meta.url = url
        meta.title = "@\(username) on sillajuku"
        if let image = UIImage(named: "logo-flower") {
            meta.imageProvider = NSItemProvider(object: image)
        }
        return meta
    }
}

// MARK: - Sub-views

private struct ProfileStatCell: View {
    let value: String
    let label: LocalizedStringKey

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.system(size: 10.5))
                .foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity)
    }
}

struct ProfileActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Color.sjInk)
            .frame(maxWidth: .infinity)
            .frame(height: 32)
            .background(Color.sjInk.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}


struct RatingListRow: View {
    let coverUrl: String?
    let title: String
    let artistLine: String
    let score: Double?
    let eloScore: Double?
    let instinctCount: Int
    var isSong: Bool = false
    var releaseType: String? = nil

    // Score to display: manual score > elo-derived (only if threshold met) > nil
    private var displayScore: Double? {
        if let s = score { return s }
        if let e = eloScore, instinctCount >= 5 { return eloToDisplayScore(e) }
        return nil
    }

    private var scoreText: String {
        guard let v = displayScore else { return "" }
        return v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))" : String(format: "%.1f", v)
    }

    // Instinct rating that exists but hasn't hit the reveal threshold yet
    private var pendingReveal: Bool {
        score == nil && eloScore != nil && instinctCount < 5
    }

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: coverUrl, cornerRadius: 6)
                .frame(width: 46, height: 46)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    if isSong {
                        Text("Song")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(Color.sjAmber)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjAmber.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    } else if let rt = releaseType {
                        Text(LocalizedStringKey(rt.lowercased() == "ep" ? "EP" : rt.capitalized))
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjBlue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
                Text(artistLine)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let _ = displayScore {
                HStack(spacing: 4) {
                    Image("icon-flower")
                        .renderingMode(.template).resizable().scaledToFit()
                        .frame(width: 11, height: 11).foregroundStyle(Color.sjBlue)
                    Text(scoreText)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.sjBlue)
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Color.sjBlue.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            } else if pendingReveal {
                VStack(alignment: .trailing, spacing: 2) {
                    Image("icon-flower")
                        .renderingMode(.template).resizable().scaledToFit()
                        .frame(width: 11, height: 11).foregroundStyle(Color.sjMuted)
                    Text(String(format: String(localized: "Rate %d more to reveal"), 5 - instinctCount))
                        .font(.system(size: 10))
                        .foregroundStyle(Color.sjMuted)
                        .multilineTextAlignment(.trailing)
                }
            } else {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 11, height: 11).foregroundStyle(Color.sjMuted)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

// MARK: - Follow list sheet (combined with swipeable tabs)

enum FollowMode { case following, followers }

struct FollowListModal: View {
    let userId: UUID
    let initialTab: FollowMode

    @State private var activeTab: FollowMode
    @State private var following: [FollowProfile] = []
    @State private var followers: [FollowProfile] = []
    @State private var isLoading  = true
    @State private var searchText = ""

    init(userId: UUID, initialTab: FollowMode) {
        self.userId = userId
        self.initialTab = initialTab
        _activeTab = State(initialValue: initialTab)
    }

    private var filteredFollowing: [FollowProfile] { filter(following) }
    private var filteredFollowers: [FollowProfile] { filter(followers) }

    private func filter(_ profiles: [FollowProfile]) -> [FollowProfile] {
        guard !searchText.isEmpty else { return profiles }
        let q = searchText.lowercased()
        return profiles.filter {
            ($0.username?.lowercased().contains(q) ?? false) ||
            ($0.displayName?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(Color.sjMuted)
                        .font(.system(size: 14))
                    TextField("Search", text: $searchText)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.sjInk)
                    if !searchText.isEmpty {
                        Button { searchText = "" } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(Color.sjMuted)
                                .font(.system(size: 14))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.sjBorder.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 8)

                // Tab bar with counts
                HStack(spacing: 0) {
                    tabBtn("Following", count: following.count, tab: .following)
                    tabBtn("Followers", count: followers.count, tab: .followers)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 4)

                Divider()

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    TabView(selection: $activeTab) {
                        profileList(filteredFollowing, empty: "Not following anyone yet")
                            .tag(FollowMode.following)
                        profileList(filteredFollowers, empty: "No followers yet")
                            .tag(FollowMode.followers)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    .animation(.easeInOut(duration: 0.2), value: activeTab)
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 0) {
                    Divider()
                    FindPeopleLinkButton()
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                }
                .background(Color.sjCream)
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle(activeTab == .following ? "Following" : "Followers")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: FindPeopleDestination.self) { _ in FindPeopleView() }
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
        }
        .task { await loadBoth() }
    }

    @ViewBuilder
    private func profileList(_ profiles: [FollowProfile], empty: String) -> some View {
        if profiles.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: searchText.isEmpty ? "person.2" : "magnifyingglass")
                    .font(.system(size: 36))
                    .foregroundStyle(Color.sjMuted)
                Text(searchText.isEmpty ? empty : "No results for \"\(searchText)\"")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(profiles) { profile in
                NavigationLink(value: UserProfileDestination(
                    userId: profile.id,
                    handle: profile.username ?? profile.displayName ?? String(localized: "user")
                )) {
                    FollowProfileRow(profile: profile)
                }
                .listRowBackground(Color.sjSurface)
                .listRowSeparatorTint(Color.sjBorder.opacity(0.5))
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    private func tabBtn(_ label: LocalizedStringKey, count: Int, tab: FollowMode) -> some View {
        Button { withAnimation { activeTab = tab } } label: {
            VStack(spacing: 0) {
                HStack(spacing: 5) {
                    Text(label)
                        .font(.system(size: 14, weight: activeTab == tab ? .semibold : .regular))
                        .foregroundStyle(activeTab == tab ? Color.sjInk : Color.sjMuted)
                    if count > 0 {
                        Text("\(count)")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(activeTab == tab ? Color.sjBlue : Color.sjMuted)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(
                                (activeTab == tab ? Color.sjBlue : Color.sjMuted).opacity(0.12)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                Rectangle()
                    .fill(activeTab == tab ? Color.sjBlue : Color.clear)
                    .frame(height: 2)
            }
        }
        .buttonStyle(.plain)
    }

    private func loadBoth() async {
        isLoading = true
        async let f = loadList(mode: .following)
        async let r = loadList(mode: .followers)
        following = await f
        followers = await r
        isLoading = false
    }

    private func loadList(mode: FollowMode) async -> [FollowProfile] {
        struct FollowRow: Codable {
            let followingId: UUID?
            let followerId: UUID?
            enum CodingKeys: String, CodingKey {
                case followingId = "following_id"
                case followerId  = "follower_id"
            }
        }
        let col    = mode == .following ? "following_id" : "follower_id"
        let filter = mode == .following ? "follower_id"  : "following_id"
        let rows: [FollowRow] = (try? await supabase
            .from("follows").select(col).eq(filter, value: userId).execute().value) ?? []
        let ids = rows.compactMap { mode == .following ? $0.followingId : $0.followerId }
        guard !ids.isEmpty else { return [] }
        return (try? await supabase
            .from("profiles")
            .select("id, username, display_name, avatar_url")
            .in("id", values: ids.map(\.uuidString))
            .execute().value) ?? []
    }
}

private struct FollowProfileRow: View {
    let profile: FollowProfile

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let url = profile.avatarUrl.flatMap(URL.init) {
                    CachedImage(url: url) { Color.sjBorder }
                        .scaledToFill()
                } else {
                    Image(systemName: "person.circle.fill")
                        .resizable()
                        .scaledToFit()
                        .foregroundStyle(Color(uiColor: .systemGray3))
                }
            }
            .frame(width: 40, height: 40)
            .clipShape(Circle())

            VStack(alignment: .leading, spacing: 2) {
                if let name = profile.displayName, !name.isEmpty {
                    Text(name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                }
                if let username = profile.username {
                    Text("@" + username)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - User search sheet

struct UserSearchSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query       = ""
    @State private var results:    [SearchProfile] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    struct SearchProfile: Codable, Identifiable, Hashable {
        let id: UUID
        let username: String?
        let displayName: String?
        enum CodingKeys: String, CodingKey { case id, username; case displayName = "display_name" }
        var handle: String  { username ?? displayName ?? String(localized: "someone") }
        var label: String   { displayName ?? username ?? String(localized: "someone") }
        var initial: String { String(handle.prefix(1)).uppercased() }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Color.sjMuted)
                    TextField("Search by username…", text: $query)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    if !query.isEmpty {
                        Button { query = "" } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Color.sjMuted)
                        }
                    }
                }
                .padding(10)
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

                Divider()

                if isSearching {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if results.isEmpty && !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text("No users found.")
                        .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(results) { profile in
                                NavigationLink(value: profile) {
                                    HStack(spacing: 12) {
                                        ZStack {
                                            Circle().fill(Color.sjAmber.opacity(0.15)).frame(width: 40, height: 40)
                                            Text(profile.initial)
                                                .font(.system(size: 16, weight: .bold)).foregroundStyle(Color.sjAmber)
                                        }
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(profile.label)
                                                .font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.sjInk)
                                            Text("@" + profile.handle)
                                                .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                                        }
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 12, weight: .semibold))
                                            .foregroundStyle(Color.sjBorder)
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                if profile.id != results.last?.id {
                                    Divider().padding(.leading, 68)
                                }
                            }
                        }
                    }
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Find People")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            // Destinations for UserProfileView and its inner navigation
            .navigationDestination(for: SearchProfile.self) { profile in
                UserProfileView(userId: profile.id, initialHandle: profile.handle)
            }
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
        }
        .onChange(of: query) { _, new in
            searchTask?.cancel()
            let trimmed = new.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { results = []; return }
            searchTask = Task {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                isSearching = true
                results = (try? await supabase
                    .from("profiles")
                    .select("id, username, display_name")
                    .ilike("username", value: "%\(trimmed)%")
                    .limit(25)
                    .execute()
                    .value) ?? []
                isSearching = false
            }
        }
    }
}

// MARK: - Profile Post Card (posts display mode)

private struct ProfilePostCard: View {
    let rating: UserRating
    let likesCount: Int
    let commentsCount: Int
    let instinctAlbumCount: Int

    private var displayScore: Double? {
        if let s = rating.score { return s }
        if let e = rating.eloScore, instinctAlbumCount >= 5 {
            return eloToDisplayScore(e)
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Album row
            HStack(spacing: 13) {
                CoverImage(url: rating.releases.coverUrl)
                    .frame(width: 72, height: 72)

                VStack(alignment: .leading, spacing: 4) {
                    Text(rating.releases.displayTitle)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(2)
                    Text(rating.releases.typeLabel + " · " + rating.releases.displayArtist)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)
                    if let score = displayScore {
                        HStack(spacing: 5) {
                            Image("icon-flower")
                                .renderingMode(.template).resizable().scaledToFit()
                                .frame(width: 11, height: 11).foregroundStyle(Color.sjAmber)
                            Text(scoreLabel(score))
                                .font(.system(size: 13, weight: .bold)).foregroundStyle(Color.sjAmber)
                        }
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.sjAmber.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .padding(.top, 2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.sjBorder)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)

            // Review text
            if let text = rating.reviewText, !text.isEmpty {
                Text(text)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }

            // Action bar: likes · comments · date
            HStack(spacing: 14) {
                HStack(spacing: 5) {
                    Image(systemName: "heart")
                        .font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                    Text("\(likesCount)")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(Color.sjMuted)
                }
                HStack(spacing: 5) {
                    Image(systemName: "bubble.right")
                        .font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                    Text("\(commentsCount)")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(Color.sjMuted)
                }
                Spacer()
                Text(rating.createdAt.relativeTimeString)
                    .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 12)
        }
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 1)
    }

    private func scoreLabel(_ s: Double) -> String {
        s.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(s))" : String(format: "%.1f", s)
    }
}

#Preview {
    ProfileView(viewModel: ProfileViewModel())
}
