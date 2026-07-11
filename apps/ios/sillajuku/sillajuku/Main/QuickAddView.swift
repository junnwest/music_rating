import SwiftUI
import Supabase

// MARK: - View Model

@Observable
final class QuickAddViewModel {
    var candidates: [Release] = []
    var isLoading = true
    var isLoadingMore = false
    var hasMore = true

    private let pageSize = 20
    private let artistNames: [String]

    /// Ordered by confidence, not deduped into a Set -- Spotify top artists (strongest
    /// "probably knows this artist" signal) first, then Spotify recently-played, then Apple
    /// Music, then the user's own highly-rated artist history. Mirrors the seed sources
    /// DiscoveryViewModel.loadPersonalized() already assembles (SearchView.swift), but as an
    /// ordered array so get_quick_add_candidates' array_position() ORDER BY reflects real
    /// confidence instead of arbitrary Set iteration order. discoveryVM is expected to already
    /// be loaded (DiscoveryViewModel.load() has run) -- this reads its in-memory state rather
    /// than re-fetching Spotify/Apple Music data itself.
    init(discoveryVM: DiscoveryViewModel) {
        var seen = Set<String>()
        var ordered: [String] = []
        func add(_ name: String) {
            guard !name.isEmpty, seen.insert(name).inserted else { return }
            ordered.append(name)
        }
        for a in discoveryVM.spotifyArtists { add(a.name) }
        for a in discoveryVM.recentlyPlayed { add(a.artistName) }
        for a in discoveryVM.appleMusicArtists { add(a.name) }
        for a in discoveryVM.appleMusicRecentlyPlayed { add(a.artistName) }
        for a in discoveryVM.appleMusicLibraryAlbums { add(a.artistName) }
        artistNames = ordered
    }

    func loadFirstPage() async {
        isLoading = true
        candidates = await fetchPage(offset: 0)
        hasMore = candidates.count == pageSize
        isLoading = false
    }

    func loadNextPage() async {
        guard hasMore, !isLoadingMore else { return }
        isLoadingMore = true
        let next = await fetchPage(offset: candidates.count)
        candidates.append(contentsOf: next)
        hasMore = next.count == pageSize
        isLoadingMore = false
    }

    private func fetchPage(offset: Int) async -> [Release] {
        guard let userId = supabase.auth.currentUser?.id, !artistNames.isEmpty else { return [] }
        struct Params: Encodable {
            let p_user_id: String
            let p_artist_names: [String]
            let p_lim: Int
            let p_offset: Int
        }
        return (try? await supabase
            .rpc("get_quick_add_candidates", params: Params(
                p_user_id: userId.uuidString,
                p_artist_names: artistNames,
                p_lim: pageSize,
                p_offset: offset))
            .execute()
            .value) ?? []
    }

    /// Optimistic: removes the row immediately rather than waiting on the write, matching the
    /// "tap a star, it's gone, move to the next one" feel the half-star control implies. Reuses
    /// AlbumQuickRate.saveManualScore (Components/AlbumContextMenu.swift) -- same write path
    /// (upsert into `ratings`, ratingChanged notification) as every other rating surface in the
    /// app, not a parallel one.
    func rate(_ release: Release, score: Double) {
        candidates.removeAll { $0.id == release.id }
        Task { await AlbumQuickRate.saveManualScore(releaseGroupId: release.id, score: score) }
    }
}

// MARK: - Half-star tap control

/// Five stars, each split into a left/right tap half (X.5 vs X.0). Always renders empty/outline
/// -- Quick Add only ever shows unrated candidates, so there's never an existing score to
/// reflect. Tapping commits immediately, no confirm step, matching the "quick" premise.
struct HalfStarRow: View {
    var starSize: CGFloat = 20
    var spacing: CGFloat = 3
    let onRate: (Double) -> Void

    var body: some View {
        HStack(spacing: spacing) {
            ForEach(1...5, id: \.self) { position in
                GeometryReader { geo in
                    Image(systemName: "star")
                        .font(.system(size: starSize))
                        .foregroundStyle(Color.sjBorder)
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0)
                                .onEnded { value in
                                    let isLeftHalf = value.location.x < geo.size.width / 2
                                    onRate(Double(position) - (isLeftHalf ? 0.5 : 0))
                                }
                        )
                }
                .frame(width: starSize, height: starSize)
            }
        }
    }
}

// MARK: - Row

private struct QuickAddRow: View {
    let release: Release
    let onRate: (Double) -> Void

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: release.coverUrl, cornerRadius: 8)
                .frame(width: 52, height: 52)

            VStack(alignment: .leading, spacing: 2) {
                Text(release.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(release.artist)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            HalfStarRow(onRate: onRate)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

// MARK: - Screen

struct QuickAddView: View {
    @State private var vm: QuickAddViewModel

    init(discoveryVM: DiscoveryViewModel) {
        _vm = State(initialValue: QuickAddViewModel(discoveryVM: discoveryVM))
    }

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if vm.candidates.isEmpty {
                emptyState
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 4) {
                        ForEach(vm.candidates) { release in
                            QuickAddRow(release: release) { score in
                                withAnimation(.easeOut(duration: 0.2)) {
                                    vm.rate(release, score: score)
                                }
                            }
                            .onAppear {
                                if release.id == vm.candidates.last?.id {
                                    Task { await vm.loadNextPage() }
                                }
                            }
                        }
                        if vm.isLoadingMore {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Quick Add")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.loadFirstPage() }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 44))
                .foregroundStyle(Color.sjBorder)
            Text("You're all caught up")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.sjInk)
            Text("No more releases to quickly rate right now.")
                .font(.system(size: 14))
                .foregroundStyle(Color.sjMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
