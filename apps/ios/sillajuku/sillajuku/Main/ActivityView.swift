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
        case id, score, profiles
        case releases  = "release_groups"
        case createdAt = "created_at"
    }
}

struct ActivityRelease: Codable, Identifiable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    let titleNative: String?
    let primaryArtist: NativeArtistRef?

    enum CodingKeys: String, CodingKey {
        case id, title
        case artist     = "artist_display"
        case coverUrl   = "cover_url"
        case titleNative = "native_title"
        case primaryArtist = "artists"
    }

    var artistNative: String? { primaryArtist?.nameNative }
    var displayTitle: String { titleNative?.isPredominantlyHangul == true ? titleNative! : title }
    var displayArtist: String { artistNative?.isPredominantlyHangul == true ? artistNative! : artist }

    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl,
                releaseType: nil, releaseDate: nil, titleNative: titleNative, artistNative: artistNative,
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
        displayName ?? username ?? String(localized: "someone")
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
            .select("id, score, created_at, release_groups(id, title, artist_display, cover_url, native_title, artists!release_groups_primary_artist_id_fkey(name_native)), profiles!ratings_user_id_fkey(username, display_name)")
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
            CoverImage(url: item.releases.coverUrl, cornerRadius: 6)
                .frame(width: 52, height: 52)

            VStack(alignment: .leading, spacing: 3) {
                Text(item.releases.displayTitle)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(item.releases.displayArtist)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
                HStack(spacing: 4) {
                    Text(item.profiles?.displayHandle ?? String(localized: "someone"))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.sjAmber)
                    Text("·")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                    HStack(spacing: 2) {
                        Image("icon-flower")
                            .renderingMode(.template)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 10, height: 10)
                        Text(scoreFormatted)
                            .font(.system(size: 12))
                    }
                    .foregroundStyle(Color.sjAmber)
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

    private var scoreFormatted: String {
        let v = item.score
        return v.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(v))" : String(format: "%.1f", v)
    }
}

// MARK: - Date helper

extension Date {
    var relativeTimeString: String {
        let s = -timeIntervalSinceNow
        if s < 60 { return String(localized: "just now") }
        if s < 3600 { return String(format: String(localized: "%dm"), Int(s / 60)) }
        if s < 86400 { return String(format: String(localized: "%dh"), Int(s / 3600)) }
        if s < 604800 { return String(format: String(localized: "%dd"), Int(s / 86400)) }
        return String(format: String(localized: "%dw"), Int(s / 604800))
    }
}

#Preview {
    ActivityView(viewModel: ActivityViewModel())
}
