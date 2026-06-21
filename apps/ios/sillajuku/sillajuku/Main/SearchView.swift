import SwiftUI
import Observation
import Supabase

// MARK: - Song model

struct SongResult: Codable, Identifiable {
    let id: UUID
    let title: String
    let artists: String?
    let releases: SongRelease

    struct SongRelease: Codable {
        let id: UUID
        let title: String
        let artist: String
        let coverUrl: String?

        enum CodingKeys: String, CodingKey {
            case id, title, artist
            case coverUrl = "cover_url"
        }
    }
}

// MARK: - Discovery ViewModel

@Observable
class DiscoveryViewModel {
    // Spotify-sourced
    var spotifyArtists: [SpotifyArtistDisplay] = []
    var recentlyPlayed: [SpotifyAlbumDisplay] = []
    var hasSpotifyData = false

    // DB-personalized (based on user's ratings)
    var personalizedAlbums: [Release] = []
    var personalizedSongs:  [SongResult] = []
    var hasPersonalized = false

    // General popular
    var popularAlbums: [Release] = []
    var popularSongs:  [SongResult] = []

    var isLoading = true
    private var hasLoaded = false

    func load() async {
        if !hasLoaded {
            hasLoaded = true
            await loadSpotify()
            await loadPopular()
            await loadPersonalized()
        } else if !hasSpotifyData {
            await loadSpotify()
        }
        isLoading = false
    }

    private func loadSpotify() async {
        guard let token = await SpotifyService.providerToken() else { return }

        spotifyArtists = await SpotifyService.topArtists(token: token, limit: 10)
        recentlyPlayed = await SpotifyService.recentlyPlayed(token: token, limit: 50)
        hasSpotifyData = !spotifyArtists.isEmpty || !recentlyPlayed.isEmpty
    }

    private func loadPopular() async {
        let albums: [Release] = (try? await supabase
            .from("releases")
            .select("id, title, artist, cover_url, title_native, artist_native")
            .in("release_type", values: ["album", "Album", "ep", "EP"])
            .not("cover_url", operator: .is, value: AnyJSON.null)
            .order("prestige", ascending: false, nullsFirst: false)
            .limit(50)
            .execute()
            .value) ?? []
        popularAlbums = albums

        let ids = albums.prefix(8).map(\.id.uuidString)
        guard !ids.isEmpty else { return }
        popularSongs = (try? await supabase
            .from("tracks")
            .select("id, title, artists, releases(id, title, artist, cover_url)")
            .in("release_id", values: ids)
            .order("position")
            .limit(30)
            .execute()
            .value) ?? []
    }

    private func loadPersonalized() async {
        guard let userId = supabase.auth.currentUser?.id else { return }

        // Step 1: user's rated release IDs (avoid join to prevent decode failures)
        struct RatingRef: Codable {
            let releaseId: UUID
            enum CodingKeys: String, CodingKey { case releaseId = "release_id" }
        }
        let ratingRefs: [RatingRef] = (try? await supabase
            .from("ratings")
            .select("release_id")
            .eq("user_id", value: userId)
            .limit(50)
            .execute()
            .value) ?? []
        guard !ratingRefs.isEmpty else { return }

        // Step 2: artists for those releases (separate query, optional artist field)
        struct RelArtist: Codable { let artist: String? }
        let relArtists: [RelArtist] = (try? await supabase
            .from("releases")
            .select("artist")
            .in("id", values: ratingRefs.map(\.releaseId.uuidString))
            .execute()
            .value) ?? []

        let topArtists = Array(Set(relArtists.compactMap(\.artist))).prefix(8)
        guard !topArtists.isEmpty else { return }

        // Step 3: albums by those exact artists (in() = no URL-encoded wildcard issues)
        let albums: [Release] = (try? await supabase
            .from("releases")
            .select("id, title, artist, cover_url, title_native, artist_native")
            .not("cover_url", operator: .is, value: AnyJSON.null)
            .in("release_type", values: ["album", "Album", "ep", "EP"])
            .in("artist", values: Array(topArtists))
            .order("prestige", ascending: false, nullsFirst: false)
            .limit(50)
            .execute()
            .value) ?? []

        personalizedAlbums = albums
        hasPersonalized = !albums.isEmpty

        let ids = albums.prefix(8).map(\.id.uuidString)
        guard !ids.isEmpty else { return }
        personalizedSongs = (try? await supabase
            .from("tracks")
            .select("id, title, artists, releases(id, title, artist, cover_url)")
            .in("release_id", values: ids)
            .order("position")
            .limit(30)
            .execute()
            .value) ?? []
    }
}

// MARK: - Search ViewModel

@Observable
class SearchViewModel {
    var query = ""
    var albumResults: [Release] = []
    var songResults:  [SongResult] = []
    var isSearching = false

    func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            albumResults = []
            songResults  = []
            return
        }
        isSearching = true
        defer { isSearching = false }

        albumResults = (try? await supabase
            .from("releases")
            .select("id, title, artist, cover_url, title_native, artist_native")
            .or("title.ilike.%\(q)%,artist.ilike.%\(q)%,title_native.ilike.%\(q)%,artist_native.ilike.%\(q)%")
            .in("release_type", values: ["album", "Album", "ep", "EP"])
            .order("prestige", ascending: false, nullsFirst: false)
            .limit(30)
            .execute()
            .value) ?? []

        songResults = (try? await supabase
            .from("tracks")
            .select("id, title, artists, releases(id, title, artist, cover_url)")
            .ilike("title", pattern: "%\(q)%")
            .limit(30)
            .execute()
            .value) ?? []
    }
}

// MARK: - View

struct SearchView: View {
    let discoveryVM: DiscoveryViewModel
    @State private var searchVM           = SearchViewModel()
    @State private var searchTask: Task<Void, Never>?
    @State private var ratingSheetRelease: Release?
    @State private var instinctSheetRelease: Release?
    @State private var userRatingMode = "manual"
    @State private var ratedReleaseIds: Set<UUID> = []

    private let threeColumns = [GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12),
                                GridItem(.flexible(), spacing: 12)]

    private var hasQuery: Bool {
        !searchVM.query.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchBar
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
                Divider()

                if hasQuery {
                    searchResultsView
                } else {
                    discoveryView
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .onTapGesture { UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil) }
            .navigationTitle("Add")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
            .navigationDestination(for: DiscoverySongList.self) { DiscoverySongListView(item: $0) }
            .navigationDestination(for: ArtistDestination.self) { ArtistPageView(artist: $0) }
            .sheet(item: $ratingSheetRelease) { release in
                NavigationStack {
                    AlbumDetailView(release: release) { id in ratedReleaseIds.insert(id) }
                }
                .presentationDetents([.large])
            }
            .sheet(item: $instinctSheetRelease) { release in
                InstinctRatingView(release: release) { id in ratedReleaseIds.insert(id) }
                    .presentationDetents([.large])
            }
        }
        .task {
            await discoveryVM.load()
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await loadUserRatingMode() }
                g.addTask { await loadRatedReleaseIds() }
            }
        }
    }

    private func loadRatedReleaseIds() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct Row: Decodable {
            let releaseId: UUID
            enum CodingKeys: String, CodingKey { case releaseId = "release_id" }
        }
        let rows: [Row] = (try? await supabase
            .from("ratings")
            .select("release_id")
            .eq("user_id", value: userId)
            .execute()
            .value) ?? []
        ratedReleaseIds = Set(rows.map(\.releaseId))
    }

    private func loadUserRatingMode() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct P: Decodable {
            let ratingMode: String?
            enum CodingKeys: String, CodingKey { case ratingMode = "rating_mode" }
        }
        if let p: P = try? await supabase
            .from("profiles")
            .select("rating_mode")
            .eq("id", value: userId)
            .single()
            .execute()
            .value {
            userRatingMode = p.ratingMode ?? "manual"
        }
    }

    private func addRelease(_ release: Release) {
        ratedReleaseIds.insert(release.id)  // disappears immediately from Add tab
        if userRatingMode == "instinct" {
            instinctSheetRelease = release
        } else {
            ratingSheetRelease = release
        }
    }

    // MARK: - Search bar

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.sjMuted)
            TextField("Artists, albums, songs…", text: $searchVM.query)
                .font(.system(size: 16))
                .foregroundStyle(Color.sjInk)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: searchVM.query) {
                    searchTask?.cancel()
                    let q = searchVM.query
                    searchTask = Task {
                        try? await Task.sleep(for: .milliseconds(300))
                        guard !Task.isCancelled, searchVM.query == q else { return }
                        await searchVM.search()
                    }
                }
            if searchVM.isSearching {
                ProgressView().scaleEffect(0.75)
            } else if !searchVM.query.isEmpty {
                Button {
                    searchVM.query = ""
                    searchVM.albumResults = []
                    searchVM.songResults = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(12)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder, lineWidth: 1))
    }

    // MARK: - Search results

    @ViewBuilder
    private var searchResultsView: some View {
        let hasAlbums = !searchVM.albumResults.isEmpty
        let hasSongs  = !searchVM.songResults.isEmpty

        if searchVM.isSearching {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if !hasAlbums && !hasSongs {
            if searchVM.query.trimmingCharacters(in: .whitespaces).count >= 2 {
                VStack(spacing: 14) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 44))
                        .foregroundStyle(Color.sjBorder)
                    Text("No results for \"\(searchVM.query)\"")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            let filteredAlbums = searchVM.albumResults.filter { !ratedReleaseIds.contains($0.id) }
            let filteredSongs  = searchVM.songResults.filter  { !ratedReleaseIds.contains($0.releases.id) }
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // ── Albums ────────────────────────────────
                    if !filteredAlbums.isEmpty {
                        sectionLabel("Albums")
                        LazyVGrid(columns: threeColumns, spacing: 14) {
                            ForEach(filteredAlbums) { release in
                                NavigationLink(value: release) {
                                    AlbumCard(release: release, onAdd: { addRelease(release) })
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 32)
                    }

                    // ── Songs ─────────────────────────────────
                    if !filteredSongs.isEmpty {
                        sectionLabel("Songs")
                        VStack(spacing: 0) {
                            ForEach(filteredSongs) { song in
                                let pr = songParentRelease(song)
                                NavigationLink(value: pr) {
                                    SongRow(song: song, onAdd: { addRelease(pr) })
                                }
                                .buttonStyle(.plain)
                                if song.id != filteredSongs.last?.id {
                                    Divider().padding(.leading, 72)
                                }
                            }
                        }
                        .padding(.bottom, 32)
                    }
                }
                .padding(.top, 16)
            }
        }
    }

    // MARK: - Discovery

    @ViewBuilder
    private var discoveryView: some View {
        if discoveryVM.isLoading {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {

                    // ── Spotify: Your Top Artists ─────────────
                    if !discoveryVM.spotifyArtists.isEmpty {
                        discoverySectionTitle("Your Top Artists")
                        spotifyArtistScroll(discoveryVM.spotifyArtists)
                        Spacer().frame(height: 24)
                    }

                    // ── Spotify: Recently Listened ────────────
                    if !discoveryVM.recentlyPlayed.isEmpty {
                        discoverySectionTitle("Recently Listened")
                        spotifyAlbumScroll(discoveryVM.recentlyPlayed)
                        Spacer().frame(height: 24)
                    }

                    // ── For You (DB-based) ────────────────────
                    let forYouAlbums = discoveryVM.personalizedAlbums.filter { !ratedReleaseIds.contains($0.id) }
                    let forYouSongs  = discoveryVM.personalizedSongs.filter  { !ratedReleaseIds.contains($0.releases.id) }
                    if discoveryVM.hasPersonalized {
                        discoverySectionTitle("For You")

                        if !forYouAlbums.isEmpty {
                            discoverySubheader("Albums")
                            albumScroll(forYouAlbums)
                        }
                        if !forYouSongs.isEmpty {
                            songSectionHeader("Songs", songs: forYouSongs)
                            songList(Array(forYouSongs.prefix(4)))
                        }
                        if forYouAlbums.isEmpty && forYouSongs.isEmpty {
                            Text("You've rated everything we'd recommend — keep exploring below.")
                                .font(.system(size: 13))
                                .foregroundStyle(Color.sjMuted)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 12)
                        }

                        Spacer().frame(height: 28)
                    }

                    // ── Popular ───────────────────────────────
                    let popAlbums = discoveryVM.popularAlbums.filter { !ratedReleaseIds.contains($0.id) }
                    let popSongs  = discoveryVM.popularSongs.filter  { !ratedReleaseIds.contains($0.releases.id) }
                    if !popAlbums.isEmpty || !popSongs.isEmpty {
                        discoverySectionTitle("Popular")
                    }
                    if !popAlbums.isEmpty {
                        discoverySubheader("Albums")
                        albumScroll(popAlbums)
                    }
                    if !popSongs.isEmpty {
                        songSectionHeader("Songs", songs: popSongs)
                        songList(Array(popSongs.prefix(4)))
                    }

                    Spacer().frame(height: 36)
                }
                .padding(.top, 4)
            }
        }
    }

    // MARK: - Helpers

    private func sectionLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .tracking(1)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
    }

    private func discoverySectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 20, weight: .bold))
            .foregroundStyle(Color.sjInk)
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 2)
    }

    private func songSectionHeader(_ title: String, songs: [SongResult]) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(1)
            Spacer()
            if songs.count > 4 {
                NavigationLink(value: DiscoverySongList(title: title, songs: songs)) {
                    Text("See all")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.sjAmber)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }

    private func discoverySubheader(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.sjAmber)
            .tracking(1)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)
    }

    private func spotifyArtistScroll(_ artists: [SpotifyArtistDisplay]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(artists) { artist in
                    NavigationLink(value: ArtistDestination(name: artist.name, imageUrl: artist.imageUrl)) {
                        VStack(spacing: 7) {
                            AsyncImage(url: URL(string: artist.imageUrl ?? "")) { phase in
                                switch phase {
                                case .success(let img):
                                    img.resizable().aspectRatio(contentMode: .fill)
                                default:
                                    Color.sjBorder.overlay(
                                        Text(String(artist.name.prefix(1)))
                                            .font(.system(size: 20, weight: .bold))
                                            .foregroundStyle(Color.sjMuted)
                                    )
                                }
                            }
                            .frame(width: 72, height: 72)
                            .clipShape(Circle())

                            Text(artist.name)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.sjInk)
                                .lineLimit(2)
                                .multilineTextAlignment(.center)
                                .frame(width: 72)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
    }

    private func spotifyAlbumScroll(_ albums: [SpotifyAlbumDisplay]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(albums) { album in
                    VStack(alignment: .leading, spacing: 6) {
                        AsyncImage(url: URL(string: album.imageUrl ?? "")) { phase in
                            switch phase {
                            case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                            default: Color.sjBorder
                            }
                        }
                        .frame(width: 112, height: 112)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                        Text(album.name)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(1)
                            .frame(width: 112, alignment: .leading)

                        Text(album.artistName)
                            .font(.system(size: 11))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)
                            .frame(width: 112, alignment: .leading)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
    }

    private func songParentRelease(_ song: SongResult) -> Release {
        Release(id: song.releases.id, title: song.releases.title,
                artist: song.releases.artist, coverUrl: song.releases.coverUrl,
                releaseType: nil, releaseDate: nil,
                titleNative: nil, artistNative: nil,
                tracklist: nil, totalTracks: nil)
    }

    private func albumScroll(_ albums: [Release]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(albums) { release in
                    ZStack(alignment: .bottomTrailing) {
                        NavigationLink(value: release) {
                            DiscoveryAlbumCard(release: release)
                        }
                        .buttonStyle(.plain)

                        Button { addRelease(release) } label: {
                            ZStack {
                                Circle()
                                    .fill(.white)
                                    .frame(width: 28, height: 28)
                                    .shadow(color: .black.opacity(0.15), radius: 4, y: 1)
                                Image(systemName: "plus")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundStyle(Color.sjBlue)
                            }
                        }
                        .buttonStyle(.plain)
                        .padding(.bottom, 34)
                        .padding(.trailing, 4)
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func songList(_ songs: [SongResult]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(songs.enumerated()), id: \.element.id) { index, song in
                let pr = songParentRelease(song)
                NavigationLink(value: pr) {
                    SongRow(song: song, onAdd: { addRelease(pr) })
                }
                .buttonStyle(.plain)
                if index < songs.count - 1 {
                    Divider()
                        .padding(.leading, 72)
                        .foregroundStyle(Color.sjBorder)
                }
            }
        }
    }
}

// MARK: - Discovery album card

private struct DiscoveryAlbumCard: View {
    let release: Release

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                default: Color.sjBorder
                }
            }
            .frame(width: 128, height: 128)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            Text(release.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.sjInk)
                .lineLimit(1)
                .frame(width: 128, alignment: .leading)

            Text(release.artist)
                .font(.system(size: 12))
                .foregroundStyle(Color.sjMuted)
                .lineLimit(1)
                .frame(width: 128, alignment: .leading)
        }
    }
}

// MARK: - Song row

struct SongRow: View {
    let song: SongResult
    var onAdd: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: song.releases.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                default: Color.sjBorder
                }
            }
            .frame(width: 44, height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 3) {
                Text(song.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text("\(song.releases.title) · \(song.artists ?? song.releases.artist)")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer()

            if let onAdd {
                Button(action: onAdd) {
                    ZStack {
                        Circle()
                            .fill(Color.sjBlue.opacity(0.12))
                            .frame(width: 30, height: 30)
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.sjBlue)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

// MARK: - Artist page (navigation destination)

struct ArtistDestination: Hashable {
    let name: String
    let imageUrl: String?
}

private struct ArtistPageView: View {
    let artist: ArtistDestination

    @State private var releases: [Release] = []
    @State private var isLoading = true

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                // Hero header
                AsyncImage(url: URL(string: artist.imageUrl ?? "")) { phase in
                    switch phase {
                    case .success(let img):
                        img.resizable().aspectRatio(contentMode: .fill)
                            .frame(maxWidth: .infinity).frame(height: 220)
                            .clipped()
                    default:
                        Color.sjBorder.frame(maxWidth: .infinity).frame(height: 220)
                            .overlay(
                                Text(String(artist.name.prefix(1)))
                                    .font(.system(size: 64, weight: .bold))
                                    .foregroundStyle(Color.sjMuted)
                            )
                    }
                }

                if isLoading {
                    ProgressView().padding(.top, 40)
                } else if releases.isEmpty {
                    Text("No albums in the catalogue yet.")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.sjMuted)
                        .padding(.top, 40)
                } else {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(releases.enumerated()), id: \.element.id) { idx, release in
                            ArtistReleaseRow(release: release)
                            if idx < releases.count - 1 {
                                Divider().padding(.leading, 80)
                            }
                        }
                    }
                    .padding(.top, 8)
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(artist.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
        .task { await load() }
    }

    private func load() async {
        let name = artist.name
        let escaped = name.replacingOccurrences(of: "'", with: "''")
        releases = (try? await supabase
            .from("releases")
            .select("id, title, artist, cover_url, release_type, release_date")
            .ilike("artist", value: "%\(escaped)%")
            .order("release_date", ascending: false, nullsFirst: false)
            .limit(50)
            .execute()
            .value) ?? []
        isLoading = false
    }
}

private struct ArtistReleaseRow: View {
    let release: Release

    var body: some View {
        NavigationLink(value: release) {
            HStack(spacing: 12) {
                AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                    switch phase {
                    case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                    default: Color.sjBorder
                    }
                }
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 8))

                VStack(alignment: .leading, spacing: 3) {
                    Text(release.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    Text((release.releaseType ?? "").capitalized)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 11))
                    .foregroundStyle(Color.sjBorder)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Full song list (navigation destination)

struct DiscoverySongList: Hashable {
    let title: String
    let songs: [SongResult]

    func hash(into hasher: inout Hasher) { hasher.combine(title) }
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.title == rhs.title }
}

private struct DiscoverySongListView: View {
    let item: DiscoverySongList

    var body: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 0) {
                ForEach(Array(item.songs.enumerated()), id: \.element.id) { index, song in
                    let pr = Release(
                        id: song.releases.id, title: song.releases.title,
                        artist: song.releases.artist, coverUrl: song.releases.coverUrl,
                        releaseType: nil, releaseDate: nil,
                        titleNative: nil, artistNative: nil,
                        tracklist: nil, totalTracks: nil
                    )
                    NavigationLink(value: pr) {
                        SongRow(song: song)
                    }
                    .buttonStyle(.plain)
                    if index < item.songs.count - 1 {
                        Divider().padding(.leading, 72)
                    }
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(item.title)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
    }
}

#Preview {
    SearchView(discoveryVM: DiscoveryViewModel())
}
