import SwiftUI
import Observation
import Supabase
import MusicKit

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

    // Apple Music-sourced (Apple Sign In users)
    var appleMusicArtists: [AppleMusicArtistDisplay] = []
    var appleMusicRecentlyPlayed: [AppleMusicAlbumDisplay] = []
    var appleMusicLibraryAlbums: [AppleMusicAlbumDisplay] = []
    var hasAppleMusicData = false

    // DB-personalized (based on user's ratings)
    var personalizedAlbums: [Release] = []
    var personalizedSongs:  [SongResult] = []
    var hasPersonalized = false

    // Artists behind ratings >= 3.5, ordered best-first -- the in-app signal QuickAddViewModel
    // supplements Spotify/Apple Music with. Populated alongside personalizedAlbums in
    // loadPersonalized() since it's derived from the same ratedReleases query.
    var ratedArtists: [String] = []

    // High-confidence taste recommendations (artists user rated 4+)
    var tasteAlbums: [Release] = []

    // Trending on the platform (most-rated recent releases)
    var trendingAlbums: [Release] = []

    // General popular
    var popularAlbums: [Release] = []
    var popularSongs:  [SongResult] = []

    var isLoading = true
    var needsSpotifyReconnect = false  // no cached data AND token is gone
    private var hasLoaded = false

    func load() async {
        if !hasLoaded {
            hasLoaded = true
            // Load music service data in parallel, then personalized (needs artist seeds from both)
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await self.loadSpotify() }
                g.addTask { await self.loadAppleMusic() }
            }
            await reloadDiscoverySections()
        } else {
            // Retried on every subsequent load() call (e.g. switching back to this tab) --
            // unlike the full first-load branch above, this only re-attempts whichever
            // service still has nothing, so a user who connects mid-session picks it up
            // without needing a full app relaunch.
            if !hasSpotifyData { await loadSpotify() }
            if !hasAppleMusicData { await loadAppleMusic() }
        }
        isLoading = false
        prefetchDiscoveryCovers()
    }

    // Pull-to-refresh on the Add tab -- load() only runs the personalized/popular/taste/trending
    // batch once per app launch (by design, so switching tabs never re-triggers a reload), which
    // means the section otherwise never changes for the rest of the session. This re-runs that
    // same batch on demand.
    func refresh() async {
        await reloadDiscoverySections()
        prefetchDiscoveryCovers()
    }

    private func reloadDiscoverySections() async {
        await withTaskGroup(of: Void.self) { g in
            g.addTask { await self.loadPopular() }
            g.addTask { await self.loadPersonalized() }
            g.addTask { await self.loadTasteAlbums() }
            g.addTask { await self.loadTrending() }
        }
    }

    private func prefetchDiscoveryCovers() {
        // Kick off background downloads for all album art so covers are ready before the user scrolls
        let prefetchUrls = (personalizedAlbums + trendingAlbums + popularAlbums + tasteAlbums)
            .compactMap { URL(string: $0.coverUrl?.thumbnailUrl ?? "") }
        ImageCache.prefetch(prefetchUrls)
    }

    private func loadAppleMusic() async {
        guard MusicKitService.isAuthorized else { return }
        async let artists = MusicKitService.fetchLibraryArtists(limit: 20)
        async let recent  = MusicKitService.fetchRecentlyPlayedAlbums(limit: 20)
        async let library = MusicKitService.fetchLibraryAlbums(limit: 25)
        let (a, r, l) = await (artists, recent, library)
        appleMusicArtists         = a
        appleMusicRecentlyPlayed  = r
        appleMusicLibraryAlbums   = l
        hasAppleMusicData = !a.isEmpty || !r.isEmpty || !l.isEmpty
    }

    private func loadSpotify() async {
        // If this account has never linked Spotify, any cached data belongs to a previous
        // account on this device — clear it and bail out immediately. Checks the FULL
        // "providers" identity list, not just the singular "provider" field (the account's
        // original signup method) — a multi-identity account that signed up via email/Google
        // and linked Spotify afterward always reports provider == "email"/"google", never
        // "spotify", even right after a fresh Spotify sign-in (confirmed live: this silently
        // wiped a real, working Spotify connection's cached data on every single load).
        let providers = supabase.auth.currentUser?.appMetadata["providers"]
        var linkedSpotify = false
        if case .array(let list) = providers {
            linkedSpotify = list.contains(.string("spotify"))
        }
        if !linkedSpotify {
            SpotifyService.clearCache()
            needsSpotifyReconnect = false
            return
        }

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

        // Primary seeds: artist_display values from ratings the user actually liked
        // (score/elo >= 3.5) -- previously every rating counted equally regardless of score,
        // so an album rated 1 star seeded "For You" just as strongly as one rated 5 stars.
        struct RatedRelease: Codable {
            let score: Double?
            let eloScore: Double?
            let releaseGroups: ArtistOnly
            struct ArtistOnly: Codable {
                let artist: String
                enum CodingKeys: String, CodingKey { case artist = "artist_display" }
            }
            enum CodingKeys: String, CodingKey {
                case score; case eloScore = "elo_score"; case releaseGroups = "release_groups"
            }
        }
        let ratedReleases: [RatedRelease] = (try? await supabase
            .from("ratings")
            .select("score, elo_score, release_groups(artist_display)")
            .eq("user_id", value: userId)
            .limit(200)
            .execute()
            .value) ?? []
        for r in ratedReleases {
            let display = r.score ?? r.eloScore.map(Elo.toScore)
            if let d = display, d >= 3.5 { dbArtists.insert(r.releaseGroups.artist) }
        }
        var seenRatedArtists = Set<String>()
        ratedArtists = ratedReleases
            .compactMap { r -> (String, Double)? in
                guard let d = r.score ?? r.eloScore.map(Elo.toScore), d >= 3.5 else { return nil }
                return (r.releaseGroups.artist, d)
            }
            .sorted { $0.1 > $1.1 }
            .map(\.0)
            .filter { seenRatedArtists.insert($0).inserted }

        // Supplement with Spotify artists when available -- independent listening signal
        // (not a rating), so no score filter applies here; filtering it would hurt cold-start
        // users who have real streaming history but haven't rated much yet.
        for a in spotifyArtists { dbArtists.insert(a.name) }
        for a in recentlyPlayed  { dbArtists.insert(a.artistName) }

        // Supplement with Apple Music library when available.
        for a in appleMusicArtists        { dbArtists.insert(a.name) }
        for a in appleMusicRecentlyPlayed { dbArtists.insert(a.artistName) }
        for a in appleMusicLibraryAlbums  { dbArtists.insert(a.artistName) }

        // Exploit slice: more albums by artists already in the seed set, capped per artist
        // (matches loadTasteAlbums()'s existing anti-flood cap -- this section had none before).
        var exploit: [Release] = []
        if !dbArtists.isEmpty {
            let seeds = Array(dbArtists.prefix(50))
            let raw: [Release] = (try? await supabase
                .from("release_groups")
                .select("id, title, artist_display, cover_url, native_title, release_group_type, first_release_date")
                .not("cover_url", operator: .is, value: AnyJSON.null)
                .in("release_group_type", values: ["album", "ep"])
                .in("artist_display", values: seeds)
                .order("first_release_date", ascending: false, nullsFirst: false)
                .limit(120)
                .execute()
                .value) ?? []
            var countPerArtist: [String: Int] = [:]
            for album in raw {
                let n = countPerArtist[album.displayArtist, default: 0]
                if n < 3 { exploit.append(album); countPerArtist[album.displayArtist] = n + 1 }
            }
        }

        // Explore slice: content-based discovery via release_groups.embedding -- surfaces new
        // artists musically similar to the user's own highest-rated albums, instead of only
        // ever resurfacing artists already in the user's history. Seeded independently (its own
        // small top-rated lookup) rather than reusing loadTasteAlbums()'s pool, so both loaders
        // can still run fully concurrently in the outer TaskGroup.
        var explore: [Release] = []
        struct TopRated: Codable {
            let releaseGroupId: UUID; let score: Double?; let eloScore: Double?
            let releaseGroups: ArtistOnly
            struct ArtistOnly: Codable {
                let artist: String
                enum CodingKeys: String, CodingKey { case artist = "artist_display" }
            }
            enum CodingKeys: String, CodingKey {
                case releaseGroupId = "release_group_id"; case score; case eloScore = "elo_score"
                case releaseGroups = "release_groups"
            }
        }
        let topRatedRows: [TopRated] = (try? await supabase
            .from("ratings")
            .select("release_group_id, score, elo_score, release_groups(artist_display)")
            .eq("user_id", value: userId)
            .limit(200)
            .execute()
            .value) ?? []
        // Capped at 3, not 5 -- confirmed live that RPC cost scales with seed count more than
        // with p_per_seed's final LIMIT: 4 seeds completed in ~3.3s, 5 reliably hit the
        // statement timeout. Deduped by artist first so e.g. three 5-star NewJeans albums don't
        // burn all 3 seed slots on one artist, leaving no room for genre diversity in the query.
        var seenArtists = Set<String>()
        let seedIds: [UUID] = topRatedRows
            .compactMap { row -> (UUID, String, Double)? in
                guard let d = row.score ?? row.eloScore.map(Elo.toScore), d >= 4.0 else { return nil }
                return (row.releaseGroupId, row.releaseGroups.artist, d)
            }
            .sorted { $0.2 > $1.2 }
            .filter { seenArtists.insert($0.1).inserted }
            .prefix(3)
            .map(\.0)

        if !seedIds.isEmpty {
            struct SimilarReleasesParams: Encodable {
                let p_seed_ids: [String]
                let p_exclude_artists: [String]?
            }
            explore = (try? await supabase
                .rpc("get_taste_similar_releases", params: SimilarReleasesParams(
                    p_seed_ids: seedIds.map(\.uuidString),
                    p_exclude_artists: dbArtists.isEmpty ? nil : Array(dbArtists)))
                .execute()
                .value) ?? []
        }

        var combined = exploit + explore
        var seen = Set<UUID>()
        combined = combined.filter { seen.insert($0.id).inserted }
        personalizedAlbums = Array(combined.shuffled().prefix(60))

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

struct SearchArtist: Codable, Identifiable {
    let id: UUID
    let name: String
    let nameNative: String?
    let coverUrl: String?
    let releaseCount: Int
    // Romanization aliases (e.g. "HYUKOH" for the Hangul-named 혁오). search_artists matches on
    // these but its canonical `name` may be native-script, so the resolve gate checks them too.
    let aliases: [String]?
    enum CodingKeys: String, CodingKey {
        case id; case name; case nameNative = "name_native"
        case coverUrl = "cover_url"; case releaseCount = "release_count"
        case aliases
    }

    // name_native is mixed-provenance (some rows hold a non-Korean transliteration instead
    // of the artist's real Korean name) — only trust it when it's actually Hangul.
    var displayNativeName: String? {
        guard let nameNative, nameNative.isPredominantlyHangul else { return nil }
        return nameNative
    }
}

// RPC param payloads. supabase-swift's `params:` takes `some Encodable`, so a heterogeneous
// dictionary literal (["q": q, "lim": 30] — String + Int) doesn't type-check; use a struct.
private struct SearchParams: Encodable { let q: String; let lim: Int }
// Telemetry row logged when a search returns nothing — feeds the MB-gap recovery signal
// (the pipeline recovers repeatedly-missed, truly-absent artists from Deezer).
private struct SearchMiss: Encodable { let query: String; let type: String; let db_count: Int }
private struct ArtistReleasesParams: Encodable { let p_artist_id: String; let lim: Int }

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

        // The three lookups used to run sequentially (album → songs →
        // artists), so a slow song lookup delayed album/artist results too
        // even though those are fast on their own -- measured live against
        // the catalog, most real search terms ("drake", "seoul", "jimin")
        // make the song step alone take 3+ seconds or time out outright,
        // since (unlike album/artist search) it has no dedicated search RPC,
        // just a raw ILIKE scan over ~2.3M recordings. Running all three
        // concurrently means total latency is bounded by the slowest one,
        // not their sum.
        async let albumsTask: [Release] = (try? await supabase
            .rpc("search_release_groups", params: SearchParams(q: q, lim: 30))
            .execute()
            .value) ?? []
        async let songsTask = fetchSongResults(q)
        async let artistsTask: [SearchArtist] = (try? await supabase
            .rpc("search_artists", params: SearchParams(q: q, lim: 10))
            .execute()
            .value) ?? []

        (albumResults, songResults, artistResults) = await (albumsTask, songsTask, artistsTask)

        // When the catalog returns NOTHING for a real query, log a search miss. This is the
        // demand signal that drives MB-gap recovery: the pipeline recovers an artist from Deezer
        // once the same truly-absent (db_count 0) query has been searched enough times and it
        // exact-matches a real Deezer artist. Fire-and-forget telemetry; failure is harmless.
        if albumResults.isEmpty && artistResults.isEmpty && songResults.isEmpty {
            let missQuery = q.lowercased()
            Task { try? await supabase.from("search_misses")
                .insert(SearchMiss(query: missQuery, type: "ios_search", db_count: 0))
                .execute() }
        }
    }

    // Raced against a timeout below -- this step alone has no dedicated
    // search RPC yet (unlike albums/artists) and is the one that measured
    // as unreliably slow; capping it keeps one bad song lookup from making
    // the whole search feel hung even after album/artist results are back.
    private func fetchSongResults(_ q: String) async -> [SongResult] {
        await withTaskGroup(of: [SongResult]?.self) { group in
            group.addTask { await self.fetchSongResultsRaw(q) }
            group.addTask {
                try? await Task.sleep(for: .seconds(2))
                return nil
            }
            let winner = (await group.next() ?? nil) ?? []
            group.cancelAll()
            return winner
        }
    }

    private func fetchSongResultsRaw(_ q: String) async -> [SongResult] {
        // Step 1 — match recordings by title
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

        guard !hits.isEmpty else { return [] }

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
        return hits.compactMap { hit in
            guard let rg = rgMap[hit.id] else { return nil }
            return SongResult(id: hit.id, title: hit.title, artists: hit.artistDisplay,
                              releases: SongResult.SongRelease(
                                  id: rg.id, title: rg.title,
                                  artist: rg.artistDisplay ?? "", coverUrl: rg.coverUrl))
        }
    }
}

// MARK: - View

struct SearchView: View {
    let discoveryVM: DiscoveryViewModel
    let onGoToSettings: () -> Void
    @State private var showQuickAdd          = false
    @State private var showQuickAddModeGate  = false
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
    @State private var recentlyPlayedNavTarget: Release?
    @State private var spotifyArtistNavTarget: ArtistDestination?
    @State private var showNotInCatalog = false
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
            // Reset the item binding to nil when its pushed destination disappears -- confirmed
            // live that a stale (still non-nil) item binding gets spuriously re-presented on top
            // of a later, unrelated push made from further inside that same destination (e.g.
            // tapping the artist name on an album opened via this row double-pushed the album
            // again on top of the artist page). Clearing it once actually popped prevents that.
            .navigationDestination(item: $recentlyPlayedNavTarget) { release in
                AlbumDetailView(release: release)
                    .onDisappear { if recentlyPlayedNavTarget == release { recentlyPlayedNavTarget = nil } }
            }
            .navigationDestination(item: $spotifyArtistNavTarget) { artist in
                ArtistPageView(artist: artist)
                    .onDisappear { if spotifyArtistNavTarget == artist { spotifyArtistNavTarget = nil } }
            }
            .alert("Not in catalog", isPresented: $showNotInCatalog) {
                Button("OK") {}
            } message: {
                Text("This album isn't in sillajuku's catalog yet.")
            }
            .alert("Switch to Manual mode", isPresented: $showQuickAddModeGate) {
                Button("Cancel", role: .cancel) {}
                Button("Go to Settings") { onGoToSettings() }
            } message: {
                Text("Quick Add's half-star rating only works in Manual mode. Switch modes in Settings to use it.")
            }
            .navigationDestination(isPresented: $showQuickAdd) {
                QuickAddView(discoveryVM: discoveryVM)
            }
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

    private func quickAddTapped() {
        Task {
            let mode = await AlbumQuickRate.currentUserRatingMode()
            if mode == "instinct" {
                showQuickAddModeGate = true
            } else {
                showQuickAdd = true
            }
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
                .accessibilityLabel(String(localized: "Clear search"))
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
            // Always render something here, even for a too-short query (no
            // search has run yet) -- an empty branch collapses this whole
            // screen's content to just the search bar + divider, which
            // SwiftUI then centers vertically instead of pinning to the top
            // (the "search bar floating in blank space" bug).
            VStack(spacing: 14) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 44))
                    .foregroundStyle(Color.sjBorder)
                if searchVM.query.trimmingCharacters(in: .whitespaces).count >= 2 {
                    Text(String(format: String(localized: "No results for \"%@\""), searchVM.query))
                        .font(.system(size: 15))
                        .foregroundStyle(Color.sjMuted)
                } else {
                    Text("Keep typing to search…")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.sjMuted)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {

                    // ── Artists ───────────────────────────────
                    if hasArtists {
                        sectionLabel("Artists")
                        VStack(spacing: 0) {
                            ForEach(searchVM.artistResults) { artist in
                                NavigationLink(value: ArtistDestination(artistId: artist.id, name: artist.name)) {
                                    HStack(spacing: 12) {
                                        Group {
                                            if let urlStr = artist.coverUrl, let url = URL(string: urlStr) {
                                                CachedImage(url: url) {
                                                    Circle().fill(Color.sjBorder)
                                                        .overlay(Text(String(artist.name.prefix(1)).uppercased())
                                                            .font(.system(size: 16, weight: .bold))
                                                            .foregroundStyle(Color.sjMuted))
                                                }
                                                .aspectRatio(contentMode: .fill)
                                            } else {
                                                ZStack {
                                                    Circle().fill(Color.sjBorder)
                                                    Text(String(artist.name.prefix(1)).uppercased())
                                                        .font(.system(size: 16, weight: .bold))
                                                        .foregroundStyle(Color.sjMuted)
                                                }
                                            }
                                        }
                                        .frame(width: 44, height: 44)
                                        .clipShape(Circle())
                                        .accessibilityHidden(true) // name text alongside already describes it

                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(artist.name)
                                                .font(.system(size: 14, weight: .semibold))
                                                .foregroundStyle(Color.sjInk)
                                            if let native = artist.displayNativeName {
                                                Text(native)
                                                    .font(.system(size: 12))
                                                    .foregroundStyle(Color.sjMuted)
                                            }
                                            Text(artist.releaseCount == 1 ? String(localized: "1 release") : String(format: String(localized: "%d releases"), artist.releaseCount))
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
                                .albumContextMenu(release)
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
                                .albumContextMenu(pr)
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

                    quickAddBanner
                        .padding(.horizontal, 16)
                        .padding(.top, 4)
                        .padding(.bottom, 20)

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

                    // ── Apple Music: Library Artists ──────────
                    if !discoveryVM.appleMusicArtists.isEmpty {
                        discoverySectionTitle("Your Library Artists")
                        appleMusicArtistScroll(discoveryVM.appleMusicArtists)
                        Spacer().frame(height: 24)
                    }

                    // ── Apple Music: Recently Listened ────────
                    if !discoveryVM.appleMusicRecentlyPlayed.isEmpty {
                        discoverySectionTitle(
                            discoveryVM.recentlyPlayed.isEmpty ? "Recently Listened" : "Recently Listened (Apple)"
                        )
                        appleMusicAlbumScroll(discoveryVM.appleMusicRecentlyPlayed)
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
            .refreshable {
                await discoveryVM.refresh()
            }
        }
    }

    private var quickAddBanner: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Setting up?")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("Half-star rate albums you've probably already heard")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Button { quickAddTapped() } label: {
                Text("Quick Add")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.sjInk)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - Helpers

    private func sectionLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .tracking(1)
            .textCase(.uppercase)
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
    }

    private func discoverySectionTitle(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 20, weight: .bold))
            .foregroundStyle(Color.sjInk)
            .padding(.horizontal, 16)
            .padding(.top, 20)
            .padding(.bottom, 2)
    }


    private func discoverySubheader(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.sjAmber)
            .textCase(.uppercase)
            .tracking(1)
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 8)
    }

    private func spotifyArtistScroll(_ artists: [SpotifyArtistDisplay]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(artists) { artist in
                    Button {
                        Task { spotifyArtistNavTarget = await resolveArtist(name: artist.name) }
                    } label: {
                        VStack(spacing: 7) {
                            CachedImage(url: URL(string: artist.imageUrl?.thumbnailUrl ?? "")) {
                                Color.sjBorder.overlay(
                                    Text(String(artist.name.prefix(1)))
                                        .font(.system(size: 20, weight: .bold))
                                        .foregroundStyle(Color.sjMuted)
                                )
                            }
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 72, height: 72)
                            .clipShape(Circle())
                            .accessibilityHidden(true) // name text below already describes it

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
                    Button {
                        Task {
                            if let r = await fetchRelease(name: album.name, artist: album.artistName) {
                                recentlyPlayedNavTarget = r
                            } else {
                                showNotInCatalog = true
                            }
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            CoverImage(url: album.imageUrl)
                                .frame(width: 112, height: 112)
                                .accessibilityHidden(true) // name text below already describes it

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
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
        }
    }

    // Spotify/Apple Music album titles rarely match our catalog byte-for-byte (punctuation,
    // capitalization, romanization), so an exact ILIKE alone was missing real catalog hits and
    // showing a false "not in catalog" alert. But fuzzy search alone isn't reliable either --
    // confirmed live that short/generic titles ("USB", 3 letters) get flooded with unrelated
    // trigram matches and the real row (which DOES exist) doesn't surface in the top 10 at all.
    // Try the exact match first (cheap, precise when it hits), fall back to fuzzy only if that
    // finds nothing.
    //
    // No blind "closest title" fallback on the fuzzy path -- confirmed live that it actively
    // backfires: searching "Father EP" (Masta Wu, genuinely not in the catalog) fuzzy-matched
    // Vampire Weekend's "Father of the Bride" as the top title hit and would have silently shown
    // that instead of the honest "not in catalog" alert. Only trust a result whose artist matches.
    private func fetchRelease(name: String, artist: String) async -> Release? {
        let al = artist.lowercased()
        // Resolve the artist first (romanization-aware, via search_artists aliases) so we can
        // accept an album by artist-id equality when its native artist_display ("혁오") can't
        // string-overlap a romanized external artist name ("Hyukoh"). One extra RPC, per tap.
        let artistId = await resolveArtist(name: artist).artistId
        func accept(_ r: Release) -> Bool {
            let ra = r.artist.lowercased()
            if ra.contains(al) || al.contains(ra) { return true }
            if let aid = artistId, r.primaryArtistId == aid { return true }
            return false
        }

        let exact: [Release] = (try? await supabase
            .from("release_groups")
            .select("id, title, artist_display, cover_url, release_group_type, first_release_date, native_title, primary_artist_id")
            .ilike("title", value: name)
            .limit(5)
            .execute()
            .value) ?? []
        if let match = exact.first(where: accept) { return match }

        let fuzzy: [Release] = (try? await supabase
            .rpc("search_release_groups", params: SearchParams(q: name, lim: 10))
            .execute()
            .value) ?? []
        return fuzzy.first(where: accept)
    }

    // Same reasoning as fetchRelease -- Spotify's artist name string rarely matches our
    // artist_display exactly, so the old artistId: nil fallback (a bare ILIKE deep inside
    // ArtistPageView) frequently showed an empty or wrong artist. Resolving the real catalog
    // id up front via search_artists lets navigation use the identity-aware RPC path instead.
    //
    // Requires the candidate's name OR native name to actually overlap the query before
    // trusting it -- confirmed live that search_artists' top fuzzy result for a genuinely
    // absent artist ("Masta Wu") was "Masta Killa", an unrelated artist that just happens to
    // share a word. Checking name_native too (not just name) is what lets a Korean-rendered
    // Spotify name like "사이먼 도미닉" still correctly match "Simon Dominic".
    private func resolveArtist(name: String) async -> ArtistDestination {
        let rows: [SearchArtist] = (try? await supabase
            .rpc("search_artists", params: SearchParams(q: name, lim: 3))
            .execute()
            .value) ?? []
        let target = name.lowercased()
        func overlaps(_ s: String) -> Bool {
            let l = s.lowercased()
            return !l.isEmpty && (l == target || l.contains(target) || target.contains(l))
        }
        let match = rows.first { row in
            // name / native as before, PLUS any romanized alias — the RPC can match a native-
            // named artist (혁오) via its "HYUKOH" alias, which name/native can't string-overlap.
            overlaps(row.name)
                || (row.nameNative.map(overlaps) ?? false)
                || (row.aliases ?? []).contains(where: overlaps)
        }
        return ArtistDestination(artistId: match?.id, name: name)
    }

    private func appleMusicArtistScroll(_ artists: [AppleMusicArtistDisplay]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 14) {
                ForEach(artists) { artist in
                    NavigationLink(value: ArtistDestination(artistId: nil, name: artist.name)) {
                        VStack(spacing: 7) {
                            CachedImage(url: artist.artworkURL) {
                                Color.sjBorder.overlay(
                                    Text(String(artist.name.prefix(1)))
                                        .font(.system(size: 20, weight: .bold))
                                        .foregroundStyle(Color.sjMuted)
                                )
                            }
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 72, height: 72)
                            .clipShape(Circle())
                            .accessibilityHidden(true) // name text below already describes it

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

    private func appleMusicAlbumScroll(_ albums: [AppleMusicAlbumDisplay]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(albums) { album in
                    Button {
                        Task {
                            if let r = await fetchRelease(name: album.name, artist: album.artistName) {
                                recentlyPlayedNavTarget = r
                            } else {
                                showNotInCatalog = true
                            }
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            CachedImage(url: album.artworkURL) { Color.sjBorder }
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 112, height: 112)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                                .accessibilityHidden(true) // name text below already describes it

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
                    .buttonStyle(.plain)
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
                    .albumContextMenu(release)
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
                .albumContextMenu(pr)
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
                    Text(String(format: String(localized: "View all %d songs"), visible.count))
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
                    .accessibilityHidden(true) // title/artist text below already describes it

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
                    .accessibilityLabel(String(format: String(localized: "Add %@"), release.title))
                }
            }

            Text(release.title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.sjInk)
                .lineLimit(1)
                .frame(width: 128, alignment: .leading)

            HStack(spacing: 5) {
                Text(release.typeLabel)
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(Color.sjBlue)
                    .padding(.horizontal, 4).padding(.vertical, 2)
                    .background(Color.sjBlue.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                Text(release.artist)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
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
                .accessibilityHidden(true) // title/artist text alongside already describes it

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(song.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    Text("Song")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(Color.sjBlue)
                        .padding(.horizontal, 4).padding(.vertical, 2)
                        .background(Color.sjBlue.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                }
                Text(song.releases.title + " · " + (song.artists ?? song.releases.artist))
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
                .accessibilityLabel(String(format: String(localized: "Add %@"), song.title))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

// MARK: - Artist page (navigation destination)

struct ArtistDestination: Hashable {
    let artistId: UUID?
    let name: String
}

private struct ArtistSong: Identifiable {
    let id: UUID
    let title: String
    let position: Int
    let albumId: UUID?
    let albumTitle: String
    let albumCoverUrl: String?
    let releaseDate: String?
    let ratingCount: Int
    let avgScore: Double?
    let myScore: Double?
}

enum ArtistAlbumTypeFilter: String, CaseIterable {
    case all    = "All"
    case album  = "Album"
    case ep     = "EP"
    case single = "Single"
}

enum ArtistAlbumSortOrder: String, CaseIterable {
    case newest       = "Newest"
    case oldest       = "Oldest"
    case topRated     = "Top Rated"
    case alphabetical = "A–Z"
}

enum ArtistCommunityDisplayMode { case list, posts }

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
    // Songs load separately from the main isLoading gate -- loadSongs()'s
    // recordings lookup is the slowest single query on this page, and the
    // default (Albums) tab doesn't need it, so it shouldn't hold up the
    // whole page's first render. The Songs tab shows its own spinner.
    @State private var isLoadingSongs   = true
    @State private var artistAvatarUrl: String? = nil
    @State private var canonicalName:   String? = nil
    @State private var albumTypeFilter: ArtistAlbumTypeFilter = .all
    @State private var albumSortOrder:  ArtistAlbumSortOrder  = .newest
    @State private var communityDisplayMode: ArtistCommunityDisplayMode = .posts
    @State private var ratingMode = "manual"
    @State private var songNavTarget: SongNavTarget? = nil

    private struct SongNavTarget: Identifiable, Hashable {
        let id: UUID
        let track: TrackEntry
        let release: Release
    }

    private struct CommunityRating: Codable, Identifiable {
        let id: UUID
        let userId: UUID
        let releaseGroupId: UUID
        let score: Double?
        let eloScore: Double?
        let createdAt: Date
        let reviewText: String?
        let profiles: CRProfile?
        struct CRProfile: Codable {
            let username: String?; let displayName: String?
            enum CodingKeys: String, CodingKey { case username; case displayName = "display_name" }
            var handle: String { username ?? displayName ?? String(localized: "someone") }
            var initial: String { String((username ?? displayName ?? "?").prefix(1)).uppercased() }
        }
        enum CodingKeys: String, CodingKey {
            case id; case userId = "user_id"; case releaseGroupId = "release_group_id"
            case score; case eloScore = "elo_score"; case createdAt = "created_at"
            case reviewText = "review_text"; case profiles
        }
        var displayScore: Double? {
            if let s = score { return s }
            if let e = eloScore { return Elo.toScore(e) }
            return nil
        }
    }

    private let tabLabels: [LocalizedStringKey] = ["Albums", "Songs", "Community", "Stats"]

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
                HStack(alignment: .center, spacing: 12) {
                    if let urlStr = artistAvatarUrl, let url = URL(string: urlStr) {
                        CachedImage(url: url) { Color.sjBorder }
                            .aspectRatio(contentMode: .fill)
                            .frame(width: 56, height: 56)
                            .clipShape(Circle())
                            .accessibilityHidden(true) // artist name text alongside already describes it
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Artist")
                            .font(.system(size: 10, weight: .semibold))
                            .tracking(1.4)
                            .foregroundStyle(Color.sjMuted)
                        Text(canonicalName ?? artist.name)
                            .font(.system(size: 28, weight: .heavy))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(2)
                            .minimumScaleFactor(0.75)
                    }
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
                        Text(String(format: String(localized: "%d rated · %@ avg"), myRatedCount, String(format: "%.1f", avg)))
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
                                albumFilterSortBar
                                let list = filteredSortedReleases
                                if list.isEmpty {
                                    Text("No releases match this filter.")
                                        .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                                        .frame(maxWidth: .infinity).padding(.top, 40)
                                } else {
                                    ForEach(Array(list.enumerated()), id: \.element.id) { idx, release in
                                        ArtistReleaseRow(release: release,
                                                         communityScore: releaseScores[release.id],
                                                         userScore: myRatings[release.id])
                                        if idx < list.count - 1 {
                                            Divider().padding(.leading, 68).foregroundStyle(Color.sjBorder)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .tag(0)

                    // Songs
                    ScrollView(showsIndicators: false) {
                        LazyVStack(spacing: 0) {
                            if isLoadingSongs {
                                ProgressView()
                                    .frame(maxWidth: .infinity)
                                    .padding(.top, 40)
                            } else if songs.isEmpty {
                                Text("No songs in the catalogue yet.")
                                    .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                                    .frame(maxWidth: .infinity).padding(.top, 40)
                            } else {
                                ForEach(Array(songs.enumerated()), id: \.element.id) { idx, song in
                                    ArtistSongRow(song: song) {
                                        guard let albumId = song.albumId else { return }
                                        let release = Release(
                                            id: albumId, title: song.albumTitle, artist: artist.name,
                                            coverUrl: song.albumCoverUrl, releaseType: nil,
                                            releaseDate: song.releaseDate, titleNative: nil, artistNative: nil,
                                            tracklist: nil, totalTracks: nil)
                                        let track = TrackEntry(
                                            trackId: song.id, position: song.position, title: song.title,
                                            durationMs: nil, artists: artist.name)
                                        songNavTarget = SongNavTarget(id: song.id, track: track, release: release)
                                    }
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
        .navigationTitle(canonicalName ?? artist.name)
        .navigationBarTitleDisplayMode(.inline)
        // No Release-type navigationDestination here -- every stack that can host this view
        // (Home/Rankings/Profile/Search) already declares one at its own root; a second
        // declaration for the same type within one NavigationStack causes SwiftUI to
        // double-push, which is what made tapping an album here reopen the artist page
        // instead (confirmed live).
        // Reset on disappear -- a stale non-nil item binding can get spuriously re-presented
        // on top of a later push made from within its own destination (e.g. tapping the artist
        // name inside SongDetailView). See the matching note on SearchView's own item targets.
        .navigationDestination(item: $songNavTarget) { target in
            SongDetailView(track: target.track, release: target.release, ratingMode: ratingMode)
                .onDisappear { if songNavTarget?.id == target.id { songNavTarget = nil } }
        }
        .task { await load() }
    }

    @ViewBuilder
    private func artistStat(value: String, label: LocalizedStringKey) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.system(size: 22, weight: .heavy)).foregroundStyle(Color.sjInk)
            Text(label).font(.system(size: 10)).foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func load() async {
        var loaded: [Release]
        if let artistId = artist.artistId {
            // Identity-aware: returns all releases credited to this artist, regardless of credit position.
            // Independent of the canonical name/avatar lookup below -- run both concurrently instead of
            // waiting on the releases RPC before even starting the artist row fetch.
            struct ARow: Codable {
                let name: String; let coverUrl: String?
                enum CodingKeys: String, CodingKey { case name; case coverUrl = "cover_url" }
            }
            async let releasesFetch: [Release] = (try? await supabase
                .rpc("get_artist_release_groups", params: ArtistReleasesParams(p_artist_id: artistId.uuidString, lim: 60))
                .execute()
                .value) ?? []
            async let artistRowFetch: [ARow] = (try? await supabase
                .from("artists").select("name, cover_url")
                .eq("id", value: artistId.uuidString).limit(1).execute().value) ?? []

            let (releasesResult, arows) = await (releasesFetch, artistRowFetch)
            loaded = releasesResult
            if let row = arows.first { artistAvatarUrl = row.coverUrl; canonicalName = row.name }
        } else {
            let escaped = artist.name.replacingOccurrences(of: "'", with: "''")
            loaded = (try? await supabase
                .from("release_groups")
                .select("id, title, artist_display, cover_url, release_group_type, first_release_date, native_title")
                .ilike("artist_display", value: escaped)
                .order("first_release_date", ascending: false, nullsFirst: false)
                .limit(60)
                .execute()
                .value) ?? []
            if loaded.isEmpty { loaded = await fetchFromWebSearch() }
        }
        releases = loaded

        let releaseGroupIds = loaded.map(\.id.uuidString)
        guard !releaseGroupIds.isEmpty else { isLoading = false; isLoadingSongs = false; return }

        // Not part of the async let group below on purpose -- this is the
        // slowest single query on the page (unindexed ILIKE scan over
        // recordings) and the default Albums tab never needs its result, so
        // it runs independently instead of gating isLoading.
        Task {
            await loadSongs()
            isLoadingSongs = false
        }
        Task { await loadRatingMode() }

        struct RRow: Codable {
            let releaseGroupId: UUID; let userId: UUID; let score: Double?
            enum CodingKeys: String, CodingKey {
                case releaseGroupId = "release_group_id"; case userId = "user_id"; case score
            }
        }
        let rows: [RRow] = (try? await supabase
            .from("ratings").select("release_group_id, user_id, score")
            .in("release_group_id", values: releaseGroupIds).execute().value) ?? []

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
            let score: Double?; let eloScore: Double?; let createdAt: Date; let reviewText: String?
            enum CodingKeys: String, CodingKey {
                case id; case userId = "user_id"; case releaseGroupId = "release_group_id"
                case score; case eloScore = "elo_score"; case createdAt = "created_at"
                case reviewText = "review_text"
            }
        }
        let cfRows: [CFRow] = (try? await supabase
            .from("ratings").select("id, user_id, release_group_id, score, elo_score, created_at, review_text")
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
                reviewText: row.reviewText,
                profiles: p.map { CommunityRating.CRProfile(username: $0.username, displayName: $0.displayName) }
            )
        }
    }

    private func loadRatingMode() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct P: Decodable {
            let ratingMode: String?
            enum CodingKeys: String, CodingKey { case ratingMode = "rating_mode" }
        }
        if let p: P = try? await supabase
            .from("profiles").select("rating_mode")
            .eq("id", value: userId).single().execute().value {
            ratingMode = p.ratingMode ?? "manual"
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
            let recordingId: UUID; let position: Int; let releases: RelRow?
            struct RelRow: Codable {
                let isCanonical: Bool?; let releaseGroups: RGInfo?
                struct RGInfo: Codable {
                    let id: UUID; let title: String; let coverUrl: String?; let firstReleaseDate: String?
                    enum CodingKeys: String, CodingKey {
                        case id, title; case coverUrl = "cover_url"; case firstReleaseDate = "first_release_date"
                    }
                }
                enum CodingKeys: String, CodingKey {
                    case isCanonical = "is_canonical"; case releaseGroups = "release_groups"
                }
            }
            enum CodingKeys: String, CodingKey { case recordingId = "recording_id"; case position; case releases }
        }
        let rtRows: [RTRow] = (try? await supabase
            .from("release_tracks")
            .select("recording_id, position, releases(is_canonical, release_groups(id, title, cover_url, first_release_date))")
            .in("recording_id", values: hits.map(\.id.uuidString)).execute().value) ?? []

        var rgMap: [UUID: RTRow.RelRow.RGInfo] = [:]
        var positionMap: [UUID: Int] = [:]
        for row in rtRows {
            guard let rg = row.releases?.releaseGroups else { continue }
            if row.releases?.isCanonical == true || rgMap[row.recordingId] == nil {
                rgMap[row.recordingId] = rg
                positionMap[row.recordingId] = row.position
            }
        }

        // Community rating count/avg per song -- counts every track_ratings row (including
        // instinct-only rows with score == nil, matching the album-side communityCount
        // convention) so "number of ratings" reflects everyone who's rated the track, not
        // just manual-mode raters.
        struct TRRow: Codable {
            let recordingId: UUID; let userId: UUID; let score: Double?; let eloScore: Double?
            enum CodingKeys: String, CodingKey {
                case recordingId = "recording_id"; case userId = "user_id"; case score; case eloScore = "elo_score"
            }
        }
        let trRows: [TRRow] = (try? await supabase
            .from("track_ratings").select("recording_id, user_id, score, elo_score")
            .in("recording_id", values: hits.map(\.id.uuidString)).execute().value) ?? []
        let currentUserId = supabase.auth.currentUser?.id
        var trCount: [UUID: Int] = [:]
        var trSum:   [UUID: (sum: Double, n: Int)] = [:]
        var myMap:   [UUID: Double] = [:]
        for r in trRows {
            trCount[r.recordingId, default: 0] += 1
            let display = r.score ?? r.eloScore.map(Elo.toScore)
            if let d = display {
                let e = trSum[r.recordingId] ?? (0, 0)
                trSum[r.recordingId] = (e.sum + d, e.n + 1)
                if r.userId == currentUserId { myMap[r.recordingId] = d }
            }
        }

        // Default order: most-rated first, ties broken by newest release -- matches the
        // Albums tab's "newest first" convention for the tie-break direction.
        songs = hits.compactMap { hit in
            let rg = rgMap[hit.id]
            let sum = trSum[hit.id]
            return ArtistSong(id: hit.id, title: hit.title, position: positionMap[hit.id] ?? 1,
                              albumId: rg?.id, albumTitle: rg?.title ?? "",
                              albumCoverUrl: rg?.coverUrl, releaseDate: rg?.firstReleaseDate,
                              ratingCount: trCount[hit.id] ?? 0,
                              avgScore: sum.map { $0.sum / Double($0.n) },
                              myScore: myMap[hit.id])
        }.sorted { a, b in
            if a.ratingCount != b.ratingCount { return a.ratingCount > b.ratingCount }
            return (a.releaseDate ?? "") > (b.releaseDate ?? "")
        }
    }

    // MARK: - Albums tab filter/sort

    private var filteredSortedReleases: [Release] {
        var list = releases
        if albumTypeFilter != .all {
            list = list.filter { $0.releaseType?.caseInsensitiveCompare(albumTypeFilter.rawValue) == .orderedSame }
        }
        switch albumSortOrder {
        case .newest:
            list.sort { ($0.releaseDate ?? "") > ($1.releaseDate ?? "") }
        case .oldest:
            list.sort { ($0.releaseDate ?? "9999-99-99") < ($1.releaseDate ?? "9999-99-99") }
        case .topRated:
            list.sort { (releaseScores[$0.id] ?? -1) > (releaseScores[$1.id] ?? -1) }
        case .alphabetical:
            list.sort { $0.displayTitle.localizedCaseInsensitiveCompare($1.displayTitle) == .orderedAscending }
        }
        return list
    }

    private var albumFilterSortBar: some View {
        HStack(spacing: 4) {
            ForEach(ArtistAlbumTypeFilter.allCases, id: \.self) { filter in
                Button { albumTypeFilter = filter } label: {
                    Text(LocalizedStringKey(filter.rawValue))
                        .font(.system(size: 12, weight: albumTypeFilter == filter ? .semibold : .regular))
                        .foregroundStyle(albumTypeFilter == filter ? Color.sjBlue : Color.sjMuted)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(albumTypeFilter == filter ? Color.sjBlue.opacity(0.1) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(.plain)
            }

            Spacer()

            Menu {
                ForEach(ArtistAlbumSortOrder.allCases, id: \.self) { order in
                    Button {
                        albumSortOrder = order
                    } label: {
                        Label(LocalizedStringKey(order.rawValue),
                              systemImage: albumSortOrder == order ? "checkmark" : "")
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "line.3.horizontal.decrease")
                    Text(LocalizedStringKey(albumSortOrder.rawValue))
                }
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.sjAmber)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
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
                    communityDisplayToggle
                    if communityDisplayMode == .list {
                        ForEach(communityFeed) { entry in
                            communityRow(entry)
                            Divider().padding(.leading, 54)
                        }
                    } else {
                        ForEach(communityFeed) { entry in
                            communityPostCard(entry)
                        }
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    private var communityDisplayToggle: some View {
        HStack {
            Spacer()
            HStack(spacing: 2) {
                ForEach([ArtistCommunityDisplayMode.list, .posts], id: \.self) { mode in
                    Button { communityDisplayMode = mode } label: {
                        Image(systemName: mode == .list ? "list.bullet" : "newspaper")
                            .font(.system(size: 14))
                            .foregroundStyle(communityDisplayMode == mode ? Color.sjBlue : Color.sjMuted)
                            .frame(width: 32, height: 28)
                            .background(communityDisplayMode == mode ? Color.sjBlue.opacity(0.1) : Color.clear)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(mode == .list ? String(localized: "List view") : String(localized: "Post view"))
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    private func communityPostCard(_ entry: CommunityRating) -> some View {
        let release = releases.first { $0.id == entry.releaseGroupId }
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                ZStack {
                    Circle().fill(Color.sjAmber.opacity(0.15)).frame(width: 32, height: 32)
                    Text(entry.profiles?.initial ?? "?")
                        .font(.system(size: 13, weight: .bold)).foregroundStyle(Color.sjAmber)
                }
                Text("@" + (entry.profiles?.handle ?? String(localized: "someone")))
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.sjInk)
                Text("·").foregroundStyle(Color.sjBorder)
                Text(entry.createdAt.relativeTimeString)
                    .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                Spacer()
            }
            .padding(.horizontal, 14).padding(.top, 12).padding(.bottom, 8)

            if let release {
                NavigationLink(value: release) {
                    HStack(spacing: 12) {
                        CoverImage(url: release.coverUrl, cornerRadius: 8)
                            .frame(width: 64, height: 64)
                            .accessibilityHidden(true) // title text alongside already describes it
                        VStack(alignment: .leading, spacing: 3) {
                            Text(release.displayTitle)
                                .font(.system(size: 15, weight: .bold)).foregroundStyle(Color.sjInk).lineLimit(1)
                            Text(release.typeLabel)
                                .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                        }
                        Spacer()
                        if let score = entry.displayScore {
                            HStack(spacing: 3) {
                                Image("icon-flower")
                                    .renderingMode(.template).resizable().scaledToFit()
                                    .frame(width: 11, height: 11).foregroundStyle(Color.sjAmber)
                                Text(score.truncatingRemainder(dividingBy: 1) == 0
                                     ? "\(Int(score))" : String(format: "%.1f", score))
                                    .font(.system(size: 13, weight: .bold)).foregroundStyle(Color.sjAmber)
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }

            if let text = entry.reviewText, !text.isEmpty {
                Text(text)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
            }
        }
        .padding(.bottom, 14)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .padding(.horizontal, 12)
        .padding(.top, 10)
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
                    Text("@" + (entry.profiles?.handle ?? String(localized: "someone")))
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.sjInk)
                        .lineLimit(1)
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
                    .accessibilityHidden(true) // title text alongside already describes it
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
                        statsSectionView("Popular Albums") { topReleasesView }
                    }
                    if songs.contains(where: { $0.ratingCount > 0 }) {
                        statsSectionView("Popular Songs") { topSongsView }
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

    private func statsSectionView(_ title: LocalizedStringKey, @ViewBuilder content: () -> some View) -> some View {
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
                            .accessibilityHidden(true) // title text alongside already describes it
                        VStack(alignment: .leading, spacing: 2) {
                            Text(release.displayTitle)
                                .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.sjInk).lineLimit(1)
                            Text(count == 1 ? String(localized: "1 rating") : String(format: String(localized: "%d ratings"), count))
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

    // Top 3 songs by community avg (min 1 rating) — navigates to the song's album,
    // since songs don't have their own detail route reachable from here.
    private var topSongsView: some View {
        let top = songs
            .filter { $0.ratingCount > 0 && $0.avgScore != nil }
            .sorted { ($0.avgScore ?? 0) > ($1.avgScore ?? 0) }
            .prefix(3)
        return VStack(spacing: 0) {
            ForEach(Array(top.enumerated()), id: \.element.id) { idx, song in
                let album = song.albumId.flatMap { id in releases.first { $0.id == id } }
                let row = HStack(spacing: 10) {
                    Text("#\(idx + 1)")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.sjMuted)
                        .frame(width: 20)
                    CoverImage(url: song.albumCoverUrl, cornerRadius: 5)
                        .frame(width: 36, height: 36)
                        .accessibilityHidden(true) // title text alongside already describes it
                    VStack(alignment: .leading, spacing: 2) {
                        Text(song.title)
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.sjInk).lineLimit(1)
                        Text(song.ratingCount == 1 ? String(localized: "1 rating") : String(format: String(localized: "%d ratings"), song.ratingCount))
                            .font(.system(size: 10)).foregroundStyle(Color.sjMuted)
                    }
                    Spacer()
                    HStack(spacing: 3) {
                        Image("icon-flower")
                            .renderingMode(.template).resizable().scaledToFit()
                            .frame(width: 10, height: 10).foregroundStyle(Color.sjAmber)
                        Text(String(format: "%.1f", song.avgScore ?? 0))
                            .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.sjAmber)
                    }
                }
                .padding(.vertical, 8)

                if let album {
                    NavigationLink(value: album) { row }.buttonStyle(.plain)
                } else {
                    row
                }
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
                    Text(LocalizedStringKey(stat.type))
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
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                CoverImage(url: song.albumCoverUrl, cornerRadius: 6)
                    .frame(width: 44, height: 44)
                    .accessibilityHidden(true) // title/album text alongside already describes it
                VStack(alignment: .leading, spacing: 3) {
                    Text(song.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjInk).lineLimit(1)
                    Text(song.albumTitle)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.sjMuted).lineLimit(1)
                }
                Spacer()

                if let s = song.myScore {
                    scoreBadge(s, color: Color.sjBlue)
                } else if let s = song.avgScore {
                    scoreBadge(s, color: Color.sjAmber)
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

    private func scoreBadge(_ score: Double, color: Color) -> some View {
        HStack(spacing: 4) {
            Image("icon-flower")
                .renderingMode(.template).resizable().scaledToFit()
                .frame(width: 11, height: 11).foregroundStyle(color)
            Text(String(format: "%.1f", score))
                .font(.system(size: 12, weight: .bold)).foregroundStyle(color)
        }
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
                    .accessibilityHidden(true) // title text alongside already describes it

                VStack(alignment: .leading, spacing: 3) {
                    Text(release.displayTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjInk).lineLimit(1)
                    HStack(spacing: 3) {
                        if let t = release.releaseType {
                            Text(LocalizedStringKey(t.lowercased() == "ep" ? "EP" : t.capitalized))
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
    SearchView(discoveryVM: DiscoveryViewModel(), onGoToSettings: {})
}
