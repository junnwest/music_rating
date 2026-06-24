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

private enum Elo {
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

// MARK: - Opponent

private struct Opponent {
    let releaseId: UUID
    let release: Release
    let eloScore: Double
    let eloGames: Int
}

// MARK: - ViewModel

@Observable
private class InstinctRatingViewModel {
    enum Phase { case bucket, comparing, done }

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
            let releaseId: UUID
            let eloScore: Double
            let eloGames: Int
            let releases: Release
            enum CodingKeys: String, CodingKey {
                case releaseId = "release_id"
                case eloScore  = "elo_score"
                case eloGames  = "elo_games"
                case releases
            }
        }

        let rows: [OpponentRow] = (try? await supabase
            .from("ratings")
            .select("release_id, elo_score, elo_games, releases(id, title, artist, cover_url, release_type, release_date, title_native, artist_native)")
            .eq("user_id", value: userId)
            .not("elo_score", operator: .is, value: AnyJSON.null)
            .not("release_id", operator: .eq, value: releaseId)
            .order("elo_score", ascending: false)
            .execute()
            .value) ?? []

        opponents = rows.map { Opponent(releaseId: $0.releaseId, release: $0.releases,
                                        eloScore: $0.eloScore, eloGames: $0.eloGames) }

        let n = opponents.count
        totalComparisons = n > 0 ? min(3, Int(ceil(log2(Double(n + 1))))) : 0
        lo = 0
        hi = n
        userRatingsCount = n
    }

    // MARK: Bucket → seed Elo → maybe compare

    func seedAndContinue(bucket: InstinctBucket) async {
        guard let releaseId, let userId else { return }
        isSaving = true
        defer { isSaving = false }

        newElo = bucket.seedElo
        newEloGames = 0

        struct RatingUpsert: Encodable {
            let userId: UUID; let releaseId: UUID
            let eloScore: Double; let eloGames: Int
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case releaseId = "release_id"
                case eloScore = "elo_score"; case eloGames = "elo_games"
            }
        }

        try? await supabase
            .from("ratings")
            .upsert(RatingUpsert(userId: userId, releaseId: releaseId,
                                 eloScore: newElo, eloGames: newEloGames),
                    onConflict: "user_id,release_id")
            .execute()

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
            .eq("release_id", value: releaseId)
            .execute()
    }

    private func writeScore(userId: UUID, releaseId: UUID, score: Double) async {
        struct ScoreUpdate: Encodable { let score: Double }
        try? await supabase
            .from("ratings")
            .update(ScoreUpdate(score: score))
            .eq("user_id", value: userId)
            .eq("release_id", value: releaseId)
            .execute()
    }

    private func logComparison(userId: UUID, winnerReleaseId: UUID, loserReleaseId: UUID) async {
        struct Row: Encodable {
            let userId: UUID; let winnerReleaseId: UUID; let loserReleaseId: UUID
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"
                case winnerReleaseId = "winner_release_id"
                case loserReleaseId  = "loser_release_id"
            }
        }
        try? await supabase
            .from("pairwise_comparisons")
            .insert(Row(userId: userId, winnerReleaseId: winnerReleaseId, loserReleaseId: loserReleaseId))
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
        phase = .done
    }
}

// MARK: - View

struct InstinctRatingView: View {
    let release: Release
    var onRated: ((UUID) -> Void)? = nil
    var onDone: (() -> Void)? = nil
    @State private var vm = InstinctRatingViewModel()
    @Environment(\.dismiss) private var dismiss

    private func close() {
        // Use parent binding when available — calling both simultaneously can cancel the animation
        if let onDone {
            onDone()
        } else {
            dismiss()
        }
    }

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            switch vm.phase {
            case .bucket:    bucketView
            case .comparing: comparingView
            case .done:      doneView
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
        .task {
            guard let userId = supabase.auth.currentUser?.id else { return }
            await vm.start(releaseId: release.id, userId: userId)
        }
    }

    // MARK: Phase 1 — Bucket

    private var bucketView: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                    switch phase {
                    case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                    default: Color.sjBorder
                    }
                }
                .frame(width: 52, height: 52)
                .clipShape(RoundedRectangle(cornerRadius: 8))

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
            .padding(.top, 20)

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
            .padding(.bottom, 24)
        }
    }

    // MARK: Phase 2 — Compare (I2: side-by-side cards)

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
                    .padding(.bottom, 12)

                HStack(alignment: .top, spacing: 10) {
                    // ── New album card ──
                    VStack(spacing: 6) {
                        AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                            switch phase {
                            case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                            default: Color.sjBorder
                            }
                        }
                        .frame(width: 74, height: 74)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                        Text(release.displayTitle)
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(release.displayArtist)
                            .font(.system(size: 10))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)

                        Text("NEW")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Color.sjBlue.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 4))

                        Spacer(minLength: 0)

                        Button {
                            Task { await vm.vote(newAlbumWon: true) }
                        } label: {
                            Text("Select")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 7)
                                .background(Color.sjBlue)
                                .clipShape(RoundedRectangle(cornerRadius: 7))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(Color.sjBlue.opacity(0.06))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sjBlue, lineWidth: 1.5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                    // ── Opponent card ──
                    VStack(spacing: 6) {
                        AsyncImage(url: URL(string: opp.release.coverUrl ?? "")) { phase in
                            switch phase {
                            case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                            default: Color.sjBorder
                            }
                        }
                        .frame(width: 74, height: 74)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                        Text(opp.release.displayTitle)
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                            .multilineTextAlignment(.center)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)

                        Text(opp.release.displayArtist)
                            .font(.system(size: 10))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)

                        // Spacer to align with NEW badge on the other card
                        Color.clear.frame(height: 17)

                        Spacer(minLength: 0)

                        Button {
                            Task { await vm.vote(newAlbumWon: false) }
                        } label: {
                            Text("Select")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 7)
                                .background(Color.sjInk)
                                .clipShape(RoundedRectangle(cornerRadius: 7))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(10)
                    .frame(maxWidth: .infinity)
                    .background(Color.sjSurface)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder, lineWidth: 1.5))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 20)
            }
        }
    }

    // MARK: Phase 3 — Done (I2: checkmark cover + rank + score badge)

    private var doneView: some View {
        VStack(spacing: 0) {
            VStack(spacing: 8) {
                ZStack(alignment: .bottomTrailing) {
                    AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                        switch phase {
                        case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                        default: Color.sjBorder
                        }
                    }
                    .frame(width: 72, height: 72)
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                    ZStack {
                        Circle()
                            .fill(Color.sjBlue)
                            .frame(width: 24, height: 24)
                            .overlay(Circle().stroke(Color.sjCream, lineWidth: 2))
                        Image(systemName: "checkmark")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .offset(x: 5, y: 5)
                }
                .padding(.top, 20)

                Text(release.displayTitle)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .padding(.horizontal, 40)

                Text(release.displayArtist)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
            }

            if let score = vm.finalScore {
                VStack(spacing: 4) {
                    HStack(spacing: 6) {
                        Image("icon-flower")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 16, height: 16)
                            .foregroundStyle(Color.sjBlue)
                        Text(String(format: "%.1f", score))
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(Color.sjBlue)
                    }
                    Text("Instinct Score · #\(vm.userRatingsCount) ranked")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.sjMuted)
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 16)
                .background(Color.sjBlue.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 14))
                .padding(.top, 16)
            } else {
                VStack(spacing: 6) {
                    Text("Ranked!")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                    let needed = max(0, 5 - vm.userRatingsCount)
                    if needed > 0 {
                        Text("Rate \(needed) more to reveal your score.")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.sjMuted)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.top, 16)
            }

            Button("Done") { close() }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.sjBlue)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, 24)
        }
    }
}
