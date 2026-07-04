import SwiftUI
import Supabase

// MARK: - Bucket

enum InstinctBucket: CaseIterable {
    case bad, neutral, good

    var seedElo: Double {
        switch self { case .bad: return 1400; case .neutral: return 1500; case .good: return 1600 }
    }
    var label: String {
        switch self { case .bad: return "Bad"; case .neutral: return "Neutral"; case .good: return "Good" }
    }
    var icon: String {
        switch self { case .bad: return "hand.thumbsdown"; case .neutral: return "minus.circle"; case .good: return "hand.thumbsup" }
    }
    var color: Color {
        switch self { case .bad: return .red; case .neutral: return Color.sjMuted; case .good: return Color.sjBlue }
    }
    var emoji: String {
        switch self { case .bad: return "😞"; case .neutral: return "😐"; case .good: return "🙂" }
    }
}

// MARK: - Elo math (mirrors lib/elo.ts)

enum Elo {
    static let defaultElo: Double = 1500
    static let scoreCentre: Double = 1500
    static let scoreSpread: Double = 250

    static func expectedScore(_ a: Double, _ b: Double) -> Double {
        1.0 / (1.0 + pow(10.0, (b - a) / 400.0))
    }

    static func kFactor(_ games: Int) -> Double {
        if games < 10 { return 40 }
        if games < 30 { return 24 }
        return 16
    }

    static func update(winnerElo: Double, winnerGames: Int,
                       loserElo: Double,  loserGames: Int) -> (winner: Double, loser: Double) {
        let exp = expectedScore(winnerElo, loserElo)
        let newWinner = winnerElo + kFactor(winnerGames) * (1.0 - exp)
        let newLoser  = loserElo  + kFactor(loserGames)  * (0.0 - (1.0 - exp))
        return (newWinner, newLoser)
    }

    static func toScore(_ elo: Double) -> Double {
        let raw = 5.0 / (1.0 + pow(10.0, (scoreCentre - elo) / scoreSpread))
        return (raw * 10).rounded() / 10.0
    }
}

// MARK: - Opponents

private struct TrackOpponent {
    let recordingId: UUID
    let title: String
    let artist: String
    let eloScore: Double
    let eloGames: Int
}

private struct Opponent {
    let releaseId: UUID
    let release: Release
    let eloScore: Double
    let eloGames: Int
}

// MARK: - ViewModel

@Observable
private class InstinctRatingViewModel {
    enum Phase { case bucket, postRating, comparing, done }

    var phase: Phase = .bucket
    var isSaving = false

    private var opponents: [Opponent] = []
    private var lo = 0
    private var hi = 0
    private(set) var comparisonIndex = 0
    private(set) var totalComparisons = 0

    private(set) var newElo: Double = Elo.defaultElo
    private var newEloGames = 0
    private var releaseId: UUID?
    private var userId: UUID?

    private(set) var userRatingsCount = 0
    private(set) var finalScore: Double?
    private(set) var ratingId: UUID? = nil
    private var pendingReviewText: String? = nil

    var currentOpponent: Opponent? {
        let mid = (lo + hi) / 2
        guard lo < hi, mid < opponents.count else { return nil }
        return opponents[mid]
    }

    var roundsRemaining: Int { max(0, totalComparisons - comparisonIndex) }

    // MARK: Load existing ranked albums

    func start(releaseId: UUID, userId: UUID) async {
        self.releaseId = releaseId
        self.userId = userId

        struct OpponentRow: Decodable {
            let releaseGroupId: UUID
            let eloScore: Double
            let eloGames: Int
            let releaseGroups: Release
            enum CodingKeys: String, CodingKey {
                case releaseGroupId = "release_group_id"
                case eloScore       = "elo_score"
                case eloGames       = "elo_games"
                case releaseGroups  = "release_groups"
            }
        }

        let rows: [OpponentRow] = (try? await supabase
            .from("ratings")
            .select("release_group_id, elo_score, elo_games, release_groups(id, title, artist_display, cover_url, release_group_type, first_release_date, native_title)")
            .eq("user_id", value: userId)
            .not("elo_score", operator: .is, value: AnyJSON.null)
            .not("release_group_id", operator: .eq, value: releaseId)
            .order("elo_score", ascending: false)
            .execute()
            .value) ?? []

        opponents = rows.map { Opponent(releaseId: $0.releaseGroupId, release: $0.releaseGroups,
                                        eloScore: $0.eloScore, eloGames: $0.eloGames) }

        let n = opponents.count
        totalComparisons = n > 0 ? min(3, Int(ceil(log2(Double(n + 1))))) : 0
        lo = 0
        hi = n
        userRatingsCount = n
    }

    // MARK: Bucket → seed Elo → maybe compare

    func seedAndContinue(bucket: InstinctBucket) async {
        newElo = bucket.seedElo
        newEloGames = 0
        phase = .postRating
    }

    func continueFromPostRating(reviewText: String?) async {
        guard let releaseId, let userId else { return }
        pendingReviewText = reviewText
        isSaving = true
        defer { isSaving = false }

        struct RatingUpsert: Encodable {
            let userId: UUID; let releaseGroupId: UUID
            let eloScore: Double; let eloGames: Int
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case releaseGroupId = "release_group_id"
                case eloScore = "elo_score"; case eloGames = "elo_games"
            }
        }

        try? await supabase
            .from("ratings")
            .upsert(RatingUpsert(userId: userId, releaseGroupId: releaseId,
                                 eloScore: newElo, eloGames: newEloGames),
                    onConflict: "user_id,release_group_id")
            .execute()

        struct IdRow: Decodable { let id: UUID }
        ratingId = (try? await supabase.from("ratings")
            .select("id")
            .eq("user_id", value: userId)
            .eq("release_group_id", value: releaseId)
            .single()
            .execute()
            .value as IdRow)?.id

        if !opponents.isEmpty && lo < hi && totalComparisons > 0 {
            phase = .comparing
        } else {
            await finalize()
        }
    }

    // MARK: Comparison vote

    func vote(newAlbumWon: Bool) async {
        guard let releaseId, let userId else { return }
        guard lo < hi, let opp = currentOpponent else {
            await finalize(); return
        }

        // Narrow binary search
        let mid = (lo + hi) / 2
        if newAlbumWon { hi = mid } else { lo = mid + 1 }
        comparisonIndex += 1

        // Calculate new Elos
        let (winElo, loseElo) = newAlbumWon
            ? Elo.update(winnerElo: newElo,      winnerGames: newEloGames,
                         loserElo:  opp.eloScore, loserGames:  opp.eloGames)
            : Elo.update(winnerElo: opp.eloScore, winnerGames: opp.eloGames,
                         loserElo:  newElo,       loserGames:  newEloGames)

        let newAlbumNewElo  = newAlbumWon ? winElo  : loseElo
        let oppNewElo       = newAlbumWon ? loseElo : winElo

        newElo = newAlbumNewElo
        newEloGames += 1

        // Persist Elo for both albums
        async let _ = updateElo(userId: userId, releaseId: releaseId,
                                 eloScore: newElo, eloGames: newEloGames)
        async let _ = updateElo(userId: userId, releaseId: opp.releaseId,
                                 eloScore: oppNewElo, eloGames: opp.eloGames + 1)
        async let _ = logComparison(userId: userId,
                                     winnerReleaseId: newAlbumWon ? releaseId : opp.releaseId,
                                     loserReleaseId:  newAlbumWon ? opp.releaseId : releaseId)

        // If the user already has 5+ ranked albums, also update their displayed scores
        if opponents.count + 1 >= 5 {
            async let _ = writeScore(userId: userId, releaseId: opp.releaseId,
                                     score: Elo.toScore(oppNewElo))
        }

        if lo >= hi || comparisonIndex >= totalComparisons {
            await finalize()
        }
    }

    // MARK: Helpers

    private func updateElo(userId: UUID, releaseId: UUID,
                           eloScore: Double, eloGames: Int) async {
        struct EloUpdate: Encodable {
            let eloScore: Double; let eloGames: Int
            enum CodingKeys: String, CodingKey {
                case eloScore = "elo_score"; case eloGames = "elo_games"
            }
        }
        try? await supabase
            .from("ratings")
            .update(EloUpdate(eloScore: eloScore, eloGames: eloGames))
            .eq("user_id", value: userId)
            .eq("release_group_id", value: releaseId)
            .execute()
    }

    private func writeScore(userId: UUID, releaseId: UUID, score: Double) async {
        struct ScoreUpdate: Encodable { let score: Double }
        try? await supabase
            .from("ratings")
            .update(ScoreUpdate(score: score))
            .eq("user_id", value: userId)
            .eq("release_group_id", value: releaseId)
            .execute()
    }

    private func logComparison(userId: UUID, winnerReleaseId: UUID, loserReleaseId: UUID) async {
        struct Row: Encodable {
            let userId: UUID; let winnerId: UUID; let loserId: UUID
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"
                case winnerId = "winner_id"
                case loserId  = "loser_id"
            }
        }
        try? await supabase
            .from("pairwise_comparisons")
            .insert(Row(userId: userId, winnerId: winnerReleaseId, loserId: loserReleaseId))
            .execute()
    }

    private func finalize() async {
        userRatingsCount = opponents.count + 1
        if userRatingsCount >= 5 {
            let score = Elo.toScore(newElo)
            finalScore = score
            if let releaseId, let userId {
                await writeScore(userId: userId, releaseId: releaseId, score: score)
            }
        }
        if let text = pendingReviewText, !text.isEmpty, let rid = ratingId {
            struct Update: Encodable {
                let reviewText: String
                enum CodingKeys: String, CodingKey { case reviewText = "review_text" }
            }
            try? await supabase.from("ratings")
                .update(Update(reviewText: text))
                .eq("id", value: rid)
                .execute()
        }
        phase = .done
        NotificationCenter.default.post(name: .ratingChanged, object: nil)
    }
}

// MARK: - View

struct InstinctRatingView: View {
    let release: Release
    var onRated: ((UUID) -> Void)? = nil
    var onDone: (() -> Void)? = nil
    @State private var vm = InstinctRatingViewModel()
    @State private var selectedSide: Bool? = nil
    @State private var sheetDetent: PresentationDetent = .fraction(0.36)
    @Environment(\.dismiss) private var dismiss

    private func close() {
        if let onDone {
            onDone()
        } else {
            dismiss()
        }
    }

    var body: some View {
        ZStack {
            switch vm.phase {
            case .bucket:     bucketView
            case .postRating: postRatingView
            case .comparing:  comparingView
            case .done:       doneView
            }
        }
        .presentationBackground(Color.sjCream)
        .presentationDetents([.fraction(0.36), .medium], selection: $sheetDetent)
        .presentationDragIndicator(.visible)
        .onChange(of: vm.phase) { _, _ in
            withAnimation { sheetDetent = .fraction(0.36) }
        }
        .task {
            guard let userId = supabase.auth.currentUser?.id else { return }
            await vm.start(releaseId: release.id, userId: userId)
        }
    }

    // MARK: Phase 1.5 — Post-rating options

    private var postRatingView: some View {
        PostRatingOptionsView(
            release: release,
            onBack: { withAnimation { vm.phase = .bucket; sheetDetent = .fraction(0.36) } },
            onContinue: { text in Task { await vm.continueFromPostRating(reviewText: text) } }
        )
    }

    // MARK: Phase 1 — Bucket

    private var bucketView: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            HStack(spacing: 12) {
                CoverImage(url: release.coverUrl, cornerRadius: 8)
                    .frame(width: 52, height: 52)
                    .accessibilityHidden(true) // title text below already describes it

                VStack(alignment: .leading, spacing: 2) {
                    Text(release.displayTitle)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(2)
                    HStack(spacing: 6) {
                        Text(release.typeLabel)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjBlue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        Text(release.displayArtist)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjMuted)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)

            Divider().padding(.vertical, 14)

            Text("How was it?")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .tracking(0.8)
                .padding(.bottom, 10)

            HStack(spacing: 8) {
                ForEach(InstinctBucket.allCases, id: \.label) { bucket in
                    Button {
                        Task {
                            await vm.seedAndContinue(bucket: bucket)
                            onRated?(release.id)
                        }
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: bucket.icon)
                                .font(.system(size: 20))
                                .foregroundStyle(bucket.color)
                            Text(bucket.label.uppercased())
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(bucket.color)
                                .tracking(0.5)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(bucket.color.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .disabled(vm.isSaving)
                }
            }
            .padding(.horizontal, 20)

            Spacer(minLength: 0)
        }
        .padding(.vertical, 16)
    }

    // MARK: Phase 2 — Compare

    private var comparingView: some View {
        VStack(spacing: 0) {
            if vm.totalComparisons > 0 {
                HStack(spacing: 6) {
                    ForEach(0..<vm.totalComparisons, id: \.self) { i in
                        Capsule()
                            .fill(i < vm.comparisonIndex ? Color.sjBlue : Color.sjBorder)
                            .frame(height: 3)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, 14)
                .padding(.bottom, 10)
            }

            if let opp = vm.currentOpponent {
                Text("Which do you prefer?")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .padding(.bottom, 10)

                HStack(alignment: .top, spacing: 10) {
                    compareCard(title: release.displayTitle, artist: release.displayArtist,
                                coverUrl: release.coverUrl, isNew: true,
                                isSelected: selectedSide == true)
                        .onTapGesture { selectedSide = true }

                    compareCard(title: opp.release.displayTitle, artist: opp.release.displayArtist,
                                coverUrl: opp.release.coverUrl, isNew: false,
                                isSelected: selectedSide == false)
                        .onTapGesture { selectedSide = false }
                }
                .padding(.horizontal, 20)

                HStack(spacing: 10) {
                    Button {
                        vm.phase = .bucket
                        selectedSide = nil
                    } label: {
                        Text("← Back")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Color.sjBorder.opacity(0.5))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)

                    Button {
                        guard let side = selectedSide else { return }
                        selectedSide = nil
                        Task { await vm.vote(newAlbumWon: side) }
                    } label: {
                        Text("Select")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(selectedSide == nil ? Color.sjMuted : Color.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(selectedSide == nil ? Color.sjBorder.opacity(0.5) : Color.sjBlue)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedSide == nil)
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 20)
            }
        }
        .onChange(of: vm.comparisonIndex) { _, _ in selectedSide = nil }
    }

    private func compareCard(title: String, artist: String, coverUrl: String?,
                              isNew: Bool, isSelected: Bool) -> some View {
        VStack(spacing: 6) {
            CoverImage(url: coverUrl, cornerRadius: 8)
                .frame(width: 74, height: 74)
                .accessibilityHidden(true) // title/artist text below already describes it
            Text(title)
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Text(artist)
                .font(.system(size: 10))
                .foregroundStyle(Color.sjMuted)
                .lineLimit(1)
            if isNew {
                Text("NEW")
                    .font(.system(size: 9, weight: .bold)).foregroundStyle(Color.sjBlue)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.sjBlue.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                Color.clear.frame(height: 17)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .background(isSelected ? Color.sjBlue.opacity(0.1) : (isNew ? Color.sjBlue.opacity(0.04) : Color.sjSurface))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(isSelected ? Color.sjBlue : Color.sjBorder, lineWidth: isSelected ? 2 : 1.5))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Phase 3 — Done

    private var doneView: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                ZStack(alignment: .bottomTrailing) {
                    CoverImage(url: release.coverUrl)
                        .frame(width: 56, height: 56)
                        .accessibilityHidden(true) // title/artist text alongside already describes it

                    ZStack {
                        Circle()
                            .fill(Color.sjBlue)
                            .frame(width: 20, height: 20)
                            .overlay(Circle().stroke(Color.sjCream, lineWidth: 2))
                        Image(systemName: "checkmark")
                            .font(.system(size: 8, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .offset(x: 4, y: 4)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(release.displayTitle)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(2)
                    Text(release.displayArtist)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)

            if let score = vm.finalScore {
                HStack(spacing: 6) {
                    Image("icon-flower")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 14, height: 14)
                        .foregroundStyle(Color.sjBlue)
                    Text(String(format: "%.1f", score))
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(Color.sjBlue)
                    Text(String(format: String(localized: "· #%d ranked"), vm.userRatingsCount))
                        .font(.system(size: 11))
                        .foregroundStyle(Color.sjMuted)
                }
                .padding(.horizontal, 20).padding(.vertical, 12)
                .frame(maxWidth: .infinity)
                .background(Color.sjBlue.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 20)
                .padding(.top, 12)
            } else {
                VStack(spacing: 4) {
                    Text("Ranked!")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                    let needed = max(0, 5 - vm.userRatingsCount)
                    if needed > 0 {
                        Text(String(format: String(localized: "Rate %d more to reveal your score."), needed))
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjMuted)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.top, 12)
            }

            Button("Done") { close() }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(Color.sjBlue)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 20)
        }
    }
}

// MARK: - Track Instinct Rating ViewModel

@Observable
private class InstinctTrackRatingViewModel {
    enum Phase { case bucket, postRating, comparing, done }

    var phase: Phase = .bucket
    var isSaving = false

    private var opponents: [TrackOpponent] = []
    private var lo = 0
    private var hi = 0
    private(set) var comparisonIndex = 0
    private(set) var totalComparisons = 0
    private(set) var newElo: Double = Elo.defaultElo
    private var newEloGames = 0
    private var recordingId: UUID?
    private var userId: UUID?
    private(set) var userRatingsCount = 0
    private(set) var finalScore: Double?
    private var pendingReviewText: String? = nil

    var currentOpponent: TrackOpponent? {
        let mid = (lo + hi) / 2
        guard lo < hi, mid < opponents.count else { return nil }
        return opponents[mid]
    }

    func start(recordingId: UUID, userId: UUID) async {
        self.recordingId = recordingId
        self.userId = userId

        struct OpponentRow: Decodable {
            let recordingId: UUID
            let eloScore: Double
            let eloGames: Int
            let recordings: RecInfo
            struct RecInfo: Decodable {
                let title: String
                let artistDisplay: String?
                enum CodingKeys: String, CodingKey {
                    case title; case artistDisplay = "artist_display"
                }
            }
            enum CodingKeys: String, CodingKey {
                case recordingId = "recording_id"
                case eloScore    = "elo_score"
                case eloGames    = "elo_games"
                case recordings
            }
        }

        let rows: [OpponentRow] = (try? await supabase
            .from("track_ratings")
            .select("recording_id, elo_score, elo_games, recordings(title, artist_display)")
            .eq("user_id", value: userId)
            .not("elo_score", operator: .is, value: AnyJSON.null)
            .not("recording_id", operator: .eq, value: recordingId)
            .order("elo_score", ascending: false)
            .execute()
            .value) ?? []

        opponents = rows.map {
            TrackOpponent(recordingId: $0.recordingId, title: $0.recordings.title,
                          artist: $0.recordings.artistDisplay ?? "",
                          eloScore: $0.eloScore, eloGames: $0.eloGames)
        }
        let n = opponents.count
        totalComparisons = n > 0 ? min(3, Int(ceil(log2(Double(n + 1))))) : 0
        lo = 0; hi = n
        userRatingsCount = n
    }

    func seedAndContinue(bucket: InstinctBucket) async {
        newElo = bucket.seedElo
        newEloGames = 0
        phase = .postRating
    }

    func continueFromPostRating(reviewText: String?) async {
        guard let recordingId, let userId else { return }
        pendingReviewText = reviewText
        isSaving = true; defer { isSaving = false }

        struct Upsert: Encodable {
            let userId: UUID; let recordingId: UUID; let eloScore: Double; let eloGames: Int
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case recordingId = "recording_id"
                case eloScore = "elo_score"; case eloGames = "elo_games"
            }
        }
        try? await supabase.from("track_ratings")
            .upsert(Upsert(userId: userId, recordingId: recordingId,
                           eloScore: newElo, eloGames: newEloGames),
                    onConflict: "user_id,recording_id")
            .execute()

        if !opponents.isEmpty && lo < hi && totalComparisons > 0 {
            phase = .comparing
        } else {
            await finalize()
        }
    }

    func vote(newTrackWon: Bool) async {
        guard let recordingId, let userId, lo < hi, let opp = currentOpponent else {
            await finalize(); return
        }
        let mid = (lo + hi) / 2
        if newTrackWon { hi = mid } else { lo = mid + 1 }
        comparisonIndex += 1

        let (winElo, loseElo) = newTrackWon
            ? Elo.update(winnerElo: newElo, winnerGames: newEloGames,
                         loserElo: opp.eloScore, loserGames: opp.eloGames)
            : Elo.update(winnerElo: opp.eloScore, winnerGames: opp.eloGames,
                         loserElo: newElo, loserGames: newEloGames)

        newElo = newTrackWon ? winElo : loseElo
        newEloGames += 1

        async let _ = updateElo(userId: userId, recordingId: recordingId,
                                 eloScore: newElo, eloGames: newEloGames)
        async let _ = updateElo(userId: userId, recordingId: opp.recordingId,
                                 eloScore: newTrackWon ? loseElo : winElo, eloGames: opp.eloGames + 1)
        async let _ = logComparison(userId: userId,
                                     winnerId: newTrackWon ? recordingId : opp.recordingId,
                                     loserId:  newTrackWon ? opp.recordingId : recordingId)
        if opponents.count + 1 >= 5 {
            async let _ = writeScore(userId: userId, recordingId: opp.recordingId,
                                     score: Elo.toScore(newTrackWon ? loseElo : winElo))
        }
        if lo >= hi || comparisonIndex >= totalComparisons { await finalize() }
    }

    private func updateElo(userId: UUID, recordingId: UUID, eloScore: Double, eloGames: Int) async {
        struct U: Encodable {
            let eloScore: Double; let eloGames: Int
            enum CodingKeys: String, CodingKey { case eloScore = "elo_score"; case eloGames = "elo_games" }
        }
        try? await supabase.from("track_ratings")
            .update(U(eloScore: eloScore, eloGames: eloGames))
            .eq("user_id", value: userId).eq("recording_id", value: recordingId).execute()
    }

    private func writeScore(userId: UUID, recordingId: UUID, score: Double) async {
        struct S: Encodable { let score: Double }
        try? await supabase.from("track_ratings")
            .update(S(score: score))
            .eq("user_id", value: userId).eq("recording_id", value: recordingId).execute()
    }

    private func logComparison(userId: UUID, winnerId: UUID, loserId: UUID) async {
        struct Row: Encodable {
            let userId: UUID; let winnerId: UUID; let loserId: UUID
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case winnerId = "winner_id"; case loserId = "loser_id"
            }
        }
        try? await supabase.from("track_pairwise_comparisons")
            .insert(Row(userId: userId, winnerId: winnerId, loserId: loserId)).execute()
    }

    private func finalize() async {
        userRatingsCount = opponents.count + 1
        if userRatingsCount >= 5 {
            finalScore = Elo.toScore(newElo)
            if let recordingId, let userId {
                await writeScore(userId: userId, recordingId: recordingId, score: finalScore!)
            }
        }
        phase = .done
        NotificationCenter.default.post(name: .ratingChanged, object: nil)
    }
}

// MARK: - Track Instinct Rating View

struct InstinctTrackRatingView: View {
    let track: TrackEntry
    let release: Release
    var onRated: (() -> Void)? = nil
    var onDone: (() -> Void)? = nil

    @State private var vm = InstinctTrackRatingViewModel()
    @State private var selectedSide: Bool? = nil
    @State private var sheetDetent: PresentationDetent = .fraction(0.36)
    @Environment(\.dismiss) private var dismiss

    private func close() {
        if let onDone { onDone() } else { dismiss() }
    }

    var body: some View {
        ZStack {
            switch vm.phase {
            case .bucket:     bucketView
            case .postRating: postRatingView
            case .comparing:  comparingView
            case .done:       doneView
            }
        }
        .presentationBackground(Color.sjCream)
        .presentationDetents([.fraction(0.36), .medium], selection: $sheetDetent)
        .presentationDragIndicator(.visible)
        .onChange(of: vm.phase) { _, _ in
            withAnimation { sheetDetent = .fraction(0.36) }
        }
        .task {
            guard let userId = supabase.auth.currentUser?.id,
                  let recordingId = track.trackId else { return }
            await vm.start(recordingId: recordingId, userId: userId)
        }
    }

    // MARK: Phase 1.5 — Post-rating options

    private var postRatingView: some View {
        PostRatingOptionsView(
            release: release,
            onBack: { withAnimation { vm.phase = .bucket; sheetDetent = .fraction(0.36) } },
            onContinue: { text in Task { await vm.continueFromPostRating(reviewText: text) } }
        )
    }

    // MARK: Phase 1 — Bucket

    private var bucketView: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            HStack(spacing: 12) {
                CoverImage(url: release.coverUrl, cornerRadius: 8)
                    .frame(width: 52, height: 52)
                    .accessibilityHidden(true) // track title text alongside already describes it
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(2)
                    HStack(spacing: 6) {
                        Text("Song")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjBlue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        Text(release.displayArtist)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjMuted)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)

            Divider().padding(.vertical, 14)

            Text("How was it?")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .tracking(0.8)
                .padding(.bottom, 10)

            HStack(spacing: 8) {
                ForEach(InstinctBucket.allCases, id: \.label) { bucket in
                    Button {
                        Task { await vm.seedAndContinue(bucket: bucket); onRated?() }
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: bucket.icon)
                                .font(.system(size: 20)).foregroundStyle(bucket.color)
                            Text(bucket.label.uppercased())
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(bucket.color).tracking(0.5)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(bucket.color.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .disabled(vm.isSaving)
                }
            }
            .padding(.horizontal, 20)

            Spacer(minLength: 0)
        }
        .padding(.vertical, 16)
    }

    // MARK: Phase 2 — Compare

    private var comparingView: some View {
        VStack(spacing: 0) {
            if vm.totalComparisons > 0 {
                HStack(spacing: 6) {
                    ForEach(0..<vm.totalComparisons, id: \.self) { i in
                        Capsule()
                            .fill(i < vm.comparisonIndex ? Color.sjBlue : Color.sjBorder)
                            .frame(height: 3)
                    }
                }
                .padding(.horizontal, 32).padding(.top, 14).padding(.bottom, 10)
            }
            if let opp = vm.currentOpponent {
                Text("Which do you prefer?")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(Color.sjInk)
                    .padding(.bottom, 10)

                HStack(alignment: .top, spacing: 10) {
                    trackCard(title: track.title, artist: release.displayArtist,
                              coverUrl: release.coverUrl, isNew: true, isSelected: selectedSide == true)
                        .onTapGesture { selectedSide = true }
                    trackCard(title: opp.title, artist: opp.artist,
                              coverUrl: nil, isNew: false, isSelected: selectedSide == false)
                        .onTapGesture { selectedSide = false }
                }
                .padding(.horizontal, 20)

                HStack(spacing: 10) {
                    Button {
                        vm.phase = .bucket
                        selectedSide = nil
                    } label: {
                        Text("← Back")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(Color.sjBorder.opacity(0.5))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)

                    Button {
                        guard let side = selectedSide else { return }
                        selectedSide = nil
                        Task { await vm.vote(newTrackWon: side) }
                    } label: {
                        Text("Select")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(selectedSide == nil ? Color.sjMuted : Color.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(selectedSide == nil ? Color.sjBorder.opacity(0.5) : Color.sjBlue)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedSide == nil)
                }
                .padding(.horizontal, 20)
                .padding(.top, 10)
                .padding(.bottom, 20)
            }
        }
        .onChange(of: vm.comparisonIndex) { _, _ in selectedSide = nil }
    }

    private func trackCard(title: String, artist: String, coverUrl: String?,
                            isNew: Bool, isSelected: Bool) -> some View {
        VStack(spacing: 6) {
            if let url = coverUrl {
                CoverImage(url: url, cornerRadius: 8).frame(width: 74, height: 74)
                    .accessibilityHidden(true) // title/artist text below already describes it
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: 8).fill(Color.sjBorder).frame(width: 74, height: 74)
                    Image(systemName: "music.note").font(.system(size: 28)).foregroundStyle(Color.sjMuted)
                }
                .accessibilityHidden(true)
            }
            Text(title)
                .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.sjInk)
                .multilineTextAlignment(.center).lineLimit(2).fixedSize(horizontal: false, vertical: true)
            Text(artist)
                .font(.system(size: 10)).foregroundStyle(Color.sjMuted).lineLimit(1)
            if isNew {
                Text("NEW")
                    .font(.system(size: 9, weight: .bold)).foregroundStyle(Color.sjBlue)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.sjBlue.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 4))
            } else {
                Color.clear.frame(height: 17)
            }
        }
        .padding(10).frame(maxWidth: .infinity)
        .background(isSelected ? Color.sjBlue.opacity(0.1) : (isNew ? Color.sjBlue.opacity(0.04) : Color.sjSurface))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(isSelected ? Color.sjBlue : Color.sjBorder, lineWidth: isSelected ? 2 : 1.5))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Phase 3 — Done

    private var doneView: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                ZStack(alignment: .bottomTrailing) {
                    CoverImage(url: release.coverUrl).frame(width: 72, height: 72)
                        .accessibilityHidden(true) // track/artist text below already describes it
                    ZStack {
                        Circle().fill(Color.sjBlue).frame(width: 24, height: 24)
                            .overlay(Circle().stroke(Color.sjCream, lineWidth: 2))
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                    }
                    .offset(x: 5, y: 5)
                }
                .padding(.top, 20)

                Text(track.title)
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(Color.sjInk)
                    .multilineTextAlignment(.center).lineLimit(2).padding(.horizontal, 40)
                Text(release.displayArtist)
                    .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
            }

            if let score = vm.finalScore {
                VStack(spacing: 4) {
                    HStack(spacing: 6) {
                        Image("icon-flower").renderingMode(.template).resizable().scaledToFit()
                            .frame(width: 16, height: 16).foregroundStyle(Color.sjBlue)
                        Text(String(format: "%.1f", score))
                            .font(.system(size: 28, weight: .bold)).foregroundStyle(Color.sjBlue)
                    }
                    Text(String(format: String(localized: "Instinct Score · #%d ranked"), vm.userRatingsCount))
                        .font(.system(size: 11)).foregroundStyle(Color.sjMuted)
                }
                .padding(.horizontal, 28).padding(.vertical, 16)
                .background(Color.sjBlue.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.top, 16)
            } else {
                VStack(spacing: 6) {
                    Text("Ranked!")
                        .font(.system(size: 18, weight: .bold)).foregroundStyle(Color.sjInk)
                    let needed = max(0, 5 - vm.userRatingsCount)
                    if needed > 0 {
                        Text(String(format: String(localized: "Rate %d more to reveal your score."), needed))
                            .font(.system(size: 13)).foregroundStyle(Color.sjMuted)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.top, 16)
            }

            Button("Done") { close() }
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Color.sjBlue).clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 24).padding(.top, 20).padding(.bottom, 24)
        }
    }
}
