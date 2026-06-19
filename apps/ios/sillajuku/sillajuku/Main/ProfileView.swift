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

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        guard let user = supabase.auth.currentUser else {
            isLoading = false
            return
        }
        isLoading = true

        profile = try? await supabase
            .from("profiles")
            .select("id, display_name, username, rating_mode")
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

    func signOut() async {
        try? await supabase.auth.signOut()
    }
}

// MARK: - View

struct ProfileView: View {
    var viewModel: ProfileViewModel
    @AppStorage("appearanceMode") private var appearanceMode = "system"

    private let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            profileHeader
                            statsRow
                                .padding(.bottom, 16)
                            Divider()
                            ratingsGrid
                        }
                    }
                }
            }
            .navigationDestination(for: Release.self) { release in
                AlbumDetailView(release: release)
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Menu {
                            Button { appearanceMode = "system" } label: {
                                Label("System", systemImage: appearanceMode == "system" ? "checkmark" : "")
                            }
                            Button { appearanceMode = "light" } label: {
                                Label("Light", systemImage: appearanceMode == "light" ? "checkmark" : "")
                            }
                            Button { appearanceMode = "dark" } label: {
                                Label("Dark", systemImage: appearanceMode == "dark" ? "checkmark" : "")
                            }
                        } label: {
                            Label("Appearance", systemImage: "circle.lefthalf.filled")
                        }

                        Divider()

                        Button(role: .destructive) {
                            Task { await viewModel.signOut() }
                        } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundStyle(Color.sjInk)
                    }
                }
            }
        }
        .task { await viewModel.load() }
    }

    // MARK: Sub-views

    private var profileHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(viewModel.profile?.displayName ?? "—")
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(Color.sjInk)
            if let username = viewModel.profile?.username {
                Text("@\(username)")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
            }
            if let mode = viewModel.profile?.ratingMode {
                Text(mode == "instinct" ? "⚡ Instinct" : "★ Normal")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.sjAmber)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.sjAmber.opacity(0.12))
                    .clipShape(Capsule())
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
        .padding(.bottom, 20)
    }

    private var statsRow: some View {
        HStack(spacing: 0) {
            StatCell(value: "\(viewModel.totalRatings)", label: "Ratings")
            Divider().frame(height: 32)
            StatCell(
                value: viewModel.totalRatings > 0
                    ? String(format: "%.1f", viewModel.avgScore) : "—",
                label: "Avg"
            )
        }
        .padding(.horizontal, 20)
    }

    @ViewBuilder
    private var ratingsGrid: some View {
        if viewModel.ratings.isEmpty {
            Text("No ratings yet.")
                .font(.system(size: 15))
                .foregroundStyle(Color.sjMuted)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 40)
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
}

private struct StatCell: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct RatingGridCell: View {
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
