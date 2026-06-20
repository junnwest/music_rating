import SwiftUI
import Observation
import Supabase

// MARK: - Models

struct UserRating: Codable, Identifiable {
    let id: UUID
    let score: Double
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

// MARK: - ViewModel

@Observable
class ProfileViewModel {
    var profile: Profile?
    var ratings: [UserRating] = []
    var isLoading = true
    private var hasLoaded = false

    var totalRatings: Int { ratings.count }
    var avgScore: Double {
        guard !ratings.isEmpty else { return 0 }
        return ratings.map(\.score).reduce(0, +) / Double(ratings.count)
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
            .select("id, display_name, username, rating_mode, bio, avatar_url")
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

struct ProfileView: View {
    var viewModel: ProfileViewModel
    @State private var activeTab: ProfileTab = .rated
    @State private var showSettings = false
    @State private var showEditProfile = false
    @State private var showShareSheet = false

    private let columns = [GridItem(.flexible(), spacing: 2),
                            GridItem(.flexible(), spacing: 2),
                            GridItem(.flexible(), spacing: 2)]

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
            .navigationTitle(viewModel.profile.flatMap { $0.username }.map { "@\($0)" } ?? "Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                            .foregroundStyle(Color.sjInk)
                    }
                }
            }
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
            headerRow
            nameRow
            actionButtons
            tabBar

            // Swipeable content — each page scrolls independently
            TabView(selection: $activeTab) {
                ScrollView(showsIndicators: false) { ratedGrid }
                    .tag(ProfileTab.rated)
                ScrollView(showsIndicators: false) { listsPlaceholder }
                    .tag(ProfileTab.lists)
                ScrollView(showsIndicators: false) { statsContent }
                    .tag(ProfileTab.stats)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .animation(.easeInOut(duration: 0.18), value: activeTab)
        }
    }

    // MARK: - Header row

    private var headerRow: some View {
        HStack(spacing: 16) {
            avatarCircle
                .frame(width: 76, height: 76)

            HStack(spacing: 0) {
                ProfileStatCell(value: "\(viewModel.totalRatings)", label: "Rated")
                ProfileStatCell(value: "\(viewModel.followingCount)", label: "Following")
                ProfileStatCell(value: "\(viewModel.followerCount)",  label: "Followers")
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
            LazyVGrid(columns: columns, spacing: 2) {
                ForEach(viewModel.ratings) { rating in
                    NavigationLink(value: rating.releases.asRelease) {
                        RatingGridCell(rating: rating)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.top, 2)
        }
    }

    @ViewBuilder
    private var listsPlaceholder: some View {
        if let profile = viewModel.profile {
            MixLibraryView(userId: profile.id)
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

struct RatingGridCell: View {
    let rating: UserRating

    private var scoreLabel: String {
        let v = rating.score
        return v.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(v))" : String(format: "%.1f", v)
    }

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            AsyncImage(url: URL(string: rating.releases.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    Color.sjBorder
                }
            }
            .frame(maxWidth: .infinity)
            .aspectRatio(1, contentMode: .fit)

            Text(scoreLabel)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 5)
                .padding(.vertical, 3)
                .background(.black.opacity(0.55))
                .clipShape(RoundedRectangle(cornerRadius: 3))
                .padding(5)
        }
        .clipped()
    }
}

#Preview {
    ProfileView(viewModel: ProfileViewModel())
}
