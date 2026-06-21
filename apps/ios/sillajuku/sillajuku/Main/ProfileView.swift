import SwiftUI
import Observation
import Supabase

// MARK: - Models

struct UserRating: Codable, Identifiable {
    let id: UUID
    let score: Double?
    let releases: ReleaseRef

    enum CodingKeys: String, CodingKey {
        case id, score, releases
    }
}

struct ReleaseRef: Codable, Identifiable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?

    enum CodingKeys: String, CodingKey {
        case id, title, artist
        case coverUrl = "cover_url"
    }

    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl,
                releaseType: nil, releaseDate: nil, titleNative: nil, artistNative: nil,
                tracklist: nil, totalTracks: nil)
    }
}

// MARK: - Tab

enum ProfileTab: CaseIterable {
    case rated, lists, stats

    var icon: String {
        switch self {
        case .rated: return "square.grid.2x2"
        case .lists: return "bookmark"
        case .stats: return "chart.bar"
        }
    }

    var activeIcon: String {
        switch self {
        case .rated: return "square.grid.2x2.fill"
        case .lists: return "bookmark.fill"
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
    var isLoading = true
    private var hasLoaded = false

    var totalRatings: Int { ratings.count }
    var avgScore: Double {
        let scored = ratings.compactMap(\.score)
        guard !scored.isEmpty else { return 0 }
        return scored.reduce(0, +) / Double(scored.count)
    }

    var followingCount = 0
    var followerCount  = 0

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        guard let user = supabase.auth.currentUser else { isLoading = false; return }
        isLoading = true

        profile = try? await supabase
            .from("profiles")
            .select("id, display_name, username, rating_mode, manual_rating_step, bio, avatar_url")
            .eq("id", value: user.id)
            .single()
            .execute()
            .value

        ratings = (try? await supabase
            .from("ratings")
            .select("id, score, releases(id, title, artist, cover_url)")
            .eq("user_id", value: user.id)
            .order("created_at", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []

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
        try? await supabase.auth.signOut()
    }
}

// MARK: - View

enum RatingSortOrder: String, CaseIterable {
    case recent     = "Recent"
    case topRated   = "Top Rated"
    case bottomRated = "Bottom Rated"
    case alphabetical = "A–Z"
}

struct ProfileView: View {
    var viewModel: ProfileViewModel
    @State private var activeTab: ProfileTab = .rated
    @State private var showSettings       = false
    @State private var showEditProfile    = false
    @State private var showShareSheet     = false
    @State private var showFollowModal    = false
    @State private var followModalInitTab: FollowMode = .following
    @State private var mixLibVM           = MixLibraryViewModel()
    @State private var ratingSortOrder: RatingSortOrder = .recent

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
        }
        .task { await viewModel.load() }
    }

    private var profileURL: URL {
        let username = viewModel.profile?.username ?? ""
        let path = username.isEmpty ? "" : "/@\(username)"
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
            .frame(maxHeight: .infinity)
        }
    }

    private var customNavBar: some View {
        ZStack {
            Text(viewModel.profile.flatMap { $0.username }.map { "@\($0)" } ?? "Profile")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.sjInk)
                .frame(maxWidth: .infinity, alignment: .center)

            HStack {
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
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().scaledToFill().clipShape(Circle())
                    default:
                        defaultAvatar
                    }
                }
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
                            .font(.system(size: tab == .lists ? 17 : 20))
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

    private var sortedRatings: [UserRating] {
        switch ratingSortOrder {
        case .recent:      return viewModel.ratings
        case .topRated:    return viewModel.ratings.sorted { ($0.score ?? 0) > ($1.score ?? 0) }
        case .bottomRated: return viewModel.ratings.sorted { ($0.score ?? 0) < ($1.score ?? 0) }
        case .alphabetical: return viewModel.ratings.sorted { $0.releases.title < $1.releases.title }
        }
    }

    @ViewBuilder
    private var ratedGrid: some View {
        if viewModel.ratings.isEmpty {
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
                HStack {
                    Text("\(viewModel.ratings.count) ratings")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                    Spacer()
                    Menu {
                        ForEach(RatingSortOrder.allCases, id: \.self) { order in
                            Button {
                                ratingSortOrder = order
                            } label: {
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
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

                ForEach(sortedRatings) { rating in
                    NavigationLink(value: rating.releases.asRelease) {
                        RatingListRow(rating: rating)
                    }
                    .buttonStyle(.plain)
                    Divider().padding(.leading, 70)
                }
            }
            .padding(.top, 4)
        }
    }

    @ViewBuilder
    private var listsPlaceholder: some View {
        if let profile = viewModel.profile {
            MixLibraryView(userId: profile.id, viewModel: mixLibVM)
        }
    }

    private var statsContent: some View {
        VStack(spacing: 16) {
            if viewModel.totalRatings > 0 {
                HStack(spacing: 12) {
                    StatsCard(value: String(format: "%.2f", viewModel.avgScore), label: "Avg Score")
                    StatsCard(value: "\(viewModel.totalRatings)", label: "Rated")
                }
            } else {
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
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 20)
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
    let label: String

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

private struct StatsCard: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 6) {
            Text(value)
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(Color.sjInk.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct RatingListRow: View {
    let rating: UserRating

    private var scoreText: String {
        guard let v = rating.score else { return "—" }
        return v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))" : String(format: "%.1f", v)
    }

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: rating.releases.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    Color.sjBorder
                }
            }
            .frame(width: 46, height: 46)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 2) {
                Text(rating.releases.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(rating.releases.artist)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if rating.score != nil {
                HStack(spacing: 4) {
                    Image("icon-flower")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 11, height: 11)
                        .foregroundStyle(Color.sjBlue)
                    Text(scoreText)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.sjBlue)
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Color.sjBlue.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                Image("icon-flower")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 11, height: 11)
                    .foregroundStyle(Color.sjMuted)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
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
    @State private var isLoading = true

    init(userId: UUID, initialTab: FollowMode) {
        self.userId = userId
        self.initialTab = initialTab
        _activeTab = State(initialValue: initialTab)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Segmented tab bar
                HStack(spacing: 0) {
                    tabBtn("Following", tab: .following)
                    tabBtn("Followers", tab: .followers)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 4)

                Divider()

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    TabView(selection: $activeTab) {
                        profileList(following, empty: "Not following anyone yet")
                            .tag(FollowMode.following)
                        profileList(followers, empty: "No followers yet")
                            .tag(FollowMode.followers)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    .animation(.easeInOut(duration: 0.2), value: activeTab)
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle(activeTab == .following ? "Following" : "Followers")
            .navigationBarTitleDisplayMode(.inline)
        }
        .task { await loadBoth() }
    }

    @ViewBuilder
    private func profileList(_ profiles: [FollowProfile], empty: String) -> some View {
        if profiles.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "person.2")
                    .font(.system(size: 36))
                    .foregroundStyle(Color.sjMuted)
                Text(empty)
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(profiles) { profile in
                FollowProfileRow(profile: profile)
                    .listRowBackground(Color.sjSurface)
                    .listRowSeparatorTint(Color.sjBorder.opacity(0.5))
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    private func tabBtn(_ label: String, tab: FollowMode) -> some View {
        Button { withAnimation { activeTab = tab } } label: {
            VStack(spacing: 0) {
                Text(label)
                    .font(.system(size: 14, weight: activeTab == tab ? .semibold : .regular))
                    .foregroundStyle(activeTab == tab ? Color.sjInk : Color.sjMuted)
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
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let img): img.resizable().scaledToFill()
                        default: Color.sjBorder
                        }
                    }
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
                    Text("@\(username)")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    ProfileView(viewModel: ProfileViewModel())
}
