import SwiftUI
import Observation
import Supabase

// MARK: - Models

struct AlbumPost: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let score: Double?
    let eloScore: Double?
    let createdAt: Date
    let profiles: PostProfile?

    struct PostProfile: Codable {
        let username: String?
        let displayName: String?
        let avatarUrl: String?
        enum CodingKeys: String, CodingKey {
            case username; case displayName = "display_name"; case avatarUrl = "avatar_url"
        }
        var handle: String { username.map { "@\($0)" } ?? displayName ?? "someone" }
    }

    enum CodingKeys: String, CodingKey {
        case id; case score; case profiles
        case userId    = "user_id"
        case eloScore  = "elo_score"
        case createdAt = "created_at"
    }
}

struct AlbumPublicMix: Identifiable {
    let id: UUID
    let name: String
    let authorHandle: String
}

// MARK: - Track entry (loaded via release_tracks → recordings)

struct TrackEntry: Codable, Identifiable {
    let trackId: UUID?        // recordings.id
    let position: Int
    let title: String
    let durationMs: Int?
    let artists: String?      // recordings.artist_display

    var id: String { trackId?.uuidString ?? "\(position)" }

    enum CodingKeys: String, CodingKey {
        case trackId = "id"
        case position, title, artists
        case durationMs = "duration_ms"
    }
}

// Intermediate type for decoding release_tracks + embedded recordings
private struct ReleaseTrackRow: Decodable {
    let position: Int
    let discNumber: Int?
    let recordings: RecordingRef

    struct RecordingRef: Decodable {
        let id: UUID
        let title: String
        let durationMs: Int?
        let artistDisplay: String?

        enum CodingKeys: String, CodingKey {
            case id, title
            case durationMs   = "duration_ms"
            case artistDisplay = "artist_display"
        }
    }

    enum CodingKeys: String, CodingKey {
        case position
        case discNumber = "disc_number"
        case recordings
    }
}

// MARK: - ViewModel

@Observable
class AlbumDetailViewModel {
    var tracklist: [TrackItem] = []
    var tracks: [TrackEntry] = []
    var trackRatings: [UUID: Double] = [:]   // keyed by recordings.id
    var communityAvg: Double?
    var communityCount: Int = 0
    var userScore: Double?
    var userEloScore: Double?
    var ratingMode = "manual"
    var posts: [AlbumPost] = []
    var publicMixes: [AlbumPublicMix] = []
    var isLoading = true
    var isSaving = false

    var isRated: Bool { userScore != nil || userEloScore != nil }

    func load(releaseGroupId: UUID) async {
        isLoading = true

        // These can run immediately in parallel while tracks loads sequentially first
        async let ratingsTask: Void = loadRatings(releaseGroupId: releaseGroupId)
        async let modeTask: Void    = loadRatingMode()
        async let postsTask: Void   = loadPosts(releaseGroupId: releaseGroupId)
        async let mixesTask: Void   = loadPublicMixes(releaseGroupId: releaseGroupId)

        // Track ratings need recording IDs, so tracks must finish first
        await loadTracks(releaseGroupId: releaseGroupId)
        await loadTrackRatings(recordingIds: tracks.compactMap(\.trackId))

        _ = await (ratingsTask, modeTask, postsTask, mixesTask)
        isLoading = false
    }

    private func loadTracks(releaseGroupId: UUID) async {
        // Step 1: find the canonical release edition for this release group
        struct CanonicalRelease: Decodable { let id: UUID }
        guard let canonical: CanonicalRelease = try? await supabase
            .from("releases")
            .select("id")
            .eq("release_group_id", value: releaseGroupId)
            .eq("is_canonical", value: true)
            .maybeSingle()
            .execute()
            .value else { return }

        // Step 2: load release_tracks with embedded recording info
        let rows: [ReleaseTrackRow] = (try? await supabase
            .from("release_tracks")
            .select("position, disc_number, recordings(id, title, duration_ms, artist_display)")
            .eq("release_id", value: canonical.id)
            .order("position")
            .execute()
            .value) ?? []

        tracks = rows.map { row in
            TrackEntry(
                trackId:   row.recordings.id,
                position:  row.position,
                title:     row.recordings.title,
                durationMs: row.recordings.durationMs,
                artists:   row.recordings.artistDisplay
            )
        }
    }

    private func loadTrackRatings(recordingIds: [UUID]) async {
        guard let userId = supabase.auth.currentUser?.id,
              !recordingIds.isEmpty else { return }
        struct TR: Decodable {
            let recordingId: UUID
            let score: Double?
            enum CodingKeys: String, CodingKey {
                case recordingId = "recording_id"; case score
            }
        }
        let rows: [TR] = (try? await supabase
            .from("track_ratings")
            .select("recording_id, score")
            .eq("user_id", value: userId)
            .in("recording_id", values: recordingIds.map(\.uuidString))
            .execute()
            .value) ?? []
        trackRatings = Dictionary(uniqueKeysWithValues: rows.compactMap { r in
            guard let s = r.score else { return nil }
            return (r.recordingId, s)
        })
    }

    func rateTrack(recordingId: UUID, score: Double?) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        if let score {
            struct Row: Encodable {
                let userId: UUID; let recordingId: UUID; let score: Double
                enum CodingKeys: String, CodingKey {
                    case userId = "user_id"; case recordingId = "recording_id"; case score
                }
            }
            try? await supabase.from("track_ratings")
                .upsert(Row(userId: userId, recordingId: recordingId, score: score),
                        onConflict: "user_id,recording_id")
                .execute()
            trackRatings[recordingId] = score
        } else {
            try? await supabase.from("track_ratings")
                .delete()
                .eq("user_id", value: userId)
                .eq("recording_id", value: recordingId)
                .execute()
            trackRatings.removeValue(forKey: recordingId)
        }
    }

    func loadRatings(releaseGroupId: UUID) async {
        struct Row: Decodable {
            let score: Double?
            let eloScore: Double?
            let userId: UUID
            enum CodingKeys: String, CodingKey {
                case score; case eloScore = "elo_score"; case userId = "user_id"
            }
        }
        let rows: [Row] = (try? await supabase
            .from("ratings").select("score, elo_score, user_id")
            .eq("release_group_id", value: releaseGroupId).execute().value) ?? []

        communityCount = rows.count
        let scored = rows.compactMap(\.score)
        communityAvg = scored.isEmpty ? nil : scored.reduce(0, +) / Double(scored.count)

        if let userId = supabase.auth.currentUser?.id {
            let mine = rows.first(where: { $0.userId == userId })
            userScore    = mine?.score
            userEloScore = mine?.eloScore
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

    func setRating(releaseGroupId: UUID, score: Double?) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        isSaving = true
        defer { isSaving = false }

        let old = userScore
        userScore = score

        do {
            if let score {
                struct Upsert: Encodable {
                    let userId: UUID; let releaseGroupId: UUID; let score: Double
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case releaseGroupId = "release_group_id"; case score
                    }
                }
                try await supabase.from("ratings")
                    .upsert(Upsert(userId: userId, releaseGroupId: releaseGroupId, score: score),
                            onConflict: "user_id,release_group_id")
                    .execute()
            } else {
                try await supabase.from("ratings")
                    .delete().eq("user_id", value: userId).eq("release_group_id", value: releaseGroupId)
                    .execute()
                userEloScore = nil
            }
            await reloadCommunityStats(releaseGroupId: releaseGroupId, currentUserId: userId)
        } catch {
            userScore = old
        }
    }

    private func reloadCommunityStats(releaseGroupId: UUID, currentUserId: UUID) async {
        struct Row: Decodable {
            let score: Double?; let userId: UUID
            enum CodingKeys: String, CodingKey { case score; case userId = "user_id" }
        }
        let rows: [Row] = (try? await supabase
            .from("ratings").select("score, user_id")
            .eq("release_group_id", value: releaseGroupId).execute().value) ?? []
        communityCount = rows.count
        let scored = rows.compactMap(\.score)
        communityAvg = scored.isEmpty ? nil : scored.reduce(0, +) / Double(scored.count)
        userScore = rows.first(where: { $0.userId == currentUserId })?.score
    }

    private func loadPosts(releaseGroupId: UUID) async {
        posts = (try? await supabase
            .from("ratings")
            .select("id, score, elo_score, created_at, user_id, profiles(username, display_name, avatar_url)")
            .eq("release_group_id", value: releaseGroupId)
            .order("created_at", ascending: false)
            .limit(20)
            .execute()
            .value) ?? []
    }

    private func loadPublicMixes(releaseGroupId: UUID) async {
        struct MixItemRef: Codable {
            let mixId: UUID
            enum CodingKeys: String, CodingKey { case mixId = "mix_id" }
        }
        let refs: [MixItemRef] = (try? await supabase
            .from("mix_items")
            .select("mix_id")
            .eq("release_group_id", value: releaseGroupId)
            .limit(50)
            .execute()
            .value) ?? []

        let mixIds = Array(Set(refs.map(\.mixId.uuidString)))
        guard !mixIds.isEmpty else { return }

        struct MixRow: Codable, Identifiable {
            let id: UUID
            let name: String
            let profiles: MixProfile?
            struct MixProfile: Codable {
                let username: String?
                let displayName: String?
                enum CodingKeys: String, CodingKey {
                    case username; case displayName = "display_name"
                }
            }
        }
        let rows: [MixRow] = (try? await supabase
            .from("mixes")
            .select("id, name, profiles(username, display_name)")
            .in("id", values: mixIds)
            .eq("is_public", value: true)
            .limit(10)
            .execute()
            .value) ?? []

        publicMixes = rows.map { row in
            let handle = row.profiles.flatMap { $0.username.map { "@\($0)" } ?? $0.displayName } ?? "someone"
            return AlbumPublicMix(id: row.id, name: row.name, authorHandle: handle)
        }
    }
}

// MARK: - Star Rating View (display-only from outside; interactive inside ManualRatingSheet)

struct StarRatingView: View {
    let score: Double?
    let interactive: Bool
    let onRate: (Double?) -> Void
    var starSize: CGFloat = 34

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { star in
                ZStack {
                    Image(systemName: symbolName(for: star))
                        .font(.system(size: starSize))
                        .foregroundStyle(Color.sjAmber)

                    if interactive {
                        HStack(spacing: 0) {
                            Color.clear.contentShape(Rectangle())
                                .onTapGesture {
                                    let half = Double(star) - 0.5
                                    onRate(score == half ? nil : half)
                                }
                            Color.clear.contentShape(Rectangle())
                                .onTapGesture {
                                    let full = Double(star)
                                    onRate(score == full ? nil : full)
                                }
                        }
                    }
                }
                .frame(width: starSize + 14, height: starSize + 14)
            }
        }
    }

    private func symbolName(for star: Int) -> String {
        guard let s = score else { return "star" }
        if Double(star) <= s            { return "star.fill" }
        if Double(star) - 0.5 <= s     { return "star.leadinghalf.filled" }
        return "star"
    }
}

// MARK: - Manual Rating Sheet

struct ManualRatingSheet: View {
    let release: Release
    @Binding var existingScore: Double?
    let onSave: (Double?) -> Void

    @State private var draftScore: Double
    @Environment(\.dismiss) private var dismiss

    init(release: Release, existingScore: Binding<Double?>, onSave: @escaping (Double?) -> Void) {
        self.release        = release
        self._existingScore = existingScore
        self.onSave         = onSave
        self._draftScore    = State(initialValue: existingScore.wrappedValue ?? 2.5)
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            VStack(spacing: 0) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(Color.sjBorder)
                    .frame(width: 36, height: 4)
                    .padding(.top, 10)
                    .frame(maxWidth: .infinity)

                VStack(spacing: 0) {
                    AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                        switch phase {
                        case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                        default:
                            Color.sjBorder.overlay(
                                Image(systemName: "music.note").foregroundStyle(Color.sjMuted)
                            )
                        }
                    }
                    .frame(width: 64, height: 64)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .padding(.top, 14)

                    Text(release.displayTitle)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .padding(.horizontal, 40)
                        .padding(.top, 8)

                    Text(release.displayArtist)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                        .padding(.top, 2)

                    Text(scoreLabel)
                        .font(.system(size: 32, weight: .bold))
                        .foregroundStyle(Color.sjBlue)
                        .monospacedDigit()
                        .padding(.top, 12)

                    Slider(value: $draftScore, in: 0.5...5.0, step: 0.5)
                        .tint(Color.sjBlue)
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                        .sensoryFeedback(.selection, trigger: draftScore)

                    HStack {
                        Text("0.5")
                        Spacer()
                        Text("5.0")
                    }
                    .font(.system(size: 10))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.horizontal, 26)
                    .padding(.top, 2)

                    VStack(spacing: 10) {
                        Button {
                            onSave(draftScore)
                            dismiss()
                        } label: {
                            Text("Save Rating")
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(Color.sjBlue)
                                .clipShape(RoundedRectangle(cornerRadius: 12))
                        }

                        if existingScore != nil {
                            Button("Remove Rating") {
                                onSave(nil)
                                dismiss()
                            }
                            .font(.system(size: 13))
                            .foregroundStyle(Color.sjMuted)
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 28)
                }
            }
            .background(Color.sjCream.ignoresSafeArea())

            Button { dismiss() } label: {
                ZStack {
                    Circle()
                        .fill(Color.sjBorder)
                        .frame(width: 28, height: 28)
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.top, 14)
            .padding(.trailing, 14)
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.hidden)
    }

    private var scoreLabel: String {
        draftScore.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(draftScore)) / 5"
            : String(format: "%.1f / 5", draftScore)
    }
}

// MARK: - Album Detail View

struct AlbumDetailView: View {
    let release: Release
    var onRated: ((UUID) -> Void)? = nil

    @State private var viewModel = AlbumDetailViewModel()
    @State private var showManualSheet = false
    @State private var showInstinctSheet = false
    @State private var trackRatingTarget: TrackEntry? = nil
    @State private var selectedSong: TrackEntry? = nil

    private var releaseYear: String {
        guard let d = release.releaseDate, d.count >= 4 else { return "" }
        return String(d.prefix(4))
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                compactHeader
                Divider().padding(.horizontal, 20)
                ratingSection
                if !viewModel.tracks.isEmpty {
                    Divider().padding(.horizontal, 20)
                    tracklistSection
                }
                if !viewModel.posts.isEmpty {
                    Divider().padding(.horizontal, 20)
                    postsSection
                }
                if !viewModel.publicMixes.isEmpty {
                    Divider().padding(.horizontal, 20)
                    mixesSection
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(release.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load(releaseGroupId: release.id) }
        .sheet(isPresented: $showManualSheet) {
            ManualRatingSheet(
                release: release,
                existingScore: $viewModel.userScore
            ) { score in
                Task {
                    await viewModel.setRating(releaseGroupId: release.id, score: score)
                    if score != nil { onRated?(release.id) }
                }
            }
        }
        .sheet(isPresented: $showInstinctSheet) {
            InstinctRatingView(release: release, onRated: { id in
                onRated?(id)
                viewModel.userEloScore = 1  // non-nil sentinel so isRated becomes true
                Task { await viewModel.loadAfterInstinct(releaseGroupId: release.id) }
            }, onDone: { showInstinctSheet = false })
        }
        .sheet(item: $trackRatingTarget) { track in
            TrackRatingSheet(
                track: track,
                release: release,
                existingScore: track.trackId.flatMap { viewModel.trackRatings[$0] }
            ) { t, score in
                Task {
                    if let recordingId = t.trackId {
                        await viewModel.rateTrack(recordingId: recordingId, score: score)
                    }
                }
            }
        }
        .navigationDestination(item: $selectedSong) { track in
            SongDetailView(track: track, release: release)
        }
    }

    // MARK: Compact header

    private var compactHeader: some View {
        HStack(alignment: .top, spacing: 14) {
            AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                default:
                    ZStack {
                        Color.sjBorder
                        Image(systemName: "music.note").font(.system(size: 24)).foregroundStyle(Color.sjMuted)
                    }
                }
            }
            .frame(width: 88, height: 88)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 5) {
                Text(release.displayTitle)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                Text(release.displayArtist)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let type = release.releaseType {
                        Text(type.capitalized)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.sjBlue.opacity(0.1)).clipShape(Capsule())
                    }
                    if !releaseYear.isEmpty {
                        Text(releaseYear)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.sjMuted.opacity(0.1)).clipShape(Capsule())
                    }
                }
                .padding(.top, 2)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
    }

    // MARK: Rating section (mode-aware)

    private var ratingSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(viewModel.ratingMode == "instinct" ? "Your Instinct Ranking" : "Your Rating")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .tracking(0.6)

            if viewModel.ratingMode == "instinct" {
                instinctRatingBody
            } else {
                manualRatingBody
            }

            if viewModel.communityCount > 0 {
                HStack(spacing: 10) {
                    if let avg = viewModel.communityAvg {
                        communityStatBox(value: String(format: "%.1f", avg),
                                         label: "Community Avg", showIcon: true)
                    }
                    communityStatBox(value: "\(viewModel.communityCount)",
                                     label: "Ratings", showIcon: false)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
    }

    // Manual mode rating body
    private var manualRatingBody: some View {
        Group {
            if let score = viewModel.userScore {
                // Already rated
                HStack(spacing: 12) {
                    StarRatingView(score: score, interactive: false, onRate: { _ in }, starSize: 22)

                    HStack(spacing: 4) {
                        Image("icon-flower")
                            .renderingMode(.template).resizable().scaledToFit()
                            .frame(width: 12, height: 12).foregroundStyle(Color.sjBlue)
                        Text(score.truncatingRemainder(dividingBy: 1) == 0
                             ? "\(Int(score))" : String(format: "%.1f", score))
                            .font(.system(size: 14, weight: .bold)).foregroundStyle(Color.sjBlue)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(Color.sjBlue.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                    Spacer()

                    Button("Edit") { showManualSheet = true }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjBlue)
                }
            } else {
                // Not yet rated
                Button { showManualSheet = true } label: {
                    Label("Rate this Album", systemImage: "plus")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color.sjBlue)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    // Instinct mode rating body
    private var instinctRatingBody: some View {
        Group {
            if let elo = viewModel.userEloScore {
                let score = instinctEloToScore(elo)
                HStack(spacing: 12) {
                    HStack(spacing: 4) {
                        Image("icon-flower")
                            .renderingMode(.template).resizable().scaledToFit()
                            .frame(width: 14, height: 14).foregroundStyle(Color.sjBlue)
                        Text(String(format: "%.1f", score))
                            .font(.system(size: 18, weight: .bold)).foregroundStyle(Color.sjBlue)
                    }
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(Color.sjBlue.opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                    Text("Instinct Score")
                        .font(.system(size: 12)).foregroundStyle(Color.sjMuted)

                    Spacer()

                    Button("Re-rank") { showInstinctSheet = true }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjBlue)
                }
            } else {
                Button { showInstinctSheet = true } label: {
                    Label("Add to Rankings", systemImage: "arrow.up.arrow.down")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(Color.sjBlue)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func instinctEloToScore(_ elo: Double) -> Double {
        let raw = 5.0 / (1.0 + pow(10.0, (1500.0 - elo) / 250.0))
        return (raw * 10).rounded() / 10.0
    }

    private func communityStatBox(value: String, label: String, showIcon: Bool) -> some View {
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
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
    }

    // MARK: Tracklist

    private var tracklistSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionLabel("Tracklist")

            ForEach(Array(viewModel.tracks.enumerated()), id: \.element.id) { i, track in
                TrackRow(
                    track: track,
                    existingScore: track.trackId.flatMap { viewModel.trackRatings[$0] },
                    onTap: track.trackId != nil ? { selectedSong = track } : nil,
                    onAdd: track.trackId != nil ? { trackRatingTarget = track } : nil
                )
                if i < viewModel.tracks.count - 1 {
                    Divider().padding(.leading, 56)
                }
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: Posts

    private var postsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionLabel("Ratings & Reviews")

            ForEach(Array(viewModel.posts.enumerated()), id: \.element.id) { i, post in
                PostRow(post: post)
                if i < viewModel.posts.count - 1 {
                    Divider().padding(.leading, 52)
                }
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: Public Mixes

    private var mixesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionLabel("In Public Mixes")

            ForEach(Array(viewModel.publicMixes.enumerated()), id: \.element.id) { i, mix in
                HStack(spacing: 12) {
                    Image(systemName: "music.note.list")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.sjBlue)
                        .frame(width: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(mix.name)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(1)
                        Text(mix.authorHandle)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjMuted)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                }
                .padding(.vertical, 11)
                .padding(.horizontal, 20)
                if i < viewModel.publicMixes.count - 1 {
                    Divider().padding(.leading, 52)
                }
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: Helpers

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .textCase(.uppercase)
            .tracking(0.6)
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)
    }
}

// MARK: - Reload after instinct rating

extension AlbumDetailViewModel {
    func loadAfterInstinct(releaseGroupId: UUID) async {
        await loadRatings(releaseGroupId: releaseGroupId)
    }
}

// MARK: - Post Row

private struct PostRow: View {
    let post: AlbumPost

    private var relativeDate: String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: post.createdAt, relativeTo: Date())
    }

    var body: some View {
        HStack(spacing: 12) {
            // Avatar placeholder
            Circle()
                .fill(Color.sjBorder)
                .frame(width: 32, height: 32)
                .overlay(
                    Text(String((post.profiles?.handle ?? "?").prefix(1)).uppercased())
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.sjMuted)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(post.profiles?.handle ?? "someone")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.sjInk)
                Text(relativeDate)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.sjMuted)
            }

            Spacer()

            if let score = post.score {
                scoreBadge(score, isElo: false)
            } else if let elo = post.eloScore {
                scoreBadge(eloToDisplay(elo), isElo: true)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 20)
    }

    private func scoreBadge(_ value: Double, isElo: Bool) -> some View {
        HStack(spacing: 3) {
            if isElo {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(Color.sjBlue)
            } else {
                Image(systemName: "star.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(Color.sjAmber)
            }
            Text(value.truncatingRemainder(dividingBy: 1) == 0
                 ? "\(Int(value))" : String(format: "%.1f", value))
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(isElo ? Color.sjBlue : Color.sjAmber)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background((isElo ? Color.sjBlue : Color.sjAmber).opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func eloToDisplay(_ elo: Double) -> Double {
        let raw = 5.0 / (1.0 + pow(10.0, (1500.0 - elo) / 250.0))
        return (raw * 10).rounded() / 10.0
    }
}

// MARK: - Track Row

private struct TrackRow: View {
    let track: TrackEntry
    var existingScore: Double? = nil
    var onTap: (() -> Void)? = nil
    var onAdd: (() -> Void)? = nil

    private var formattedDuration: String {
        guard let ms = track.durationMs, ms > 0 else { return "" }
        let s = ms / 1000
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private func scoreLabel(_ s: Double) -> String {
        s.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(s))" : String(format: "%.1f", s)
    }

    var body: some View {
        HStack(spacing: 10) {
            Text("\(track.position)")
                .font(.system(size: 13)).foregroundStyle(Color.sjMuted)
                .frame(width: 24, alignment: .trailing)

            if let onTap {
                Button(action: onTap) {
                    Text(track.title)
                        .font(.system(size: 14)).foregroundStyle(Color.sjBlue).lineLimit(1)
                }
                .buttonStyle(.plain)
            } else {
                Text(track.title)
                    .font(.system(size: 14)).foregroundStyle(Color.sjInk).lineLimit(1)
            }

            Spacer()
            if !formattedDuration.isEmpty {
                Text(formattedDuration)
                    .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
            }
            if let score = existingScore {
                Text(scoreLabel(score))
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.sjBlue)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.sjBlue.opacity(0.1)).clipShape(RoundedRectangle(cornerRadius: 4))
            } else if let onAdd {
                Button(action: onAdd) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.sjBlue)
                        .frame(width: 26, height: 26)
                        .background(Color.sjBlue.opacity(0.1)).clipShape(Circle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 11).padding(.horizontal, 20)
    }
}

// MARK: - Track Rating Sheet

private struct TrackRatingSheet: View {
    let track: TrackEntry
    let release: Release
    let existingScore: Double?
    let onSave: (TrackEntry, Double?) -> Void

    @State private var draftScore: Double
    @Environment(\.dismiss) private var dismiss

    init(track: TrackEntry, release: Release, existingScore: Double?,
         onSave: @escaping (TrackEntry, Double?) -> Void) {
        self.track = track
        self.release = release
        self.existingScore = existingScore
        self.onSave = onSave
        self._draftScore = State(initialValue: existingScore ?? 2.5)
    }

    private var scoreLabel: String {
        draftScore.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(draftScore)) / 5"
            : String(format: "%.1f / 5", draftScore)
    }

    var body: some View {
        VStack(spacing: 0) {
            RoundedRectangle(cornerRadius: 2).fill(Color.sjBorder)
                .frame(width: 36, height: 4).padding(.top, 10).frame(maxWidth: .infinity)

            AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                default: Color.sjBorder.overlay(Image(systemName: "music.note").foregroundStyle(Color.sjMuted))
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .padding(.top, 16)

            Text(track.title)
                .font(.system(size: 15, weight: .bold)).foregroundStyle(Color.sjInk)
                .multilineTextAlignment(.center).lineLimit(2)
                .padding(.horizontal, 32).padding(.top, 8)
            Text(release.displayArtist)
                .font(.system(size: 12)).foregroundStyle(Color.sjMuted).padding(.top, 2)

            Text(scoreLabel)
                .font(.system(size: 30, weight: .bold)).foregroundStyle(Color.sjBlue)
                .monospacedDigit().padding(.top, 12)

            Slider(value: $draftScore, in: 0.5...5.0, step: 0.5)
                .tint(Color.sjBlue)
                .padding(.horizontal, 24).padding(.top, 8)
                .sensoryFeedback(.selection, trigger: draftScore)
            HStack { Text("0.5"); Spacer(); Text("5.0") }
                .font(.system(size: 10)).foregroundStyle(Color.sjMuted)
                .padding(.horizontal, 26).padding(.top, 2)

            VStack(spacing: 10) {
                Button {
                    onSave(track, draftScore)
                    dismiss()
                } label: {
                    Text("Save Rating")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Color.sjBlue).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                if existingScore != nil {
                    Button("Remove Rating") { onSave(track, nil); dismiss() }
                        .font(.system(size: 13)).foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.horizontal, 24).padding(.top, 16).padding(.bottom, 24)
        }
        .background(Color.sjCream.ignoresSafeArea())
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Song Detail View

struct SongDetailView: View {
    let track: TrackEntry
    let release: Release

    @State private var communityAvg: Double? = nil
    @State private var communityCount: Int = 0
    @State private var userScore: Double? = nil
    @State private var isLoaded = false
    @State private var showRatingSheet = false

    private var durationString: String {
        guard let ms = track.durationMs, ms > 0 else { return "" }
        let s = ms / 1000
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                songHeader
                Divider().padding(.horizontal, 20)
                communitySection
                Divider().padding(.horizontal, 20)
                ratingSection
                Divider().padding(.horizontal, 20)
                appearsOnSection
            }
            .padding(.bottom, 40)
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(track.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            guard !isLoaded else { return }
            isLoaded = true
            await loadStats()
        }
        .sheet(isPresented: $showRatingSheet) {
            TrackRatingSheet(track: track, release: release, existingScore: userScore) { _, score in
                userScore = score
            }
        }
    }

    private var songHeader: some View {
        HStack(spacing: 16) {
            AsyncImage(url: URL(string: release.coverUrl?.thumbnailUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                default: Color.sjBorder
                }
            }
            .frame(width: 80, height: 80)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 5) {
                Text("Track \(track.position)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
                    .textCase(.uppercase)
                    .tracking(0.5)
                Text(track.title)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(2)
                Text(release.artist)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                if !durationString.isEmpty {
                    Text(durationString)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }

    private var communitySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("COMMUNITY")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(0.8)
            HStack(spacing: 32) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(communityAvg.map {
                        $0.truncatingRemainder(dividingBy: 1) == 0
                            ? "\(Int($0))" : String(format: "%.2f", $0)
                    } ?? "—")
                    .font(.system(size: 28, weight: .bold)).foregroundStyle(Color.sjInk)
                    Text("avg score")
                        .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(communityCount)")
                        .font(.system(size: 28, weight: .bold)).foregroundStyle(Color.sjInk)
                    Text(communityCount == 1 ? "rating" : "ratings")
                        .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }

    private var ratingSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("YOUR RATING")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(0.8)
            if let score = userScore {
                HStack(spacing: 8) {
                    Text(score.truncatingRemainder(dividingBy: 1) == 0
                         ? "\(Int(score))" : String(format: "%.1f", score))
                    .font(.system(size: 22, weight: .bold)).foregroundStyle(Color.sjBlue)
                    Text("/ 5")
                        .font(.system(size: 16)).foregroundStyle(Color.sjMuted)
                    Spacer()
                    Button("Edit") { showRatingSheet = true }
                        .buttonStyle(.plain)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.sjBlue)
                }
            } else {
                Button { showRatingSheet = true } label: {
                    Text("Rate this track")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.sjCream)
                        .frame(maxWidth: .infinity).frame(height: 42)
                        .background(Color.sjBlue)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }

    private var appearsOnSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("APPEARS ON")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(0.8)
            NavigationLink(value: release) {
                HStack(spacing: 12) {
                    AsyncImage(url: URL(string: release.coverUrl?.thumbnailUrl ?? "")) { phase in
                        switch phase {
                        case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                        default: Color.sjBorder
                        }
                    }
                    .frame(width: 44, height: 44)
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                    VStack(alignment: .leading, spacing: 2) {
                        Text(release.displayTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.sjInk).lineLimit(1)
                        Text(release.artist)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjMuted).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }

    private func loadStats() async {
        guard let recordingId = track.trackId else { return }
        struct ScoreRow: Decodable { let score: Double? }
        let allRows: [ScoreRow] = (try? await supabase
            .from("track_ratings").select("score")
            .eq("recording_id", value: recordingId)
            .execute().value) ?? []
        let scores = allRows.compactMap(\.score)
        communityCount = scores.count
        communityAvg = scores.isEmpty ? nil : scores.reduce(0, +) / Double(scores.count)

        guard let userId = supabase.auth.currentUser?.id else { return }
        struct UserRow: Decodable { let score: Double? }
        let row: UserRow? = try? await supabase
            .from("track_ratings").select("score")
            .eq("user_id", value: userId)
            .eq("recording_id", value: recordingId)
            .maybeSingle().execute().value
        userScore = row?.score
    }
}

#Preview {
    NavigationStack {
        AlbumDetailView(release: .preview)
    }
}
