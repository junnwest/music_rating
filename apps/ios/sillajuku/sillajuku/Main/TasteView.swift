import SwiftUI
import Observation
import Supabase

// MARK: - ViewModel

@Observable
final class TasteViewModel {
    static let unlockThreshold = 25

    private(set) var ratingCount = 0
    private(set) var report: TasteProfileResponse?
    private(set) var isLoading = true
    // True only when the count fetch itself failed (timeout/network) -- kept
    // distinct from "below threshold" so a transient failure can't silently
    // masquerade as a low rating count and falsely show the lock screen to a
    // user who's well past it.
    private(set) var loadFailed = false
    private(set) var isRefreshing = false
    private var hasLoaded = false

    var isUnlocked: Bool { ratingCount >= Self.unlockThreshold }
    var remaining: Int   { max(0, Self.unlockThreshold - ratingCount) }

    private func fetchCount(table: String, userId: UUID) async -> Int? {
        (try? await supabase.from(table)
            .select("*", head: true, count: .exact).eq("user_id", value: userId).execute())?.count
    }

    func load() async {
        guard !hasLoaded else { return }
        guard let user = supabase.auth.currentUser else { isLoading = false; return }
        isLoading = true
        loadFailed = false

        // Cheap counts only, just to decide the unlock gate -- matching ProfileView's
        // `totalRatings` so the unlock progress agrees with the "Rated" stat on the profile.
        // The report itself comes from web's own /api/taste/profile (one algorithm, one
        // source of truth) -- kicked off here, in parallel with the counts, rather than
        // after them: most visits ARE already unlocked (25 ratings is a low bar), so
        // waiting for the cheap counts to resolve before even starting the report fetch
        // (by far the slower of the two -- a full report computation, not a row count)
        // turned this into a needless waterfall for the common case. Simply never
        // awaited (auto-cancelled) for the rare still-locked visitor.
        // No refresh=1: that skips the route's cache on every load, forcing a full
        // recomputation per visit -- the exact Vercel-CPU bug fixed on web 2026-07-15.
        async let reportTask: TasteProfileResponse? = WebAPI.get("/api/taste/profile", authed: true)
        async let albumTask = fetchCount(table: "ratings", userId: user.id)
        async let songTask  = fetchCount(table: "track_ratings", userId: user.id)
        var albumCount = await albumTask
        var songCount  = await songTask
        if albumCount == nil { albumCount = await fetchCount(table: "ratings", userId: user.id) }        // one retry
        if songCount  == nil { songCount  = await fetchCount(table: "track_ratings", userId: user.id) }  // one retry
        guard let albumCount, let songCount else {
            loadFailed = true
            isLoading = false
            return
        }
        ratingCount = albumCount + songCount

        if isUnlocked {
            report = await reportTask
            guard report != nil else {
                // Don't latch hasLoaded -- a failed report fetch must retry on next
                // visit/Retry tap, not freeze the view in a permanent broken state
                // (this exact bug: hasLoaded set before this fetch even ran meant a
                // one-time report failure got stuck forever, falling through to a
                // stale branch that showed the lock screen with a negative countdown).
                loadFailed = true
                isLoading = false
                return
            }
        }

        hasLoaded = true
        isLoading = false
    }

    /// Manually bypasses the route's 60s cache -- the **only** path allowed to
    /// pass `refresh=1` (mirrors web's `page.tsx` Refresh button, and its
    /// explicit warning not to auto-bypass on every load, which burned Vercel
    /// CPU before it was removed 2026-07-15). Deliberately separate from
    /// `load()` rather than a parameter on it, so that guarantee holds
    /// structurally instead of by convention. Keeps the existing `report` on
    /// screen while in flight and on failure, rather than blanking the page.
    func refresh() async {
        guard !isRefreshing, isUnlocked else { return }
        isRefreshing = true
        if let fresh: TasteProfileResponse = await WebAPI.get("/api/taste/profile", authed: true, query: ["refresh": "1"]) {
            report = fresh
        }
        isRefreshing = false
    }
}

// MARK: - TasteView (root)

struct TasteView: View {
    var viewModel: TasteViewModel
    var onGoToAdd: (() -> Void)? = nil

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    tasteLoader
                } else if viewModel.loadFailed {
                    tasteFailed
                } else if !viewModel.isUnlocked {
                    TasteLockView(ratingCount: viewModel.ratingCount, onGoToAdd: onGoToAdd)
                } else if let report = viewModel.report {
                    TasteReportView(
                        report: report,
                        isRefreshing: viewModel.isRefreshing,
                        onRefresh: { Task { await viewModel.refresh() } }
                    )
                } else {
                    // Unreachable via load() now (unlocked-but-no-report routes through
                    // loadFailed above) -- kept as a safety net so an unlocked user with
                    // a missing report never again sees the lock screen's nonsensical
                    // "rate N more" math instead of an honest failure state.
                    tasteFailed
                }
            }
            .navigationBarHidden(true)
        }
        .task { await viewModel.load() }
    }

    private var tasteLoader: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            ProgressView().tint(Color.sjAmber)
        }
    }

    private var tasteFailed: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            VStack(spacing: 12) {
                Image("icon-wifi-off")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 36, height: 36)
                    .foregroundStyle(Color.sjBorder)
                Text("Couldn't load your taste progress.")
                    .font(.jakarta(15))
                    .foregroundStyle(Color.sjMuted)
                Button("Retry") { Task { await viewModel.load() } }
                    .font(.jakarta(14, weight: .semibold))
                    .foregroundStyle(Color.sjAmber)
            }
        }
    }
}

// MARK: - Report

/// The graphical taste-analysis report — a direct port of web's Taste page
/// (2026-07-13 rebuild + 2026-07-17 territory bubbles): worlds as packed
/// bubbles, per-world sub-genre breakdowns, decade + score histograms with
/// mean markers, scene mix, canon reach, stat tiles, community dumbbells,
/// and disliked chips. Every chart carries web's plain-language sentence.
private struct TasteReportView: View {
    let report: TasteProfileResponse
    let isRefreshing: Bool
    let onRefresh: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    private var stats: TasteProfileResponse.TasteStats { report.stats }
    private var charts: TasteProfileResponse.TasteCharts { report.charts }

    /// Section numbers stay sequential no matter which sections this profile
    /// has -- port of web's `nextNo()` counter. `flags[i]` false ⇒ `""`,
    /// otherwise the running count zero-padded, e.g. "01".
    private func sectionNumbers(_ flags: [Bool]) -> [String] {
        var n = 0
        return flags.map { flag in
            guard flag else { return "" }
            n += 1
            return String(format: "%02d", n)
        }
    }

    private var hasMap: Bool { report.graph != nil && !(report.graph?.worlds.isEmpty ?? true) }

    var body: some View {
        let sceneShares = TasteViz.sceneShares(charts.scenes)
        let flags = [
            hasMap,                                                       // 0 Map
            true,                                                        // 1 Numbers
            charts.years.count > 1 && stats.meanYear != nil && stats.avgScore != nil,  // 2 Years
            charts.scoreDist.reduce(0, +) > 0 && stats.avgScore != nil,  // 3 Score
            !sceneShares.isEmpty,                                        // 4 Scene
            true,                                                        // 5 Canon
            !report.standings.isEmpty,                                   // 6 Standings
            !report.disliked.isEmpty,                                    // 7 Disliked
        ]
        let nos = sectionNumbers(flags)

        return ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                heroCard

                if flags[0], let graph = report.graph {
                    ReportSection(
                        no: nos[0],
                        title: String(localized: "Your taste map"),
                        lead: String(localized: "Tap a world to explore its sub-genres, then a sub-genre to see your albums and recommendations.")
                    ) {
                        TasteMapView(data: graph)
                    }
                }

                ReportSection(no: nos[1], title: String(localized: "By the numbers")) {
                    numbersContent
                }

                if flags[2], let avgScore = stats.avgScore {
                    ReportSection(no: nos[2], title: String(localized: "Across the years"), lead: yearsLeadText) {
                        YearChartView(
                            years: charts.years,
                            avgScore: avgScore,
                            aboveLabel: String(localized: "above average"),
                            belowLabel: String(localized: "below average"),
                            paceLabel: String(localized: "pace"),
                            avgLabel: String(localized: "avg")
                        )
                    }
                }

                if flags[3] {
                    ReportSection(no: nos[3], title: String(localized: "How you score"), lead: scoreLeadText) {
                        ScoreRampChartView(
                            bins: charts.scoreDist,
                            mean: (pos: ((stats.avgScore ?? 0) - 0.25) / 5,
                                   label: "\(String(localized: "avg")) \(String(format: "%.2f", stats.avgScore ?? 0))"),
                            legend: String(localized: "score")
                        )
                    }
                }

                if flags[4] {
                    ReportSection(no: nos[4], title: String(localized: "Where your music comes from"), lead: sceneLeadText(sceneShares)) {
                        sceneContent(sceneShares)
                    }
                }

                ReportSection(no: nos[5], title: String(localized: "Canon reach")) {
                    canonContent
                }

                if flags[6] {
                    ReportSection(
                        no: nos[6],
                        title: String(localized: "You vs the community"),
                        lead: String(localized: "How your average compares to the community's, genre by genre.")
                    ) {
                        standingsContent
                    }
                }

                if flags[7] {
                    ReportSection(no: nos[7], title: String(localized: "Not your thing")) {
                        FlowChips(items: report.disliked.map(\.display))
                            .padding(.top, 10)
                    }
                }

                Text("That's your taste snapshot.")
                    .font(.jakarta(11.5))
                    .foregroundStyle(Color.sjMuted.opacity(0.5))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 24)
        }
        .background(Color.sjCream.ignoresSafeArea())
    }

    // ── Hero ──

    /// Radial washes mixed from the user's top-3 world colors, one per theme
    /// (lightness differs light/dark, same values web's `aurora()` uses per
    /// theme) -- port of web's personalized hero aurora.
    private var auroraColors: [Color] {
        let lightness = colorScheme == .dark ? 0.3 : 0.86
        return report.clusters.prefix(3).map { Spectrum.color(score: $0.avgScore ?? 3, lightness: lightness, chromaScale: 0.65) }
    }

    private static let auroraPositions: [UnitPoint] = [
        UnitPoint(x: 0.14, y: 0.16),
        UnitPoint(x: 0.86, y: 0.08),
        UnitPoint(x: 0.68, y: 0.96),
    ]

    private var auroraBackground: some View {
        ZStack {
            ForEach(Array(auroraColors.enumerated()), id: \.offset) { i, color in
                RadialGradient(colors: [color.opacity(0.55), .clear],
                               center: Self.auroraPositions[i], startRadius: 0, endRadius: 260)
            }
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                Text("Taste Report")
                    .font(.jakarta(10, weight: .black))
                    .kerning(1.2)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.sjBlue.opacity(0.7))
                Spacer(minLength: 8)
                Button(action: onRefresh) {
                    HStack(spacing: 6) {
                        if isRefreshing {
                            ProgressView().tint(Color.sjBlue).scaleEffect(0.7)
                        } else {
                            Image("icon-rotate-cw")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 12, height: 12)
                        }
                        Text(isRefreshing ? String(localized: "Refreshing…") : String(localized: "Refresh"))
                            .font(.jakarta(12, weight: .semibold))
                    }
                    .foregroundStyle(Color.sjBlue)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 6)
                    .background(Color.sjSurface.opacity(0.7))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(Color.sjBlue.opacity(0.25), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .disabled(isRefreshing)
            }
            Text(report.clusters.count >= 2
                 ? String(format: String(localized: "Your taste lives in\n%d worlds."), report.clusters.count)
                 : String(localized: "Your taste lives in\none world."))
                .font(.jakarta(24, weight: .black))
                .foregroundStyle(Color.sjInk)
                .padding(.top, 8)
            Text(String(format: String(localized: "Based on %1$d ratings across %2$d genres, analyzed into %3$d worlds."),
                        report.ratingCount, report.totalTags, report.clusters.count))
                .font(.jakarta(12.5))
                .foregroundStyle(Color.sjMuted)
                .padding(.top, 6)
            HStack(spacing: 18) {
                heroStat(value: report.ratingCount, label: String(localized: "rated"))
                Rectangle().fill(Color.sjBlue.opacity(0.2)).frame(width: 1, height: 30)
                heroStat(value: report.totalTags, label: String(localized: "genres"))
                Rectangle().fill(Color.sjBlue.opacity(0.2)).frame(width: 1, height: 30)
                heroStat(value: report.clusters.count, label: String(localized: "worlds"))
            }
            .padding(.top, 18)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
        .background(ZStack { Color.sjBlue.opacity(0.07); auroraBackground })
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.sjBlue.opacity(0.15), lineWidth: 1))
    }

    private func heroStat(value: Int, label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            CountUpText(value: value)
                .font(.jakarta(22, weight: .black))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.jakarta(10, weight: .bold))
                .kerning(0.6)
                .textCase(.uppercase)
                .foregroundStyle(Color.sjMuted)
        }
    }

    // ── Release years ──

    private var yearsLeadText: String {
        let sd = Int((stats.sdYears ?? 0).rounded())
        return (stats.sdYears ?? 0) >= 12
            ? String(format: String(localized: "Your library centers on %1$d, but spans ±%2$d years — you roam freely across eras."), stats.meanYear ?? 0, sd)
            : String(format: String(localized: "Your library centers on %1$d and stays close (±%2$d years) — you know your era."), stats.meanYear ?? 0, sd)
    }

    // ── Score distribution ──

    private var scoreLeadText: String {
        let avg = stats.avgScore ?? 0
        let sd = stats.sdScore ?? 0
        return sd >= 0.9
            ? String(format: String(localized: "You average %1$@ but use the whole scale (±%2$@) — scores from you are earned."),
                     String(format: "%.2f", avg), String(format: "%.2f", sd))
            : String(format: String(localized: "You average %1$@ within a tight ±%2$@ band — a consistent, predictable scorer."),
                     String(format: "%.2f", avg), String(format: "%.2f", sd))
    }

    // ── Scene mix ──

    private func sceneLeadText(_ shares: [(label: String, share: Double, color: Color)]) -> String? {
        guard let lead = shares.max(by: { $0.share < $1.share }) else { return nil }
        return String(format: String(localized: "Your biggest source is the %1$@, at %2$d%% of what you rate."),
                       lead.label, Int((lead.share * 100).rounded()))
    }

    private func sceneContent(_ shares: [(label: String, share: Double, color: Color)]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            StackedBarView(segments: shares.map { (share: $0.share, color: $0.color) })
                .padding(.top, 12)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(shares.enumerated()), id: \.offset) { _, s in
                    HStack(spacing: 6) {
                        Circle().fill(s.color).frame(width: 10, height: 10)
                        Text(s.label)
                            .font(.jakarta(12, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                        Text("\(Int((s.share * 100).rounded()))%")
                            .font(.jakarta(12))
                            .monospacedDigit()
                            .foregroundStyle(Color.sjMuted)
                    }
                }
            }
            .padding(.top, 10)
        }
    }

    // ── Canon reach ──

    private var canonContent: some View {
        HStack(alignment: .center, spacing: 18) {
            CanonRadialGauge(pct: stats.prestigeShare ?? 0, label: String(localized: "in the canon"))
            Text(String(format: String(localized: "%d%% of what you rate sits in the curated canon; the rest is your own discovery."),
                        Int(((stats.prestigeShare ?? 0) * 100).rounded())))
                .font(.jakarta(12.5))
                .foregroundStyle(Color.sjMuted)
        }
        .padding(.top, 10)
    }

    // ── Numbers (top album + stat tiles + 12-month activity) ──

    private var numbersContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !report.topAlbums.isEmpty {
                HallOfFameView(albums: report.topAlbums, score: report.topScore ?? report.topAlbums[0].score)
                    .padding(.top, 14)
            }
            let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
            LazyVGrid(columns: columns, spacing: 10) {
                StatTileView(
                    value: stats.avgScore.map { String(format: "%.2f", $0) } ?? "—",
                    label: String(localized: "average score")
                ) {
                    if let sd = stats.sdScore {
                        Text("±\(String(format: "%.2f", sd)) \(String(localized: "spread"))")
                            .font(.jakarta(10.5, weight: .semibold))
                            .foregroundStyle(Color.sjMuted.opacity(0.8))
                    }
                }
                StatTileView(
                    value: stats.median.map { String(format: "%.1f", $0) } ?? "—",
                    label: String(localized: "median score")
                ) {
                    if let hint = skewHint {
                        Text(hint)
                            .font(.jakarta(10.5, weight: .semibold))
                            .foregroundStyle(Color.sjMuted.opacity(0.8))
                    }
                }
                StatTileView(
                    value: stats.effectiveGenres.map { String(format: "%.1f", $0) } ?? "—",
                    label: String(localized: "effective genres")
                ) {
                    Text(String(format: String(localized: "across %d rated"), report.totalTags))
                        .font(.jakarta(10.5, weight: .semibold))
                        .foregroundStyle(Color.sjMuted.opacity(0.8))
                }
                StatTileView(
                    value: stats.communityDelta.map { "\($0 >= 0 ? "+" : "−")\(String(format: "%.2f", abs($0)))" } ?? "—",
                    label: String(localized: "vs. the crowd")
                ) {
                    if let hint = crowdHint {
                        Text(hint)
                            .font(.jakarta(10.5, weight: .semibold))
                            .foregroundStyle(crowdHintColor)
                    }
                }
            }
            .padding(.top, 12)
            VStack(alignment: .leading, spacing: 8) {
                Text(String(localized: "12-month activity"))
                    .font(.jakarta(11, weight: .bold))
                    .foregroundStyle(Color.sjMuted)
                ActivitySparkView(timeline: charts.timeline, peakIndex: charts.peakMonthIndex, monthLabel: monthTooltipLabel)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.sjCream)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder.opacity(0.6), lineWidth: 1))
            .padding(.top, 10)
        }
    }

    /// Median-vs-mean skew read: which way the score distribution leans.
    /// Negative moment-skew = a long tail of harsh scores below a generous
    /// hump. Port of web's `skewHint()` (page.tsx).
    private var skewHint: String? {
        guard let skew = stats.skew, stats.median != nil, stats.avgScore != nil else { return nil }
        if abs(skew) < 0.25 { return String(localized: "evenly balanced") }
        return skew < 0
            ? String(localized: "clusters high, harsh tail")
            : String(localized: "clusters low, generous tail")
    }

    /// Turns the signed community gap into a plain-language grader read.
    /// Port of web's `crowdHint()` (page.tsx).
    private var crowdHint: String? {
        guard let delta = stats.communityDelta else { return nil }
        if abs(delta) < 0.05 { return String(localized: "right in line") }
        return delta > 0 ? String(localized: "a softer grader") : String(localized: "a tougher grader")
    }

    private var crowdHintColor: Color {
        guard let delta = stats.communityDelta, abs(delta) >= 0.05 else { return Color.sjMuted.opacity(0.8) }
        return delta > 0 ? Color.sjBlue : YearChartView.belowColor
    }

    /// "Aug 2026" -- full month + year for `ActivitySparkView`'s drag tooltip.
    private func monthTooltipLabel(_ month: String) -> String {
        let parts = month.split(separator: "-")
        guard parts.count == 2, let m = Int(parts[1]) else { return month }
        var comps = DateComponents(); comps.month = m
        let date = Calendar.current.date(from: comps) ?? Date()
        let fmt = DateFormatter(); fmt.dateFormat = "MMM"
        return "\(fmt.string(from: date)) \(parts[0])"
    }

    // ── Standings ──

    /// Sorted by how far the user diverges above the community -- the story
    /// the section is telling, not RPC row order (matches web).
    private var sortedStandings: [TasteProfileResponse.GenreStandingRow] {
        report.standings.sorted { ($0.userAvg - $0.communityAvg) > ($1.userAvg - $1.communityAvg) }
    }

    private var standingsContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 10) {
                Spacer()
                HStack(spacing: 4) {
                    Circle().fill(Color.sjBlue).frame(width: 9, height: 9)
                    Text("You").font(.jakarta(11)).foregroundStyle(Color.sjMuted)
                }
                HStack(spacing: 4) {
                    Circle().fill(Color.sjMuted.opacity(0.5)).frame(width: 9, height: 9)
                    Text("Community").font(.jakarta(11)).foregroundStyle(Color.sjMuted)
                }
            }
            DumbbellAxisView()
            VStack(spacing: 16) {
                ForEach(Array(sortedStandings.enumerated()), id: \.offset) { _, s in
                    let diff = s.userAvg - s.communityAvg
                    VStack(spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(s.genre)
                                .font(.jakarta(13, weight: .bold))
                                .foregroundStyle(Color.sjInk)
                            Spacer()
                            HStack(spacing: 3) {
                                Image(diff >= 0 ? "icon-arrow-up" : "icon-arrow-down")
                                    .renderingMode(.template)
                                    .resizable().scaledToFit()
                                    .frame(width: 9, height: 9)
                                Text("\(String(format: "%.2f", abs(diff))) \(diff >= 0 ? String(localized: "above average") : String(localized: "below average"))")
                                    .font(.jakarta(11.5, weight: .semibold))
                            }
                            .foregroundStyle(diff >= 0 ? Color.sjBlue : Color.sjMuted)
                        }
                        DumbbellView(user: s.userAvg, community: s.communityAvg)
                    }
                }
            }
        }
        .padding(.top, 10)
    }
}

// MARK: - Chart primitives

/// Single-hue column chart with a peak label, hairline baseline, x labels,
/// and an optional mean marker — port of web's ColumnChart.
private struct ColumnChartView: View {
    let bins: [Int]
    let xLabels: [String?]
    let peakIndex: Int?
    let mean: (pos: Double, label: String)?

    private var maxCount: Int { max(1, bins.max() ?? 1) }

    var body: some View {
        VStack(spacing: 4) {
            ZStack(alignment: .topLeading) {
                VStack(spacing: 0) {
                    HStack(alignment: .bottom, spacing: 2) {
                        ForEach(Array(bins.enumerated()), id: \.offset) { i, count in
                            VStack(spacing: 2) {
                                if i == peakIndex && count > 0 {
                                    Text("\(count)")
                                        .font(.jakarta(10, weight: .semibold))
                                        .monospacedDigit()
                                        .foregroundStyle(Color.sjMuted)
                                }
                                UnevenRoundedRectangle(topLeadingRadius: 4, topTrailingRadius: 4)
                                    .fill(Color.sjBlue)
                                    .frame(height: count > 0 ? max(3, CGFloat(count) / CGFloat(maxCount) * 76) : 0)
                                    .frame(maxWidth: 24)
                            }
                            .frame(maxWidth: .infinity, alignment: .bottom)
                        }
                    }
                    .frame(height: 96, alignment: .bottom)
                    Rectangle().fill(Color.sjBorder).frame(height: 1)
                }
                if let mean {
                    GeometryReader { geo in
                        let x = geo.size.width * CGFloat(min(0.98, max(0.02, mean.pos)))
                        Rectangle()
                            .fill(Color.sjInk.opacity(0.35))
                            .frame(width: 1)
                            .position(x: x, y: geo.size.height / 2)
                        Text(mean.label)
                            .font(.jakarta(10, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                            .fixedSize()
                            .position(x: geo.size.width * CGFloat(min(0.9, max(0.1, mean.pos))), y: -8)
                    }
                }
            }
            .padding(.top, mean != nil ? 16 : 0)
            HStack(spacing: 2) {
                ForEach(Array(xLabels.enumerated()), id: \.offset) { _, label in
                    Text(label ?? " ")
                        .font(.jakarta(10))
                        .monospacedDigit()
                        .foregroundStyle(Color.sjMuted.opacity(0.7))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                }
            }
        }
        .padding(.top, 12)
    }
}

/// Part-to-whole stacked bar with 2pt gaps. Grows in from zero width when
/// scrolled into view -- port of web's `tr-grow` (`SceneBar`, 0.8s, 0.15s
/// delay), scaleX(0)→1 with a left transform-origin.
private struct StackedBarView: View {
    let segments: [(share: Double, color: Color)]

    @State private var grown = UIAccessibility.isReduceMotionEnabled

    var body: some View {
        GeometryReader { geo in
            let totalGap = CGFloat(max(0, segments.count - 1)) * 2
            let available = geo.size.width - totalGap
            HStack(spacing: 2) {
                ForEach(Array(segments.enumerated()), id: \.offset) { _, s in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(s.color)
                        .frame(width: max(6, available * CGFloat(s.share)))
                }
            }
            .scaleEffect(x: grown ? 1 : 0, anchor: .leading)
            .animation(.easeOut(duration: 0.8).delay(0.15), value: grown)
        }
        .frame(height: 14)
        .onScrollVisibilityChange(threshold: 0.15) { visible in
            guard !grown, visible else { return }
            grown = true
        }
    }
}

/// You-vs-community dumbbell on a fixed 0.5–5.0 track. Tap to reveal a
/// tooltip pill with both exact values -- web's hover equivalent.
private struct DumbbellView: View {
    let user: Double
    let community: Double

    @State private var showTip = false

    private func pos(_ v: Double) -> CGFloat {
        CGFloat(min(0.98, max(0.02, (v - 0.5) / 4.5)))
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let u = pos(user) * w
            let c = pos(community) * w
            let mid = (u + c) / 2
            ZStack {
                Capsule().fill(Color.sjBorder.opacity(0.7))
                    .frame(height: 2)
                Rectangle().fill(Color.sjMuted.opacity(0.4))
                    .frame(width: abs(u - c), height: 2)
                    .position(x: mid, y: geo.size.height / 2)
                Circle().fill(Color.sjMuted.opacity(0.5))
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(Color.sjSurface, lineWidth: 2))
                    .position(x: c, y: geo.size.height / 2)
                Circle().fill(Color.sjBlue)
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(Color.sjSurface, lineWidth: 2))
                    .position(x: u, y: geo.size.height / 2)
                if showTip {
                    BinTooltip(text: "\(String(localized: "You")) \(String(format: "%.2f", user)) · \(String(localized: "Community")) \(String(format: "%.2f", community))")
                        .position(x: min(max(mid, 44), w - 44), y: -14)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture { showTip.toggle() }
        }
        .frame(height: 18)
    }
}

/// Small tick row (1–5) above the standings' dumbbell track -- shared axis
/// header, port of web's `DumbbellAxis`.
private struct DumbbellAxisView: View {
    private let ticks = [1, 2, 3, 4, 5]
    private func pos(_ v: Double) -> CGFloat { CGFloat(min(0.98, max(0.02, (v - 0.5) / 4.5))) }

    var body: some View {
        GeometryReader { geo in
            ForEach(ticks, id: \.self) { v in
                Text("\(v)")
                    .font(.jakarta(10))
                    .monospacedDigit()
                    .foregroundStyle(Color.sjMuted.opacity(0.6))
                    .position(x: geo.size.width * pos(Double(v)), y: 7)
            }
        }
        .frame(height: 14)
    }
}

// MARK: - Taste report v2 primitives (2026-08-13 port of web's TasteCharts.tsx)

/// Ink-on-page tooltip pill -- port of web's `BinTooltip`. Callers position it
/// themselves via `.position()` inside a `GeometryReader`.
private struct BinTooltip: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.jakarta(11, weight: .semibold))
            .foregroundStyle(Color.sjCream)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.sjInk.opacity(0.9))
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .fixedSize()
            .allowsHitTesting(false)
    }
}

/// Press-and-drag-to-scrub gesture over `count` equal-width bins spanning
/// `width` -- touch equivalent of web's pointer-hover `useBinHover`.
private func binHoverGesture(count: Int, width: CGFloat, hover: Binding<Int?>) -> some Gesture {
    DragGesture(minimumDistance: 0)
        .onChanged { value in
            guard count > 0, width > 0 else { return }
            let i = Int((value.location.x / width) * CGFloat(count))
            hover.wrappedValue = min(count - 1, max(0, i))
        }
        .onEnded { _ in hover.wrappedValue = nil }
}

/// `1 ▓▓▓▓ 5 · label` gradient swatch stating the score ramp's scale --
/// reused by the score chart and the taste map's legend. Port of web's
/// `RampLegend`.
struct RampLegendView: View {
    let label: String
    var width: CGFloat = 56

    var body: some View {
        HStack(spacing: 6) {
            Text("1").font(.jakarta(10)).monospacedDigit().foregroundStyle(Color.sjMuted)
            LinearGradient(
                colors: (1...5).map { Spectrum.color(score: Double($0), lightness: 0.62, chromaScale: 1) },
                startPoint: .leading, endPoint: .trailing
            )
            .frame(width: width, height: 6)
            .clipShape(Capsule())
            Text("5").font(.jakarta(10)).monospacedDigit().foregroundStyle(Color.sjMuted)
            Text(label).font(.jakarta(10)).foregroundStyle(Color.sjMuted)
        }
    }
}

/// Release-year histogram, redrawn (2026-08-27 web rebuild) as a grouped
/// diverging frequency chart: two bars per year -- how many of that year's
/// ratings landed above your overall average (accent) versus below it (a
/// warm red) -- plus a smoothed 5-year moving-average "pace" line over the
/// per-year total. Your average is stated in a chip above the plot instead
/// of a shaded band. Drag-scrub tooltip shows year · above▲ below▼. Port of
/// web's `YearChart` (TasteCharts.tsx).
private struct YearChartView: View {
    let years: [TasteProfileResponse.TasteCharts.YearBin]
    let avgScore: Double
    let aboveLabel: String
    let belowLabel: String
    let paceLabel: String
    let avgLabel: String

    @State private var hover: Int? = nil

    private var totals: [Int] { years.map { $0.above + $0.below } }
    private var maxTotal: Int { max(1, totals.max() ?? 1) }
    private var tickEvery: Int { max(1, Int((Double(years.count) / 6).rounded(.up))) }

    private func barHeight(_ v: Int) -> CGFloat {
        v > 0 ? max(3, CGFloat(v) / CGFloat(maxTotal) * 76) : 0
    }

    /// Centred 5-year moving average of the per-year total -- the "pace" line.
    private var pace: [Double] {
        let w = 2
        return totals.indices.map { i in
            let lo = max(0, i - w), hi = min(totals.count - 1, i + w)
            let slice = totals[lo...hi]
            return slice.reduce(0.0) { $0 + Double($1) } / Double(slice.count)
        }
    }

    /// Matches web's `--tr-dn` (below-your-average bars): #D8433D light / #EF655D dark.
    fileprivate static let belowColor = Color(UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0.937, green: 0.396, blue: 0.365, alpha: 1)
            : UIColor(red: 0.847, green: 0.263, blue: 0.239, alpha: 1)
    })

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Spacer(minLength: 0)
                HStack(spacing: 5) {
                    Circle().fill(Color.sjInk.opacity(0.4)).frame(width: 6, height: 6)
                    Text(avgLabel).font(.jakarta(11, weight: .semibold)).foregroundStyle(Color.sjMuted)
                    Text(String(format: "%.2f", avgScore)).font(.jakarta(11, weight: .semibold)).foregroundStyle(Color.sjInk)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color.sjSurface)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Color.sjBorder.opacity(0.7), lineWidth: 1))
            }
            GeometryReader { geo in
                ZStack(alignment: .topLeading) {
                    VStack(spacing: 0) {
                        HStack(alignment: .bottom, spacing: 2) {
                            ForEach(Array(years.enumerated()), id: \.offset) { i, y in
                                HStack(alignment: .bottom, spacing: 2) {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(Color.sjBlue)
                                        .frame(maxWidth: 11)
                                        .frame(height: barHeight(y.above))
                                        .opacity(hover == nil || hover == i ? 1 : 0.7)
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(Self.belowColor)
                                        .frame(maxWidth: 11)
                                        .frame(height: barHeight(y.below))
                                        .opacity(hover == nil || hover == i ? 1 : 0.7)
                                }
                                .frame(maxWidth: .infinity, alignment: .bottom)
                                .background(hover == i ? Color.sjInk.opacity(0.05) : .clear)
                            }
                        }
                        .frame(height: 96, alignment: .bottom)
                        Rectangle().fill(Color.sjBorder).frame(height: 1)
                    }
                    if years.count > 1 {
                        PaceTrendPath(values: pace, maxValue: Double(maxTotal))
                            .stroke(Color.sjInk.opacity(0.45), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                            .frame(height: 96)
                    }
                    if let hover, years.indices.contains(hover) {
                        let y = years[hover]
                        BinTooltip(text: "\(y.year) · \(y.above)▲ \(y.below)▼")
                            .position(x: geo.size.width * (CGFloat(hover) + 0.5) / CGFloat(years.count), y: -14)
                    }
                }
                .contentShape(Rectangle())
                .gesture(binHoverGesture(count: years.count, width: geo.size.width, hover: $hover))
            }
            .frame(height: 96)
            .padding(.top, 16)
            HStack(spacing: 2) {
                ForEach(Array(years.enumerated()), id: \.offset) { i, y in
                    Text(i % tickEvery == 0 || i == years.count - 1 ? String(y.year) : "")
                        .font(.jakarta(9))
                        .monospacedDigit()
                        .foregroundStyle(Color.sjMuted.opacity(0.7))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity)
                }
            }
            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.sjBlue).frame(width: 10, height: 10)
                    Text(aboveLabel).font(.jakarta(11)).foregroundStyle(Color.sjMuted)
                }
                HStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(Self.belowColor).frame(width: 10, height: 10)
                    Text(belowLabel).font(.jakarta(11)).foregroundStyle(Color.sjMuted)
                }
                HStack(spacing: 6) {
                    Rectangle().fill(Color.sjInk.opacity(0.45)).frame(width: 16, height: 2)
                    Text(paceLabel).font(.jakarta(11)).foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.top, 4)
        }
        .padding(.top, 12)
    }
}

/// Smooth trend line through a per-index value series via monotone cubic
/// Hermite interpolation, normalized to the shape's own frame. Port of web's
/// `PaceTrendPath` usage of `monotonePath()`.
private struct PaceTrendPath: Shape {
    let values: [Double]
    let maxValue: Double

    func path(in rect: CGRect) -> Path {
        guard !values.isEmpty, maxValue > 0 else { return Path() }
        let n = values.count
        let points: [CGPoint] = values.enumerated().map { i, v in
            let xPct = (CGFloat(i) + 0.5) / CGFloat(n)
            let yPct = 1 - CGFloat(v / maxValue) * 0.94
            return CGPoint(x: xPct * rect.width, y: yPct * rect.height)
        }
        return monotonePath(points)
    }
}

/// Shape-preserving smooth path through `points` (x-ascending) via monotone
/// cubic Hermite interpolation (Fritsch–Carlson tangents) -- the curve never
/// overshoots the values it connects, so it eases onto a run of zero values
/// instead of dipping below or ringing. Port of web's `monotonePath()`
/// (TasteCharts.tsx).
private func monotonePath(_ points: [CGPoint]) -> Path {
    var path = Path()
    let n = points.count
    guard n > 0 else { return path }
    guard n > 1 else {
        path.move(to: points[0])
        return path
    }

    var h = [CGFloat](); var s = [CGFloat]()
    for i in 0..<(n - 1) {
        let dx = points[i + 1].x - points[i].x
        h.append(dx)
        s.append(dx == 0 ? 0 : (points[i + 1].y - points[i].y) / dx)
    }

    var t = [CGFloat](repeating: 0, count: n)
    t[0] = s[0]
    t[n - 1] = s[n - 2]
    for i in 1..<(n - 1) {
        if s[i - 1] * s[i] <= 0 {
            t[i] = 0
        } else {
            let w1 = 2 * h[i] + h[i - 1]
            let w2 = h[i] + 2 * h[i - 1]
            t[i] = (w1 + w2) / (w1 / s[i - 1] + w2 / s[i])
        }
    }

    path.move(to: points[0])
    for i in 0..<(n - 1) {
        let c1 = CGPoint(x: points[i].x + h[i] / 3, y: points[i].y + (t[i] * h[i]) / 3)
        let c2 = CGPoint(x: points[i + 1].x - h[i] / 3, y: points[i + 1].y - (t[i + 1] * h[i]) / 3)
        path.addCurve(to: points[i + 1], control1: c1, control2: c2)
    }
    return path
}

/// Half-star score bins, each bar colored by the OKLCh score ramp at its own
/// score (color restates the x-axis, never the sole encoding). Drag-scrub
/// tooltip shows score · count. Bars grow in, staggered, when scrolled into
/// view -- port of web's `tr-bar` (`ScoreChart`, 0.7s per bar, 35ms stagger).
/// Port of web's `ScoreChart`.
private struct ScoreRampChartView: View {
    let bins: [Int]
    let mean: (pos: Double, label: String)?
    let legend: String

    @State private var hover: Int? = nil
    @State private var grown = UIAccessibility.isReduceMotionEnabled

    private var maxCount: Int { max(1, bins.max() ?? 1) }
    private var peakIndex: Int { bins.indices.max(by: { bins[$0] < bins[$1] }) ?? 0 }
    private func scoreAt(_ i: Int) -> Double { Double(i + 1) / 2 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 4) {
                GeometryReader { geo in
                    ZStack(alignment: .topLeading) {
                        VStack(spacing: 0) {
                            HStack(alignment: .bottom, spacing: 3) {
                                ForEach(Array(bins.enumerated()), id: \.offset) { i, count in
                                    VStack(spacing: 2) {
                                        if i == peakIndex, count > 0, hover == nil {
                                            Text("\(count)")
                                                .font(.jakarta(9, weight: .semibold))
                                                .monospacedDigit()
                                                .foregroundStyle(Color.sjMuted)
                                        }
                                        UnevenRoundedRectangle(topLeadingRadius: 3, topTrailingRadius: 3)
                                            .fill(Spectrum.color(score: scoreAt(i), lightness: 0.62, chromaScale: hover == i ? 1 : 0.9))
                                            .frame(height: count > 0 ? max(3, CGFloat(count) / CGFloat(maxCount) * 76) : 0)
                                            .frame(maxWidth: 24)
                                            .scaleEffect(y: grown ? 1 : 0, anchor: .bottom)
                                            .animation(.timingCurve(0.22, 0.61, 0.36, 1, duration: 0.7).delay(Double(i) * 0.035), value: grown)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .bottom)
                                }
                            }
                            .frame(height: 88, alignment: .bottom)
                            .onScrollVisibilityChange(threshold: 0.15) { visible in
                                guard !grown, visible else { return }
                                grown = true
                            }
                            Rectangle().fill(Color.sjBorder).frame(height: 1)
                        }
                        if let mean {
                            let x = geo.size.width * CGFloat(min(0.98, max(0.02, mean.pos)))
                            Rectangle().fill(Color.sjInk.opacity(0.35)).frame(width: 1).position(x: x, y: 44)
                            Text(mean.label)
                                .font(.jakarta(10, weight: .semibold))
                                .foregroundStyle(Color.sjMuted)
                                .fixedSize()
                                .position(x: geo.size.width * CGFloat(min(0.9, max(0.1, mean.pos))), y: -8)
                        }
                        if let hover, bins.indices.contains(hover) {
                            BinTooltip(text: "\(String(format: "%.1f", scoreAt(hover)))★ · \(bins[hover])")
                                .position(x: geo.size.width * (CGFloat(hover) + 0.5) / CGFloat(bins.count), y: -14)
                        }
                    }
                    .contentShape(Rectangle())
                    .gesture(binHoverGesture(count: bins.count, width: geo.size.width, hover: $hover))
                }
                .frame(height: 88)
                .padding(.top, mean != nil ? 16 : 0)
                HStack(spacing: 3) {
                    ForEach(bins.indices, id: \.self) { i in
                        Text(i % 2 == 1 ? String(format: "%g", scoreAt(i)) : "")
                            .font(.jakarta(10))
                            .monospacedDigit()
                            .foregroundStyle(Color.sjMuted.opacity(0.7))
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.top, 12)
            RampLegendView(label: legend)
                .padding(.top, 10)
        }
    }
}

/// Animated radial donut gauge -- track in a faint tint, arc in accent,
/// percentage + label centred. Port of web's `CanonGauge`.
private struct CanonRadialGauge: View {
    let pct: Double
    let label: String

    @State private var animatedPct: Double = 0

    var body: some View {
        ZStack {
            Circle().stroke(Color.sjBlue.opacity(0.12), lineWidth: 9)
            Circle()
                .trim(from: 0, to: animatedPct)
                .stroke(Color.sjBlue, style: StrokeStyle(lineWidth: 9, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text("\(Int((pct * 100).rounded()))%")
                    .font(.jakarta(22, weight: .black))
                    .monospacedDigit()
                    .foregroundStyle(Color.sjInk)
                Text(label)
                    .font(.jakarta(9, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 10)
            }
        }
        .frame(width: 112, height: 112)
        .onAppear {
            if UIAccessibility.isReduceMotionEnabled {
                animatedPct = min(1, max(0, pct))
            } else {
                withAnimation(.easeOut(duration: 1.0).delay(0.1)) {
                    animatedPct = min(1, max(0, pct))
                }
            }
        }
    }
}

/// Monthly rating counts; the peak month wears accent. Drag-scrub tooltip
/// shows month · count. Bars grow in, staggered, when scrolled into view --
/// port of web's `tr-bar` (`ActivitySpark`, 30ms stagger). Port of web's
/// `ActivitySpark`.
private struct ActivitySparkView: View {
    let timeline: [TasteProfileResponse.TasteCharts.TimelineEntry]
    let peakIndex: Int?
    let monthLabel: (String) -> String

    @State private var hover: Int? = nil
    @State private var grown = UIAccessibility.isReduceMotionEnabled

    private var maxCount: Int { max(1, timeline.map(\.count).max() ?? 1) }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(Array(timeline.enumerated()), id: \.offset) { i, m in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(i == peakIndex ? Color.sjBlue : (hover == i ? Color.sjBlue.opacity(0.6) : Color.sjBorder))
                            .frame(height: max(2, CGFloat(m.count) / CGFloat(maxCount) * 24))
                            .frame(maxWidth: .infinity)
                            .scaleEffect(y: grown ? 1 : 0, anchor: .bottom)
                            .animation(.timingCurve(0.22, 0.61, 0.36, 1, duration: 0.7).delay(Double(i) * 0.03), value: grown)
                    }
                }
                .frame(height: 24, alignment: .bottom)
                .onScrollVisibilityChange(threshold: 0.15) { visible in
                    guard !grown, visible else { return }
                    grown = true
                }
                if let hover, timeline.indices.contains(hover) {
                    BinTooltip(text: "\(monthLabel(timeline[hover].month)) · \(timeline[hover].count)")
                        .position(x: geo.size.width * (CGFloat(hover) + 0.5) / CGFloat(timeline.count), y: -14)
                }
            }
            .contentShape(Rectangle())
            .gesture(binHoverGesture(count: timeline.count, width: geo.size.width, hover: $hover))
        }
        .frame(height: 24)
        .padding(.top, 4)
    }
}

/// Ease-out count-up via SwiftUI's native numeric content transition --
/// simpler and more idiomatic than reimplementing web's `requestAnimationFrame`
/// loop. Instant under Reduce Motion, matching web's `prefers-reduced-motion`.
private struct CountUpText: View {
    let value: Int
    var duration: Double = 0.9

    @State private var shown: Int = 0

    var body: some View {
        Text("\(shown)")
            .contentTransition(.numericText(value: Double(shown)))
            .onAppear {
                if UIAccessibility.isReduceMotionEnabled {
                    shown = value
                } else {
                    withAnimation(.easeOut(duration: duration)) { shown = value }
                }
            }
    }
}

/// Scroll-triggered fade-up wrapper, firing once when ~15% visible -- port of
/// web's `IntersectionObserver`-based `Reveal`. Uses the native
/// `onScrollVisibilityChange` (iOS 18+; this project's deployment target is
/// pinned to iOS 26, so no availability gating is needed).
private struct RevealSection<Content: View>: View {
    @ViewBuilder var content: Content

    @State private var isVisible = false

    var body: some View {
        content
            .opacity(isVisible ? 1 : 0)
            .offset(y: isVisible ? 0 : 16)
            .onScrollVisibilityChange(threshold: 0.15) { visible in
                guard !isVisible, visible else { return }
                if UIAccessibility.isReduceMotionEnabled {
                    isVisible = true
                } else {
                    withAnimation(.easeOut(duration: 0.65)) { isVisible = true }
                }
            }
    }
}

/// Mobile adaptation of web's rotating 3D "hall of fame" ring for albums tied
/// at the user's top score -- web's version spins a CSS `perspective`/
/// `rotateY` ring, a desktop-hover-oriented effect with no touch equivalent,
/// so this ports the same "your #1, possibly tied" idea as a native swipeable
/// paging carousel instead (matching how the taste map's own treemap was
/// already replaced with a flat ranked list for the same reason). A single
/// top album renders as one static card with no pager, mirroring web's
/// `n === 1` branch.
private struct HallOfFameView: View {
    let albums: [TasteProfileResponse.TasteTopAlbum]
    let score: Double

    @State private var scrollPosition: UUID?
    @State private var floated = false

    private var currentIndex: Int {
        guard let scrollPosition, let i = albums.firstIndex(where: { $0.id == scrollPosition }) else { return 0 }
        return i
    }

    var body: some View {
        VStack(spacing: 10) {
            Text("Your #1 Album")
                .font(.jakarta(10, weight: .black))
                .kerning(1)
                .textCase(.uppercase)
                .foregroundStyle(Color.sjBlue.opacity(0.7))
                .frame(maxWidth: .infinity, alignment: .leading)

            if albums.count == 1 {
                card(albums[0])
                    .offset(y: floated ? -7 : 0)
                    .onAppear {
                        guard !UIAccessibility.isReduceMotionEnabled else { return }
                        withAnimation(.easeInOut(duration: 2.75).repeatForever(autoreverses: true)) {
                            floated = true
                        }
                    }
            } else {
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 0) {
                        ForEach(albums, id: \.id) { album in
                            card(album)
                                .containerRelativeFrame(.horizontal)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollTargetBehavior(.paging)
                .scrollPosition(id: $scrollPosition)
                .scrollIndicators(.hidden)
                .frame(height: 234)
                .task { await autoRotate() }

                HStack(spacing: 5) {
                    ForEach(albums.indices, id: \.self) { i in
                        Capsule()
                            .fill(i == currentIndex ? Color.sjBlue : Color.sjMuted.opacity(0.35))
                            .frame(width: i == currentIndex ? 16 : 6, height: 6)
                            .animation(.easeOut(duration: 0.25), value: currentIndex)
                    }
                }

                Text(String(format: String(localized: "%1$d albums tied at %2$@"), albums.count, String(format: "%.1f", score)))
                    .font(.jakarta(11))
                    .foregroundStyle(Color.sjMuted)
            }
        }
    }

    /// Auto-advances through the tied albums every 3.4s, same cadence as
    /// web's `HallOfFame` ring -- structured-concurrency equivalent of its
    /// `setInterval`, cancelled automatically when the view disappears.
    /// Off under Reduce Motion, matching web's `usePrefersReducedMotion` gate.
    private func autoRotate() async {
        guard !UIAccessibility.isReduceMotionEnabled, albums.count > 1 else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3.4))
            guard !Task.isCancelled else { return }
            let next = (currentIndex + 1) % albums.count
            withAnimation(.easeInOut(duration: 0.6)) {
                scrollPosition = albums[next].id
            }
        }
    }

    @ViewBuilder
    private func card(_ album: TasteProfileResponse.TasteTopAlbum) -> some View {
        VStack(spacing: 10) {
            Group {
                if let s = album.coverUrl, let url = URL(string: s) {
                    CachedImage(url: url) { Color.sjBorder }
                        .scaledToFill()
                } else {
                    Color.sjBorder
                }
            }
            .frame(width: 152, height: 152)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .shadow(color: .black.opacity(0.12), radius: 10, y: 4)

            VStack(spacing: 2) {
                Text(album.title)
                    .font(.jakarta(14, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                Text(album.artist)
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: 240)

            Text(String(format: "%.1f", album.score))
                .font(.jakarta(14, weight: .black))
                .foregroundStyle(Spectrum.number(album.score))
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .background(Spectrum.fill(album.score))
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .frame(maxWidth: .infinity)
    }
}

private struct StatTileView<Content: View>: View {
    let value: String
    let label: String
    @ViewBuilder var content: Content

    init(value: String, label: String, @ViewBuilder content: () -> Content = { EmptyView() }) {
        self.value = value
        self.label = label
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.jakarta(19, weight: .black))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.jakarta(11))
                .foregroundStyle(Color.sjMuted)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.sjCream)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder.opacity(0.6), lineWidth: 1))
    }
}

/// Wrapping chip row (disliked genres).
private struct FlowChips: View {
    let items: [String]

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.jakarta(12.5))
                    .strikethrough(true, color: Color.sjMuted.opacity(0.5))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color.sjBorder.opacity(0.5))
                    .clipShape(Capsule())
            }
        }
    }
}

/// Minimal left-aligned wrapping layout for chips.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: width, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}

// MARK: - Shared card chrome

private struct ReportCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .padding(.vertical, 18)
            .background(Color.sjSurface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

private struct CardTitle: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.jakarta(15, weight: .bold))
            .foregroundStyle(Color.sjInk)
    }
}

private struct CardSub: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.jakarta(12.5))
            .foregroundStyle(Color.sjMuted)
            .padding(.top, 4)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Numbered, scroll-revealed report section card -- port of web's `Section`.
/// Wraps the existing `ReportCard` chrome with a running section number chip
/// and `RevealSection`'s fade-up-on-scroll.
private struct ReportSection<Content: View>: View {
    let no: String
    let title: String
    var lead: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        RevealSection {
            ReportCard {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(no)
                        .font(.jakarta(11, weight: .black))
                        .monospacedDigit()
                        .foregroundStyle(Color.sjBlue.opacity(0.6))
                    CardTitle(title)
                }
                if let lead {
                    CardSub(lead)
                }
                content
            }
        }
    }
}

// MARK: - Viz palette + scene labels

/// Fixed-order categorical palette, mirroring web's validated `--viz-1..5`
/// vars (separate light/dark steps; identity never rides on color alone —
/// every use is paired with a named legend or direct label).
enum TasteViz {
    private static let light: [UInt32] = [0x2A78D6, 0x1BAF7A, 0xEDA100, 0x008300, 0x4A3AA7]
    private static let dark:  [UInt32] = [0x3987E5, 0x199E70, 0xC98500, 0x008300, 0x9085E9]

    static func color(_ i: Int) -> Color {
        let slot = i % light.count
        return Color(UIColor { trait in
            let rgb = trait.userInterfaceStyle == .dark ? dark[slot] : light[slot]
            return UIColor(
                red: CGFloat((rgb >> 16) & 0xFF) / 255,
                green: CGFloat((rgb >> 8) & 0xFF) / 255,
                blue: CGFloat(rgb & 0xFF) / 255,
                alpha: 1
            )
        })
    }

    static func sceneLabel(_ scene: String?) -> String {
        switch scene {
        case "kr": String(localized: "Korean scene")
        case "jp": String(localized: "Japanese scene")
        case "west": String(localized: "Western scene")
        case "other": String(localized: "global scene")
        default: String(localized: "mixed scenes")
        }
    }

    /// Scenes keep fixed palette slots (color follows the entity, not rank).
    static func sceneShares(_ mix: TasteProfileResponse.TasteCharts.SceneMix?)
        -> [(label: String, share: Double, color: Color)] {
        guard let mix, mix.total > 0 else { return [] }
        let entries: [(String, Int, Int)] = [
            (String(localized: "Korean scene"), mix.counts.kr, 0),
            (String(localized: "Japanese scene"), mix.counts.jp, 1),
            (String(localized: "Western scene"), mix.counts.west, 2),
            (String(localized: "global scene"), mix.counts.other, 3),
        ]
        return entries
            .filter { $0.1 > 0 }
            .map { (label: $0.0, share: Double($0.1) / Double(mix.total), color: color($0.2)) }
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

                Image("icon-lock")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 36, height: 36)
                    .foregroundStyle(Color.sjAmber)
                    .padding(.bottom, 24)

                Text(String(format: String(localized: "Rate %d more\nreleases to unlock Taste"), Self.threshold - ratingCount))
                    .font(.jakarta(24, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .multilineTextAlignment(.center)
                    .padding(.bottom, 12)

                Text("We need enough ratings to surface\nmeaningful insights about your taste.")
                    .font(.jakarta(15))
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
                        .font(.jakarta(13, weight: .semibold))
                        .foregroundStyle(Color.sjMuted)
                }

                if let onGoToAdd {
                    Button(action: onGoToAdd) {
                        Text("Find releases to rate")
                            .font(.jakarta(14, weight: .semibold))
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
                        .font(.jakarta(10, weight: .bold))
                        .foregroundStyle(Color.sjMuted.opacity(0.6))
                        .kerning(0.8)
                        .textCase(.uppercase)

                    HStack(spacing: 0) {
                        ForEach(teaserItems, id: \.1) { icon, label in
                            VStack(spacing: 5) {
                                Image(icon)
                                    .renderingMode(.template)
                                    .resizable().scaledToFit()
                                    .frame(width: 20, height: 20)
                                    .foregroundStyle(Color.sjAmber.opacity(0.4))
                                Text(label)
                                    .font(.jakarta(10))
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
        ("icon-star-filled", "Top Album"),
        ("icon-bar-chart",   "Activity"),
        ("icon-drama",       "Your Style"),
        ("icon-waveform",    "Genre DNA")
    ]
}
