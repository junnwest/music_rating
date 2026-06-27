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

    // High-confidence taste recommendations (artists user rated 4+)
    var tasteAlbums: [Release] = []

    // Trending on the platform (most-rated recent releases)
    var trendingAlbums: [Release] = []

    // General popular
    var popularAlbums: [Release] = []
    var popularSongs:  [SongResult] = []

    var isLoading = true
    var needsSpotifyReconnect = false  // no cached data AND token is gone
    var isReconnectingSpotify = false
    private var hasLoaded = false

    func load() async {
        if !hasLoaded {
            hasLoaded = true
            await loadSpotify()
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.loadPopular() }
                g.addTask { await self.loadPersonalized() }
                g.addTask { await self.loadTasteAlbums() }
                g.addTask { await self.loadTrending() }
            }
        } else if !hasSpotifyData {
            await loadSpotify()
        }
        isLoading = false
    }

    private func loadSpotify() async {
        // Layer 1: UserDefaults (instant, device-local)
        if spotifyArtists.isEmpty { spotifyArtists = SpotifyService.loadCachedArtists() }
        if recentlyPlayed.isEmpty { recentlyPlayed  = SpotifyService.loadCachedRecentlyPlayed() }

        // Layer 2: Supabase DB (persistent across reinstalls and devices)
        if spotifyArtists.isEmpty {
            let dbArtists = await SpotifyService.loadArtistsFromDB()
            if !dbArtists.isEmpty {
                spotifyArtists = dbArtists
                SpotifyService.saveArtists(dbArtists)  // backfill local cache
            }
        }
        if recentlyPlayed.isEmpty {
            let dbRecent = await SpotifyService.loadRecentlyPlayedFromDB()
            if !dbRecent.isEmpty {
                recentlyPlayed = dbRecent
                SpotifyService.saveRecentlyPlayed(dbRecent)
            }
        }

        hasSpotifyData = !spotifyArtists.isEmpty || !recentlyPlayed.isEmpty

        // Layer 3: Live Spotify API (when token is valid — refreshes both caches)
        guard let token = await SpotifyService.validToken() else {
            needsSpotifyReconnect = !hasSpotifyData
            return
        }
        needsSpotifyReconnect = false

        let fresh = await SpotifyService.topArtists(token: token, limit: 10)
        if !fresh.isEmpty {
            spotifyArtists = fresh
            SpotifyService.saveArtists(fresh)
            await SpotifyService.saveArtistsToDB(fresh)
        }

        let recent = await SpotifyService.recentlyPlayed(token: token, limit: 50)
        if !recent.isEmpty {
            recentlyPlayed = recent
            SpotifyService.saveRecentlyPlayed(recent)
            await SpotifyService.saveRecentlyPlayedToDB(recent)
        }

        hasSpotifyData = !spotifyArtists.isEmpty || !recentlyPlayed.isEmpty
    }

    // Opens Spotify OAuth to get a fresh provider token.
    // After the user returns from the browser, call refreshSpotifyIfNeeded().
    func reconnectSpotify() async {
        isReconnectingSpotify = true
        defer { isReconnectingSpotify = false }
        // Use signInWithOAuth (not linkIdentity) — linkIdentity fails silently when the
        // Spotify identity is already linked, so no providerToken is ever delivered.
        // signInWithOAuth re-authenticates through /auth/v1/callback, which always returns
        // a full session including provider_token, triggering authStateChanges correctly.
        try? await supabase.auth.signInWithOAuth(
            provider: .spotify,
            redirectTo: Config.oauthRedirectURL,
            scopes: "user-top-read user-read-recently-played"
        )
    }

    // Called when app returns to foreground — picks up the new token if OAuth completed.
    func refreshSpotifyIfNeeded() async {
        guard needsSpotifyReconnect || !hasSpotifyData else { return }
        await loadSpotify()
    }

    private func loadPopular() async {
        popularAlbums = (try? await supabase
            .from("release_groups")
            .select("id, title, artist_display, cover_url, native_title, release_group_type, first_release_date")
            .in("release_group_type", values: ["album", "ep"])
            .not("cover_url", operator: .is, value: AnyJSON.null)
            .order("first_release_date", ascending: false, nullsFirst: false)
            .limit(50)
            .execute()
            .value) ?? []
        popularSongs = []  // songs in discovery deferred until Windows rebuilds search RPCs
    }

    private func loadPersonalized() async {
        guard let userId = supabase.auth.currentUser?.id else { return }

        var dbArtists = Set<String>()

        // Primary seeds: exact artist_display values from the user's own ratings.
        struct RatedRelease: Codable {
            let releaseGroups: ArtistOnly
            struct ArtistOnly: Codable {
                let artist: String
                enum CodingKeys: String, CodingKey { case artist = "artist_display" }
            }
            enum CodingKeys: String, CodingKey { case releaseGroups = "release_groups" }
        }
        let ratedReleases: [RatedRelease] = (try? await supabase
            .from("ratings")
            .select("release_groups(artist_display)")
            .eq("user_id", value: userId)
            .limit(200)
            .execute()
            .value) ?? []
        ratedReleases.forEach { dbArtists.insert($0.releaseGroups.artist) }

        // Supplement with Spotify artists when available.
        for a in spotifyArtists { dbArtists.insert(a.name) }
        for a in recentlyPlayed  { dbArtists.insert(a.artistName) }

        guard !dbArtists.isEmpty else { return }

        let seeds = Array(dbArtists.prefix(50))

        personalizedAlbums = (try? await supabase
            .from("release_groups")
            .select("id, title, artist_display, cover_url, native_title, release_group_type, first_release_date")
            .not("cover_url", operator: .is, value: AnyJSON.null)
            .in("release_group_type", values: ["album", "ep"])
            .in("artist_display", values: seeds)
            .order("first_release_date", ascending: false, nullsFirst: false)
            .limit(60)
            .execute()
            .value) ?? []

        hasPersonalized = !personalizedAlbums.isEmpty
        personalizedSongs = []  // deferred until Windows rebuilds search RPCs
    }

    // Albums by artists the user has explicitly loved (rated ≥ 4.0).
    private func loadTasteAlbums() async {
        guard let userId = supabase.auth.currentUser?.id else { return }

        struct HighRated: Codable {
            let releaseGroups: AR
            struct AR: Codable {
                let artist: String
                enum CodingKeys: String, CodingKey { case artist = "artist_display" }
            }
            enum CodingKeys: String, CodingKey { case releaseGroups = "release_groups" }
        }
        let rows: [HighRated] = (try? await supabase
            .from("ratings")
            .select("release_groups(artist_display)")
            .eq("user_id", value: userId)
            .gte("score", value: 4.0)
            .execute()
            .value) ?? []

        let lovedArtists = Array(Set(rows.map(\.releaseGroups.artist)).prefix(30))
        guard !lovedArtists.isEmpty else { return }

        let all: [Release] = (try? await supabase
            .from("release_groups")
            .select("id, title, artist_display, cover_url, native_title, release_group_type, first_release_date")
            .in("artist_display", values: lovedArtists)
            .in("release_group_type", values: ["album", "ep"])
            .not("cover_url", operator: .is, value: AnyJSON.null)
            .order("first_release_date", ascending: false, nullsFirst: false)
            .limit(200)
            .execute()
            .value) ?? []

        // Cap at 3 albums per artist so no single prolific artist floods the section.
        var countPerArtist: [String: Int] = [:]
        var capped: [Release] = []
        for album in all {
            let n = countPerArtist[album.displayArtist, default: 0]
            if n < 3 { capped.append(album); countPerArtist[album.displayArtist] = n + 1 }
        }
        tasteAlbums = capped.shuffled()
    }

    // Most-rated release groups on the platform in the last 30 days.
    private func loadTrending() async {
        let cutoff = ISO8601DateFormatter().string(
            from: Calendar.current.date(byAdding: .day, value: -30, to: Date()) ?? Date()
        )

        struct Row: Codable {
            let releaseGroupId: UUID
            let releaseGroups: Release
            enum CodingKeys: String, CodingKey {
                case releaseGroupId = "release_group_id"
                case releaseGroups  = "release_groups"
            }
        }

        let rows: [Row] = (try? await supabase
            .from("ratings")
            .select("release_group_id, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, first_release_date)")
            .gt("created_at", value: cutoff)
            .order("created_at", ascending: false)
            .limit(500)
            .execute()
            .value) ?? []

        var counts: [UUID: (count: Int, release: Release)] = [:]
        for row in rows {
            guard row.releaseGroups.releaseType != "single" else { continue }
            counts[row.releaseGroupId] = ((counts[row.releaseGroupId]?.count ?? 0) + 1, row.releaseGroups)
        }

        trendingAlbums = counts.values
            .sorted { $0.count > $1.count }
            .map(\.release)
            .prefix(25)
            .map { $0 }
    }
}

// MARK: - Search ViewModel

struct SearchArtist: Identifiable {
    let name: String
    let releaseCount: Int
    var id: String { name }
}

@Observable
class SearchViewModel {
    var query = ""
    var artistResults: [SearchArtist] = []
    var albumResults:  [Release] = []
    var songResults:   [SongResult] = []
    var isSearching = false

    func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            artistResults = []
            albumResults  = []
            songResults   = []
            return
        }
        isSearching = true
        defer { isSearching = false }

        // Album search against release_groups
        let albums: [Release] = (try? await supabase
            .from("release_groups")
            .select("id, title, artist_display, cover_url, native_title, release_group_type, first_release_date")
            .or("title.ilike.%\(q)%,artist_display.ilike.%\(q)%,native_title.ilike.%\(q)%")
            .in("release_group_type", values: ["album", "ep"])
            .order("first_release_date", ascending: false, nullsFirst: false)
            .limit(30)
            .execute()
            .value) ?? []
        albumResults = albums

        // Song search: Step 1 — match recordings by title
        struct RecordingHit: Codable, Identifiable {
            let id: UUID; let title: String; let artistDisplay: String?
            enum CodingKeys: String, CodingKey {
                case id, title; case artistDisplay = "artist_display"
            }
        }
        let hits: [RecordingHit] = (try? await supabase
            .from("recordings")
            .select("id, title, artist_display")
            .ilike("title", pattern: "%\(q)%")
            .limit(30)
            .execute()
            .value) ?? []

        if hits.isEmpty {
            songResults = []
        } else {
            // Step 2 — get release group info for these recordings via release_tracks
            struct RTRow: Codable {
                let recordingId: UUID
                let releases: RelRow?
                struct RelRow: Codable {
                    let isCanonical: Bool?
                    let releaseGroups: RGInfo?
                    struct RGInfo: Codable {
                        let id: UUID; let title: String; let artistDisplay: String?; let coverUrl: String?
                        enum CodingKeys: String, CodingKey {
                            case id, title; case artistDisplay = "artist_display"; case coverUrl = "cover_url"
                        }
                    }
                    enum CodingKeys: String, CodingKey {
                        case isCanonical = "is_canonical"; case releaseGroups = "release_groups"
                    }
                }
                enum CodingKeys: String, CodingKey {
                    case recordingId = "recording_id"; case releases
                }
            }
            let rtRows: [RTRow] = (try? await supabase
                .from("release_tracks")
                .select("recording_id, releases(is_canonical, release_groups(id, title, artist_display, cover_url))")
                .in("recording_id", values: hits.map(\.id.uuidString))
                .execute()
                .value) ?? []

            var rgMap: [UUID: RTRow.RelRow.RGInfo] = [:]
            for row in rtRows {
                guard let rg = row.releases?.releaseGroups else { continue }
                if row.releases?.isCanonical == true || rgMap[row.recordingId] == nil {
                    rgMap[row.recordingId] = rg
                }
            }
            songResults = hits.compactMap { hit in
                guard let rg = rgMap[hit.id] else { return nil }
                return SongResult(id: hit.id, title: hit.title, artists: hit.artistDisplay,
                                  releases: SongResult.SongRelease(
                                      id: rg.id, title: rg.title,
                                      artist: rg.artistDisplay ?? "", coverUrl: rg.coverUrl))
            }
        }

        // Derive artist suggestions from album results.
        let ql = q.lowercased()
        var relevanceMap: [String: (count: Int, nameMatch: Bool)] = [:]
        for album in albums {
            let match = album.artist.lowercased().contains(ql)
            let e = relevanceMap[album.artist] ?? (0, false)
            relevanceMap[album.artist] = (e.count + 1, e.nameMatch || match)
        }
        artistResults = relevanceMap
            .filter  { $0.value.nameMatch || $0.value.count >= 3 }
            .sorted  { a, b in
                if a.value.nameMatch != b.value.nameMatch { return a.value.nameMatch }
                return a.value.count > b.value.count
            }
            .prefix(4)
            .map { SearchArtist(name: $0.key, releaseCount: $0.value.count) }
    }
}

// MARK: - View

struct SearchView: View {
    let discoveryVM: DiscoveryViewModel
    @State private var searchVM           = SearchViewModel()
    @State private var searchTask: Task<Void, Never>?
    @State private var quickRateRelease: Release?
    @State private var quickRateScore: Double?     = nil
    @State private var instinctSheetRelease: Release?
    @State private var userRatingMode  = "manual"
    @State private var userRatingStep: Double = 0.5
    @State private var ratedReleaseIds: Set<UUID> = []   // loaded from DB at launch — used to hide pre-rated items
    @State private var sessionRatedIds: Set<UUID>  = []   // tapped in this session — shows checkmark
    @State private var showAllPersonalizedSongs = false
    @State private var showAllPopularSongs      = false
    @Environment(\.scenePhase) private var scenePhase

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
                    .padding(.top, 10)
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
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
            .navigationDestination(for: ArtistDestination.self) { ArtistPageView(artist: $0) }
            .sheet(item: $quickRateRelease) { release in
                ManualRatingSheet(
                    release: release,
                    existingScore: $quickRateScore,
                    ratingStep: userRatingStep
                ) { score in
                    guard let score else { return }
                    Task { await saveQuickRating(score, for: release) }
                }
            }
            .sheet(item: $instinctSheetRelease) { release in
                InstinctRatingView(release: release, onRated: { id in
                    ratedReleaseIds.insert(id)
                    sessionRatedIds.insert(id)
                }, onDone: { instinctSheetRelease = nil })
            }
        }
        .task {
            await discoveryVM.load()
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await loadUserRatingMode() }
                g.addTask { await loadRatedReleaseIds() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await discoveryVM.refreshSpotifyIfNeeded() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .sjSpotifyTokenRefreshed)) { _ in
            // Auth observer saved a fresh provider token — reload Spotify data now.
            // This fires after linkIdentity completes, which is later than scenePhase.active.
            Task { await discoveryVM.refreshSpotifyIfNeeded() }
        }
    }

    private func loadRatedReleaseIds() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct Row: Decodable {
            let releaseGroupId: UUID
            enum CodingKeys: String, CodingKey { case releaseGroupId = "release_group_id" }
        }
        let rows: [Row] = (try? await supabase
            .from("ratings")
            .select("release_group_id")
            .eq("user_id", value: userId)
            .execute()
            .value) ?? []
        ratedReleaseIds = Set(rows.map(\.releaseGroupId))
    }

    private func loadUserRatingMode() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct P: Decodable {
            let ratingMode: String?; let manualRatingStep: Double?
            enum CodingKeys: String, CodingKey {
                case ratingMode = "rating_mode"; case manualRatingStep = "manual_rating_step"
            }
        }
        if let p: P = try? await supabase
            .from("profiles")
            .select("rating_mode, manual_rating_step")
            .eq("id", value: userId)
            .single()
            .execute()
            .value {
            userRatingMode = p.ratingMode ?? "manual"
            userRatingStep = p.manualRatingStep ?? 0.5
        }
    }

    private func addRelease(_ release: Release) {
        if userRatingMode == "instinct" {
            instinctSheetRelease = release
        } else {
            quickRateScore   = nil
            quickRateRelease = release
        }
    }

    private func saveQuickRating(_ score: Double, for release: Release) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct Payload: Encodable {
            let userId: UUID; let releaseGroupId: UUID; let score: Double
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case releaseGroupId = "release_group_id"; case score
            }
        }
        try? await supabase.from("ratings")
            .upsert(Payload(userId: userId, releaseGroupId: release.id, score: score),
                    onConflict: "user_id,release_group_id")
            .execute()
        sessionRatedIds.insert(release.id)
        ratedReleaseIds.insert(release.id)
        NotificationCenter.default.post(name: .ratingChanged, object: nil)
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
                    searchVM.artistResults = []
                    searchVM.albumResults  = []
                    searchVM.songResults   = []
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
        let hasArtists = !searchVM.artistResults.isEmpty
        let hasAlbums  = !searchVM.albumResults.isEmpty
        let hasSongs   = !searchVM.songResults.isEmpty

        if searchVM.isSearching {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if !hasArtists && !hasAlbums && !hasSongs {
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

                    // ── Artists ───────────────────────────────
                    if hasArtists {
                        sectionLabel("Artists")
                        VStack(spacing: 0) {
                            ForEach(searchVM.artistResults) { artist in
                                NavigationLink(value: ArtistDestination(name: artist.name)) {
                                    HStack(spacing: 12) {
                                        ZStack {
                                            Circle().fill(Color.sjBorder)
                                            Text(String(artist.name.prefix(1)).uppercased())
                                                .font(.system(size: 16, weight: .bold))
                                                .foregroundStyle(Color.sjMuted)
                                        }
                                        .frame(width: 44, height: 44)

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(artist.name)
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundStyle(Color.sjInk)
                                            Text("\(artist.releaseCount) release\(artist.releaseCount == 1 ? "" : "s")")
                                                .font(.system(size: 12))
                                                .foregroundStyle(Color.sjMuted)
                                        }

                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.system(size: 11))
                                            .foregroundStyle(Color.sjBorder)
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 10)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)

                                if artist.id != searchVM.artistResults.last?.id {
                                    Divider().padding(.leading, 72)
                                }
                            }
                        }
                        .padding(.bottom, 24)
                    }

                    // ── Albums ────────────────────────────────
                    if hasAlbums {
                        sectionLabel("Albums")
                        LazyVGrid(columns: threeColumns, spacing: 14) {
                            ForEach(searchVM.albumResults) { release in
                                let rated = ratedReleaseIds.contains(release.id)
                                NavigationLink(value: release) {
                                    AlbumCard(
                                        release: release,
                                        onAdd: rated ? nil : { addRelease(release) },
                                        isRated: rated
                                    )
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
                                let pr = songParentRelease(song)
                                let rated = ratedReleaseIds.contains(song.releases.id)
                                NavigationLink(value: pr) {
                                    SongRow(
                                        song: song,
                                        onAdd: rated ? nil : { addRelease(pr) },
                                        isRated: rated
                                    )
                                }
                                .buttonStyle(.plain)
                                if song.id != searchVM.songResults.last?.id {
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

                    // ── Spotify: reconnect prompt (only when no cached data) ──
                    if discoveryVM.needsSpotifyReconnect {
                        spotifyReconnectBanner
                    }

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

                    // ── From Your Taste (4+ star artists) ────
                    let visibleTaste = discoveryVM.tasteAlbums.filter {
                        !ratedReleaseIds.contains($0.id) || sessionRatedIds.contains($0.id)
                    }
                    if !visibleTaste.isEmpty {
                        discoverySectionTitle("From Your Taste")
                        albumScroll(visibleTaste)
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
                            songList(discoveryVM.personalizedSongs, expanded: $showAllPersonalizedSongs)
                        }

                        Spacer().frame(height: 28)
                    }

                    // ── Popular ───────────────────────────────
                    if !discoveryVM.popularAlbums.isEmpty || !discoveryVM.popularSongs.isEmpty {
                        discoverySectionTitle("Popular")
                    }
                    if !discoveryVM.popularAlbums.isEmpty {
                        discoverySubheader("Albums")
                        albumScroll(discoveryVM.popularAlbums)
                    }
                    if !discoveryVM.popularSongs.isEmpty {
                        discoverySubheader("Songs")
                        songList(discoveryVM.popularSongs, expanded: $showAllPopularSongs)
                    }

                    // ── Trending ──────────────────────────────
                    let visibleTrending = discoveryVM.trendingAlbums.filter {
                        !ratedReleaseIds.contains($0.id) || sessionRatedIds.contains($0.id)
                    }
                    if !visibleTrending.isEmpty {
                        discoverySectionTitle("Trending")
                        albumScroll(discoveryVM.trendingAlbums)
                        Spacer().frame(height: 24)
                    }

                    Spacer().frame(height: 36)
                }
                .padding(.top, 4)
            }
        }
    }

    // MARK: - Spotify reconnect banner

    private var spotifyReconnectBanner: some View {
        HStack(spacing: 12) {
            Image("icon-spotify")
                .resizable()
                .scaledToFit()
                .frame(width: 20, height: 20)
                .opacity(0.7)
            VStack(alignment: .leading, spacing: 2) {
                Text("Connect Spotify")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                Text("Link your account to see personalized suggestions")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
            }
            Spacer()
            Button {
                Task { await discoveryVM.reconnectSpotify() }
            } label: {
                if discoveryVM.isReconnectingSpotify {
                    ProgressView().tint(Color.sjSpotifyGreen)
                } else {
                    Text("Reconnect")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.sjSpotifyGreen)
                        .clipShape(Capsule())
                }
            }
            .disabled(discoveryVM.isReconnectingSpotify)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.sjInk.opacity(0.05))
        .padding(.top, 8)
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
            HStack(alignment: .top, spacing: 14) {
                ForEach(artists) { artist in
                    NavigationLink(value: ArtistDestination(name: artist.name)) {
                        VStack(spacing: 7) {
                            AsyncImage(url: URL(string: artist.imageUrl?.thumbnailUrl ?? "")) { phase in
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
                        CoverImage(url: album.imageUrl)
                            .frame(width: 112, height: 112)

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
        // Hide pre-session rated items; show session-rated ones with a checkmark.
        let visible = albums.filter { !ratedReleaseIds.contains($0.id) || sessionRatedIds.contains($0.id) }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(visible) { release in
                    let checked = sessionRatedIds.contains(release.id)
                    NavigationLink(value: release) {
                        DiscoveryAlbumCard(release: release,
                                           onAdd: checked ? nil : { addRelease(release) },
                                           isRated: checked)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private func songList(_ songs: [SongResult], expanded: Binding<Bool>? = nil) -> some View {
        let visible = songs.filter { !ratedReleaseIds.contains($0.releases.id) || sessionRatedIds.contains($0.releases.id) }
        let cap     = 5
        let isExpanded = expanded?.wrappedValue ?? true
        let shown   = isExpanded ? visible : Array(visible.prefix(cap))
        let hasMore = !isExpanded && visible.count > cap

        return VStack(spacing: 0) {
            ForEach(Array(shown.enumerated()), id: \.element.id) { index, song in
                let pr = songParentRelease(song)
                let checked = sessionRatedIds.contains(pr.id)
                NavigationLink(value: pr) {
                    SongRow(song: song, onAdd: checked ? nil : { addRelease(pr) }, isRated: checked)
                }
                .buttonStyle(.plain)
                if index < shown.count - 1 || hasMore {
                    Divider()
                        .padding(.leading, 72)
                        .foregroundStyle(Color.sjBorder)
                }
            }
            if hasMore {
                Button {
                    expanded?.wrappedValue = true
                } label: {
                    Text("See all \(visible.count) songs")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjAmber)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 13)
                }
            }
        }
    }
}

// MARK: - Discovery album card

private struct DiscoveryAlbumCard: View {
    let release: Release
    var onAdd: (() -> Void)? = nil
    var isRated: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .bottomTrailing) {
                CoverImage(url: release.coverUrl)
                    .frame(width: 128, height: 128)

                if isRated {
                    ZStack {
                        Circle()
                            .fill(Color.sjBlue)
                            .frame(width: 28, height: 28)
                            .shadow(color: .black.opacity(0.15), radius: 4, y: 1)
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .allowsHitTesting(false)
                    .padding(6)
                } else if let onAdd {
                    Button(action: onAdd) {
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
                    .padding(6)
                }
            }

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
    var isRated: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: song.releases.coverUrl, cornerRadius: 6)
                .frame(width: 44, height: 44)

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

            if isRated {
                ZStack {
                    Circle()
                        .fill(Color.sjBlue)
                        .frame(width: 30, height: 30)
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(.white)
                }
                .allowsHitTesting(false)
            } else if let onAdd {
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
}

private struct ArtistSong: Identifiable {
    let id: UUID
    let title: String
    let albumId: UUID?
    let albumTitle: String
    let albumCoverUrl: String?
}

struct ArtistPageView: View {
    let artist: ArtistDestination

    @State private var releases:       [Release]     = []
    @State private var songs:          [ArtistSong]  = []
    @State private var communityAvg:   Double?        = nil
    @State private var communityCount: Int            = 0
    @State private var releaseScores:    [UUID: Double]        = [:]
    @State private var releaseCounts:   [UUID: Int]           = [:]
    @State private var myRatings:       [UUID: Double]        = [:]
    @State private var allRatingScores: [Double]              = []
    @State private var communityFeed:   [CommunityRating]     = []
    @State private var selectedTab      = 0
    @State private var isLoading        = true

    private struct CommunityRating: Codable, Identifiable {
        let id: UUID
        let userId: UUID
        let releaseGroupId: UUID
        let score: Double?
        let eloScore: Double?
        let createdAt: Date
        let profiles: CRProfile?
        struct CRProfile: Codable {
            let username: String?; let displayName: String?
            enum CodingKeys: String, CodingKey { case username; case displayName = "display_name" }
            var handle: String { username ?? displayName ?? "someone" }
            var initial: String { String((username ?? displayName ?? "?").prefix(1)).uppercased() }
        }
        enum CodingKeys: String, CodingKey {
            case id; case userId = "user_id"; case releaseGroupId = "release_group_id"
            case score; case eloScore = "elo_score"; case createdAt = "created_at"; case profiles
        }
        var displayScore: Double? {
            if let s = score { return s }
            if let e = eloScore { return Elo.toScore(e) }
            return nil
        }
    }

    private let tabLabels = ["Albums", "Songs", "Community", "Stats"]

    private var myRatedCount: Int { myRatings.values.filter { $0 > 0 }.count }
    private var myAvg: Double? {
        let scores = myRatings.values.filter { $0 > 0 }
        guard !scores.isEmpty else { return nil }
        return scores.reduce(0, +) / Double(scores.count)
    }

    var body: some View {
        VStack(spacing: 0) {
            // ── Header ──────────────────────────────────────
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Artist")
                        .font(.system(size: 10, weight: .semibold))
                        .tracking(1.4)
                        .foregroundStyle(Color.sjMuted)
                    Text(artist.name)
                        .font(.system(size: 28, weight: .heavy))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(2)
                        .minimumScaleFactor(0.75)
                }
                .padding(.horizontal, 18)
                .padding(.top, 16)
                .padding(.bottom, 14)

                HStack(spacing: 0) {
                    artistStat(value: communityAvg.map { String(format: "%.1f", $0) } ?? "—",
                               label: "community avg")
                    Divider().frame(height: 28)
                    artistStat(value: "\(communityCount)", label: "ratings")
                    Divider().frame(height: 28)
                    artistStat(value: "\(releases.count)", label: "releases")
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 14)

                if myRatedCount > 0, let avg = myAvg {
                    HStack(spacing: 6) {
                        Text("You")
                            .font(.system(size: 10, weight: .semibold))
                            .tracking(0.5)
                            .foregroundStyle(Color.sjMuted)
                        Text("\(myRatedCount) rated · \(String(format: "%.1f", avg)) avg")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Color.sjAmber.opacity(0.12))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.sjAmber.opacity(0.4), lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .padding(.horizontal, 18).padding(.bottom, 12)
                }
            }

            // ── Tab bar ──────────────────────────────────────
            HStack(spacing: 0) {
                ForEach(tabLabels.indices, id: \.self) { i in
                    Button { selectedTab = i } label: {
                        Text(tabLabels[i])
                            .font(.system(size: 11, weight: selectedTab == i ? .bold : .medium))
                            .foregroundStyle(selectedTab == i ? Color.sjInk : Color.sjMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 9)
                            .overlay(alignment: .bottom) {
                                if selectedTab == i {
                                    Rectangle().frame(height: 2).foregroundStyle(Color.sjInk)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                }
            }
            .overlay(alignment: .bottom) { Divider() }

            // ── Swipeable content ────────────────────────────
            if isLoading {
                Spacer()
                ProgressView()
                Spacer()
            } else {
                TabView(selection: $selectedTab) {
                    // Albums
                    ScrollView(showsIndicators: false) {
                        LazyVStack(spacing: 0) {
                            if releases.isEmpty {
                                Text("No releases in the catalogue yet.")
                                    .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                                    .frame(maxWidth: .infinity).padding(.top, 40)
                            } else {
                                ForEach(Array(releases.enumerated()), id: \.element.id) { idx, release in
                                    ArtistReleaseRow(release: release,
                                                     communityScore: releaseScores[release.id],
                                                     userScore: myRatings[release.id])
                                    if idx < releases.count - 1 {
                                        Divider().padding(.leading, 68).foregroundStyle(Color.sjBorder)
                                    }
                                }
                            }
                        }
                    }
                    .tag(0)

                    // Songs
                    ScrollView(showsIndicators: false) {
                        LazyVStack(spacing: 0) {
                            if songs.isEmpty {
                                Text("No songs in the catalogue yet.")
                                    .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                                    .frame(maxWidth: .infinity).padding(.top, 40)
                            } else {
                                ForEach(Array(songs.enumerated()), id: \.element.id) { idx, song in
                                    ArtistSongRow(song: song)
                                    if idx < songs.count - 1 {
                                        Divider().padding(.leading, 68).foregroundStyle(Color.sjBorder)
                                    }
                                }
                            }
                        }
                    }
                    .tag(1)

                    // Community
                    communityTab.tag(2)

                    // Stats
                    statsTab.tag(3)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(artist.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
        .task { await load() }
    }

    @ViewBuilder
    private func artistStat(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: 22, weight: .heavy)).foregroundStyle(Color.sjInk)
            Text(label).font(.system(size: 10)).foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func load() async {
        let escaped = artist.name.replacingOccurrences(of: "'", with: "''")
        var loaded: [Release] = (try? await supabase
            .from("release_groups")
            .select("id, title, artist_display, cover_url, release_group_type, first_release_date, native_title")
            .ilike("artist_display", value: escaped)
            .order("first_release_date", ascending: false, nullsFirst: false)
            .limit(60)
            .execute()
            .value) ?? []

        if loaded.isEmpty { loaded = await fetchFromWebSearch() }
        releases = loaded

        let releaseGroupIds = loaded.map(\.id.uuidString)
        guard !releaseGroupIds.isEmpty else { isLoading = false; return }

        struct RRow: Codable {
            let releaseGroupId: UUID; let userId: UUID; let score: Double?
            enum CodingKeys: String, CodingKey {
                case releaseGroupId = "release_group_id"; case userId = "user_id"; case score
            }
        }
        async let rowsFetch: [RRow] = (try? await supabase
            .from("ratings").select("release_group_id, user_id, score")
            .in("release_group_id", values: releaseGroupIds).execute().value) ?? []
        async let songsFetch: Void = loadSongs()

        let rows = await rowsFetch
        await songsFetch

        let currentUserId = supabase.auth.currentUser?.id
        var sumMap: [UUID: (sum: Double, count: Int)] = [:]
        var myMap:  [UUID: Double] = [:]
        for r in rows {
            if let s = r.score {
                let e = sumMap[r.releaseGroupId] ?? (0, 0)
                sumMap[r.releaseGroupId] = (e.sum + s, e.count + 1)
                if r.userId == currentUserId { myMap[r.releaseGroupId] = s }
            }
        }
        releaseScores    = sumMap.mapValues { $0.sum / Double($0.count) }
        releaseCounts   = sumMap.mapValues { $0.count }
        myRatings       = myMap
        let allScores   = rows.compactMap(\.score)
        allRatingScores = allScores
        communityCount  = rows.count  // all ratings, including instinct (score may be nil)
        communityAvg    = allScores.isEmpty ? nil : allScores.reduce(0, +) / Double(allScores.count)
        isLoading       = false

        await loadCommunityFeed(releaseGroupIds: releaseGroupIds)
    }

    private func loadCommunityFeed(releaseGroupIds: [String]) async {
        struct CFRow: Codable {
            let id: UUID; let userId: UUID; let releaseGroupId: UUID
            let score: Double?; let eloScore: Double?; let createdAt: Date
            enum CodingKeys: String, CodingKey {
                case id; case userId = "user_id"; case releaseGroupId = "release_group_id"
                case score; case eloScore = "elo_score"; case createdAt = "created_at"
            }
        }
        let cfRows: [CFRow] = (try? await supabase
            .from("ratings").select("id, user_id, release_group_id, score, elo_score, created_at")
            .in("release_group_id", values: releaseGroupIds)
            .order("created_at", ascending: false)
            .limit(60)
            .execute().value) ?? []
        guard !cfRows.isEmpty else { return }

        struct ProfileRow: Codable {
            let id: UUID; let username: String?; let displayName: String?
            enum CodingKeys: String, CodingKey { case id, username; case displayName = "display_name" }
        }
        let userIds = Array(Set(cfRows.map(\.userId.uuidString)))
        let profiles: [ProfileRow] = (try? await supabase
            .from("profiles").select("id, username, display_name")
            .in("id", values: userIds).execute().value) ?? []
        let pMap = Dictionary(uniqueKeysWithValues: profiles.map { ($0.id, $0) })

        communityFeed = cfRows.map { row in
            let p = pMap[row.userId]
            return CommunityRating(
                id: row.id, userId: row.userId, releaseGroupId: row.releaseGroupId,
                score: row.score, eloScore: row.eloScore, createdAt: row.createdAt,
                profiles: p.map { CommunityRating.CRProfile(username: $0.username, displayName: $0.displayName) }
            )
        }
    }

    private func loadSongs() async {
        struct RecHit: Codable { let id: UUID; let title: String }
        let hits: [RecHit] = (try? await supabase
            .from("recordings").select("id, title")
            .ilike("artist_display", value: artist.name)
            .order("title").limit(200).execute().value) ?? []
        guard !hits.isEmpty else { return }

        struct RTRow: Codable {
            let recordingId: UUID; let releases: RelRow?
            struct RelRow: Codable {
                let isCanonical: Bool?; let releaseGroups: RGInfo?
                struct RGInfo: Codable {
                    let id: UUID; let title: String; let coverUrl: String?
                    enum CodingKeys: String, CodingKey { case id, title; case coverUrl = "cover_url" }
                }
                enum CodingKeys: String, CodingKey {
                    case isCanonical = "is_canonical"; case releaseGroups = "release_groups"
                }
            }
            enum CodingKeys: String, CodingKey { case recordingId = "recording_id"; case releases }
        }
        let rtRows: [RTRow] = (try? await supabase
            .from("release_tracks")
            .select("recording_id, releases(is_canonical, release_groups(id, title, cover_url))")
            .in("recording_id", values: hits.map(\.id.uuidString)).execute().value) ?? []

        var rgMap: [UUID: RTRow.RelRow.RGInfo] = [:]
        for row in rtRows {
            guard let rg = row.releases?.releaseGroups else { continue }
            if row.releases?.isCanonical == true || rgMap[row.recordingId] == nil { rgMap[row.recordingId] = rg }
        }
        songs = hits.compactMap { hit in
            let rg = rgMap[hit.id]
            return ArtistSong(id: hit.id, title: hit.title,
                              albumId: rg?.id, albumTitle: rg?.title ?? "",
                              albumCoverUrl: rg?.coverUrl)
        }
    }

    // MARK: - Community tab

    @ViewBuilder
    private var communityTab: some View {
        if communityFeed.isEmpty {
            Text("No community ratings yet.")
                .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                .frame(maxWidth: .infinity).padding(.top, 40)
        } else {
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(communityFeed) { entry in
                        communityRow(entry)
                        Divider().padding(.leading, 54)
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    private func communityRow(_ entry: CommunityRating) -> some View {
        let release = releases.first { $0.id == entry.releaseGroupId }
        return HStack(spacing: 10) {
            // Avatar circle
            ZStack {
                Circle().fill(Color.sjAmber.opacity(0.15)).frame(width: 36, height: 36)
                Text(entry.profiles?.initial ?? "?")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.sjAmber)
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text("@\(entry.profiles?.handle ?? "someone")")
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.sjInk)
                    Text("·").foregroundStyle(Color.sjBorder)
                    Text(entry.createdAt.relativeTimeString)
                        .font(.system(size: 11)).foregroundStyle(Color.sjMuted)
                }
                if let r = release {
                    Text(r.displayTitle)
                        .font(.system(size: 12)).foregroundStyle(Color.sjMuted).lineLimit(1)
                }
            }
            Spacer()
            if let score = entry.displayScore {
                HStack(spacing: 3) {
                    Image("icon-flower")
                        .renderingMode(.template).resizable().scaledToFit()
                        .frame(width: 10, height: 10).foregroundStyle(Color.sjAmber)
                    Text(score.truncatingRemainder(dividingBy: 1) == 0
                         ? "\(Int(score))" : String(format: "%.1f", score))
                        .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.sjAmber)
                }
            }
            if let r = release {
                CoverImage(url: r.coverUrl, cornerRadius: 6).frame(width: 36, height: 36)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Stats tab

    @ViewBuilder
    private var statsTab: some View {
        if allRatingScores.isEmpty && myRatings.isEmpty {
            Text("No ratings yet.")
                .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                .frame(maxWidth: .infinity).padding(.top, 40)
        } else {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 20) {
                    if !allRatingScores.isEmpty {
                        statsSectionView("Score Distribution") { distributionChart }
                        statsSectionView("Top Releases") { topReleasesView }
                    }
                    if !myRatings.isEmpty {
                        statsSectionView("Your Coverage") { coverageView }
                    }
                    if typeStats.count > 1 {
                        statsSectionView("By Release Type") { typeBreakdownView }
                    }
                }
                .padding(18)
            }
        }
    }

    private func statsSectionView(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .tracking(0.8)
            content()
        }
    }

    // Horizontal bar chart — one row per 0.5-point bucket
    private var distributionChart: some View {
        let bins = scoreBins
        let maxCount = bins.map(\.count).max() ?? 1
        return VStack(alignment: .leading, spacing: 5) {
            ForEach(bins, id: \.label) { bin in
                HStack(spacing: 8) {
                    Text(bin.label)
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(Color.sjMuted)
                        .frame(width: 26, alignment: .trailing)
                    GeometryReader { geo in
                        RoundedRectangle(cornerRadius: 3)
                            .fill(Color.sjAmber.opacity(0.75))
                            .frame(width: geo.size.width * CGFloat(bin.count) / CGFloat(maxCount))
                    }
                    .frame(height: 14)
                    Text("\(bin.count)")
                        .font(.system(size: 11)).foregroundStyle(Color.sjMuted)
                }
            }
        }
    }

    private var scoreBins: [(label: String, count: Int)] {
        var bins: [Int: Int] = [:]
        for s in allRatingScores {
            let key = Int((s * 2).rounded())  // e.g. 4.5 → 9, 5.0 → 10
            bins[key, default: 0] += 1
        }
        return stride(from: 10, through: 1, by: -1).compactMap { key in
            guard let count = bins[key], count > 0 else { return nil }
            let val = Double(key) / 2.0
            let label = val.truncatingRemainder(dividingBy: 1) == 0
                ? "\(Int(val))" : String(format: "%.1f", val)
            return (label, count)
        }
    }

    // Top 3 releases by community avg (min 1 rating)
    private var topReleasesView: some View {
        let top = releases
            .compactMap { r -> (Release, Double, Int)? in
                guard let s = releaseScores[r.id], let c = releaseCounts[r.id] else { return nil }
                return (r, s, c)
            }
            .sorted { $0.1 > $1.1 }
            .prefix(3)
        return VStack(spacing: 0) {
            ForEach(Array(top.enumerated()), id: \.element.0.id) { idx, item in
                let (release, score, count) = item
                NavigationLink(value: release) {
                    HStack(spacing: 10) {
                        Text("#\(idx + 1)")
                            .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.sjMuted)
                            .frame(width: 20)
                        CoverImage(url: release.coverUrl, cornerRadius: 5)
                            .frame(width: 36, height: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(release.displayTitle)
                                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.sjInk).lineLimit(1)
                            Text("\(count) rating\(count == 1 ? "" : "s")")
                                .font(.system(size: 10)).foregroundStyle(Color.sjMuted)
                        }
                        Spacer()
                        HStack(spacing: 3) {
                            Image("icon-flower")
                                .renderingMode(.template).resizable().scaledToFit()
                                .frame(width: 10, height: 10).foregroundStyle(Color.sjAmber)
                            Text(String(format: "%.1f", score))
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.sjAmber)
                        }
                    }
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                if idx < top.count - 1 { Divider() }
            }
        }
    }

    // Your coverage stats
    private var coverageView: some View {
        let rated  = myRatings.values.filter { $0 > 0 }.count
        let total  = releases.count
        let myAvgV = myRatings.values.filter { $0 > 0 }.reduce(0, +) / Double(max(1, rated))
        let pct    = total > 0 ? Int(Double(rated) / Double(total) * 100) : 0
        return HStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(rated)/\(total)").font(.system(size: 20, weight: .heavy)).foregroundStyle(Color.sjInk)
                Text("releases rated").font(.system(size: 10)).foregroundStyle(Color.sjMuted)
            }
            if rated > 0 {
                Divider().frame(height: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(String(format: "%.1f", myAvgV)).font(.system(size: 20, weight: .heavy)).foregroundStyle(Color.sjInk)
                    Text("your avg").font(.system(size: 10)).foregroundStyle(Color.sjMuted)
                }
                if let cAvg = communityAvg {
                    Divider().frame(height: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        let diff = myAvgV - cAvg
                        Text((diff >= 0 ? "+" : "") + String(format: "%.1f", diff))
                            .font(.system(size: 20, weight: .heavy))
                            .foregroundStyle(diff >= 0 ? Color.sjBlue : Color.sjMuted)
                        Text("vs community").font(.system(size: 10)).foregroundStyle(Color.sjMuted)
                    }
                }
            }
            Spacer()
        }
    }

    // Per release-type breakdown
    private var typeStats: [(type: String, avg: Double, count: Int)] {
        var map: [String: (sum: Double, count: Int)] = [:]
        for r in releases {
            guard let t = r.releaseType, let s = releaseScores[r.id] else { continue }
            let e = map[t] ?? (0, 0)
            map[t] = (e.sum + s, e.count + 1)
        }
        return map.map { key, val in
            let label = key.lowercased() == "ep" ? "EP" : key.capitalized
            return (label, val.sum / Double(val.count), val.count)
        }.sorted { $0.count > $1.count }
    }

    private var typeBreakdownView: some View {
        VStack(spacing: 8) {
            ForEach(typeStats, id: \.type) { stat in
                HStack {
                    Text(stat.type)
                        .font(.system(size: 12, weight: .medium)).foregroundStyle(Color.sjInk)
                    Text("(\(stat.count))")
                        .font(.system(size: 11)).foregroundStyle(Color.sjMuted)
                    Spacer()
                    HStack(spacing: 3) {
                        Image("icon-flower")
                            .renderingMode(.template).resizable().scaledToFit()
                            .frame(width: 10, height: 10).foregroundStyle(Color.sjAmber)
                        Text(String(format: "%.1f", stat.avg))
                            .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.sjAmber)
                    }
                }
            }
        }
    }

    private func fetchFromWebSearch() async -> [Release] {
        var comps = URLComponents(url: Config.webBaseURL.appendingPathComponent("api/search"),
                                  resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "query", value: artist.name),
                            URLQueryItem(name: "type", value: "releases")]
        guard let url = comps.url,
              let (data, _) = try? await URLSession.shared.data(from: url) else { return [] }
        struct SearchResponse: Decodable { let releases: [Release] }
        guard let resp = try? JSONDecoder().decode(SearchResponse.self, from: data) else { return [] }
        return resp.releases.filter { $0.artist.lowercased() == artist.name.lowercased() }
    }
}

private struct ArtistSongRow: View {
    let song: ArtistSong

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: song.albumCoverUrl, cornerRadius: 6)
                .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 3) {
                Text(song.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sjInk).lineLimit(1)
                Text(song.albumTitle)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.sjMuted).lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .contentShape(Rectangle())
    }
}

private struct ArtistReleaseRow: View {
    let release:        Release
    let communityScore: Double?
    let userScore:      Double?

    private var year: String? {
        guard let d = release.releaseDate, d.count >= 4 else { return nil }
        return String(d.prefix(4))
    }

    var body: some View {
        NavigationLink(value: release) {
            HStack(spacing: 12) {
                CoverImage(url: release.coverUrl, cornerRadius: 6)
                    .frame(width: 44, height: 44)

                VStack(alignment: .leading, spacing: 3) {
                    Text(release.displayTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjInk).lineLimit(1)
                    HStack(spacing: 3) {
                        if let t = release.releaseType {
                            Text(t.lowercased() == "ep" ? "EP" : t.capitalized)
                        }
                        if let y = year { Text("·"); Text(y) }
                    }
                    .font(.system(size: 11)).foregroundStyle(Color.sjMuted)
                }

                Spacer()

                if let s = userScore {
                    flowerScore(s, color: Color.sjBlue)
                } else if let s = communityScore {
                    flowerScore(s, color: Color.sjAmber)
                } else {
                    ZStack {
                        Circle().stroke(Color.sjBorder, lineWidth: 1.5).frame(width: 24, height: 24)
                        Image(systemName: "plus").font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                    }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func flowerScore(_ score: Double, color: Color) -> some View {
        HStack(spacing: 4) {
            Image("icon-flower")
                .renderingMode(.template).resizable().scaledToFit()
                .frame(width: 11, height: 11).foregroundStyle(color)
            Text(String(format: "%.1f", score))
                .font(.system(size: 12, weight: .bold)).foregroundStyle(color)
        }
    }
}


#Preview {
    SearchView(discoveryVM: DiscoveryViewModel())
}
