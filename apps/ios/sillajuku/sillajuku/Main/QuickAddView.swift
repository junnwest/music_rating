import SwiftUI
import Supabase

// MARK: - Mode

enum QuickAddMode: Hashable { case albums, songs }

// MARK: - Song model

struct SongCandidate: Codable, Identifiable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    let albumTitle: String

    enum CodingKeys: String, CodingKey {
        case id, title
        case artist = "artist_display"
        case coverUrl = "cover_url"
        case albumTitle = "album_title"
    }
}

// MARK: - View Model

@Observable
final class QuickAddViewModel {
    var albumCandidates: [Release] = []
    var songCandidates: [SongCandidate] = []
    var isLoadingAlbums = true
    var isLoadingSongs = true
    var isLoadingMoreAlbums = false
    var isLoadingMoreSongs = false
    var hasMoreAlbums = true
    var hasMoreSongs = true
    // Rated this session but not yet removed from view -- keyed by release/song id, shared
    // across both modes (safe: these are real DB row ids, not a shared id space that could
    // collide). A row with an entry here renders its held score instead of the star control;
    // the item itself is only actually dropped from albumCandidates/songCandidates on the next
    // refresh or cold load, once the server-side NOT EXISTS exclusion naturally leaves it out.
    var ratedScores: [UUID: Double] = [:]

    private let pageSize = 20
    private let artistNames: [String]

    /// Ordered by confidence, not deduped into a Set -- Spotify top artists (strongest
    /// "probably knows this artist" signal) first, then Spotify recently-played, then Apple
    /// Music, then the user's own highly-rated artist history. Mirrors the seed sources
    /// DiscoveryViewModel.loadPersonalized() already assembles (SearchView.swift), but as an
    /// ordered array so get_quick_add_candidates'/get_quick_add_song_candidates'
    /// array_position() ORDER BY reflects real confidence instead of arbitrary Set iteration
    /// order. discoveryVM is expected to already be loaded (DiscoveryViewModel.load() has run)
    /// -- this reads its in-memory state rather than re-fetching Spotify/Apple Music data itself.
    /// Shared across both modes -- one seed list, two RPCs.
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
        for a in discoveryVM.ratedArtists { add(a) }
        artistNames = ordered
    }

    // MARK: Albums

    func loadFirstAlbumPage() async {
        isLoadingAlbums = true
        albumCandidates = await fetchAlbumPage(offset: 0)
        hasMoreAlbums = albumCandidates.count == pageSize
        isLoadingAlbums = false
    }

    func loadNextAlbumPage() async {
        guard hasMoreAlbums, !isLoadingMoreAlbums else { return }
        isLoadingMoreAlbums = true
        let next = await fetchAlbumPage(offset: albumCandidates.count)
        albumCandidates.append(contentsOf: next)
        hasMoreAlbums = next.count == pageSize
        isLoadingMoreAlbums = false
    }

    /// Pull-to-refresh: re-fetches page 1 rather than appending. The server-side NOT EXISTS
    /// exclusion naturally drops anything rated since the last load (same as a fresh app launch
    /// would), and fetchAlbumPage shuffles offset-0 pages so the top of the list doesn't look
    /// identical every time.
    func refreshAlbums() async {
        albumCandidates = await fetchAlbumPage(offset: 0)
        hasMoreAlbums = albumCandidates.count == pageSize
    }

    private func fetchAlbumPage(offset: Int) async -> [Release] {
        guard let userId = supabase.auth.currentUser?.id, !artistNames.isEmpty else { return [] }
        struct Params: Encodable {
            let p_user_id: String
            let p_artist_names: [String]
            let p_lim: Int
            let p_offset: Int
        }
        let page: [Release] = (try? await supabase
            .rpc("get_quick_add_candidates", params: Params(
                p_user_id: userId.uuidString,
                p_artist_names: artistNames,
                p_lim: pageSize,
                p_offset: offset))
            .execute()
            .value) ?? []
        // Only the first page of a fresh load/refresh gets shuffled -- the RPC's own
        // array_position/prestige ORDER BY has to stay stable for offset-based pagination to
        // work at all (a shuffled order server-side would skip/repeat rows across pages).
        return offset == 0 ? page.shuffled() : page
    }

    /// Holds the row in place with the rated score shown instead of removing it immediately --
    /// per the user's request, a just-rated item should stay visible (showing what it was rated)
    /// until the next refresh or app relaunch actually re-fetches and server-side excludes it,
    /// not disappear the instant a star is tapped. Reuses AlbumQuickRate.saveManualScore
    /// (Components/AlbumContextMenu.swift) -- same write path (upsert into `ratings`,
    /// ratingChanged notification) as every other rating surface in the app, not a parallel one.
    func rate(_ release: Release, score: Double) {
        ratedScores[release.id] = score
        Task { await AlbumQuickRate.saveManualScore(releaseGroupId: release.id, score: score) }
    }

    // MARK: Songs

    func loadFirstSongPage() async {
        isLoadingSongs = true
        songCandidates = await fetchSongPage(offset: 0)
        hasMoreSongs = songCandidates.count == pageSize
        isLoadingSongs = false
    }

    func loadNextSongPage() async {
        guard hasMoreSongs, !isLoadingMoreSongs else { return }
        isLoadingMoreSongs = true
        let next = await fetchSongPage(offset: songCandidates.count)
        songCandidates.append(contentsOf: next)
        hasMoreSongs = next.count == pageSize
        isLoadingMoreSongs = false
    }

    /// Same pull-to-refresh shape as refreshAlbums().
    func refreshSongs() async {
        songCandidates = await fetchSongPage(offset: 0)
        hasMoreSongs = songCandidates.count == pageSize
    }

    private func fetchSongPage(offset: Int) async -> [SongCandidate] {
        guard let userId = supabase.auth.currentUser?.id, !artistNames.isEmpty else { return [] }
        struct Params: Encodable {
            let p_user_id: String
            let p_artist_names: [String]
            let p_lim: Int
            let p_offset: Int
        }
        let page: [SongCandidate] = (try? await supabase
            .rpc("get_quick_add_song_candidates", params: Params(
                p_user_id: userId.uuidString,
                p_artist_names: artistNames,
                p_lim: pageSize,
                p_offset: offset))
            .execute()
            .value) ?? []
        return offset == 0 ? page.shuffled() : page
    }

    /// Same hold-in-place shape as `rate(_:score:)`, writing to `track_ratings` via
    /// AlbumQuickRate.saveManualTrackScore instead of `ratings`.
    func rateSong(_ song: SongCandidate, score: Double) {
        ratedScores[song.id] = score
        Task { await AlbumQuickRate.saveManualTrackScore(recordingId: song.id, score: score) }
    }
}

// MARK: - Half-star drag control

/// Five flower traces (the same `icon-flower` mark ScoreBadge/ManualRatingSheet use elsewhere in
/// the app). A single drag gesture spans the whole row (not one gesture per star -- a per-star
/// gesture can't track a drag that moves past the star it started on, since the touch stays
/// bound to whichever view's gesture recognizer first claimed it), continuously previewing the
/// fill up to wherever the finger currently is; the rating only actually commits in onEnded, not
/// per-frame during the drag. Always starts fully empty/outline -- Quick Add only ever shows
/// unrated candidates, so there's never an existing score to reflect at rest.
struct HalfStarRow: View {
    var starSize: CGFloat = 20
    var spacing: CGFloat = 3
    let onRate: (Double) -> Void

    @State private var liveRating: Double? = nil

    private var totalWidth: CGFloat { CGFloat(5) * starSize + CGFloat(4) * spacing }

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: spacing) {
                ForEach(1...5, id: \.self) { position in
                    star(for: position)
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        liveRating = rating(atX: value.location.x, rowWidth: geo.size.width)
                    }
                    .onEnded { value in
                        let final = rating(atX: value.location.x, rowWidth: geo.size.width)
                        liveRating = nil
                        onRate(final)
                    }
            )
        }
        .frame(width: totalWidth, height: starSize)
    }

    @ViewBuilder
    private func star(for position: Int) -> some View {
        let fillFraction = liveRating.map { min(max($0 - Double(position - 1), 0), 1) } ?? 0
        ZStack {
            Image("icon-flower")
                .renderingMode(.template).resizable().scaledToFit()
                .foregroundStyle(Color.sjBorder)
            if fillFraction > 0 {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .foregroundStyle(Color.sjBlue)
                    .mask(
                        HStack(spacing: 0) {
                            Rectangle().frame(width: starSize * fillFraction)
                            Spacer(minLength: 0)
                        }
                    )
            }
        }
        .frame(width: starSize, height: starSize)
    }

    private func rating(atX x: CGFloat, rowWidth: CGFloat) -> Double {
        guard rowWidth > 0 else { return 0.5 }
        let clampedX = min(max(x, 0), rowWidth)
        let raw = (clampedX / rowWidth) * 5
        let roundedToHalf = (raw * 2).rounded() / 2
        return min(max(roundedToHalf, 0.5), 5.0)
    }
}

// MARK: - Rows

private struct QuickAddRow: View {
    let release: Release
    let ratedScore: Double?
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

            if let ratedScore {
                ScoreBadge(score: ratedScore, badgeSize: 32)
            } else {
                HalfStarRow(onRate: onRate)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

private struct QuickAddSongRow: View {
    let song: SongCandidate
    let ratedScore: Double?
    let onRate: (Double) -> Void

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: song.coverUrl, cornerRadius: 8)
                .frame(width: 52, height: 52)

            VStack(alignment: .leading, spacing: 2) {
                Text(song.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(song.artist)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if let ratedScore {
                ScoreBadge(score: ratedScore, badgeSize: 32)
            } else {
                HalfStarRow(onRate: onRate)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }
}

// MARK: - Screen

struct QuickAddView: View {
    @State private var vm: QuickAddViewModel
    @State private var mode: QuickAddMode = .albums
    @State private var albumScrollTrigger = UUID()
    @State private var songScrollTrigger = UUID()

    init(discoveryVM: DiscoveryViewModel) {
        _vm = State(initialValue: QuickAddViewModel(discoveryVM: discoveryVM))
    }

    var body: some View {
        VStack(spacing: 0) {
            modeHeader
            content
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Quick Add")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await vm.loadFirstAlbumPage()
            await vm.loadFirstSongPage()
        }
    }

    // MARK: Mode header (Albums / Songs -- same style as Home Explore/Following)

    private var modeHeader: some View {
        HStack(spacing: 28) {
            modeTabButton(.albums, label: "Albums")
            modeTabButton(.songs,  label: "Songs")
        }
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
    }

    private func modeTabButton(_ target: QuickAddMode, label: LocalizedStringKey) -> some View {
        Button {
            if mode == target {
                if target == .albums { albumScrollTrigger = UUID() }
                else                 { songScrollTrigger = UUID() }
            } else {
                withAnimation(.easeInOut(duration: 0.18)) { mode = target }
            }
        } label: {
            Text(label)
                .font(.system(size: 17, weight: mode == target ? .bold : .regular))
                .foregroundStyle(mode == target ? Color.sjInk : Color.sjMuted)
        }
        .buttonStyle(.plain)
    }

    // MARK: Swipeable content

    private var content: some View {
        TabView(selection: $mode) {
            albumList.tag(QuickAddMode.albums)
            songList.tag(QuickAddMode.songs)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .animation(.easeInOut(duration: 0.18), value: mode)
    }

    @ViewBuilder
    private var albumList: some View {
        if vm.isLoadingAlbums {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if vm.albumCandidates.isEmpty {
            emptyState
        } else {
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 4) {
                        Color.clear.frame(height: 0).id("album-top")
                        ForEach(vm.albumCandidates) { release in
                            QuickAddRow(release: release, ratedScore: vm.ratedScores[release.id]) { score in
                                withAnimation(.easeOut(duration: 0.2)) {
                                    vm.rate(release, score: score)
                                }
                            }
                            .onAppear {
                                if release.id == vm.albumCandidates.last?.id {
                                    Task { await vm.loadNextAlbumPage() }
                                }
                            }
                        }
                        if vm.isLoadingMoreAlbums {
                            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 16)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .refreshable { await vm.refreshAlbums() }
                .onChange(of: albumScrollTrigger) { _, _ in
                    withAnimation { proxy.scrollTo("album-top", anchor: .top) }
                }
            }
        }
    }

    @ViewBuilder
    private var songList: some View {
        if vm.isLoadingSongs {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if vm.songCandidates.isEmpty {
            emptyState
        } else {
            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 4) {
                        Color.clear.frame(height: 0).id("song-top")
                        ForEach(vm.songCandidates) { song in
                            QuickAddSongRow(song: song, ratedScore: vm.ratedScores[song.id]) { score in
                                withAnimation(.easeOut(duration: 0.2)) {
                                    vm.rateSong(song, score: score)
                                }
                            }
                            .onAppear {
                                if song.id == vm.songCandidates.last?.id {
                                    Task { await vm.loadNextSongPage() }
                                }
                            }
                        }
                        if vm.isLoadingMoreSongs {
                            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 16)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .refreshable { await vm.refreshSongs() }
                .onChange(of: songScrollTrigger) { _, _ in
                    withAnimation { proxy.scrollTo("song-top", anchor: .top) }
                }
            }
        }
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
