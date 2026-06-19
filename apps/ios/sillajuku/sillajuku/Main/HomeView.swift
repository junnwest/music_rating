import SwiftUI
import Observation
import Supabase

@Observable
class HomeViewModel {
    var sections: [(genre: String, label: String, releases: [Release])] = []
    var isLoading = true
    private var hasLoaded = false

    private static let genres: [(key: String, label: String)] = [
        ("k-pop",       "K-Pop"),
        ("hip-hop",     "Hip-Hop"),
        ("electronic",  "Electronic"),
        ("rock",        "Rock"),
        ("pop",         "Pop"),
        ("r&b",         "R&B"),
        ("indie",       "Indie"),
        ("jazz",        "Jazz"),
    ]

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        isLoading = true
        var results: [(index: Int, label: String, releases: [Release])] = []

        await withTaskGroup(of: (Int, String, [Release]).self) { group in
            for (index, entry) in Self.genres.enumerated() {
                group.addTask {
                    do {
                        let releases: [Release] = try await supabase
                            .from("recommendable_releases")
                            .select("id, title, artist, cover_url, title_native, artist_native")
                            .ilike("genres", value: "%\(entry.key)%")
                            .order("prestige", ascending: false)
                            .limit(20)
                            .execute()
                            .value
                        return (index, entry.label, releases)
                    } catch {
                        return (index, entry.label, [])
                    }
                }
            }
            for await result in group {
                results.append((index: result.0, label: result.1, releases: result.2))
            }
        }

        sections = results
            .sorted { $0.index < $1.index }
            .compactMap { item in
                item.releases.isEmpty ? nil
                    : (genre: Self.genres[item.index].key, label: item.label, releases: item.releases)
            }
        isLoading = false
    }
}

struct HomeView: View {
    var viewModel: HomeViewModel

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 32) {
                            ForEach(viewModel.sections, id: \.genre) { section in
                                GenreSection(label: section.label, releases: section.releases)
                            }
                        }
                        .padding(.vertical, 16)
                    }
                }
            }
            .navigationDestination(for: Release.self) { release in
                AlbumDetailView(release: release)
            }
            .background(Color.sjCream.ignoresSafeArea())
        }
        .task { await viewModel.load() }
    }
}

private struct GenreSection: View {
    let label: String
    let releases: [Release]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(label)
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .padding(.horizontal, 20)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(releases) { release in
                        NavigationLink(value: release) {
                            AlbumCard(release: release)
                                .frame(width: 140)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}

#Preview {
    HomeView(viewModel: HomeViewModel())
}
