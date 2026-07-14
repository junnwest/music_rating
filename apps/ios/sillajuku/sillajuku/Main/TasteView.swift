import SwiftUI
import Observation
import Supabase

// MARK: - Insight card model

enum TasteInsightCard: Identifiable {
    case topAlbum(releaseId: UUID, title: String, artist: String, coverUrl: String?, score: Double)
    case activityPeak(monthName: String, count: Int, allMonths: [(month: Int, count: Int)])
    case tasteType(code: String, adjectiveKey: String, nounKey: String)
    case genreStanding(genre: String, userAvg: Double, communityAvg: Double, userCount: Int)

    var id: String {
        switch self {
        case .topAlbum(let rid, _, _, _, _):    return "top_\(rid)"
        case .activityPeak(let m, _, _):         return "activity_\(m)"
        case .tasteType(let code, _, _):         return "type_\(code)"
        case .genreStanding(let g, _, _, _):     return "genre_\(g)"
        }
    }
}

// MARK: - ViewModel

@Observable
final class TasteViewModel {
    static let unlockThreshold = 25

    private(set) var ratingCount = 0
    private(set) var cards: [TasteInsightCard] = []
    private(set) var isLoading = true

    var isUnlocked: Bool { ratingCount >= Self.unlockThreshold }
    var remaining: Int   { max(0, Self.unlockThreshold - ratingCount) }

    func load() async {
        guard let user = supabase.auth.currentUser else { isLoading = false; return }

        // Cheap counts only, just to decide the unlock gate -- matching ProfileView's
        // `totalRatings` so the unlock progress agrees with the "Rated" stat on the profile.
        // The actual card data (once unlocked) comes from web's own /api/taste/profile below,
        // rather than a second, separately-maintained local computation.
        let albumCount = (try? await supabase.from("ratings")
            .select("*", head: true, count: .exact).eq("user_id", value: user.id).execute())?.count ?? 0
        let songCount = (try? await supabase.from("track_ratings")
            .select("*", head: true, count: .exact).eq("user_id", value: user.id).execute())?.count ?? 0
        ratingCount = albumCount + songCount

        if isUnlocked {
            cards = await buildCards()
        }

        isLoading = false
    }

    // Calls web's own /api/taste/profile directly (same taste-vector/genre-embedding algorithm
    // web's Taste page uses) instead of the old single get_user_genre_standings RPC call + local
    // top-album/activity-month computation -- one algorithm, one source of truth. Builds the same
    // 4-ish card shapes the reel already had (per this session's "algorithm only, keep the
    // existing card-reel UI" scope decision), just fed by richer data: a real composite taste
    // type instead of a single 5-star-frequency heuristic, and up to 3 genre standings instead of
    // just the first one.
    private func buildCards() async -> [TasteInsightCard] {
        guard let resp: TasteProfileResponse = await WebAPI.get(
            "/api/taste/profile", authed: true, query: ["refresh": "1"]
        ) else { return [] }

        var result: [TasteInsightCard] = []

        if let top = resp.topAlbum {
            result.append(.topAlbum(
                releaseId: top.id, title: top.title, artist: top.artist,
                coverUrl: top.coverUrl, score: top.score
            ))
        }

        // months/peakMonthIndex are 0-indexed (JS Date.getMonth()) -- monthSymbols is also
        // 0-indexed, so peakMonthIndex needs no adjustment; allMonths converts to the 1-indexed
        // `month` field ActivityCard's existing view code already expects.
        if let peakIndex = resp.stats.peakMonthIndex, resp.stats.peakMonthCount > 0 {
            let name = Calendar.current.monthSymbols[peakIndex]
            let allMonths = resp.stats.months.enumerated().map { (month: $0.offset + 1, count: $0.element) }
            result.append(.activityPeak(monthName: name, count: resp.stats.peakMonthCount, allMonths: allMonths))
        }

        result.append(.tasteType(
            code: resp.type.code, adjectiveKey: resp.type.adjectiveKey, nounKey: resp.type.nounKey
        ))

        for standing in resp.standings.prefix(3) {
            result.append(.genreStanding(
                genre: standing.genre, userAvg: standing.userAvg,
                communityAvg: standing.communityAvg, userCount: standing.userCount
            ))
        }

        return result
    }
}

// MARK: - TasteView (root)

struct TasteView: View {
    var onGoToAdd: (() -> Void)? = nil
    @State private var vm = TasteViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if vm.isLoading {
                    tasteLoader
                } else if !vm.isUnlocked {
                    TasteLockView(ratingCount: vm.ratingCount, onGoToAdd: onGoToAdd)
                } else {
                    TasteReelView(cards: vm.cards)
                }
            }
            .navigationBarHidden(true)
        }
        .task { await vm.load() }
    }

    private var tasteLoader: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            ProgressView().tint(Color.sjAmber)
        }
    }
}

// MARK: - Lock screen

private struct TasteLockView: View {
    let ratingCount: Int
    var onGoToAdd: (() -> Void)? = nil
    private static let threshold = TasteViewModel.unlockThreshold

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer()

                Image(systemName: "lock.fill")
                    .font(.system(size: 36, weight: .medium))
                    .foregroundStyle(Color.sjAmber)
                    .padding(.bottom, 24)

                Text(String(format: String(localized: "Rate %d more\nreleases to unlock Taste"), Self.threshold - ratingCount))
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 12)

                Text("We need enough ratings to surface\nmeaningful insights about your taste.")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 40)

                // Progress bar
                VStack(spacing: 8) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule()
                                .fill(Color.sjAmber.opacity(0.12))
                                .frame(height: 6)
                            Capsule()
                                .fill(Color.sjAmber)
                                .frame(
                                    width: geo.size.width * CGFloat(ratingCount) / CGFloat(Self.threshold),
                                    height: 6
                                )
                        }
                    }
                    .frame(height: 6)
                    .padding(.horizontal, 48)

                    Text(String(format: String(localized: "%d of %d"), ratingCount, Self.threshold))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjMuted)
                }

                if let onGoToAdd {
                    Button(action: onGoToAdd) {
                        Text("Find releases to rate")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.sjCream)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(Color.sjBlue)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .buttonStyle(.plain)
                    .padding(.horizontal, 48)
                    .padding(.top, 20)
                }

                Spacer()

                // Teaser strip
                VStack(spacing: 10) {
                    Text("Coming to you")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color.sjMuted.opacity(0.6))
                        .kerning(0.8)
                        .textCase(.uppercase)

                    HStack(spacing: 0) {
                        ForEach(teaserItems, id: \.1) { icon, label in
                            VStack(spacing: 5) {
                                Image(systemName: icon)
                                    .font(.system(size: 20))
                                    .foregroundStyle(Color.sjAmber.opacity(0.4))
                                Text(label)
                                    .font(.system(size: 10))
                                    .foregroundStyle(Color.sjMuted.opacity(0.7))
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .padding(.bottom, 48)
            }
            .padding(.horizontal, 24)
        }
    }

    private let teaserItems: [(String, String)] = [
        ("star.fill",      "Top Album"),
        ("chart.bar.fill", "Activity"),
        ("theatermasks",   "Your Style"),
        ("waveform",       "Genre DNA")
    ]
}

// MARK: - Reel

private struct TasteReelView: View {
    let cards: [TasteInsightCard]
    @State private var scrolledID: String?

    private var currentIndex: Int {
        guard let id = scrolledID else { return 0 }
        return cards.firstIndex(where: { $0.id == id }) ?? 0
    }

    var body: some View {
        GeometryReader { geo in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(Array(cards.enumerated()), id: \.element.id) { i, card in
                        InsightCardView(card: card, isLast: i == cards.count - 1)
                            .frame(height: geo.size.height)
                            .id(card.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $scrolledID)
            .overlay(alignment: .trailing) {
                progressDots
                    .padding(.trailing, 14)
            }
        }
        .ignoresSafeArea()
    }

    private var progressDots: some View {
        VStack(spacing: 6) {
            ForEach(0..<cards.count, id: \.self) { i in
                Circle()
                    .fill(i == currentIndex
                          ? Color.white.opacity(0.85)
                          : Color.white.opacity(0.22))
                    .frame(width: i == currentIndex ? 6 : 5,
                           height: i == currentIndex ? 6 : 5)
                    .animation(.easeInOut(duration: 0.2), value: currentIndex)
            }
        }
        .frame(maxHeight: .infinity, alignment: .center)
    }
}

// MARK: - Card dispatcher

private struct InsightCardView: View {
    let card: TasteInsightCard
    let isLast: Bool

    var body: some View {
        switch card {
        case .topAlbum(let rid, let title, let artist, let coverUrl, let score):
            TopAlbumCard(
                releaseId: rid, title: title, artist: artist,
                coverUrl: coverUrl, score: score, isLast: isLast
            )
        case .activityPeak(let name, let count, let months):
            ActivityCard(monthName: name, count: count, allMonths: months, isLast: isLast)
        case .tasteType(let code, let adjectiveKey, let nounKey):
            TasteTypeCard(code: code, adjectiveKey: adjectiveKey, nounKey: nounKey, isLast: isLast)
        case .genreStanding(let genre, let userAvg, let communityAvg, let userCount):
            GenreStandingCard(
                genre: genre, userAvg: userAvg,
                communityAvg: communityAvg, userCount: userCount, isLast: isLast
            )
        }
    }
}

// MARK: - Top Album card

private struct TopAlbumCard: View {
    let releaseId: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    let score: Double
    let isLast: Bool

    var body: some View {
        ZStack {
            Color(red: 0.07, green: 0.07, blue: 0.10).ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer()
                TasteEyebrow(label: "Your #1 Album", color: .sjAmber)
                    .padding(.bottom, 22)
                coverThumb
                    .padding(.bottom, 22)
                Text(title)
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .padding(.horizontal, 36)
                Text(artist)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .padding(.top, 4)
                    .padding(.bottom, 24)
                Text(String(format: "%.1f", score))
                    .font(.system(size: 64, weight: .black))
                    .foregroundStyle(Color.sjAmber)
                    .kerning(-2)
                Text("out of 5.0")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.white.opacity(0.28))
                Spacer()
                if !isLast { TasteSwipeHint() }
            }
        }
    }

    private var coverThumb: some View {
        Group {
            if let s = coverUrl, let url = URL(string: s) {
                CachedImage(url: url) { Color.white.opacity(0.08) }
                    .scaledToFill()
            } else {
                Color.white.opacity(0.08)
            }
        }
        .frame(width: 156, height: 156)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.4), radius: 20, y: 8)
        .accessibilityHidden(true) // title/artist text below already describes it
    }
}

// MARK: - Activity card

private struct ActivityCard: View {
    let monthName: String
    let count: Int
    let allMonths: [(month: Int, count: Int)]
    let isLast: Bool

    private var maxCount: Int { allMonths.map(\.count).max() ?? 1 }
    private let shortNames = ["J","F","M","A","M","J","J","A","S","O","N","D"]

    var body: some View {
        ZStack {
            Color(red: 0.12, green: 0.09, blue: 0.02).ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer()
                TasteEyebrow(label: "Your Month", color: .sjAmber)
                    .padding(.bottom, 20)
                Text("\(monthName) was your\nmost active month.")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 8)
                Text(String(format: String(localized: "%d albums rated"), count))
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjAmber.opacity(0.7))
                    .padding(.bottom, 36)
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(allMonths, id: \.month) { item in
                        let isPeak = item.count == maxCount && item.count > 0
                        VStack(spacing: 3) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(isPeak ? Color.sjAmber : Color.white.opacity(0.12))
                                .frame(height: max(3, CGFloat(item.count) / CGFloat(maxCount) * 60))
                            Text(shortNames[item.month - 1])
                                .font(.system(size: 7, weight: isPeak ? .bold : .regular))
                                .foregroundStyle(isPeak ? Color.sjAmber : Color.white.opacity(0.25))
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 28)
                Spacer()
                if !isLast { TasteSwipeHint() }
            }
        }
    }
}

// MARK: - Taste Type card

private struct TasteTypeCard: View {
    let code: String
    let adjectiveKey: String
    let nounKey: String
    let isLast: Bool

    private var adjective: String {
        switch adjectiveKey {
        case "adjWE": return String(localized: "Open-Hearted")
        case "adjSE": return String(localized: "Discerning")
        case "adjWF": return String(localized: "Devoted")
        case "adjSF": return String(localized: "Exacting")
        default:      return ""
        }
    }

    private var noun: String {
        switch nounKey {
        case "nounMN": return String(localized: "Wave Rider")
        case "nounUN": return String(localized: "Scene Digger")
        case "nounMT": return String(localized: "Canon Keeper")
        case "nounUT": return String(localized: "Crate Digger")
        default:       return ""
        }
    }

    private let accentColor = Color(red: 0.85, green: 0.38, blue: 0.38)

    var body: some View {
        ZStack {
            Color(red: 0.13, green: 0.06, blue: 0.06).ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer()
                TasteEyebrow(label: "Your Type", color: accentColor)
                    .padding(.bottom, 20)
                Text(String(format: String(localized: "The %@ %@"), adjective, noun))
                    .font(.system(size: 30, weight: .black))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 12)
                Text(code.map(String.init).joined(separator: " · "))
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(accentColor.opacity(0.8))
                    .kerning(1)
                Spacer()
                if !isLast { TasteSwipeHint() }
            }
        }
    }
}

// MARK: - Genre Standing card

private struct GenreStandingCard: View {
    let genre: String
    let userAvg: Double
    let communityAvg: Double
    let userCount: Int
    let isLast: Bool

    private var diff: Double { userAvg - communityAvg }
    private let accentColor = Color(red: 0.38, green: 0.68, blue: 1.0)

    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.08, blue: 0.16).ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer()
                TasteEyebrow(label: "Genre DNA", color: accentColor)
                    .padding(.bottom, 20)
                Text(String(format: String(localized: "You rate %@\n%@ than most."), genre, diff >= 0 ? String(localized: "higher") : String(localized: "lower")))
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.bottom, 6)
                Text(String(format: String(localized: "From %d ratings"), userCount))
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white.opacity(0.3))
                    .padding(.bottom, 36)
                VStack(spacing: 12) {
                    genreBar(label: "You", value: userAvg, color: .sjAmber)
                    genreBar(label: "Community", value: communityAvg, color: Color.white.opacity(0.25))
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 20)
                diffBadge
                Spacer()
                if isLast {
                    Text("That's your taste snapshot.")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.white.opacity(0.18))
                        .padding(.bottom, 48)
                } else {
                    TasteSwipeHint()
                }
            }
        }
    }

    private var diffBadge: some View {
        HStack(spacing: 5) {
            Image(systemName: diff >= 0 ? "arrow.up" : "arrow.down")
                .font(.system(size: 11, weight: .bold))
            Text(String(format: "%.2f %@ average", abs(diff), diff >= 0 ? "above" : "below"))
                .font(.system(size: 13, weight: .semibold))
        }
        .foregroundStyle(diff >= 0 ? Color.sjAmber : Color.white.opacity(0.45))
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .background(Color.white.opacity(0.07))
        .clipShape(Capsule())
    }

    private func genreBar(label: LocalizedStringKey, value: Double, color: Color) -> some View {
        HStack(spacing: 10) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.4))
                .frame(width: 72, alignment: .trailing)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.07)).frame(height: 7)
                    Capsule().fill(color)
                        .frame(width: geo.size.width * CGFloat(value / 5.0), height: 7)
                }
            }
            .frame(height: 7)
            Text(String(format: "%.2f", value))
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 30, alignment: .leading)
        }
    }
}

// MARK: - Shared sub-views

private struct TasteEyebrow: View {
    let label: LocalizedStringKey
    let color: Color

    var body: some View {
        Text(label)
            .font(.system(size: 9, weight: .black))
            .foregroundStyle(color)
            .textCase(.uppercase)
            .kerning(0.8)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(color.opacity(0.14))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(color.opacity(0.3), lineWidth: 0.5))
    }
}

private struct TasteSwipeHint: View {
    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: "chevron.up")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.white.opacity(0.22))
            Text("Swipe up")
                .font(.system(size: 10))
                .foregroundStyle(Color.white.opacity(0.18))
        }
        .padding(.bottom, 48)
    }
}
