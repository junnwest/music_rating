import SwiftUI
import Observation
import Supabase

// MARK: - ViewModel

@Observable
class AlbumDetailViewModel {
    var tracklist: [TrackItem] = []
    var communityAvg: Double?
    var communityCount: Int = 0
    var userScore: Double?
    var isLoading = true
    var isSaving = false

    func load(releaseId: UUID) async {
        isLoading = true

        struct ReleaseFull: Decodable {
            let tracklist: [TrackItem]?
            let totalTracks: Int?
            enum CodingKeys: String, CodingKey {
                case tracklist
                case totalTracks = "total_tracks"
            }
        }

        if let full: ReleaseFull = try? await supabase
            .from("releases")
            .select("tracklist, total_tracks")
            .eq("id", value: releaseId)
            .single()
            .execute()
            .value {
            tracklist = full.tracklist ?? []
        }

        struct SimpleRating: Decodable {
            let score: Double
            let userId: UUID
            enum CodingKeys: String, CodingKey {
                case score
                case userId = "user_id"
            }
        }

        let allRatings: [SimpleRating] = (try? await supabase
            .from("ratings")
            .select("score, user_id")
            .eq("release_id", value: releaseId)
            .execute()
            .value) ?? []

        communityCount = allRatings.count
        if !allRatings.isEmpty {
            communityAvg = allRatings.map(\.score).reduce(0, +) / Double(allRatings.count)
        }

        if let userId = supabase.auth.currentUser?.id {
            userScore = allRatings.first(where: { $0.userId == userId })?.score
        }

        isLoading = false
    }

    func setRating(releaseId: UUID, score: Double?) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        isSaving = true
        defer { isSaving = false }

        let oldScore = userScore
        userScore = score

        // Optimistic community stats update
        if let old = oldScore {
            if let new = score {
                let total = (communityAvg ?? 0) * Double(communityCount)
                communityAvg = (total - old + new) / Double(communityCount)
            } else {
                communityCount -= 1
                if communityCount > 0 {
                    let total = (communityAvg ?? 0) * Double(communityCount + 1)
                    communityAvg = (total - old) / Double(communityCount)
                } else {
                    communityAvg = nil
                }
            }
        } else if let new = score {
            let total = (communityAvg ?? 0) * Double(communityCount)
            communityCount += 1
            communityAvg = (total + new) / Double(communityCount)
        }

        do {
            if let score {
                struct RatingUpsert: Encodable {
                    let userId: UUID
                    let releaseId: UUID
                    let score: Double
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"
                        case releaseId = "release_id"
                        case score
                    }
                }
                try await supabase.from("ratings")
                    .upsert(
                        RatingUpsert(userId: userId, releaseId: releaseId, score: score),
                        onConflict: "user_id,release_id"
                    )
                    .execute()
            } else {
                try await supabase.from("ratings")
                    .delete()
                    .eq("user_id", value: userId)
                    .eq("release_id", value: releaseId)
                    .execute()
            }
        } catch {
            userScore = oldScore
        }
    }
}

// MARK: - Star Rating View

struct StarRatingView: View {
    let score: Double?
    let interactive: Bool
    let onRate: (Double?) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { star in
                ZStack {
                    Image(systemName: symbolName(for: star))
                        .font(.system(size: 34))
                        .foregroundStyle(Color.sjAmber)

                    if interactive {
                        HStack(spacing: 0) {
                            Color.clear
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    let half = Double(star) - 0.5
                                    onRate(score == half ? nil : half)
                                }
                            Color.clear
                                .contentShape(Rectangle())
                                .onTapGesture {
                                    let full = Double(star)
                                    onRate(score == full ? nil : full)
                                }
                        }
                    }
                }
                .frame(width: 48, height: 48)
            }
        }
    }

    private func symbolName(for star: Int) -> String {
        guard let s = score else { return "star" }
        if Double(star) <= s { return "star.fill" }
        if Double(star) - 0.5 <= s { return "star.leadinghalf.filled" }
        return "star"
    }
}

// MARK: - Album Detail View

struct AlbumDetailView: View {
    let release: Release
    @State private var viewModel = AlbumDetailViewModel()

    private var releaseYear: String {
        guard let d = release.releaseDate, d.count >= 4 else { return "" }
        return String(d.prefix(4))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                coverSection
                VStack(alignment: .leading, spacing: 20) {
                    infoSection
                    Divider()
                    statsSection
                    Divider()
                    ratingSection
                    if !viewModel.tracklist.isEmpty {
                        Divider()
                        tracklistSection
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 20)
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(release.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load(releaseId: release.id) }
    }

    // MARK: Cover

    private var coverSection: some View {
        AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
            switch phase {
            case .success(let image):
                image.resizable().aspectRatio(contentMode: .fill)
            default:
                ZStack {
                    Color.sjBorder
                    Image(systemName: "music.note")
                        .font(.system(size: 60))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    // MARK: Info

    private var infoSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(release.displayTitle)
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(release.displayArtist)
                .font(.system(size: 17))
                .foregroundStyle(Color.sjMuted)
            HStack(spacing: 8) {
                if let type = release.releaseType {
                    Text(type)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color.sjAmber)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.sjAmber.opacity(0.12))
                        .clipShape(Capsule())
                }
                if !releaseYear.isEmpty {
                    Text(releaseYear)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
    }

    // MARK: Community Stats

    private var statsSection: some View {
        HStack(spacing: 12) {
            if let avg = viewModel.communityAvg {
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjAmber)
                    Text(String(format: "%.1f", avg))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                }
            }
            Text(viewModel.communityCount > 0
                 ? "\(viewModel.communityCount) rating\(viewModel.communityCount == 1 ? "" : "s")"
                 : "No ratings yet")
                .font(.system(size: 14))
                .foregroundStyle(Color.sjMuted)
        }
    }

    // MARK: User Rating

    private var ratingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Your Rating")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                if viewModel.isSaving {
                    ProgressView().scaleEffect(0.7).padding(.leading, 4)
                }
                Spacer()
                if let score = viewModel.userScore {
                    Text(score.truncatingRemainder(dividingBy: 1) == 0
                         ? "\(Int(score))" : String(format: "%.1f", score))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.sjAmber)
                }
            }
            StarRatingView(score: viewModel.userScore, interactive: true) { newScore in
                Task { await viewModel.setRating(releaseId: release.id, score: newScore) }
            }
            Text("Tap left half of a star for a half-rating. Tap again to clear.")
                .font(.system(size: 11))
                .foregroundStyle(Color.sjMuted)
        }
    }

    // MARK: Tracklist

    private var tracklistSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Tracklist")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.sjInk)
            VStack(spacing: 0) {
                ForEach(Array(viewModel.tracklist.enumerated()), id: \.offset) { i, track in
                    TrackRow(track: track)
                    if i < viewModel.tracklist.count - 1 {
                        Divider().padding(.leading, 36)
                    }
                }
            }
        }
    }
}

// MARK: - Track Row

private struct TrackRow: View {
    let track: TrackItem

    private var formattedDuration: String {
        guard let ms = track.durationMs, ms > 0 else { return "" }
        let totalSeconds = ms / 1000
        return String(format: "%d:%02d", totalSeconds / 60, totalSeconds % 60)
    }

    var body: some View {
        HStack(spacing: 12) {
            Text("\(track.position)")
                .font(.system(size: 13))
                .foregroundStyle(Color.sjMuted)
                .frame(width: 24, alignment: .trailing)
            Text(track.title)
                .font(.system(size: 14))
                .foregroundStyle(Color.sjInk)
                .lineLimit(1)
            Spacer()
            if !formattedDuration.isEmpty {
                Text(formattedDuration)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
            }
        }
        .padding(.vertical, 10)
    }
}

#Preview {
    NavigationStack {
        AlbumDetailView(release: .preview)
    }
}
