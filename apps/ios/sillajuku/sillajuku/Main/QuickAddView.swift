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

    var asTrackEntry: TrackEntry {
        TrackEntry(trackId: id, position: 0, title: title, durationMs: nil, artists: artist)
    }
    /// Display-only -- the precise-rate sheet needs a Release for its cover/artist
    /// text; the actual write goes through `id` (the recording), never this id.
    var displayRelease: Release {
        Release(id: id, title: albumTitle, artist: artist, coverUrl: coverUrl, releaseType: nil,
                 releaseDate: nil, titleNative: nil, artistNative: nil, tracklist: nil, totalTracks: nil)
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
    // Set when a rate write actually fails (rate()/rateSong() roll the optimistic score
    // back at the same time) -- surfaced as an alert rather than failing silently.
    var rateErrorMessage: String?

    // MARK: Genre explorer ("Explore other genres")

    /// Same short, recognisable list as web's `GENRES` (`quick-add/page.tsx`) — matched by
    /// `_rg_primary_matches` server-side, so anything that works as a charts genre filter
    /// works here. Deliberately not the full genre taxonomy; this is a browse affordance.
    static let allGenres: [String] = [
        "K-Pop", "K-Indie", "Hip Hop", "R&B", "Rock", "Pop", "Indie", "Electronic",
        "Jazz", "Metal", "Classical", "Folk", "Soul", "Punk", "City Pop", "J-Pop",
    ]
    /// Persisted to `profiles.preferred_genres` -- permanent shelves, and the same column
    /// the home feed's category resolver reads, so liking a genre here reshapes Home too.
    var likedGenres: [String] = []
    /// Opened (not liked) genres -- session-only, cleared on next launch.
    var openedGenres: [String] = []
    var genreShelves: [String: [Release]] = [:]
    var loadingGenres: Set<String> = []

    /// Liked genres first, then opened-but-not-liked -- mirrors web's `wanted` shelf order.
    var genresToShow: [String] {
        var seen = Set<String>()
        var out: [String] = []
        for g in likedGenres + openedGenres where seen.insert(g).inserted { out.append(g) }
        return out
    }

    /// No Spotify/Apple Music history and no rated-artist signal at all -- Quick Add has
    /// nothing to seed suggestions from. Distinct from "candidates.isEmpty because we've
    /// shown everything" (the real "all caught up" case) -- these read as opposite states
    /// to the user and were incorrectly sharing one empty-state message before this.
    var hasSeed: Bool { !artistNames.isEmpty }

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
        let previous = ratedScores[release.id]
        ratedScores[release.id] = score
        Task {
            let ok = await AlbumQuickRate.saveManualScore(releaseGroupId: release.id, score: score)
            if !ok {
                // Roll back to whatever was actually true before this tap -- not just nil,
                // in case this was a re-rate of an already-committed score.
                ratedScores[release.id] = previous
                rateErrorMessage = String(localized: "Couldn't save that rating. Check your connection and try again.")
            }
        }
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
        let previous = ratedScores[song.id]
        ratedScores[song.id] = score
        Task {
            let ok = await AlbumQuickRate.saveManualTrackScore(recordingId: song.id, score: score)
            if !ok {
                ratedScores[song.id] = previous
                rateErrorMessage = String(localized: "Couldn't save that rating. Check your connection and try again.")
            }
        }
    }

    // MARK: Genre explorer

    func loadLikedGenres() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct Row: Decodable { let preferredGenres: String?
            enum CodingKeys: String, CodingKey { case preferredGenres = "preferred_genres" }
        }
        let row: Row? = try? await supabase
            .from("profiles")
            .select("preferred_genres")
            .eq("id", value: userId)
            .single()
            .execute()
            .value
        // Only genres this picker knows about -- the column is shared with onboarding,
        // which used a different (older) label set.
        let known = Set(Self.allGenres)
        likedGenres = (row?.preferredGenres ?? "")
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { known.contains($0) }
    }

    /// Persisted immediately, not a local-only flag -- rolls back on write failure rather
    /// than lying about what's saved (same rule as web's toggleLiked).
    func toggleLikedGenre(_ genre: String) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let previous = likedGenres
        if let idx = likedGenres.firstIndex(of: genre) {
            likedGenres.remove(at: idx)
        } else {
            likedGenres.append(genre)
        }
        do {
            try await supabase
                .from("profiles")
                .update(["preferred_genres": likedGenres.joined(separator: ", ")])
                .eq("id", value: userId)
                .execute()
        } catch {
            likedGenres = previous
        }
    }

    /// Tapping a genre's label -- a look, not a preference. Loads its shelf the first
    /// time it's opened; re-tapping just collapses it back (data stays cached).
    func toggleOpenedGenre(_ genre: String) {
        if let idx = openedGenres.firstIndex(of: genre) {
            openedGenres.remove(at: idx)
        } else {
            openedGenres.append(genre)
            if genreShelves[genre] == nil {
                Task { await loadGenreShelf(genre) }
            }
        }
    }

    /// One page, no further pagination -- a genre shelf here is a browse sampler, not a
    /// full paged list like web's "See more" modal (that's more chrome than this flat,
    /// single-screen layout needs for a first port).
    func loadGenreShelf(_ genre: String) async {
        guard let userId = supabase.auth.currentUser?.id, !loadingGenres.contains(genre) else { return }
        loadingGenres.insert(genre)
        defer { loadingGenres.remove(genre) }
        struct Params: Encodable {
            let p_user_id: String
            let p_genre: String
            let p_lim: Int
        }
        let page: [Release] = (try? await supabase
            .rpc("get_quick_add_genre_candidates", params: Params(
                p_user_id: userId.uuidString,
                p_genre: genre,
                p_lim: 20))
            .execute()
            .value) ?? []
        genreShelves[genre] = page
    }
}

// MARK: - Rows

private struct QuickAddRow: View {
    let release: Release
    let ratedScore: Double?
    let onRate: (Double) -> Void

    @State private var showPrecise = false

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: release.coverUrl, cornerRadius: 8)
                .frame(width: 52, height: 52)

            VStack(alignment: .leading, spacing: 2) {
                Text(release.title)
                    .font(.jakarta(15, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(release.artist)
                    .font(.jakarta(13))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            // Stays a re-ratable drag gauge even after rating (shows the committed
            // score) so a slip can be fixed in place -- swapping to a ScoreBadge here
            // made just-rated rows read-only until the next refresh.
            FlowerRateControl(
                onRate: onRate,
                onRequestPrecise: { showPrecise = true },
                size: 34,
                currentScore: ratedScore,
                accessibilityLabelText: String(format: String(localized: "Rate %@"), release.title)
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .sheet(isPresented: $showPrecise) {
            ManualRatingSheet(release: release, existingScore: .constant(ratedScore)) { score in
                if let score { onRate(score) }
            }
        }
    }
}

private struct QuickAddSongRow: View {
    let song: SongCandidate
    let ratedScore: Double?
    let onRate: (Double) -> Void

    @State private var showPrecise = false

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: song.coverUrl, cornerRadius: 8)
                .frame(width: 52, height: 52)

            VStack(alignment: .leading, spacing: 2) {
                Text(song.title)
                    .font(.jakarta(15, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(song.artist)
                    .font(.jakarta(13))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            // Same as QuickAddRow: stays draggable after rating so it can be fixed in place.
            FlowerRateControl(
                onRate: onRate,
                onRequestPrecise: { showPrecise = true },
                size: 34,
                currentScore: ratedScore,
                accessibilityLabelText: String(format: String(localized: "Rate %@"), song.title)
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .sheet(isPresented: $showPrecise) {
            TrackRatingSheet(track: song.asTrackEntry, release: song.displayRelease, existingScore: ratedScore) { _, score in
                if let score { onRate(score) }
            }
        }
    }
}

// MARK: - Screen

struct QuickAddView: View {
    @State private var vm: QuickAddViewModel
    @State private var mode: QuickAddMode = .albums
    @State private var albumScrollTrigger = UUID()
    @State private var songScrollTrigger = UUID()
    @Environment(\.dismiss) private var dismiss
    private let onGoToSettings: () -> Void

    init(discoveryVM: DiscoveryViewModel, onGoToSettings: @escaping () -> Void) {
        _vm = State(initialValue: QuickAddViewModel(discoveryVM: discoveryVM))
        self.onGoToSettings = onGoToSettings
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
            await vm.loadLikedGenres()
        }
        .alert(
            "Couldn't save rating",
            isPresented: Binding(
                get: { vm.rateErrorMessage != nil },
                set: { if !$0 { vm.rateErrorMessage = nil } }
            ),
            presenting: vm.rateErrorMessage
        ) { _ in
            Button("OK") { vm.rateErrorMessage = nil }
        } message: { message in
            Text(message)
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
                .font(.jakarta(17, weight: mode == target ? .bold : .regular))
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
            // Seedless (no Spotify/Apple Music history, no ratings yet) reads as the
            // opposite of "caught up" -- give it its own message + a way forward,
            // instead of the generic checkmark that implies there was ever anything to
            // exhaust in the first place.
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    if vm.hasSeed { emptyState } else { seedlessNudge }
                    genreExplorer
                }
                .padding(16)
            }
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

                    // Always available, seeded or not -- matches web, where "Explore
                    // other genres" sits under the shelves regardless of whether the
                    // user already has suggestions.
                    genreExplorer
                        .padding(.horizontal, 16)
                        .padding(.top, 8)
                        .padding(.bottom, 24)
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
            if vm.hasSeed {
                emptyState
            } else {
                ScrollView(showsIndicators: false) {
                    seedlessNudge.padding(16)
                }
            }
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
                .font(.jakarta(44))
                .foregroundStyle(Color.sjBorder)
            Text("You're all caught up")
                .font(.jakarta(17, weight: .semibold))
                .foregroundStyle(Color.sjInk)
            Text("No more releases to quickly rate right now.")
                .font(.jakarta(14))
                .foregroundStyle(Color.sjMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Seedless nudge

    /// Shown instead of `emptyState` when there's no seed at all yet -- no Spotify/Apple
    /// Music history and no ratings. Two concrete next actions rather than a dead end.
    private var seedlessNudge: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Nothing to suggest yet")
                    .font(.jakarta(17, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                Text("Quick Add works off your listening history and your own ratings. Either of these gets it started:")
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjMuted)
            }

            VStack(spacing: 10) {
                Button { dismiss() } label: {
                    nudgeRow(icon: "magnifyingglass", title: "Search & rate a few albums")
                }
                Button { onGoToSettings() } label: {
                    nudgeRow(icon: "link", title: "Connect Spotify or Apple Music")
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func nudgeRow(icon: String, title: LocalizedStringKey) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.jakarta(15, weight: .semibold))
                .foregroundStyle(Color.sjCream)
                .frame(width: 32, height: 32)
                .background(Color.sjInk)
                .clipShape(Circle())
            Text(title)
                .font(.jakarta(14.5, weight: .semibold))
                .foregroundStyle(Color.sjInk)
            Spacer(minLength: 8)
            Image(systemName: "chevron.right")
                .font(.jakarta(12, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
        }
        .padding(14)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: Genre explorer

    /// iOS counterpart of web's `GenreExplorer` (`quick-add/page.tsx`) -- same RPC
    /// (`get_quick_add_genre_candidates`), same two-action chip (label opens a shelf,
    /// heart likes/persists the genre), same permanent-vs-session shelf split. Albums
    /// only, matching the RPC (`release_group_type IN ('album','ep')`) and web's own
    /// scope call that songs are rated in runs, not browsed.
    private var genreExplorer: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "safari")
                    .font(.jakarta(13, weight: .semibold))
                    .foregroundStyle(Color.sjAmber)
                Text("Explore other genres")
                    .font(.jakarta(14.5, weight: .bold))
                    .foregroundStyle(Color.sjInk)
            }
            Text("Browse genres outside your usual listening. Liking one also shapes your Home feed.")
                .font(.jakarta(12.5))
                .foregroundStyle(Color.sjMuted)

            FlowLayout(spacing: 8) {
                ForEach(QuickAddViewModel.allGenres, id: \.self) { genre in
                    genreChip(genre)
                }
            }

            ForEach(vm.genresToShow, id: \.self) { genre in
                genreSection(genre)
            }
        }
        .padding(16)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    /// Two independent taps in one pill -- the label opens (a look), the heart likes (a
    /// preference). Kept apart so browsing jazz once doesn't claim you like jazz.
    private func genreChip(_ genre: String) -> some View {
        let isLiked = vm.likedGenres.contains(genre)
        let isOpen = isLiked || vm.openedGenres.contains(genre)
        return HStack(spacing: 0) {
            Button { vm.toggleOpenedGenre(genre) } label: {
                Text(genre)
                    .font(.jakarta(12.5, weight: .medium))
                    .foregroundStyle(isOpen ? Color.sjAmber : Color.sjMuted)
                    .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 7)
            }
            Button { Task { await vm.toggleLikedGenre(genre) } } label: {
                Image(systemName: isLiked ? "heart.fill" : "heart")
                    .font(.jakarta(11))
                    .foregroundStyle(isLiked ? Color.sjAmber : Color.sjMuted)
                    .padding(.leading, 4).padding(.trailing, 10).padding(.vertical, 7)
            }
        }
        .buttonStyle(.plain)
        .background(isOpen ? Color.sjAmber.opacity(0.12) : Color.sjCream)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(isOpen ? Color.sjAmber.opacity(0.4) : Color.sjBorder, lineWidth: 1))
    }

    @ViewBuilder
    private func genreSection(_ genre: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(genre)
                .font(.jakarta(12.5, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .padding(.top, 6)
                .padding(.horizontal, 2)

            if vm.loadingGenres.contains(genre) && (vm.genreShelves[genre]?.isEmpty ?? true) {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 12)
            } else if let items = vm.genreShelves[genre], !items.isEmpty {
                VStack(spacing: 0) {
                    ForEach(items) { release in
                        QuickAddRow(release: release, ratedScore: vm.ratedScores[release.id]) { score in
                            withAnimation(.easeOut(duration: 0.2)) {
                                vm.rate(release, score: score)
                            }
                        }
                    }
                }
                .background(Color.sjCream)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                Text("Nothing here yet")
                    .font(.jakarta(12.5))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.vertical, 6)
            }
        }
    }
}

/// Minimal left-aligned wrapping layout for genre chips. Self-contained here rather than
/// reusing TasteView.swift's private `FlowLayout` of the same shape, to avoid a cross-file
/// dependency for a five-line utility.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
