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
        guard !hasLoaded else { return }
        hasLoaded = true

        await loadSpotify()
        await loadPopular()
        await loadPersonalized()

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
            .from("recommendable_releases")
            .select("id, title, artist, cover_url, title_native, artist_native")
            .order("prestige", ascending: false)
            .limit(20)
            .execute()
            .value) ?? []
        popularAlbums = albums

        let ids = albums.prefix(5).map(\.id.uuidString)
        guard !ids.isEmpty else { return }
        popularSongs = (try? await supabase
            .from("tracks")
            .select("id, title, artists, releases(id, title, artist, cover_url)")
            .in("release_id", values: ids)
            .order("position")
            .limit(20)
            .execute()
            .value) ?? []
    }

    private func loadPersonalized() async {
        guard let userId = supabase.auth.currentUser?.id else { return }

        struct ArtistRef: Codable {
            let releases: ArtistName
            struct ArtistName: Codable { let artist: String }
        }
        let userRatings: [ArtistRef] = (try? await supabase
            .from("ratings")
            .select("releases(artist)")
            .eq("user_id", value: userId)
            .order("score", ascending: false)
            .limit(20)
            .execute()
            .value) ?? []

        let topArtists = Array(Set(userRatings.map(\.releases.artist))).prefix(5)
        guard !topArtists.isEmpty else { return }

        let orFilter = topArtists
            .map { "artist.ilike.%\($0.replacingOccurrences(of: "'", with: "''"))%" }
            .joined(separator: ",")

        let albums: [Release] = (try? await supabase
            .from("recommendable_releases")
            .select("id, title, artist, cover_url, title_native, artist_native")
            .or(orFilter)
            .limit(20)
            .execute()
            .value) ?? []

        personalizedAlbums = albums
        hasPersonalized = !albums.isEmpty

        let ids = albums.prefix(5).map(\.id.uuidString)
        guard !ids.isEmpty else { return }
        personalizedSongs = (try? await supabase
            .from("tracks")
            .select("id, title, artists, releases(id, title, artist, cover_url)")
            .in("release_id", values: ids)
            .order("position")
            .limit(20)
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
            .from("recommendable_releases")
            .select("id, title, artist, cover_url, title_native, artist_native")
            .or("title.ilike.%\(q)%,artist.ilike.%\(q)%,title_native.ilike.%\(q)%,artist_native.ilike.%\(q)%")
            .order("prestige", ascending: false)
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
    @State private var searchVM    = SearchViewModel()
    @State private var discoveryVM = DiscoveryViewModel()
    @State private var searchTask: Task<Void, Never>?

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
            .navigationTitle("Add")
            .navigationBarTitleDisplayMode(.large)
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
        }
        .task { await discoveryVM.load() }
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
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    // ── Albums ────────────────────────────────
                    if hasAlbums {
                        sectionLabel("Albums")
                        LazyVGrid(columns: threeColumns, spacing: 14) {
                            ForEach(searchVM.albumResults) { release in
                                NavigationLink(value: release) {
                                    AlbumCard(release: release)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 32)
                    }

                    // ── Songs ─────────────────────────────────
                    if hasSongs {
                        sectionLabel("Songs")
                        VStack(spacing: 0) {
                            ForEach(searchVM.songResults) { song in
                                SongRow(song: song)
                                if song.id != searchVM.songResults.last?.id {
                                    Divider()
                                        .padding(.leading, 72)
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
                    if discoveryVM.hasPersonalized {
                        discoverySectionTitle("For You")

                        if !discoveryVM.personalizedAlbums.isEmpty {
                            discoverySubheader("Albums")
                            albumScroll(discoveryVM.personalizedAlbums)
                        }
                        if !discoveryVM.personalizedSongs.isEmpty {
                            discoverySubheader("Songs")
                            songList(discoveryVM.personalizedSongs)
                        }

                        Spacer().frame(height: 28)
                    }

                    // ── Popular ───────────────────────────────
                    discoverySectionTitle("Popular")

                    if !discoveryVM.popularAlbums.isEmpty {
                        discoverySubheader("Albums")
                        albumScroll(discoveryVM.popularAlbums)
                    }
                    if !discoveryVM.popularSongs.isEmpty {
                        discoverySubheader("Songs")
                        songList(discoveryVM.popularSongs)
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
            HStack(spacing: 14) {
                ForEach(artists) { artist in
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

    private func albumScroll(_ albums: [Release]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(albums) { release in
                    NavigationLink(value: release) {
                        DiscoveryAlbumCard(release: release)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func songList(_ songs: [SongResult]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(songs.enumerated()), id: \.element.id) { index, song in
                SongRow(song: song)
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
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

#Preview {
    SearchView()
}
