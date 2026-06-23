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

        // Persist both
        async let _ = updateElo(userId: userId, releaseId: releaseId,
                                 eloScore: newElo, eloGames: newEloGames)
        async let _ = updateElo(userId: userId, releaseId: opp.releaseId,
                                 eloScore: oppNewElo, eloGames: opp.eloGames + 1)
        async let _ = logComparison(userId: userId,
                                     winnerReleaseId: newAlbumWon ? releaseId : opp.releaseId,
                                     loserReleaseId:  newAlbumWon ? opp.releaseId : releaseId)

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
            finalScore = Elo.toScore(newElo)
        }
        phase = .done
    }
}

// MARK: - View

struct InstinctRatingView: View {
    let release: Release
    var onRated: ((UUID) -> Void)? = nil
    @State private var vm = InstinctRatingViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sjCream.ignoresSafeArea()

                switch vm.phase {
                case .bucket:    bucketView
                case .comparing: comparingView
                case .done:      doneView
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .task {
            guard let userId = supabase.auth.currentUser?.id else { return }
            await vm.start(releaseId: release.id, userId: userId)
        }
    }

    // MARK: Phase 1 — Bucket

    private var bucketView: some View {
        VStack(spacing: 32) {
            albumHero(title: "How was it?", subtitle: nil)

            VStack(spacing: 10) {
                ForEach(InstinctBucket.allCases, id: \.label) { bucket in
                    Button {
                        Task {
                            await vm.seedAndContinue(bucket: bucket)
                            onRated?(release.id)
                        }
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: bucket.icon)
                                .font(.system(size: 20))
                                .frame(width: 28)
                            Text(bucket.label)
                                .font(.system(size: 16, weight: .semibold))
                            Spacer()
                        }
                        .foregroundStyle(bucket.color)
                        .padding(.horizontal, 20)
                        .padding(.vertical, 16)
                        .background(bucket.color.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                    }
                    .buttonStyle(.plain)
                    .disabled(vm.isSaving)
                }
            }
            .padding(.horizontal, 24)

            Spacer()
        }
        .padding(.top, 28)
    }

    // MARK: Phase 2 — Pairwise comparison

    private var comparingView: some View {
        VStack(spacing: 0) {
            // Progress dots
            if vm.totalComparisons > 0 {
                HStack(spacing: 6) {
                    ForEach(0..<vm.totalComparisons, id: \.self) { i in
                        Capsule()
                            .fill(i < vm.comparisonIndex ? Color.sjBlue : Color.sjBorder)
                            .frame(height: 4)
                    }
                }
                .padding(.horizontal, 32)
                .padding(.top, 16)
            }

            Text("Which do you prefer?")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .padding(.top, 24)
                .padding(.bottom, 20)

            if let opp = vm.currentOpponent {
                HStack(alignment: .top, spacing: 12) {
                    comparisonCard(release: release, isNew: true) {
                        Task { await vm.vote(newAlbumWon: true) }
                    }
                    VStack {
                        Spacer()
                        Text("vs")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(Color.sjMuted)
                        Spacer()
                    }
                    comparisonCard(release: opp.release, isNew: false) {
                        Task { await vm.vote(newAlbumWon: false) }
                    }
                }
                .padding(.horizontal, 20)
            }

            Spacer()
        }
    }

    private func comparisonCard(release: Release, isNew: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 10) {
                AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                    switch phase {
                    case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                    default: Color.sjBorder
                    }
                }
                .frame(maxWidth: .infinity)
                .aspectRatio(1, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 10))

                Text(release.displayTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)

                Text(release.displayArtist)
                    .font(.system(size: 11))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)

                if isNew {
                    Text("New")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color.sjBlue)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.sjBlue.opacity(0.1))
                        .clipShape(Capsule())
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity)
            .background(Color.sjSurface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sjBorder, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: Phase 3 — Done

    private var doneView: some View {
        VStack(spacing: 28) {
            albumHero(title: nil, subtitle: nil)

            if let score = vm.finalScore {
                VStack(spacing: 6) {
                    HStack(spacing: 8) {
                        Image("icon-flower")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 18, height: 18)
                            .foregroundStyle(Color.sjBlue)
                        Text(String(format: "%.1f", score))
                            .font(.system(size: 32, weight: .bold))
                            .foregroundStyle(Color.sjBlue)
                    }
                    Text("Your Instinct Score")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjMuted)
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 20)
                .background(Color.sjBlue.opacity(0.08))
                .clipShape(RoundedRectangle(cornerRadius: 16))
            } else {
                VStack(spacing: 8) {
                    Text("Rated!")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                    let needed = max(0, 5 - vm.userRatingsCount)
                    if needed > 0 {
                        Text("Rate \(needed) more \(needed == 1 ? "album" : "albums") to reveal your score.")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.sjMuted)
                            .multilineTextAlignment(.center)
                    }
                }
            }

            Button("Done") { dismiss() }
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Color.sjBlue)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.horizontal, 32)

            Spacer()
        }
        .padding(.top, 28)
        .padding(.horizontal, 24)
    }

    // MARK: Shared album hero

    private func albumHero(title: String?, subtitle: String?) -> some View {
        VStack(spacing: 14) {
            AsyncImage(url: URL(string: release.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                default: Color.sjBorder
                }
            }
            .frame(width: 120, height: 120)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.1), radius: 8, y: 4)

            VStack(spacing: 4) {
                Text(release.displayTitle)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .multilineTextAlignment(.center)
                Text(release.displayArtist)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)
            }

            if let title {
                Text(title)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Color.sjInk)
            }
            if let subtitle {
                Text(subtitle)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
            }
        }
    }
}
