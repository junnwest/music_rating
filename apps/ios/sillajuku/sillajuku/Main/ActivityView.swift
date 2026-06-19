import SwiftUI
import Observation
import Supabase

// MARK: - Models

struct ActivityRating: Codable, Identifiable {
    let id: UUID
    let score: Double
    let createdAt: Date
    let releases: ActivityRelease
    let profiles: ActivityProfile?

    enum CodingKeys: String, CodingKey {
        case id, score, releases, profiles
        case createdAt = "created_at"
    }
}

struct ActivityRelease: Codable, Identifiable {
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

struct ActivityProfile: Codable {
    let username: String?
    let displayName: String?

    enum CodingKeys: String, CodingKey {
        case username
        case displayName = "display_name"
    }

    var displayHandle: String {
        displayName ?? username ?? "someone"
    }
}

// MARK: - ViewModel

@Observable
class ActivityViewModel {
    var items: [ActivityRating] = []
    var isLoading = true
    private var hasLoaded = false

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        isLoading = true
        items = (try? await supabase
            .from("ratings")
            .select("id, score, created_at, releases(id, title, artist, cover_url), profiles(username, display_name)")
            .order("created_at", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []
        isLoading = false
    }
}

// MARK: - View

struct ActivityView: View {
    var viewModel: ActivityViewModel

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.items.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "music.note.list")
                            .font(.system(size: 48))
                            .foregroundStyle(Color.sjBorder)
                        Text("No activity yet.")
                            .font(.system(size: 15))
                            .foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(viewModel.items) { item in
                        NavigationLink(value: item.releases.asRelease) {
                            ActivityRow(item: item)
                        }
                        .listRowBackground(Color.sjSurface)
                        .listRowSeparatorTint(Color.sjBorder)
                        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .navigationDestination(for: Release.self) { release in
                AlbumDetailView(release: release)
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Feed")
            .navigationBarTitleDisplayMode(.large)
        }
        .task { await viewModel.load() }
    }
}

private struct ActivityRow: View {
    let item: ActivityRating

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: item.releases.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                default:
                    Color.sjBorder
                }
            }
            .frame(width: 52, height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 3) {
                Text(item.releases.title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(item.releases.artist)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text(item.profiles?.displayHandle ?? "someone")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.sjAmber)
                    Text("·")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                    Text(scoreText)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                    Text("·")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                    Text(item.createdAt.relativeTimeString)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private var scoreText: String {
        let v = item.score
        let formatted = v.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(v))" : String(format: "%.1f", v)
        return "★ \(formatted)"
    }
}

// MARK: - Date helper

extension Date {
    var relativeTimeString: String {
        let s = -timeIntervalSinceNow
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60))m" }
        if s < 86400 { return "\(Int(s / 3600))h" }
        if s < 604800 { return "\(Int(s / 86400))d" }
        return "\(Int(s / 604800))w"
    }
}

#Preview {
    ActivityView(viewModel: ActivityViewModel())
}
