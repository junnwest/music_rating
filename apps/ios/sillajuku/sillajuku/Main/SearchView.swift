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

        var asRelease: Release {
            Release(id: id, title: title, artist: artist, coverUrl: coverUrl, releaseType: nil,
                     releaseDate: nil, titleNative: nil, artistNative: nil, tracklist: nil, totalTracks: nil)
        }
    }

    var asTrackEntry: TrackEntry {
        TrackEntry(trackId: id, position: 0, title: title, durationMs: nil, artists: artists)
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
    // supplements Spotify/Apple Music with. Populated by loadRatedArtists() below.
    var ratedArtists: [String] = []

    // High-confidence taste recommendations (artists user rated 4+)
    var tasteAlbums: [Release] = []

    // Genre-cluster "worlds" from /api/recommendations -- one row per taste cluster, e.g.
    // "Because you love {label}". New this session (web sibling: search/page.tsx's worlds[]).
    var worlds: [(label: String, albums: [Release])] = []

    // Trending on the platform (most-rated recent releases, real ratings weighted over bot ones)
    var trendingAlbums: [Release] = []

    // Newest albums/EPs with cover art -- a genuine "New Releases" row, distinct from Popular
    // now that Popular is actually prestige-ranked (was previously the same newest-first query
    // mislabeled "Popular").
    var newReleaseAlbums: [Release] = []

    // Popular (prestige-ranked)
    var popularAlbums: [Release] = []
    var popularSongs:  [SongResult] = []

    // Artists with any rating <=1.5 -- suppressed from every section above. Populated by
    // loadRecommendations() (the only endpoint that knows this), applied there and retroactively
    // to Discovery's own concurrently-fetched sections.
    var blockedArtists: Set<String> = []

    // Spotify/Apple "Recently Listened" resolved against the catalog -- see
    // resolveRecentlyPlayedIfNeeded() below. Rendered via the same albumScroll/DiscoveryAlbumCard
    // every other section uses (proper cover size, add button, context menu) instead of the old
    // raw-metadata row that couldn't offer any of that since it had no Release until tap.
    var recentlyPlayedReleases: [Release] = []
    var appleMusicRecentlyPlayedReleases: [Release] = []

    var isLoading = true
    var needsSpotifyReconnect = false  // no cached data AND token is gone
    private var hasResolvedRecentlyPlayed = false

    // Whether ANY discovery/recommendation section actually populated. reloadDiscoverySections()
    // fans out to two WebAPI.get() calls that silently resolve to "do nothing" on any failure
    // (network blip, timeout, or the whole .task getting cancelled by a quick tab-switch
    // mid-load) -- previously `hasLoaded` latched true regardless, before those calls even
    // finished, so a single such failure left every album-suggestion section empty for the rest
    // of the app session (the `else` branch below only ever retried Spotify/Apple Music), with no
    // way to recover short of relaunching. Same root shape as the Taste tab's
    // hasLoaded-latched-too-early bug. Checked on every load() call, independent of `hasLoaded`,
    // so a retry never has to re-run the Spotify/Apple Music fetch (which hits live, rate-limited
    // APIs unconditionally) just to also retry discovery.
    private var hasDiscoveryData: Bool {
        !personalizedAlbums.isEmpty || !tasteAlbums.isEmpty || !worlds.isEmpty
            || !trendingAlbums.isEmpty || !newReleaseAlbums.isEmpty || !popularAlbums.isEmpty
    }

    func load() async {
        // Every section below (`discoveryView` in the View) already guards itself on its own
        // `!x.isEmpty` check -- nothing actually requires ALL of Spotify/Apple Music/Discovery/
        // Recommendations to finish before rendering something. Flipping this immediately, before
        // any of the fetches below even start, turns "stare at one spinner for 11-20s" into
        // "see the screen instantly, sections pop in individually as their own fetch lands" --
        // this is the fix that actually gets Add under 5s to first meaningful content; the
        // parallelization work above/below reduces total background completion time, but was
        // never going to get a single blocking spinner under 5s on its own (bounded by the
        // slowest of several independent network calls, several of them third-party APIs this
        // app doesn't control the latency of). Same progressive-reveal pattern ProfileViewModel
        // already uses (see its load()).
        isLoading = false

        // Spotify/Apple Music and Discovery/Recommendations are independent of each other --
        // Discovery moved to web's own /api/discovery + /api/recommendations a while back and no
        // longer needs Spotify/Apple Music seed artists (see reloadDiscoverySections' own
        // loaders), but this kept waiting for the music-service fetch to finish first anyway,
        // stacking two full network legs in series (measured live: ~6s Spotify+Apple Music, THEN
        // ~6s Discovery on top of it -- ~12s total for a cold Add-tab visit). Merged into one
        // wave; each still has its own hasXData-based guard so a retry only re-fetches what's
        // actually missing, same as before.
        await withTaskGroup(of: Void.self) { g in
            if !hasSpotifyData    { g.addTask { await self.loadSpotify() } }
            if !hasAppleMusicData { g.addTask { await self.loadAppleMusic() } }
            if !hasDiscoveryData  { g.addTask { await self.reloadDiscoverySections() } }
        }
        // One retry if discovery/recommendations came back empty -- loadDiscovery/
        // loadRecommendations/loadRatedArtists each silently swallow a failed fetch (network
        // blip, timeout, or cold-launch contention with Home/Quest's own concurrent queries) as
        // "no data" rather than surfacing an error, so `hasDiscoveryData` false here is far more
        // likely a transient failure than a real empty state (popular/trending are global feeds,
        // not personalized -- they're essentially never genuinely empty). Without this, the user
        // was stuck seeing only Spotify's locally-cached "Your Top Artists" (immune to this
        // failure -- see loadSpotify) until a manual pull-to-refresh. Same "optional fetch, one
        // retry" pattern already used by TasteViewModel/MixLibraryViewModel for this exact shape
        // of bug.
        if !hasDiscoveryData {
            await reloadDiscoverySections()
        }
        // Only needs the recently-played lists loadSpotify/loadAppleMusic just populated above --
        // has its own hasResolvedRecentlyPlayed guard, so this really must stay sequenced after
        // the wave above (unlike Discovery, it has a genuine dependency on Spotify/Apple Music).
        await resolveRecentlyPlayedIfNeeded()
        prefetchDiscoveryCovers()
    }

    // Recently-played rows come back as raw Spotify/Apple Music metadata (name + artist string),
    // not a catalog release -- previously resolved lazily per-row on tap, which meant the row
    // itself could never show a proper cover size or add button (there was no Release to give
    // one), and a miss only surfaced as a dead-end "not in catalog" alert after the tap. Resolves
    // once, up front, against the same matching logic (exact title match, fuzzy fallback,
    // artist-name/id acceptance gate) SearchView.fetchRelease already had tuned for this exact
    // problem -- unmatched entries are just dropped instead of rendered as a broken-looking row.
    // Capped at 24 for Spotify (of up to 50 fetched) since eagerly resolving all of them means
    // that many concurrent catalog lookups for a horizontally-scrolled list most users won't
    // scroll all the way through anyway; Apple's own fetch is already capped at 20.
    private func resolveRecentlyPlayedIfNeeded() async {
        guard !hasResolvedRecentlyPlayed else { return }
        guard !recentlyPlayed.isEmpty || !appleMusicRecentlyPlayed.isEmpty else { return }
        hasResolvedRecentlyPlayed = true
        async let spotifyMatches = Self.resolveCatalogMatches(
            Array(recentlyPlayed.prefix(24)).map { (name: $0.name, artist: $0.artistName) }
        )
        async let appleMatches = Self.resolveCatalogMatches(
            appleMusicRecentlyPlayed.map { (name: $0.name, artist: $0.artistName) }
        )
        recentlyPlayedReleases = await spotifyMatches
        appleMusicRecentlyPlayedReleases = await appleMatches
    }

    // Batches concurrency at 8 rather than firing every lookup at once -- confirmed elsewhere
    // this session (the web sitemap's pagination fetch) that a burst of many simultaneous
    // PostgREST requests can silently drop results from otherwise-valid concurrent requests in
    // the same batch. Preserves input order (task completion order isn't submission order).
    private static func resolveCatalogMatches(_ items: [(name: String, artist: String)]) async -> [Release] {
        var resolved = [Int: Release]()
        var i = 0
        while i < items.count {
            let batch = items[i..<min(i + 8, items.count)]
            await withTaskGroup(of: (Int, Release?).self) { g in
                for (offset, item) in batch.enumerated() {
                    let index = i + offset
                    g.addTask { (index, await fetchRelease(name: item.name, artist: item.artist)) }
                }
                for await (index, release) in g {
                    if let release { resolved[index] = release }
                }
            }
            i += 8
        }
        return (0..<items.count).compactMap { resolved[$0] }
    }

    // Same matching logic as SearchView's own fetchRelease (tuned live against real misses --
    // see that function's comment for why exact-first + gated-fuzzy, no blind closest-title
    // fallback). Kept here too since this now needs to run eagerly at load time rather than
    // lazily per-tap from the view.
    private static func fetchRelease(name: String, artist: String) async -> Release? {
        let al = artist.lowercased()
        let artistId = await resolveArtistId(name: artist)
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

    // fileprivate (not private) so ArtistPageView.load() can reuse it for its own artistId == nil
    // resolution instead of the weaker bare-ILIKE fallback -- same identity-aware, alias-aware
    // matching this file's other name-based lookups already share.
    fileprivate static func resolveArtistId(name: String) async -> UUID? {
        let rows: [SearchArtist] = (try? await supabase
            .rpc("search_artists", params: SearchParams(q: name, lim: 3))
            .execute()
            .value) ?? []
        let target = name.lowercased()
        func overlaps(_ s: String) -> Bool {
            let l = s.lowercased()
            return !l.isEmpty && (l == target || l.contains(target) || target.contains(l))
        }
        return rows.first { row in
            overlaps(row.name)
                || (row.nameNative.map(overlaps) ?? false)
                || (row.aliases ?? []).contains(where: overlaps)
        }?.id
    }

    // Pull-to-refresh on the Add tab -- load() only runs the personalized/popular/taste/trending
    // batch once per app launch (by design, so switching tabs never re-triggers a reload), which
    // means the section otherwise never changes for the rest of the session. This re-runs that
    // same batch on demand.
    func refresh() async {
        // Recently Listened's catalog resolution is otherwise a load()-once-per-session guard
        // (resolveRecentlyPlayedIfNeeded) -- reset it here so refresh actually re-attempts
        // matching too, same as every other section already does. Matters because the catalog
        // itself can change independent of the (unrefreshed) underlying Spotify/Apple data --
        // e.g. a search-matching fix landing server-side wouldn't otherwise show up without a
        // full app relaunch.
        hasResolvedRecentlyPlayed = false
        await reloadDiscoverySections()
        await resolveRecentlyPlayedIfNeeded()
        prefetchDiscoveryCovers()
    }

    private func reloadDiscoverySections() async {
        await withTaskGroup(of: Void.self) { g in
            g.addTask { await self.loadRatedArtists() }
            g.addTask { await self.loadDiscovery() }
            g.addTask { await self.loadRecommendations() }
        }
    }

    private func prefetchDiscoveryCovers() {
        // Kick off background downloads for all album art so covers are ready before the user scrolls
        let prefetchUrls = (personalizedAlbums + trendingAlbums + popularAlbums + tasteAlbums
            + newReleaseAlbums + worlds.flatMap(\.albums)
            + recentlyPlayedReleases + appleMusicRecentlyPlayedReleases)
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

        // Layer 2: Supabase DB (persistent across reinstalls and devices) -- independent
        // of each other, run concurrently instead of stacking two DB round-trips when
        // both caches are empty (e.g. every cold app launch).
        async let dbArtistsTask: [SpotifyArtistDisplay] =
            spotifyArtists.isEmpty ? await SpotifyService.loadArtistsFromDB() : []
        async let dbRecentTask: [SpotifyAlbumDisplay] =
            recentlyPlayed.isEmpty ? await SpotifyService.loadRecentlyPlayedFromDB() : []
        let dbArtists = await dbArtistsTask
        let dbRecent  = await dbRecentTask
        if !dbArtists.isEmpty {
            spotifyArtists = dbArtists
            SpotifyService.saveArtists(dbArtists)  // backfill local cache
        }
        if !dbRecent.isEmpty {
            recentlyPlayed = dbRecent
            SpotifyService.saveRecentlyPlayed(dbRecent)
        }

        hasSpotifyData = !spotifyArtists.isEmpty || !recentlyPlayed.isEmpty

        // Layer 3: Live Spotify API (when token is valid — refreshes both caches)
        guard let token = await SpotifyService.validToken() else {
            needsSpotifyReconnect = !hasSpotifyData
            return
        }
        needsSpotifyReconnect = false

        // Independent of each other -- were two full sequential live Spotify API round-trips
        // (each with its own network latency) stacked one after the other; now concurrent.
        async let freshTask  = SpotifyService.topArtists(token: token, limit: 10)
        async let recentTask = SpotifyService.recentlyPlayed(token: token, limit: 50)
        let (fresh, recent) = await (freshTask, recentTask)

        if !fresh.isEmpty {
            spotifyArtists = fresh
            SpotifyService.saveArtists(fresh)
        }
        if !recent.isEmpty {
            recentlyPlayed = recent
            SpotifyService.saveRecentlyPlayed(recent)
        }
        // DB writebacks are independent of each other too -- same treatment.
        await withTaskGroup(of: Void.self) { g in
            if !fresh.isEmpty  { g.addTask { await SpotifyService.saveArtistsToDB(fresh) } }
            if !recent.isEmpty { g.addTask { await SpotifyService.saveRecentlyPlayedToDB(recent) } }
        }

        hasSpotifyData = !spotifyArtists.isEmpty || !recentlyPlayed.isEmpty
    }

    // Called when app returns to foreground — picks up the new token if OAuth completed.
    func refreshSpotifyIfNeeded() async {
        guard needsSpotifyReconnect || !hasSpotifyData else { return }
        await loadSpotify()
    }

    // Same idea for Apple Music, triggered from Settings' new "Connect Apple Music" row
    // (MusicKitService.requestAuthorization() there has no way to reach this view model
    // directly, so it goes through the same scenePhase/notification hooks Spotify uses).
    func refreshAppleMusicIfNeeded() async {
        guard !hasAppleMusicData else { return }
        await loadAppleMusic()
    }

    // Artists behind ratings >= 3.5, best-first -- QuickAddViewModel's seed source. Kept as its
    // own small loader (previously a side effect of loadPersonalized(), now that that's gone in
    // favor of calling web's own /api/recommendations directly).
    private func loadRatedArtists() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct RatedRelease: Codable {
            let score: Double?
            let releaseGroups: ArtistOnly
            struct ArtistOnly: Codable {
                let artist: String
                enum CodingKeys: String, CodingKey { case artist = "artist_display" }
            }
            enum CodingKeys: String, CodingKey {
                case score; case releaseGroups = "release_groups"
            }
        }
        let ratedReleases: [RatedRelease] = (try? await supabase
            .from("ratings")
            .select("score, release_groups(artist_display)")
            .eq("user_id", value: userId)
            .limit(200)
            .execute()
            .value) ?? []
        var seenRatedArtists = Set<String>()
        ratedArtists = ratedReleases
            .compactMap { r -> (String, Double)? in
                guard let d = r.score, d >= 3.5 else { return nil }
                return (r.releaseGroups.artist, d)
            }
            .sorted { $0.1 > $1.1 }
            .map(\.0)
            .filter { seenRatedArtists.insert($0).inserted }
    }

    // Popular (prestige-ranked, not just newest), New Releases, and bot-weighted Trending --
    // calls web's own /api/discovery directly instead of the old client-side queries (which had
    // "Popular" mislabeled newest-first, and Trending counting every rating equally regardless
    // of is_bot). Same algorithm as web, no local reimplementation to drift out of sync. See
    // Services/WebAPI.swift.
    private func loadDiscovery() async {
        guard let resp: DiscoveryResponse = await WebAPI.get("/api/discovery", authed: false) else { return }
        popularAlbums = filterBlocked(resp.popular)
        newReleaseAlbums = filterBlocked(resp.newReleases)
        trendingAlbums = filterBlocked(resp.trending)
        popularSongs = []  // songs in discovery deferred until Windows rebuilds search RPCs
    }

    // "From Your Taste" / "For You" / genre-cluster "worlds" -- calls web's own
    // /api/recommendations directly instead of the old client-side exploit+explore blend, so iOS
    // gets the same taste-vector/genre-embedding clustering web has (see Services/WebAPI.swift).
    // Also the only source of blockedArtists (any artist rated <=1.5), applied here and
    // retroactively to Discovery below since that fetch runs concurrently and can't wait on this.
    private func loadRecommendations() async {
        guard let resp: RecommendationsResponse = await WebAPI.get("/api/recommendations", authed: true) else { return }
        blockedArtists = Set(resp.blockedArtists)
        tasteAlbums = filterBlocked(resp.fromYourTaste)
        personalizedAlbums = filterBlocked(resp.forYou)
        worlds = resp.worlds.map { (label: $0.label, albums: filterBlocked($0.albums)) }
        hasPersonalized = !personalizedAlbums.isEmpty
        personalizedSongs = []  // deferred until Windows rebuilds search RPCs

        // Discovery's own fetch runs concurrently and may have already populated these before
        // blockedArtists was known -- re-apply now that it is.
        popularAlbums = filterBlocked(popularAlbums)
        newReleaseAlbums = filterBlocked(newReleaseAlbums)
        trendingAlbums = filterBlocked(trendingAlbums)
    }

    private func filterBlocked(_ albums: [Release]) -> [Release] {
        blockedArtists.isEmpty ? albums : albums.filter { !blockedArtists.contains($0.artist) }
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

    // Monotonic token so a superseded search can never clobber a newer one's
    // results -- the debounce alone doesn't cover a slow old response landing
    // after a fast new one (web's search got the same stale-request guard
    // 2026-07-17).
    private var searchGeneration = 0

    func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        searchGeneration += 1
        let generation = searchGeneration
        guard q.count >= 2 else {
            artistResults = []
            albumResults  = []
            songResults   = []
            isSearching   = false
            return
        }
        isSearching = true

        // The three lookups used to run sequentially (album → songs →
        // artists), so a slow song lookup delayed album/artist results too
        // even though those are fast on their own -- measured live against
        // the catalog, most real search terms ("drake", "seoul", "jimin")
        // make the song step alone take 3+ seconds or time out outright,
        // since (unlike album/artist search) it has no dedicated search RPC,
        // just a raw ILIKE scan over ~2.3M recordings. They run concurrently,
        // and (2026-07-18, matching web's progressive search) results land
        // AS EACH FINISHES: albums + artists render immediately while the
        // slow song lookup is still going, instead of everything waiting on
        // the slowest of the three.
        async let albumsTask: [Release] = (try? await supabase
            .rpc("search_release_groups", params: SearchParams(q: q, lim: 30))
            .execute()
            .value) ?? []
        async let songsTask = fetchSongResults(q)
        async let artistsTask: [SearchArtist] = (try? await supabase
            .rpc("search_artists", params: SearchParams(q: q, lim: 10))
            .execute()
            .value) ?? []

        let albums = await albumsTask
        guard generation == searchGeneration else { return }
        albumResults = albums

        let artists = await artistsTask
        guard generation == searchGeneration else { return }
        artistResults = artists
        // The fast pair is in -- stop the spinner while songs stream in.
        isSearching = false

        let songs = await songsTask
        guard generation == searchGeneration else { return }
        songResults = songs

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
    @State private var searchVM           = SearchViewModel()
    @State private var searchTask: Task<Void, Never>?
    @State private var quickRateRelease: Release?
    @State private var quickRateScore: Double?     = nil
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
            .navigationDestination(isPresented: $showQuickAdd) {
                QuickAddView(discoveryVM: discoveryVM, onGoToSettings: onGoToSettings)
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
        }
        .task {
            await discoveryVM.load()
            await withTaskGroup(of: Void.self) { g in
                g.addTask { await loadUserRatingStep() }
                g.addTask { await loadRatedReleaseIds() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await discoveryVM.refreshSpotifyIfNeeded() }
                Task { await discoveryVM.refreshAppleMusicIfNeeded() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .sjSpotifyTokenRefreshed)) { _ in
            // Auth observer saved a fresh provider token — reload Spotify data now.
            // This fires after linkIdentity completes, which is later than scenePhase.active.
            Task { await discoveryVM.refreshSpotifyIfNeeded() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .sjAppleMusicAuthorized)) { _ in
            Task { await discoveryVM.refreshAppleMusicIfNeeded() }
        }
    }

    private func quickAddTapped() {
        showQuickAdd = true
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

    private func loadUserRatingStep() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct P: Decodable {
            let manualRatingStep: Double?
            enum CodingKeys: String, CodingKey {
                case manualRatingStep = "manual_rating_step"
            }
        }
        if let p: P = try? await supabase
            .from("profiles")
            .select("manual_rating_step")
            .eq("id", value: userId)
            .single()
            .execute()
            .value {
            userRatingStep = p.manualRatingStep ?? 0.5
        }
    }

    private func addRelease(_ release: Release) {
        quickRateScore   = nil
        quickRateRelease = release
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
                                    SongRow(song: song, isRated: rated)
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
                    // Resolved against the catalog up front (resolveRecentlyPlayedIfNeeded) --
                    // renders through the same albumScroll every other section uses, so a real
                    // cover size, add button, and context menu all come for free, and anything
                    // that didn't resolve to a real release is simply not shown instead of
                    // leading to a dead-end "not in catalog" tap.
                    if !discoveryVM.recentlyPlayedReleases.isEmpty {
                        discoverySectionTitle("Recently Listened")
                        albumScroll(discoveryVM.recentlyPlayedReleases, hideRated: false)
                        Spacer().frame(height: 24)
                    }

                    // ── Apple Music: Library Artists ──────────
                    if !discoveryVM.appleMusicArtists.isEmpty {
                        discoverySectionTitle("Your Library Artists")
                        appleMusicArtistScroll(discoveryVM.appleMusicArtists)
                        Spacer().frame(height: 24)
                    }

                    // ── Apple Music: Recently Listened ────────
                    if !discoveryVM.appleMusicRecentlyPlayedReleases.isEmpty {
                        discoverySectionTitle(
                            discoveryVM.recentlyPlayedReleases.isEmpty ? "Recently Listened" : "Recently Listened (Apple)"
                        )
                        albumScroll(discoveryVM.appleMusicRecentlyPlayedReleases, hideRated: false)
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

                    // ── Worlds (genre-cluster rows, e.g. "Because you love Dream Pop") ──
                    ForEach(Array(discoveryVM.worlds.enumerated()), id: \.offset) { _, world in
                        let visibleWorld = world.albums.filter {
                            !ratedReleaseIds.contains($0.id) || sessionRatedIds.contains($0.id)
                        }
                        if !visibleWorld.isEmpty {
                            discoverySectionTitle(
                                LocalizedStringKey(String(format: String(localized: "Because you love %@"), world.label))
                            )
                            albumScroll(visibleWorld)
                            Spacer().frame(height: 24)
                        }
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

                    // ── New Releases ──────────────────────────
                    let visibleNewReleases = discoveryVM.newReleaseAlbums.filter {
                        !ratedReleaseIds.contains($0.id) || sessionRatedIds.contains($0.id)
                    }
                    if !visibleNewReleases.isEmpty {
                        discoverySectionTitle("New Releases")
                        albumScroll(visibleNewReleases)
                        Spacer().frame(height: 24)
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
                    // sjCream, not .white -- sjInk flips light in dark mode, so a hardcoded
                    // white label disappears there (cream flips dark in step, like the
                    // other sjInk-background buttons: InviteView, onboarding steps).
                    .foregroundStyle(Color.sjCream)
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
                    // Navigates immediately (was previously gated behind an async
                    // search_artists resolution that blocked the page push for
                    // several seconds with zero loading feedback -- confusing, read
                    // as a dead tap). ArtistPageView now does that same identity-
                    // aware resolution itself, behind its own spinner, when
                    // `artistId` is nil -- matching how the Apple Music row below
                    // already navigates.
                    NavigationLink(value: ArtistDestination(artistId: nil, name: artist.name)) {
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

    private func songParentRelease(_ song: SongResult) -> Release {
        Release(id: song.releases.id, title: song.releases.title,
                artist: song.releases.artist, coverUrl: song.releases.coverUrl,
                releaseType: nil, releaseDate: nil,
                titleNative: nil, artistNative: nil,
                tracklist: nil, totalTracks: nil)
    }

    // hideRated: recommendation-style sections (Popular/Trending/For You/etc.) hide releases the
    // user already rated -- no point recommending something they've already done. Recently
    // Listened is a listening *history*, not a recommendation, so it passes false: you should
    // still see what you recently played whether you've rated it or not (was silently dropping
    // already-rated albums, e.g. one rated 4 days before ever showing up here, when this was
    // switched onto the shared component).
    private func albumScroll(_ albums: [Release], hideRated: Bool = true) -> some View {
        let visible = hideRated
            ? albums.filter { !ratedReleaseIds.contains($0.id) || sessionRatedIds.contains($0.id) }
            : albums
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(visible) { release in
                    // Not just session-rated -- an unfiltered list (hideRated: false) can include
                    // releases rated in an earlier session too, which should also show the
                    // checkmark rather than a misleading "add" button.
                    let checked = sessionRatedIds.contains(release.id) || ratedReleaseIds.contains(release.id)
                    NavigationLink(value: release) {
                        DiscoveryAlbumCard(release: release, isRated: checked)
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
                    SongRow(song: song, isRated: checked)
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
                } else {
                    AlbumRateButton(release: release, size: 30)
                        .padding(4)
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
                    .lineLimit(1)
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
            } else {
                // Keyed on the song's *parent release*, not the individual recording --
                // this row has never rated the song itself, only quick-added its album.
                AlbumRateButton(release: song.releases.asRelease, size: 30)
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
    // A failed/timed-out releases fetch used to be indistinguishable from a
    // genuinely empty artist (`try? ?? []`) -- the page then claimed
    // "0 releases" for artists that have plenty. Tracked so the empty state
    // can offer Retry instead of lying.
    @State private var loadFailed       = false
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
    @State private var songNavTarget: SongNavTarget? = nil
    @Namespace private var artistTabBubble

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
            case score; case createdAt = "created_at"
            case reviewText = "review_text"; case profiles
        }
        var displayScore: Double? { score }
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

                HStack(spacing: 10) {
                    artistStatBox(value: communityAvg.map { String(format: "%.1f", $0) } ?? "—",
                                  label: "Community Avg", showIcon: true)
                    artistStatBox(value: "\(communityCount)",
                                  label: communityCount == 1 ? "Rating" : "Ratings", showIcon: false)
                    // "—" while loading: rendering a live "0" here during the
                    // fetch is what read as "this artist has 0 releases".
                    artistStatBox(value: isLoading ? "—" : "\(releases.count)",
                                  label: "Releases", showIcon: false)
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
            // Floating glass-capsule bubble behind the selected label, sliding via
            // matchedGeometryEffect -- same pattern as Home's Explore/Following
            // switcher (`feedTabButton`), not a flat underline indicator.
            HStack(spacing: 4) {
                ForEach(tabLabels.indices, id: \.self) { i in
                    artistTabButton(i, label: tabLabels[i])
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
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
                            if loadFailed {
                                VStack(spacing: 12) {
                                    Text("Couldn't load this artist's releases.")
                                        .font(.system(size: 14)).foregroundStyle(Color.sjMuted)
                                    Button {
                                        isLoading = true
                                        Task { await load() }
                                    } label: {
                                        Text("Retry")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(Color.sjCream)
                                            .padding(.horizontal, 18).padding(.vertical, 8)
                                            .background(Color.sjInk)
                                            .clipShape(Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                                .frame(maxWidth: .infinity).padding(.top, 40)
                            } else if releases.isEmpty {
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
            SongDetailView(track: target.track, release: target.release)
                .onDisappear { if songNavTarget?.id == target.id { songNavTarget = nil } }
        }
        .task { await load() }
    }

    private func artistTabButton(_ i: Int, label: LocalizedStringKey) -> some View {
        Button { selectedTab = i } label: {
            Text(label)
                .font(.system(size: 12.5, weight: selectedTab == i ? .bold : .medium))
                .foregroundStyle(selectedTab == i ? Color.sjInk : Color.sjMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background {
                    if selectedTab == i {
                        Capsule()
                            .fill(Color.clear)
                            .glassEffect(.regular, in: Capsule())
                            .matchedGeometryEffect(id: "artistTabBubble", in: artistTabBubble)
                    }
                }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }

    /// Bordered stat tile -- same visual spec as `AlbumDetailView.communityStatBox`
    /// (rounded 10, `sjSurface` fill, `sjBorder` stroke, icon+value+label), so the
    /// artist page's summary numbers read as the same kind of object as the
    /// album page's, instead of the bare number+divider row this replaced.
    @ViewBuilder
    private func artistStatBox(value: String, label: LocalizedStringKey, showIcon: Bool) -> some View {
        HStack(spacing: 6) {
            if showIcon {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 12, height: 12).foregroundStyle(Color.sjBlue)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(Color.sjInk)
                Text(label)
                    .font(.system(size: 10)).foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
    }

    private func load() async {
        loadFailed = false
        var loaded: [Release]
        // Spotify/Apple Music rows only carry a name -- resolve the real catalog id via the same
        // identity-aware, alias-aware RPC used by search results (DiscoveryViewModel.resolveArtistId),
        // instead of the bare ILIKE fallback below, which can show an empty or wrong artist for a
        // name that doesn't string-match exactly (e.g. Korean-rendered "사이먼 도미닉" vs "Simon
        // Dominic"). This resolution used to happen BEFORE navigation even started (blocking the
        // page push for several seconds with no loading indicator, reading as a dead tap) -- moved
        // here so the page pushes immediately and this runs behind the spinner already below instead.
        let resolvedArtistId: UUID?
        if let id = artist.artistId {
            resolvedArtistId = id
        } else {
            resolvedArtistId = await DiscoveryViewModel.resolveArtistId(name: artist.name)
        }
        if let artistId = resolvedArtistId {
            // Identity-aware: returns all releases credited to this artist, regardless of credit position.
            // Independent of the canonical name/avatar lookup below -- run both concurrently instead of
            // waiting on the releases RPC before even starting the artist row fetch.
            struct ARow: Codable {
                let name: String; let coverUrl: String?
                enum CodingKeys: String, CodingKey { case name; case coverUrl = "cover_url" }
            }
            // Optional (nil = the fetch itself failed), NOT coalesced to [] --
            // a timeout must not masquerade as an artist with zero releases.
            func fetchReleases() async -> [Release]? {
                try? await supabase
                    .rpc("get_artist_release_groups", params: ArtistReleasesParams(p_artist_id: artistId.uuidString, lim: 60))
                    .execute()
                    .value
            }
            async let releasesFetch: [Release]? = fetchReleases()
            async let artistRowFetch: [ARow] = (try? await supabase
                .from("artists").select("name, cover_url")
                .eq("id", value: artistId.uuidString).limit(1).execute().value) ?? []

            var (releasesResult, arows) = await (releasesFetch, artistRowFetch)
            if let row = arows.first { artistAvatarUrl = row.coverUrl; canonicalName = row.name }
            if releasesResult == nil { releasesResult = await fetchReleases() }  // one retry
            guard let releasesResult else {
                loadFailed = true
                releases = []
                isLoading = false
                isLoadingSongs = false
                return
            }
            loaded = releasesResult
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
        // Releases are the page -- render them NOW and let community scores /
        // my-ratings stream in below (their state updates re-render the rows).
        // Previously isLoading stayed true through the full ratings fetch too,
        // so the whole page sat on a spinner well after the releases existed.
        isLoading = false
        ImageCache.prefetch(loaded.compactMap { URL(string: $0.coverUrl?.thumbnailUrl ?? "") })

        let releaseGroupIds = loaded.map(\.id.uuidString)
        guard !releaseGroupIds.isEmpty else { isLoadingSongs = false; return }

        // Not part of the async let group below on purpose -- this is the
        // slowest single query on the page (unindexed ILIKE scan over
        // recordings) and the default Albums tab never needs its result, so
        // it runs independently instead of gating isLoading.
        Task {
            await loadSongs()
            isLoadingSongs = false
        }

        struct RRow: Codable {
            let releaseGroupId: UUID; let userId: UUID; let score: Double?
            enum CodingKeys: String, CodingKey {
                case releaseGroupId = "release_group_id"; case userId = "user_id"; case score
            }
        }
        // Independent of each other (the feed doesn't need the stats query's
        // result, or vice versa) -- was two sequential round trips, now concurrent.
        async let statsRowsFetch: [RRow] = (try? await supabase
            .from("ratings").select("release_group_id, user_id, score")
            .in("release_group_id", values: releaseGroupIds).execute().value) ?? []
        async let communityFeedFetch = loadCommunityFeed(releaseGroupIds: releaseGroupIds)
        let (rows, feed) = await (statsRowsFetch, communityFeedFetch)
        communityFeed = feed

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
    }

    /// Was two sequential round trips (ratings, then a separate profiles lookup
    /// keyed off the ratings' user ids) -- now one, embedding profiles via the
    /// same `profiles!ratings_user_id_fkey(...)` join HomeView's feed queries
    /// already use, since `CommunityRating` already decodes a nested `profiles`.
    private func loadCommunityFeed(releaseGroupIds: [String]) async -> [CommunityRating] {
        (try? await supabase
            .from("ratings")
            .select("id, user_id, release_group_id, score, created_at, review_text, profiles!ratings_user_id_fkey(username, display_name)")
            .in("release_group_id", values: releaseGroupIds)
            .order("created_at", ascending: false)
            .limit(60)
            .execute().value) ?? []
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

        struct TRRow: Codable {
            let recordingId: UUID; let userId: UUID; let score: Double?
            enum CodingKeys: String, CodingKey {
                case recordingId = "recording_id"; case userId = "user_id"; case score
            }
        }
        let trRows: [TRRow] = (try? await supabase
            .from("track_ratings").select("recording_id, user_id, score")
            .in("recording_id", values: hits.map(\.id.uuidString)).execute().value) ?? []
        let currentUserId = supabase.auth.currentUser?.id
        var trCount: [UUID: Int] = [:]
        var trSum:   [UUID: (sum: Double, n: Int)] = [:]
        var myMap:   [UUID: Double] = [:]
        for r in trRows {
            trCount[r.recordingId, default: 0] += 1
            if let d = r.score {
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
                            ScoreBadge(score: score, badgeSize: 32, ringStroke: 2, ringGap: 1.5)
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
            // One person's own rating -- ScoreBadge, same as everywhere else an
            // individual rating shows (see the note on ArtistReleaseRow's userScore).
            if let score = entry.displayScore {
                ScoreBadge(score: score, badgeSize: 24, ringStroke: 1.5, ringGap: 1)
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
                        Image("icon-flower")
                            .renderingMode(.template).resizable().scaledToFit()
                            .frame(width: 12, height: 12)
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
                ZStack(alignment: .bottomTrailing) {
                    CoverImage(url: release.coverUrl, cornerRadius: 6)
                        .frame(width: 44, height: 44)
                        .accessibilityHidden(true) // title text alongside already describes it

                    if userScore == nil {
                        AlbumRateButton(release: release, size: 22)
                            .offset(x: 3, y: 3)
                    }
                }

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
                    // An individual rating (mine) -- ScoreBadge, the same badge every
                    // other individual-rating surface in the app uses (AlbumDetailView's
                    // "Your Rating", ProfileView's rated list, HomeView's feed). The
                    // community average just below stays plain text on purpose: it's an
                    // aggregate, not anyone's specific rating, and the app never puts an
                    // aggregate in a ScoreBadge (see AlbumDetailView's Community Avg tile).
                    ScoreBadge(score: s, badgeSize: 26, ringStroke: 1.5, ringGap: 1)
                } else if let s = communityScore {
                    flowerScore(s, color: Color.sjAmber)
                } else {
                    ZStack {
                        Circle().stroke(Color.sjBorder, lineWidth: 1.5).frame(width: 24, height: 24)
                        Image("icon-flower")
                            .renderingMode(.template).resizable().scaledToFit()
                            .frame(width: 12, height: 12)
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
