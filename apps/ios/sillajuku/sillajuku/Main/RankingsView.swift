import SwiftUI
import Observation
import Supabase

// MARK: - Data models

struct ChartsPulse {
    let totalRatings: Int
    let avgScore: Double
    let todayCount: Int
}

struct ChartEntry: Identifiable, Hashable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    var avgScore: Double?
    var ratingCount: Int?
    var newCount: Int?

    static func == (lhs: ChartEntry, rhs: ChartEntry) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl,
                releaseType: nil, releaseDate: nil, titleNative: nil, artistNative: nil,
                tracklist: nil, totalTracks: nil)
    }
}

struct ChartGenre: Identifiable, Hashable {
    let id: String
    let name: String
    let slug: String      // used in ILIKE queries
    let symbol: String    // SF Symbol name
    let bgColor: Color

    static func == (lhs: ChartGenre, rhs: ChartGenre) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    static let all: [ChartGenre] = [
        ChartGenre(id: "kpop",       name: "K-Pop",      slug: "k-pop",
                   symbol: "music.note.list", bgColor: Color(red: 0.10, green: 0.10, blue: 0.22)),
        ChartGenre(id: "hiphop",     name: "Hip-Hop",    slug: "hip-hop",
                   symbol: "mic.fill",        bgColor: Color(red: 0.10, green: 0.10, blue: 0.10)),
        ChartGenre(id: "rock",       name: "Rock",       slug: "rock",
                   symbol: "guitars.fill",    bgColor: Color(red: 0.10, green: 0.14, blue: 0.28)),
        ChartGenre(id: "electronic", name: "Electronic", slug: "electronic",
                   symbol: "waveform",        bgColor: Color(red: 0.14, green: 0.10, blue: 0.25)),
        ChartGenre(id: "indie",      name: "Indie",      slug: "indie",
                   symbol: "leaf.fill",       bgColor: Color(red: 0.10, green: 0.18, blue: 0.10)),
        ChartGenre(id: "rnb",        name: "R&B",        slug: "r&b",
                   symbol: "heart.fill",      bgColor: Color(red: 0.22, green: 0.10, blue: 0.14)),
    ]
}

struct RankingDetailDestination: Hashable {}

// A chart category that can be drilled into (non-genre)
enum ChartDetailType: Hashable {
    case topRated
    case mostRated
    case hiddenGems
    case controversial
    case trending
    case bestOfYear(start: Int, end: Int, label: String)

    var title: String {
        switch self {
        case .topRated:             return "Top Rated"
        case .mostRated:            return "Most Rated"
        case .hiddenGems:           return "Hidden Gems"
        case .controversial:        return "Controversial"
        case .trending:             return "Trending"
        case .bestOfYear(_, _, let label): return label
        }
    }
}

enum TrendingMode { case global_, forYou }

// Silla Score leaderboard row — returned by get_silla_leaderboard RPC
private struct SillaLeaderboardRow: Codable {
    let releaseId:   UUID
    let title:       String
    let artist:      String
    let coverUrl:    String?
    let sillaScore:  Double
    let ratingCount: Int?
    enum CodingKeys: String, CodingKey {
        case releaseId   = "release_id"; case title; case artist
        case coverUrl    = "cover_url"
        case sillaScore  = "silla_score"
        case ratingCount = "rating_count"
    }
}

private struct SillaLeaderboardParams: Encodable {
    let p_genre:   String?
    let p_country: String?
    let p_limit:   Int
    let p_offset:  Int
}

// Shared Codable rows — must be at file scope (Swift disallows type declarations in generic functions)
private struct RankedRPCRow: Codable {
    let releaseId: UUID; let title: String; let artist: String
    let coverUrl: String?; let avgScore: Double?; let ratingCount: Int?
    enum CodingKeys: String, CodingKey {
        case releaseId   = "release_id"; case title; case artist
        case coverUrl    = "cover_url"
        case avgScore    = "avg_score"
        case ratingCount = "rating_count"
    }
}

private struct TrendingRPCRow: Codable {
    let releaseId: UUID; let title: String; let artist: String
    let coverUrl: String?; let newCount: Int?
    enum CodingKeys: String, CodingKey {
        case releaseId = "release_id"; case title; case artist
        case coverUrl  = "cover_url";  case newCount = "new_count"
    }
}

private struct SongRPCRow: Codable {
    let releaseId: UUID; let trackPosition: Int; let trackTitle: String
    let artist: String; let albumTitle: String; let coverUrl: String?
    let avgScore: Double?; let ratingCount: Int?
    enum CodingKeys: String, CodingKey {
        case releaseId    = "release_id"; case trackPosition = "track_position"
        case trackTitle   = "track_title"; case artist; case albumTitle = "album_title"
        case coverUrl     = "cover_url"; case avgScore = "avg_score"
        case ratingCount  = "rating_count"
    }
}

private struct TrendingSongRPCRow: Codable {
    let releaseId: UUID; let trackPosition: Int; let trackTitle: String
    let artist: String; let albumTitle: String; let coverUrl: String?; let newCount: Int?
    enum CodingKeys: String, CodingKey {
        case releaseId    = "release_id"; case trackPosition = "track_position"
        case trackTitle   = "track_title"; case artist; case albumTitle = "album_title"
        case coverUrl     = "cover_url"; case newCount = "new_count"
    }
}

enum ChartMode: Hashable { case albums, songs }

struct ChartSongEntry: Identifiable, Hashable {
    var id: String { "\(releaseId)_\(trackPosition)" }
    let releaseId: UUID
    let trackPosition: Int
    let trackTitle: String
    let artist: String
    let albumTitle: String
    let coverUrl: String?
    var avgScore: Double?
    var ratingCount: Int?
    var newCount: Int?

    var asRelease: Release {
        Release(id: releaseId, title: albumTitle, artist: artist, coverUrl: coverUrl,
                releaseType: nil, releaseDate: nil, titleNative: nil, artistNative: nil,
                tracklist: nil, totalTracks: nil)
    }

    static func == (lhs: ChartSongEntry, rhs: ChartSongEntry) -> Bool { lhs.id == rhs.id }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - ChartsViewModel

@Observable
class ChartsViewModel {
    var pulse: ChartsPulse?
    var trendingGlobal: [ChartEntry] = []
    var trendingForYou: [ChartEntry] = []
    var topRated: [ChartEntry] = []
    var mostRated: [ChartEntry] = []
    var trendingMode: TrendingMode = .forYou
    var chartMode: ChartMode = .albums
    // Songs
    var topRatedSongs: [ChartSongEntry] = []
    var mostRatedSongs: [ChartSongEntry] = []
    var trendingSongs: [ChartSongEntry] = []
    var isLoading = true
    private var hasLoaded = false

    var activeTrending: [ChartEntry] {
        trendingMode == .forYou && !trendingForYou.isEmpty ? trendingForYou : trendingGlobal
    }

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        isLoading = true
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadPulse() }
            group.addTask { await self.loadTopRated() }
            group.addTask { await self.loadMostRated() }
            group.addTask { await self.loadTrendingGlobal() }
            group.addTask { await self.loadTrendingForYou() }
            group.addTask { await self.loadTopRatedSongs() }
            group.addTask { await self.loadMostRatedSongs() }
            group.addTask { await self.loadTrendingSongs() }
        }
        isLoading = false
    }

    // MARK: Loaders

    private func loadPulse() async {
        struct PulseRow: Codable {
            let totalRatings: Int?; let avgScore: Double?; let todayCount: Int?
            enum CodingKeys: String, CodingKey {
                case totalRatings = "total_ratings"
                case avgScore     = "avg_score"
                case todayCount   = "today_count"
            }
        }
        let rows: [PulseRow] = (try? await supabase.rpc("get_charts_pulse").execute().value) ?? []
        if let row = rows.first {
            pulse = ChartsPulse(
                totalRatings: row.totalRatings ?? 0,
                avgScore:     row.avgScore     ?? 0,
                todayCount:   row.todayCount   ?? 0
            )
        }
    }

    private func loadTopRated() async {
        topRated = await fetchRanked(rpc: "get_charts_top_rated", params: ["p_limit": 20])
    }

    private func loadMostRated() async {
        mostRated = await fetchRanked(rpc: "get_charts_most_rated", params: ["p_limit": 20])
    }

    private func loadTrendingGlobal() async {
        trendingGlobal = await fetchTrending(rpc: "get_charts_trending", params: ["p_limit": 5])
    }

    private func loadTrendingForYou() async {
        guard let session = try? await supabase.auth.session else {
            trendingForYou = trendingGlobal; return
        }
        struct GenreRow: Codable { let genre: String; let count: Int }
        struct UserGenresParams: Encodable { let p_user_id: UUID; let p_limit: Int }
        let genreRows: [GenreRow] = (try? await supabase
            .rpc("get_user_top_genres", params: UserGenresParams(p_user_id: session.user.id, p_limit: 3))
            .execute().value) ?? []
        let genres = genreRows.map { $0.genre.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard !genres.isEmpty else { trendingForYou = trendingGlobal; return }

        struct ForGenresParams: Encodable { let p_genres: [String]; let p_limit: Int }
        let rows = await fetchTrending(
            rpc: "get_charts_trending_for_genres",
            params: ForGenresParams(p_genres: genres, p_limit: 5)
        )
        trendingForYou = rows.isEmpty ? trendingGlobal : rows
    }

    private func loadTopRatedSongs() async {
        let rows: [SongRPCRow] = (try? await supabase
            .rpc("get_charts_top_rated_songs", params: ["p_limit": 20])
            .execute().value) ?? []
        topRatedSongs = rows.map { makeSongEntry($0) }
    }

    private func loadMostRatedSongs() async {
        let rows: [SongRPCRow] = (try? await supabase
            .rpc("get_charts_most_rated_songs", params: ["p_limit": 20])
            .execute().value) ?? []
        mostRatedSongs = rows.map { makeSongEntry($0) }
    }

    private func loadTrendingSongs() async {
        let rows: [TrendingSongRPCRow] = (try? await supabase
            .rpc("get_charts_trending_songs", params: ["p_limit": 10])
            .execute().value) ?? []
        trendingSongs = rows.map {
            ChartSongEntry(releaseId: $0.releaseId, trackPosition: $0.trackPosition,
                           trackTitle: $0.trackTitle, artist: $0.artist,
                           albumTitle: $0.albumTitle, coverUrl: $0.coverUrl,
                           avgScore: nil, ratingCount: nil, newCount: $0.newCount)
        }
    }

    private func makeSongEntry(_ r: SongRPCRow) -> ChartSongEntry {
        ChartSongEntry(releaseId: r.releaseId, trackPosition: r.trackPosition,
                       trackTitle: r.trackTitle, artist: r.artist,
                       albumTitle: r.albumTitle, coverUrl: r.coverUrl,
                       avgScore: r.avgScore, ratingCount: r.ratingCount, newCount: nil)
    }

    // MARK: Generic fetch helpers

    private func fetchRanked(rpc name: String, params: some Encodable) async -> [ChartEntry] {
        let rows: [RankedRPCRow] = (try? await supabase.rpc(name, params: params).execute().value) ?? []
        return rows.map {
            ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                       coverUrl: $0.coverUrl, avgScore: $0.avgScore,
                       ratingCount: $0.ratingCount, newCount: nil)
        }
    }

    private func fetchTrending(rpc name: String, params: some Encodable) async -> [ChartEntry] {
        let rows: [TrendingRPCRow] = (try? await supabase.rpc(name, params: params).execute().value) ?? []
        return rows.map {
            ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                       coverUrl: $0.coverUrl, avgScore: nil, ratingCount: nil, newCount: $0.newCount)
        }
    }
}

// MARK: - ChartsView (hub)

struct ChartsView: View {
    var viewModel: ChartsViewModel

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                Color.sjCream.ignoresSafeArea()
                chartContent
                floatingHeader
            }
            .navigationBarHidden(true)
            .navigationDestination(for: Release.self)              { AlbumDetailView(release: $0) }
            .navigationDestination(for: ChartDetailType.self)      { ChartDetailView(type: $0) }
            .navigationDestination(for: ChartGenre.self)           { GenreDetailView(genre: $0) }
            .navigationDestination(for: RankingDetailDestination.self) { _ in
                RankingDetailView()
            }
        }
        .task { await viewModel.load() }
    }

    // MARK: Floating header (Albums / Songs — same style as Home Explore/Following)

    private var floatingHeader: some View {
        HStack(spacing: 28) {
            chartTabButton(.albums, label: "Albums")
            chartTabButton(.songs,  label: "Songs")
        }
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity)
        .background(Color.sjCream.ignoresSafeArea(edges: .top))
    }

    private func chartTabButton(_ mode: ChartMode, label: String) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.18)) { viewModel.chartMode = mode }
        } label: {
            Text(label)
                .font(.system(size: 17, weight: viewModel.chartMode == mode ? .bold : .regular))
                .foregroundStyle(viewModel.chartMode == mode ? Color.sjInk : Color.sjMuted)
        }
        .buttonStyle(.plain)
    }

    // MARK: Swipeable tab content

    private var chartContent: some View {
        TabView(selection: Binding(
            get: { viewModel.chartMode },
            set: { viewModel.chartMode = $0 }
        )) {
            albumsTab.tag(ChartMode.albums)
            songsTab.tag(ChartMode.songs)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .animation(.easeInOut(duration: 0.18), value: viewModel.chartMode)
    }

    private var albumsTab: some View {
        Group {
            if viewModel.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        RankingBlock(entries: viewModel.topRated)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 22)

                        TrendingCard(viewModel: viewModel)
                            .padding(.bottom, 22)

                        ChartHorizSection(
                            title: "Most Rated",
                            entries: viewModel.mostRated,
                            destination: ChartDetailType.mostRated,
                            showScore: false
                        )
                        .padding(.bottom, 22)

                        GenreScrollSection()
                            .padding(.bottom, 22)

                        InsightCardRow()
                            .padding(.bottom, 22)

                        YearScrollSection()
                            .padding(.bottom, 22)

                        PulseCard(pulse: viewModel.pulse)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 32)
                    }
                }
                .contentMargins(.top, 54, for: .scrollContent)
            }
        }
    }

    private var songsTab: some View {
        Group {
            if viewModel.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        SongHorizSection(
                            title: "Top Rated",
                            entries: viewModel.topRatedSongs,
                            showScore: true
                        )
                        .padding(.bottom, 22)

                        SongHorizSection(
                            title: "Most Rated",
                            entries: viewModel.mostRatedSongs,
                            showScore: false
                        )
                        .padding(.bottom, 22)

                        TrendingSongsSection(entries: viewModel.trendingSongs)
                            .padding(.bottom, 32)
                    }
                }
                .contentMargins(.top, 54, for: .scrollContent)
            }
        }
    }
}

// MARK: - Song hub sections

private struct SongHorizSection: View {
    let title: String
    let entries: [ChartSongEntry]
    let showScore: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .padding(.horizontal, 16)

            if entries.isEmpty {
                Text("No data yet.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.horizontal, 16)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(entries.prefix(20).enumerated()), id: \.element.id) { idx, entry in
                            NavigationLink(value: entry.asRelease) {
                                HorizSongCard(rank: idx + 1, entry: entry, showScore: showScore)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
    }
}

private struct HorizSongCard: View {
    let rank: Int
    let entry: ChartSongEntry
    let showScore: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ZStack(alignment: .topLeading) {
                CoverThumb(url: entry.coverUrl, size: 110, radius: 10)

                Text("#\(rank)")
                    .font(.system(size: 9, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(Color.black.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    .padding(5)

                if showScore, let score = entry.avgScore {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            Text(String(format: "%.1f", score))
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Color.sjAmber)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                                .padding(5)
                        }
                    }
                }
            }
            .frame(width: 110, height: 110)

            Text(entry.trackTitle)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjInk)
                .lineLimit(1)
                .frame(width: 110, alignment: .leading)

            Text(entry.artist)
                .font(.system(size: 10))
                .foregroundStyle(Color.sjMuted)
                .lineLimit(1)
                .frame(width: 110, alignment: .leading)

            Text(entry.albumTitle)
                .font(.system(size: 9))
                .foregroundStyle(Color.sjMuted.opacity(0.7))
                .lineLimit(1)
                .frame(width: 110, alignment: .leading)
        }
    }
}

private struct TrendingSongsSection: View {
    let entries: [ChartSongEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color.sjAmber)
                Text("Trending")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.sjInk)
            }
            .padding(.horizontal, 16)

            if entries.isEmpty {
                Text("No trending song data yet.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(entries.prefix(10).enumerated()), id: \.element.id) { idx, entry in
                        NavigationLink(value: entry.asRelease) {
                            TrendingSongRow(rank: idx + 1, entry: entry)
                        }
                        .buttonStyle(.plain)
                        if idx < min(10, entries.count) - 1 {
                            Divider().padding(.leading, 16)
                        }
                    }
                }
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder, lineWidth: 0.5))
                .padding(.horizontal, 16)
            }
        }
    }
}

private struct TrendingSongRow: View {
    let rank: Int
    let entry: ChartSongEntry

    var body: some View {
        HStack(spacing: 8) {
            Text("\(rank)")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color.sjMuted)
                .frame(width: 14, alignment: .trailing)

            CoverThumb(url: entry.coverUrl, size: 38, radius: 6)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.trackTitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text("\(entry.artist) · \(entry.albumTitle)")
                    .font(.system(size: 10))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            Spacer()
            if let n = entry.newCount {
                VStack(alignment: .trailing, spacing: 1) {
                    Text("+\(n)")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                    Text("this week")
                        .font(.system(size: 8))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

// MARK: - RankingBlock

private struct RankingBlock: View {
    let entries: [ChartEntry]

    @State private var isExpanded = false
    @State private var selectedGenre: String? = nil
    @State private var selectedCountry: String? = nil

    private let genres    = ["Hip Hop", "K-Pop", "Jazz", "Electronic", "Classical", "Metal", "R&B", "Pop"]
    private let countries = [("Global", Optional<String>.none), ("🇰🇷 KR", "kr"), ("🇯🇵 JP", "jp"),
                             ("🇺🇸 US", "us"), ("🇬🇧 UK", "uk"), ("🇫🇷 FR", "fr"), ("🌎 LA", "la")]

    var body: some View {
        VStack(spacing: 0) {
            // Header — tap to collapse / expand
            Button {
                withAnimation(.easeInOut(duration: 0.22)) { isExpanded.toggle() }
            } label: {
                HStack {
                    HStack(spacing: 8) {
                        Image(systemName: "trophy.fill")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Color.sjAmber)
                        Text("Ranking")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                    }
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjMuted)
                        .rotationEffect(.degrees(isExpanded ? 180 : 0))
                        .animation(.easeInOut(duration: 0.22), value: isExpanded)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isExpanded {
                expandedContent
            } else {
                collapsedTeaser
            }
        }
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sjBorder, lineWidth: 0.5))
        .animation(.easeInOut(duration: 0.22), value: isExpanded)
    }

    // MARK: Collapsed — 3-album teaser

    private var collapsedTeaser: some View {
        GeometryReader { geo in
            let itemSize = (geo.size.width - 20) / 3   // 2 gaps of 10pt
            HStack(spacing: 10) {
                ForEach(Array(entries.prefix(3).enumerated()), id: \.element.id) { idx, entry in
                    NavigationLink(value: entry.asRelease) {
                        ZStack(alignment: .topLeading) {
                            CoverThumb(url: entry.coverUrl, size: itemSize, radius: 8)
                            Text("#\(idx + 1)")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Color.black.opacity(0.55))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                                .padding(5)
                        }
                        .overlay(alignment: .bottomTrailing) {
                            if let score = entry.avgScore {
                                Text(String(format: "%.1f", score))
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 5).padding(.vertical, 2)
                                    .background(Color.sjAmber)
                                    .clipShape(RoundedRectangle(cornerRadius: 4))
                                    .padding(5)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .frame(height: (UIScreen.main.bounds.width - 32 - 20) / 3)   // 32 = outer h-padding, 20 = gaps
        .padding(.horizontal, 16)
        .padding(.bottom, 14)
    }

    // MARK: Expanded — filters + rows + see all

    @ViewBuilder
    private var expandedContent: some View {
        Divider()

        // Genre
        filterLabel("Genre")
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                filterChip(nil, label: "All", selectedValue: selectedGenre) { selectedGenre = nil }
                ForEach(genres, id: \.self) { genre in
                    filterChip(genre, label: genre, selectedValue: selectedGenre) { selectedGenre = genre }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }

        // Country
        filterLabel("Country")
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 7) {
                ForEach(countries, id: \.0) { label, code in
                    filterChip(code, label: label, selectedValue: selectedCountry) { selectedCountry = code }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }

        Divider()

        // Top 5 rows
        VStack(spacing: 0) {
            ForEach(Array(entries.prefix(5).enumerated()), id: \.element.id) { idx, entry in
                NavigationLink(value: entry.asRelease) {
                    rankRow(rank: idx + 1, entry: entry)
                }
                .buttonStyle(.plain)
                if idx < min(4, entries.count - 1) {
                    Divider().padding(.leading, 16 + 24 + 8 + 44 + 8)
                }
            }
        }

        Divider()

        // See full ranking
        NavigationLink(value: RankingDetailDestination()) {
            HStack(spacing: 4) {
                Text("See full ranking")
                    .font(.system(size: 14, weight: .semibold))
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(Color.sjAmber)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Helpers

    private func filterLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .kerning(0.4)
            .textCase(.uppercase)
            .padding(.horizontal, 16)
            .padding(.top, 10)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func filterChip(_ value: String?, label: String, selectedValue: String?, action: @escaping () -> Void) -> some View {
        let selected = selectedValue == value
        return Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(selected ? .white : Color.sjMuted)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(selected ? Color.sjAmber : Color.sjCream)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(!selected ? RoundedRectangle(cornerRadius: 14).stroke(Color.sjBorder, lineWidth: 0.5) : nil)
        }
        .buttonStyle(.plain)
    }

    private func rankRow(rank: Int, entry: ChartEntry) -> some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.system(size: 16, weight: .black))
                .foregroundStyle(rank <= 3 ? Color.sjAmber : Color.sjBorder)
                .frame(width: 24, alignment: .center)
                .monospacedDigit()

            CoverThumb(url: entry.coverUrl, size: 44, radius: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(entry.artist)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if let score = entry.avgScore {
                VStack(alignment: .trailing, spacing: 3) {
                    Text(String(format: "%.1f", score))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(Color.sjAmber)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    Text("avg")
                        .font(.system(size: 10))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }
}

// MARK: - RankingDetailView

struct RankingDetailView: View {
    @State private var entries:    [ChartEntry] = []
    @State private var isLoading   = true
    @State private var selectedGenre:   String? = nil
    @State private var selectedCountry: String? = nil

    private let genres    = ["Hip Hop", "K-Pop", "Jazz", "Electronic", "Classical", "Metal", "R&B", "Pop"]
    private let countries = [("Global", Optional<String>.none), ("🇰🇷 KR", "kr"), ("🇯🇵 JP", "jp"),
                             ("🇺🇸 US", "us"), ("🇬🇧 UK", "uk"), ("🇫🇷 FR", "fr"), ("🌎 LA", "la")]

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            VStack(spacing: 0) {
                // Sticky filter bar
                filterBar
                    .background(Color.sjCream)
                Divider()

                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if entries.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "trophy")
                            .font(.system(size: 36)).foregroundStyle(Color.sjMuted)
                        Text("No ranking data yet.")
                            .font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            // Podium (#1–3)
                            if entries.count >= 3 {
                                PodiumRow(entries: Array(entries.prefix(3)))
                                    .padding(.horizontal, 16).padding(.vertical, 14)
                                Divider()
                            }
                            // Rest of the list
                            let offset = entries.count >= 3 ? 3 : 0
                            ForEach(Array(entries.dropFirst(offset).enumerated()), id: \.element.id) { idx, entry in
                                NavigationLink(value: entry.asRelease) {
                                    RankedListRow(rank: idx + offset + 1, entry: entry, isTrending: false)
                                }
                                .buttonStyle(.plain)
                                Divider().padding(.leading, 16)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Ranking")
        .navigationBarTitleDisplayMode(.large)
        .task { await load() }
        .onChange(of: selectedGenre)   { Task { await load() } }
        .onChange(of: selectedCountry) { Task { await load() } }
    }

    // MARK: Filter bar

    private var filterBar: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    detailChip(nil, label: "All", selectedValue: selectedGenre) { selectedGenre = nil }
                    ForEach(genres, id: \.self) { g in
                        detailChip(g, label: g, selectedValue: selectedGenre) { selectedGenre = g }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
            Divider()
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(countries, id: \.0) { label, code in
                        detailChip(code, label: label, selectedValue: selectedCountry) { selectedCountry = code }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
        }
    }

    private func detailChip(_ value: String?, label: String, selectedValue: String?, action: @escaping () -> Void) -> some View {
        let selected = selectedValue == value
        return Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(selected ? .white : Color.sjMuted)
                .padding(.horizontal, 12).padding(.vertical, 5)
                .background(selected ? Color.sjAmber : Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .overlay(!selected ? RoundedRectangle(cornerRadius: 14).stroke(Color.sjBorder, lineWidth: 0.5) : nil)
        }
        .buttonStyle(.plain)
    }

    // MARK: Load

    private func load() async {
        isLoading = true
        let params = SillaLeaderboardParams(
            p_genre:   selectedGenre,
            p_country: selectedCountry,
            p_limit:   100,
            p_offset:  0
        )
        let rows: [SillaLeaderboardRow] = (try? await supabase
            .rpc("get_silla_leaderboard", params: params)
            .execute().value) ?? []
        // silla_score is [0,1]; scale ×5 so the badge reads on the same 0–5 axis as ratings
        entries = rows.map {
            ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                       coverUrl: $0.coverUrl, avgScore: $0.sillaScore * 5.0,
                       ratingCount: $0.ratingCount, newCount: nil)
        }
        isLoading = false
    }
}

// MARK: - PulseCard

private struct PulseCard: View {
    let pulse: ChartsPulse?

    var body: some View {
        HStack(spacing: 0) {
            PulseStat(value: formatCount(pulse?.totalRatings), label: "total ratings")
            Divider().frame(height: 28).overlay(Color.white.opacity(0.15))
            PulseStat(value: pulse.map { String(format: "%.2f", $0.avgScore) } ?? "—", label: "community avg")
            Divider().frame(height: 28).overlay(Color.white.opacity(0.15))
            PulseStat(value: formatCount(pulse?.todayCount), label: "rated today")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(Color(red: 0.10, green: 0.10, blue: 0.10))
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func formatCount(_ n: Int?) -> String {
        guard let n else { return "—" }
        if n >= 1_000 { return String(format: "%.1fk", Double(n) / 1_000) }
        return "\(n)"
    }
}

private struct PulseStat: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.system(size: 17, weight: .black, design: .default))
                .foregroundStyle(Color.sjAmber)
                .monospacedDigit()
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.45))
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - TrendingCard

private struct TrendingCard: View {
    @Bindable var viewModel: ChartsViewModel   // won't work with @Observable directly; use State trick
    // @Observable classes need the parent to pass binding, but since ChartsViewModel is @Observable
    // we just read/write the property directly — SwiftUI tracks it.
    // Using a local approach: read viewModel.trendingMode, write via viewModel.trendingMode = ...

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header row
            HStack(alignment: .center) {
                HStack(spacing: 6) {
                    Image(systemName: "flame.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.sjAmber)
                    Text("Trending")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                }
                Spacer()
                // Toggle
                HStack(spacing: 0) {
                    toggleBtn(label: "Global",  mode: .global_)
                    toggleBtn(label: "For You", mode: .forYou)
                }
                .background(Color.black.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 10)

            let entries = viewModel.activeTrending
            if entries.isEmpty {
                Text("No trending data yet.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(entries.prefix(5).enumerated()), id: \.element.id) { idx, entry in
                        NavigationLink(value: entry.asRelease) {
                            TrendingRow(rank: idx + 1, entry: entry)
                        }
                        .buttonStyle(.plain)
                        if idx < entries.prefix(5).count - 1 {
                            Divider().padding(.leading, 16 + 14 + 8 + 38 + 8)
                        }
                    }
                }
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder, lineWidth: 0.5)
                )
                .padding(.horizontal, 16)

                NavigationLink(value: ChartDetailType.trending) {
                    Text("See all")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.sjAmber)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 10)
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func toggleBtn(label: String, mode: TrendingMode) -> some View {
        let active = viewModel.trendingMode == mode
        Button {
            viewModel.trendingMode = mode
        } label: {
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(active ? Color.sjInk : Color.sjMuted)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(active ? Color.sjSurface : Color.clear)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .shadow(color: active ? Color.black.opacity(0.08) : .clear, radius: 2, y: 1)
        }
        .buttonStyle(.plain)
    }
}

private struct TrendingRow: View {
    let rank: Int
    let entry: ChartEntry

    var body: some View {
        HStack(spacing: 8) {
            Text("\(rank)")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color.sjMuted)
                .frame(width: 14, alignment: .trailing)

            CoverThumb(url: entry.coverUrl, size: 52, radius: 8)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                if let n = entry.newCount {
                    Text("\(entry.artist) · +\(n) this week")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)
                } else {
                    Text(entry.artist)
                        .font(.system(size: 11))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.sjBorder)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}

// MARK: - Horizontal album scroll section

private struct ChartHorizSection: View {
    let title: String
    let entries: [ChartEntry]
    let destination: ChartDetailType
    let showScore: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Spacer()
                NavigationLink(value: destination) {
                    Text("See all")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.sjAmber)
                }
                .padding(.trailing, 16)
            }
            .padding(.leading, 16)

            if entries.isEmpty {
                Text("No data yet.")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.horizontal, 16)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) {
                        ForEach(Array(entries.prefix(20).enumerated()), id: \.element.id) { idx, entry in
                            NavigationLink(value: entry.asRelease) {
                                HorizAlbumCard(rank: idx + 1, entry: entry, showScore: showScore)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
        }
    }
}

private struct HorizAlbumCard: View {
    let rank: Int
    let entry: ChartEntry
    let showScore: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            ZStack(alignment: .topLeading) {
                CoverThumb(url: entry.coverUrl, size: 110, radius: 10)

                Text("#\(rank)")
                    .font(.system(size: 9, weight: .black))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(Color.black.opacity(0.6))
                    .clipShape(RoundedRectangle(cornerRadius: 3))
                    .padding(5)

                if showScore, let score = entry.avgScore {
                    VStack {
                        Spacer()
                        HStack {
                            Spacer()
                            Text(String(format: "%.1f", score))
                                .font(.system(size: 10, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 2)
                                .background(Color.sjAmber)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                                .padding(5)
                        }
                    }
                }
            }
            .frame(width: 110, height: 110)

            Text(entry.title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjInk)
                .lineLimit(1)
                .frame(width: 110, alignment: .leading)

            Text(entry.artist)
                .font(.system(size: 10))
                .foregroundStyle(Color.sjMuted)
                .lineLimit(1)
                .frame(width: 110, alignment: .leading)
        }
    }
}

// MARK: - Genre scroll section

private struct GenreScrollSection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("By Genre")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(ChartGenre.all) { genre in
                        NavigationLink(value: genre) {
                            GenrePill(genre: genre)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

private struct GenrePill: View {
    let genre: ChartGenre

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: genre.symbol)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
            Text(genre.name)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(minWidth: 96, alignment: .leading)
        .background(genre.bgColor)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}

// MARK: - Insight cards (Hidden Gems / Controversial)

private struct InsightCardRow: View {
    var body: some View {
        HStack(spacing: 10) {
            InsightCard(
                symbol: "diamond.fill",
                title: "Hidden Gems",
                subtitle: "High scores, small audiences",
                destination: ChartDetailType.hiddenGems
            )
            InsightCard(
                symbol: "bolt.fill",
                title: "Controversial",
                subtitle: "The community can't agree",
                destination: ChartDetailType.controversial
            )
        }
        .padding(.horizontal, 16)
    }
}

private struct InsightCard: View {
    let symbol: String
    let title: String
    let subtitle: String
    let destination: ChartDetailType

    var body: some View {
        NavigationLink(value: destination) {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.sjAmber)
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text(subtitle)
                    .font(.system(size: 10))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.sjSurface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sjBorder, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Year scroll section

private struct YearScrollSection: View {
    private let years: [(label: String, start: Int, end: Int, bg: Color)] = [
        ("2025", 2025, 2025, Color(red: 0.10, green: 0.10, blue: 0.10)),
        ("2024", 2024, 2024, Color(red: 0.16, green: 0.13, blue: 0.06)),
        ("2010s", 2010, 2019, Color(red: 0.11, green: 0.13, blue: 0.13)),
        ("2000s", 2000, 2009, Color(red: 0.13, green: 0.11, blue: 0.18)),
        ("1990s", 1990, 1999, Color(red: 0.14, green: 0.10, blue: 0.10)),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Best by Year")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .padding(.horizontal, 16)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(years, id: \.label) { item in
                        NavigationLink(value: ChartDetailType.bestOfYear(
                            start: item.start, end: item.end, label: item.label
                        )) {
                            YearCard(item: item)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

private struct YearCard: View {
    let item: (label: String, start: Int, end: Int, bg: Color)

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(item.label)
                .font(.system(size: 20, weight: .black))
                .foregroundStyle(.white)
                .monospacedDigit()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(minWidth: 80, alignment: .leading)
        .background(item.bg)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - ChartDetailView (drill-down list)

@Observable
private class ChartDetailViewModel {
    let type: ChartDetailType
    var entries: [ChartEntry] = []
    var isLoading = false

    init(type: ChartDetailType) { self.type = type }

    func load() async {
        guard entries.isEmpty else { return }
        isLoading = true
        entries = await fetch()
        isLoading = false
    }

    private func fetch() async -> [ChartEntry] {
        switch type {
        case .topRated:
            return await fetchRanked(rpc: "get_charts_top_rated",
                                     params: TopRatedParams(p_limit: 50))
        case .mostRated:
            return await fetchRanked(rpc: "get_charts_most_rated",
                                     params: TopRatedParams(p_limit: 50))
        case .hiddenGems:
            return await fetchRanked(rpc: "get_charts_hidden_gems",
                                     params: SimpleLimit(p_limit: 50))
        case .controversial:
            return await fetchRanked(rpc: "get_charts_controversial",
                                     params: SimpleLimit(p_limit: 50))
        case .trending:
            return await fetchTrending()
        case .bestOfYear(let start, let end, _):
            return await fetchRanked(rpc: "get_charts_top_rated",
                                     params: YearParams(p_limit: 50, p_year_start: start, p_year_end: end))
        }
    }

    private struct TopRatedParams: Encodable { let p_limit: Int }
    private struct SimpleLimit: Encodable { let p_limit: Int }
    private struct YearParams: Encodable {
        let p_limit: Int; let p_year_start: Int; let p_year_end: Int
    }

    private func fetchRanked(rpc name: String, params: some Encodable) async -> [ChartEntry] {
        let rows: [RankedRPCRow] = (try? await supabase.rpc(name, params: params).execute().value) ?? []
        return rows.map {
            ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                       coverUrl: $0.coverUrl, avgScore: $0.avgScore,
                       ratingCount: $0.ratingCount, newCount: nil)
        }
    }

    private func fetchTrending() async -> [ChartEntry] {
        let rows: [TrendingRPCRow] = (try? await supabase
            .rpc("get_charts_trending", params: ["p_limit": 50])
            .execute().value) ?? []
        return rows.map {
            ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                       coverUrl: $0.coverUrl, avgScore: nil, ratingCount: nil, newCount: $0.newCount)
        }
    }
}

struct ChartDetailView: View {
    let type: ChartDetailType
    @State private var viewModel: ChartDetailViewModel

    init(type: ChartDetailType) {
        self.type = type
        _viewModel = State(initialValue: ChartDetailViewModel(type: type))
    }

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            if viewModel.isLoading {
                ProgressView()
            } else if viewModel.entries.isEmpty {
                emptyState
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        // Podium for top 3
                        if viewModel.entries.count >= 3 {
                            PodiumRow(entries: Array(viewModel.entries.prefix(3)))
                                .padding(.horizontal, 16)
                                .padding(.vertical, 14)
                            Divider()
                        }
                        // Remaining entries
                        let offset = viewModel.entries.count >= 3 ? 3 : 0
                        ForEach(Array(viewModel.entries.dropFirst(offset).enumerated()), id: \.element.id) { idx, entry in
                            NavigationLink(value: entry.asRelease) {
                                RankedListRow(rank: idx + offset + 1, entry: entry, isTrending: type == .trending)
                            }
                            .buttonStyle(.plain)
                            Divider().padding(.leading, 16)
                        }
                    }
                }
            }
        }
        .navigationTitle(type.title)
        .navigationBarTitleDisplayMode(.large)
        .task { await viewModel.load() }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "chart.bar.xaxis")
                .font(.system(size: 36))
                .foregroundStyle(Color.sjMuted)
            Text("No data yet.")
                .font(.system(size: 15))
                .foregroundStyle(Color.sjMuted)
        }
    }
}

private struct PodiumRow: View {
    let entries: [ChartEntry]

    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            // #2 — left, shorter
            PodiumItem(rank: 2, entry: entries[1], height: 66)
            // #1 — center, tallest
            PodiumItem(rank: 1, entry: entries[0], height: 82)
            // #3 — right, shortest
            PodiumItem(rank: 3, entry: entries[2], height: 66)
        }
    }
}

private struct PodiumItem: View {
    let rank: Int
    let entry: ChartEntry
    let height: CGFloat

    var body: some View {
        NavigationLink(value: entry.asRelease) {
            VStack(spacing: 5) {
                ZStack(alignment: .topLeading) {
                    CoverThumb(url: entry.coverUrl, size: height, radius: 8)
                    Group {
                        if rank == 1 {
                            Image(systemName: "trophy.fill")
                                .font(.system(size: 8, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(4)
                                .background(Color.sjAmber)
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                                .padding(4)
                        } else {
                            Text("#\(rank)")
                                .font(.system(size: 8, weight: .black))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 2)
                                .background(Color.black.opacity(0.6))
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                                .padding(4)
                        }
                    }
                }
                if let score = entry.avgScore {
                    Text(String(format: "%.1f", score))
                        .font(.system(size: 13, weight: .black))
                        .foregroundStyle(rank == 1 ? Color.sjAmber : Color.sjInk)
                }
                Text(entry.title)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(entry.artist)
                    .font(.system(size: 8))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }
}

private struct RankedListRow: View {
    let rank: Int
    let entry: ChartEntry
    let isTrending: Bool

    var body: some View {
        HStack(spacing: 10) {
            Text("\(rank)")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Color.sjMuted)
                .frame(width: 22, alignment: .trailing)
            CoverThumb(url: entry.coverUrl, size: 38, radius: 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(entry.artist)
                    .font(.system(size: 10))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                if isTrending, let n = entry.newCount {
                    Text("+\(n)")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                    Text("this week")
                        .font(.system(size: 9))
                        .foregroundStyle(Color.sjMuted)
                } else if let score = entry.avgScore {
                    Text(String(format: "%.1f", score))
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                    if let count = entry.ratingCount {
                        Text(formatCount(count))
                            .font(.system(size: 9))
                            .foregroundStyle(Color.sjMuted)
                    }
                } else if let count = entry.ratingCount {
                    Text(formatCount(count))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                    Text("ratings")
                        .font(.system(size: 9))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    private func formatCount(_ n: Int) -> String {
        n >= 1_000 ? String(format: "%.1fk", Double(n) / 1_000) : "\(n)"
    }
}

// MARK: - GenreDetailView

@Observable
private class GenreDetailViewModel {
    enum SortMode: String, CaseIterable {
        case topRated    = "Top Rated"
        case mostRated   = "Most Rated"
        case trending    = "Trending"
        case gems        = "Gems"
    }

    let genre: ChartGenre
    var entries: [ChartEntry] = []
    var sortMode: SortMode = .topRated
    var avgScore: Double?
    var isLoading = false

    init(genre: ChartGenre) { self.genre = genre }

    func load() async {
        isLoading = true
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.reloadEntries() }
        }
        isLoading = false
    }

    func resort(to mode: SortMode) async {
        sortMode = mode
        await reloadEntries()
    }

    private func reloadEntries() async {
        struct RankedRow: Codable {
            let releaseId: UUID; let title: String; let artist: String
            let coverUrl: String?; let avgScore: Double?; let ratingCount: Int?
            enum CodingKeys: String, CodingKey {
                case releaseId   = "release_id"; case title; case artist
                case coverUrl    = "cover_url"
                case avgScore    = "avg_score"
                case ratingCount = "rating_count"
            }
        }
        struct TrendRow: Codable {
            let releaseId: UUID; let title: String; let artist: String
            let coverUrl: String?; let newCount: Int?
            enum CodingKeys: String, CodingKey {
                case releaseId = "release_id"; case title; case artist
                case coverUrl  = "cover_url";  case newCount = "new_count"
            }
        }
        struct GenreLimit: Encodable { let p_limit: Int; let p_genre: String }
        struct TrendGenreParams: Encodable { let p_genres: [String]; let p_limit: Int }

        switch sortMode {
        case .topRated:
            let rows: [RankedRow] = (try? await supabase
                .rpc("get_charts_top_rated",
                     params: GenreLimit(p_limit: 50, p_genre: genre.slug))
                .execute().value) ?? []
            entries = rows.map {
                ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                           coverUrl: $0.coverUrl, avgScore: $0.avgScore,
                           ratingCount: $0.ratingCount, newCount: nil)
            }
            avgScore = entries.compactMap(\.avgScore).first

        case .mostRated:
            let rows: [RankedRow] = (try? await supabase
                .rpc("get_charts_most_rated",
                     params: GenreLimit(p_limit: 50, p_genre: genre.slug))
                .execute().value) ?? []
            entries = rows.map {
                ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                           coverUrl: $0.coverUrl, avgScore: $0.avgScore,
                           ratingCount: $0.ratingCount, newCount: nil)
            }

        case .trending:
            let rows: [TrendRow] = (try? await supabase
                .rpc("get_charts_trending_for_genres",
                     params: TrendGenreParams(p_genres: [genre.slug], p_limit: 50))
                .execute().value) ?? []
            entries = rows.map {
                ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                           coverUrl: $0.coverUrl, avgScore: nil,
                           ratingCount: nil, newCount: $0.newCount)
            }

        case .gems:
            let rows: [RankedRow] = (try? await supabase
                .rpc("get_charts_hidden_gems",
                     params: GenreLimit(p_limit: 50, p_genre: genre.slug))
                .execute().value) ?? []
            entries = rows.map {
                ChartEntry(id: $0.releaseId, title: $0.title, artist: $0.artist,
                           coverUrl: $0.coverUrl, avgScore: $0.avgScore,
                           ratingCount: $0.ratingCount, newCount: nil)
            }
        }
    }
}

struct GenreDetailView: View {
    let genre: ChartGenre
    @State private var viewModel: GenreDetailViewModel

    init(genre: ChartGenre) {
        self.genre = genre
        _viewModel = State(initialValue: GenreDetailViewModel(genre: genre))
    }

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            VStack(spacing: 0) {
                // Sort chips
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(GenreDetailViewModel.SortMode.allCases, id: \.self) { mode in
                            SortChip(label: mode.rawValue, active: viewModel.sortMode == mode) {
                                Task { await viewModel.resort(to: mode) }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                }
                .background(Color.sjCream)
                Divider()

                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.entries.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "chart.bar.xaxis")
                            .font(.system(size: 36))
                            .foregroundStyle(Color.sjMuted)
                        Text("No data yet.")
                            .font(.system(size: 15))
                            .foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            if viewModel.entries.count >= 3, viewModel.sortMode != .trending {
                                PodiumRow(entries: Array(viewModel.entries.prefix(3)))
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 14)
                                Divider()
                            }
                            let offset = (viewModel.entries.count >= 3 && viewModel.sortMode != .trending) ? 3 : 0
                            ForEach(Array(viewModel.entries.dropFirst(offset).enumerated()), id: \.element.id) { idx, entry in
                                NavigationLink(value: entry.asRelease) {
                                    RankedListRow(
                                        rank: idx + offset + 1,
                                        entry: entry,
                                        isTrending: viewModel.sortMode == .trending
                                    )
                                }
                                .buttonStyle(.plain)
                                Divider().padding(.leading, 16)
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle(genre.name)
        .navigationBarTitleDisplayMode(.large)
        .task { await viewModel.load() }
    }
}

private struct SortChip: View {
    let label: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(active ? Color.sjSurface : Color.sjMuted)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(active ? Color.sjInk : Color.sjSurface)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(active ? Color.clear : Color.sjBorder, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Shared cover thumbnail

struct CoverThumb: View {
    let url: String?
    let size: CGFloat
    let radius: CGFloat

    var body: some View {
        CoverImage(url: url, cornerRadius: radius)
            .frame(width: size, height: size)
    }
}

// MARK: - Preview

#Preview {
    ChartsView(viewModel: ChartsViewModel())
}
