import SwiftUI
import Observation
import Supabase

/// Set to `true` only inside a `TasteShareCard` snapshot. Several charts
/// (`StackedBarView`, `ScoreRampChartView`, `ActivitySparkView`) grow their
/// bars in only once `onScrollVisibilityChange` reports them visible --
/// correct for the live, scrolling page, but that callback never fires
/// inside an `ImageRenderer` snapshot (there's no real scroll happening),
/// so left alone every bar would export at zero height. Read at the same
/// call sites that already gate on `UIAccessibility.isReduceMotionEnabled`,
/// which is exactly the existing precedent for "skip the animation, just
/// show the end state."
private struct IsTasteShareSnapshotKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var isTasteShareSnapshot: Bool {
        get { self[IsTasteShareSnapshotKey.self] }
        set { self[IsTasteShareSnapshotKey.self] = newValue }
    }
}

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

    /// `load()` only ever runs once per session (`hasLoaded`) -- fine for the report
    /// itself, but it means the lock screen's "X of 25" count never moved again after
    /// the user rated/unrated albums elsewhere in the app, even though the count query
    /// itself is cheap and instant. Called from every `.ratingChanged` post, in both
    /// directions -- NOT just while locked: a delete that drops the count back below
    /// threshold has to be able to re-lock a currently-unlocked session, so this can't
    /// early-return on `isUnlocked` the way an earlier version of this fix did.
    func refreshRatingCount() async {
        guard let user = supabase.auth.currentUser else { return }
        async let albumTask = fetchCount(table: "ratings", userId: user.id)
        async let songTask  = fetchCount(table: "track_ratings", userId: user.id)
        guard let albumCount = await albumTask, let songCount = await songTask else { return }
        ratingCount = albumCount + songCount

        if isUnlocked {
            // Crossed up into (or still) unlocked -- make sure there's a report to show;
            // don't re-fetch one that's already there (e.g. an unrelated score edit that
            // didn't change the count at all).
            if report == nil {
                report = await WebAPI.get("/api/taste/profile", authed: true)
                if report != nil { hasLoaded = true }
            }
        } else {
            // Dropped back below threshold -- clear the stale report so a later
            // re-unlock fetches a fresh one instead of showing what was true before
            // the delete. `isUnlocked` alone already re-locks the screen (TasteView's
            // branching checks it before ever looking at `report`); this just keeps
            // the two pieces of state consistent with each other.
            report = nil
            hasLoaded = false
        }
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
        .onReceive(NotificationCenter.default.publisher(for: .ratingChanged)) { _ in
            Task { await viewModel.refreshRatingCount() }
        }
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
                Button("Retry") {
                    Haptics.light()
                    Task { await viewModel.load() }
                }
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
    /// The hero page's own share button state -- every other section shares
    /// through `TastePageChrome`'s identical mechanism, but the hero page
    /// doesn't use that chrome (it has its own full-bleed aurora layout), so
    /// it needs this one directly.
    @State private var pendingShare: TasteShareBox?

    private var stats: TasteProfileResponse.TasteStats { report.stats }
    private var charts: TasteProfileResponse.TasteCharts { report.charts }

    private var hasMap: Bool { report.graph != nil && !(report.graph?.worlds.isEmpty ?? true) }

    /// Builds this profile's page sequence -- which sections this report has
    /// (same gating the old single-scroll layout used) plus an unnumbered
    /// hero page up front. Numbers stay sequential regardless of which
    /// optional pages are present, port of web's `nextNo()` counter. The
    /// pager's own `loopsAround` appends the wrap-back-to-the-top transition
    /// after whatever page ends up last here -- no explicit outro page
    /// needed to hand off to it.
    private func buildPages(sceneShares: [(label: String, share: Double, color: Color)]) -> ([TastePageKind], [String]) {
        var kinds: [TastePageKind] = []
        var nos: [String] = []
        var n = 0
        func add(_ kind: TastePageKind, numbered: Bool = true) {
            kinds.append(kind)
            if numbered { n += 1; nos.append(String(format: "%02d", n)) } else { nos.append("") }
        }
        add(.hero, numbered: false)
        if hasMap { add(.map) }
        if !report.topAlbums.isEmpty { add(.hallOfFame) }
        add(.numbers)
        if charts.years.count > 1 && stats.meanYear != nil && stats.avgScore != nil { add(.years) }
        if charts.scoreDist.reduce(0, +) > 0 && stats.avgScore != nil { add(.score) }
        // Unconditional, not gated on `sceneShares` -- canon reach (merged
        // in below) never had a gating condition of its own, so this page
        // must keep appearing even on the rare profile with no scene data,
        // just without the scene half.
        add(.scene)
        if !report.standings.isEmpty { add(.standings) }
        if !report.disliked.isEmpty { add(.disliked) }
        return (kinds, nos)
    }

    var body: some View {
        let sceneShares = TasteViz.sceneShares(charts.scenes)
        let (kinds, nos) = buildPages(sceneShares: sceneShares)

        return TastePagerContainer(count: kinds.count, loopsAround: true) { i, topInset, bottomInset in
            page(kinds[i], no: nos[i], sceneShares: sceneShares, topInset: topInset, bottomInset: bottomInset)
                .overlay(alignment: .top) {
                    // User ask: swiping up from the hero page shows a hard
                    // seam where its aurora wash meets the next page's plain
                    // cream. Root cause: the third aurora glow is centered
                    // at y: 0.96 -- almost the very bottom edge -- so it's
                    // still near full strength exactly where the page gets
                    // clipped, then the next page starts from flat cream
                    // with nothing to bridge the two. Rather than moving the
                    // glow (which would flatten the hero page's own
                    // intentional full-bleed look), the second page gets a
                    // matching fade at its own top that "continues" the same
                    // color down to nothing -- always page index 1, since
                    // `buildPages` puts hero at index 0 unconditionally, so
                    // index 1 is always whatever section actually follows it.
                    if i == 1, let seamColor = auroraColors.last {
                        LinearGradient(colors: [seamColor.opacity(0.45), .clear],
                                       startPoint: .top, endPoint: .bottom)
                            .frame(height: 200)
                            .allowsHitTesting(false)
                    }
                }
        }
        .sheet(item: $pendingShare) { box in
            SharePreviewSheet { box.view }
        }
    }

    /// A compact restatement of the hero page's own headline + stat row --
    /// not the full aurora-background layout (`heroCard` fills an entire
    /// screen; `TasteShareCard` already gives every shared section its own
    /// cream card treatment, so reusing the full hero layout verbatim would
    /// double up on background/padding meant for two different contexts).
    /// Deliberately plain `Text`, not `heroStat`/`CountUpText` -- the
    /// count-up animates from 0 over ~0.9s on appear, and `SharePreviewSheet`
    /// snapshots the card within a frame or two of it appearing, so reusing
    /// it here would very likely export a card showing "0" for every stat.
    private var heroShareContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(report.clusters.count >= 2
                 ? String(format: String(localized: "Your taste lives in\n%d worlds."), report.clusters.count)
                 : String(localized: "Your taste lives in\none world."))
                .font(.jakarta(26, weight: .black))
                .foregroundStyle(Color.sjInk)
            Text(String(format: String(localized: "Based on %1$d ratings across %2$d genres, analyzed into %3$d worlds."),
                        report.ratingCount, report.totalTags, report.clusters.count))
                .font(.jakarta(13))
                .foregroundStyle(Color.sjMuted)
            HStack(spacing: 16) {
                heroShareStat(value: report.ratingCount, label: String(localized: "rated"))
                Rectangle().fill(Color.sjBlue.opacity(0.2)).frame(width: 1, height: 30)
                heroShareStat(value: report.totalTags, label: String(localized: "genres"))
                Rectangle().fill(Color.sjBlue.opacity(0.2)).frame(width: 1, height: 30)
                heroShareStat(value: report.clusters.count, label: String(localized: "worlds"))
            }
            .padding(.top, 6)
        }
    }

    private func heroShareStat(value: Int, label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(value)")
                .font(.jakarta(28, weight: .black))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.jakarta(11, weight: .bold))
                .kerning(0.6)
                .textCase(.uppercase)
                .foregroundStyle(Color.sjMuted)
        }
    }

    /// One full-screen page's content, dispatched by kind. Everything but
    /// `.hero` is wrapped in the shared `TastePageChrome` (numbered title +
    /// lead + card), matching the old `ReportSection` chrome. `topInset`/
    /// `bottomInset` are the real status-bar/tab-bar clearance for this
    /// page to apply to its own *content* -- each page applies these
    /// itself, rather than the pager padding every row from the outside,
    /// so a page with its own full-bleed background (the hero page's
    /// aurora wash) can still reach the actual screen edges instead of
    /// leaving a gap where that outer padding used to shrink it.
    @ViewBuilder
    private func page(_ kind: TastePageKind, no: String, sceneShares: [(label: String, share: Double, color: Color)],
                       topInset: CGFloat, bottomInset: CGFloat) -> some View {
        switch kind {
        case .hero:
            heroPage(topInset: topInset, bottomInset: bottomInset)
        case .map:
            if let graph = report.graph {
                TastePageChrome(
                    no: no,
                    title: String(localized: "Your taste map"),
                    lead: String(localized: "Tap a world to explore its sub-genres, then a sub-genre to see your albums and recommendations."),
                    topInset: topInset, bottomInset: bottomInset
                ) {
                    TasteMapView(data: graph)
                }
            }
        case .hallOfFame:
            TastePageChrome(no: no, title: String(localized: "Your #1 Album"), topInset: topInset, bottomInset: bottomInset) {
                HallOfFameView(albums: report.topAlbums, score: report.topScore ?? report.topAlbums[0].score)
            }
        case .numbers:
            TastePageChrome(no: no, title: String(localized: "By the numbers"), topInset: topInset, bottomInset: bottomInset) {
                numbersContent
            }
        case .years:
            if let avgScore = stats.avgScore {
                TastePageChrome(no: no, title: String(localized: "Across the years"), lead: yearsLeadText,
                                 topInset: topInset, bottomInset: bottomInset) {
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
        case .score:
            TastePageChrome(no: no, title: String(localized: "How you score"), lead: scoreLeadText,
                             topInset: topInset, bottomInset: bottomInset) {
                ScoreRampChartView(
                    bins: charts.scoreDist,
                    mean: (pos: ((stats.avgScore ?? 0) - 0.25) / 5,
                           label: "\(String(localized: "avg")) \(String(format: "%.2f", stats.avgScore ?? 0))"),
                    legend: String(localized: "score")
                )
            }
        case .scene:
            // Canon reach merged in below (was its own page) -- user ask.
            // Canon has no gating condition of its own (always shown), so
            // it renders regardless; the scene half only renders -- and
            // only gets a divider above canon -- when there's scene data.
            // Wrapped in its own `ScrollView` since the combined height can
            // now exceed one screen (each half used to comfortably fit
            // alone) -- without it, `TastePageChrome`'s content frame
            // centers overflow vertically rather than pinning it to the
            // top, pushing content off *both* edges and rendering nothing
            // at all, confirmed live before adding this.
            TastePageChrome(no: no, title: String(localized: "Where your music comes from"),
                             lead: sceneShares.isEmpty ? nil : sceneLeadText(sceneShares),
                             topInset: topInset, bottomInset: bottomInset) {
                SceneCanonContent(sceneShares: sceneShares, prestigeShare: stats.prestigeShare)
            }
        case .standings:
            TastePageChrome(
                no: no,
                title: String(localized: "You vs the community"),
                lead: String(localized: "How your average compares to the community's, genre by genre."),
                topInset: topInset, bottomInset: bottomInset
            ) {
                StandingsList(standings: sortedStandings)
            }
        case .disliked:
            TastePageChrome(no: no, title: String(localized: "Not your thing"), topInset: topInset, bottomInset: bottomInset) {
                FlowChips(items: report.disliked.map(\.display))
                    .padding(.top, 10)
            }
        }
    }

    private func heroPage(topInset: CGFloat, bottomInset: CGFloat) -> some View {
        heroCard(topInset: topInset, bottomInset: bottomInset)
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

    /// The hero/title page's full-bleed content -- was a small rounded-rect
    /// "card" centered on an otherwise-empty page; now the aurora wash and
    /// content fill the whole screen, with the title/stats distributed by
    /// the two `Spacer`s rather than clustered at the top over dead space.
    private func heroCard(topInset: CGFloat, bottomInset: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                Text("Taste Report")
                    .font(.jakarta(10, weight: .black))
                    .kerning(1.2)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.sjBlue.opacity(0.7))
                Spacer(minLength: 8)
                TasteShareButton {
                    Haptics.light()
                    pendingShare = TasteShareBox(view: AnyView(TasteShareCard(no: "", title: "") { heroShareContent }))
                }
                Button(action: {
                    Haptics.light()
                    onRefresh()
                }) {
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
            Spacer(minLength: 24)
            Text(report.clusters.count >= 2
                 ? String(format: String(localized: "Your taste lives in\n%d worlds."), report.clusters.count)
                 : String(localized: "Your taste lives in\none world."))
                .font(.jakarta(40, weight: .black))
                .foregroundStyle(Color.sjInk)
            Text(String(format: String(localized: "Based on %1$d ratings across %2$d genres, analyzed into %3$d worlds."),
                        report.ratingCount, report.totalTags, report.clusters.count))
                .font(.jakarta(14.5))
                .foregroundStyle(Color.sjMuted)
                .padding(.top, 10)
            Spacer(minLength: 24)
            HStack(spacing: 20) {
                heroStat(value: report.ratingCount, label: String(localized: "rated"))
                Rectangle().fill(Color.sjBlue.opacity(0.2)).frame(width: 1, height: 34)
                heroStat(value: report.totalTags, label: String(localized: "genres"))
                Rectangle().fill(Color.sjBlue.opacity(0.2)).frame(width: 1, height: 34)
                heroStat(value: report.clusters.count, label: String(localized: "worlds"))
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 28 + topInset)
        .padding(.bottom, 40 + bottomInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ZStack { Color.sjBlue.opacity(0.07); auroraBackground })
    }

    private func heroStat(value: Int, label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            CountUpText(value: value)
                .font(.jakarta(28, weight: .black))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.jakarta(11, weight: .bold))
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

    // ── Numbers (stat tiles + 12-month activity; top album is its own page) ──

    private var numbersContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]
            LazyVGrid(columns: columns, spacing: 14) {
                StatTileView(
                    value: stats.avgScore.map { String(format: "%.2f", $0) } ?? "—",
                    label: String(localized: "average score"),
                    tip: String(localized: "The mean of every score you have given — where your ratings sit on average.")
                ) {
                    if let sd = stats.sdScore {
                        Text("±\(String(format: "%.2f", sd)) \(String(localized: "spread"))")
                            .font(.jakarta(10.5, weight: .semibold))
                            .foregroundStyle(Color.sjMuted.opacity(0.8))
                    }
                }
                StatTileView(
                    value: stats.median.map { String(format: "%.1f", $0) } ?? "—",
                    label: String(localized: "median score"),
                    tip: String(localized: "Your middle score: half your ratings fall above it, half below. Less swayed by extremes than the average.")
                ) {
                    if let hint = skewHint {
                        Text(hint)
                            .font(.jakarta(10.5, weight: .semibold))
                            .foregroundStyle(Color.sjMuted.opacity(0.8))
                    }
                }
                StatTileView(
                    value: stats.effectiveGenres.map { String(format: "%.1f", $0) } ?? "—",
                    label: String(localized: "effective genres"),
                    tip: String(localized: "How many genres you effectively spread across, weighted by how much you rate each. Higher means a broader palette.")
                ) {
                    Text(String(format: String(localized: "across %d rated"), report.totalTags))
                        .font(.jakarta(10.5, weight: .semibold))
                        .foregroundStyle(Color.sjMuted.opacity(0.8))
                }
                StatTileView(
                    value: stats.communityDelta.map { "\($0 >= 0 ? "+" : "−")\(String(format: "%.2f", abs($0)))" } ?? "—",
                    label: String(localized: "vs. the crowd"),
                    tip: String(localized: "How your scores compare with the community average on the same albums. Positive means you rate more generously than the crowd.")
                ) {
                    if let hint = crowdHint {
                        Text(hint)
                            .font(.jakarta(10.5, weight: .semibold))
                            .foregroundStyle(crowdHintColor)
                    }
                }
            }
            .padding(.top, 28)
            VStack(alignment: .leading, spacing: 10) {
                Text(String(localized: "12-month activity"))
                    .font(.jakarta(12, weight: .bold))
                    .foregroundStyle(Color.sjMuted)
                ActivitySparkView(timeline: charts.timeline, peakIndex: charts.peakMonthIndex, monthLabel: monthTooltipLabel)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 20)
            .background(Color.sjSurface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.sjBorder.opacity(0.6), lineWidth: 1))
            .padding(.top, 14)
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
}

// MARK: - Haptics

/// Thin wrapper over `UIFeedbackGenerator` -- centralizes the taps the Taste
/// tab fires (page snap, dot/card jump, tap-to-reveal, map drill-in) so the
/// feel stays consistent instead of each call site picking its own
/// generator/style. Internal, not file-private: `TasteMapView.swift` uses it
/// too.
enum Haptics {
    static func light() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    /// A sharper, less springy impact than `.medium` -- reads as hitting a
    /// hard limit rather than a soft confirmation, so it's reserved for
    /// resistance/boundary feedback (e.g. the loop swipe's guarded gate)
    /// rather than ordinary taps.
    static func rigid() { UIImpactFeedbackGenerator(style: .rigid).impactOccurred() }
    static func heavy() { UIImpactFeedbackGenerator(style: .heavy).impactOccurred() }
    /// `UINotificationFeedbackGenerator`'s distinctive multi-pulse pattern,
    /// not another single impact -- reserved for a genuine "arrived/done"
    /// moment (the loop transition landing back on the hero page) rather
    /// than an ordinary tap, so it reads as celebratory instead of just louder.
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func selection() { UISelectionFeedbackGenerator().selectionChanged() }
}

// MARK: - Full-screen pager

/// One swipeable "page" of the taste report -- an unnumbered hero up front,
/// then every gated section from the old single-scroll report (now one
/// section per screen instead of one card in a long scroll). The pager's
/// own `loopsAround` handles wrapping past the last of these back to `.hero`.
private enum TastePageKind {
    case hero, map, hallOfFame, numbers, years, score, scene, standings, disliked
}

/// True one-swipe-one-page paging -- every gesture moves at most one page,
/// like `UIScrollView.isPagingEnabled`, plus the wrap-around loop row's
/// extra resistance. Landed on this type across two user asks:
///
/// 1. "the scroll shouldn't be continuous... a single vertical swipe
///    should go to the section right below and snap almost immediately."
///    The built-in `.scrollTargetBehavior(.paging)` snaps to the nearest
///    multiple of the container height from the system's *momentum-
///    projected* target -- for a hard flick that projection can land two
///    or three pages away, so one strong swipe could glide straight past
///    several sections instead of landing on the very next one. Fixed by
///    reducing that projection to its direction only, not its magnitude:
///    `rawDelta` (how far past `fromPage` the projected target landed, in
///    page units) decides *which way*, but the actual target is always
///    clamped to `fromPage` or one page beyond it.
/// 2. The last-page-to-first-page swipe should be stickier than that: it
///    only commits once the drag has crossed `resistantFraction` of a
///    full page, otherwise it springs back to the last page (with a
///    firm "hit a wall" haptic marking the failed attempt). Every other
///    adjacent-page swipe (`guardedPage == nil`, or any transition not
///    landing on it) keeps the plain one-page paging above untouched.
///
/// A third attempt (now reverted) tried to make settle *speed* independent
/// of swipe speed too ("when i swipe slowly the motion also becomes slow"):
/// telling this type's own `target.rect` to stay put while separately
/// driving the real `UIScrollView.contentOffset` with a manual
/// `UIView.animate`. That broke the pager outright -- confirmed live, not
/// just reasoned: reporting `target.rect.origin.y = fromY` (i.e. "nothing
/// moved") left SwiftUI's own `scrollPosition(id:)` binding believing the
/// page genuinely hadn't changed, so on its next reconciliation pass it
/// re-asserted the *old* position, fighting the one-shot manual animation
/// and winning -- the pager was stuck on page 0, unable to advance at all.
/// Reverted to reporting the real target truthfully after that regression;
/// re-adding fixed-duration settling (below) took a structurally different
/// approach this time specifically to avoid repeating it.
///
/// **Second attempt at fixed-duration settling, same user ask, different
/// mechanism.** The first attempt (reverted above) manipulated the real
/// `UIScrollView.contentOffset` directly via raw UIKit, while telling this
/// type's own `target.rect` that nothing had moved -- SwiftUI's
/// `scrollPosition(id:)` binding never learned the page actually changed
/// (its `get` closure kept reading the stale, never-updated `currentPage`),
/// so it kept re-asserting the old position and winning the fight, forever.
/// This time, a swipe that decides to change pages doesn't touch
/// `UIScrollView` at all: it tells native to stay put (`target.rect` = the
/// starting position, same as the rejected-swipe case just below) and hands
/// off entirely to `onCommit`, which the container wires directly to `jump`
/// -- the exact same `currentPage = target; withAnimation { proxy.scrollTo }`
/// path a dot-rail tap already uses successfully, every round this session.
/// Because that path writes `currentPage` itself (not through the
/// `scrollPosition` binding's own set closure), SwiftUI's binding is never
/// left stale, and there's nothing for it to fight.
private struct LoopGuardedPaging: ScrollTargetBehavior {
    /// The invisible loop-trigger row's index (`count` in
    /// `TastePagerContainer`), or nil on a page that doesn't loop -- falls
    /// back to plain one-page-per-swipe paging with no guarded transition.
    let guardedPage: Int?
    /// Wired to `jump(to:proxy:)` by `TastePagerContainer` -- see this
    /// type's own doc comment for why handing off to it (rather than
    /// touching `UIScrollView` directly) is the load-bearing difference
    /// from the reverted first attempt.
    let onCommit: (Int) -> Void
    private let resistantFraction: CGFloat = 0.82

    func updateTarget(_ target: inout ScrollTarget, context: ScrollTargetBehaviorContext) {
        let pageHeight = context.containerSize.height
        guard pageHeight > 0 else { return }

        let fromY = context.originalTarget.rect.origin.y
        let fromPage = (fromY / pageHeight).rounded()

        // The system's own proposed target already bakes release velocity
        // into its distance (that's exactly what let a hard flick glide
        // past several pages) -- so direction alone, off a simple >half-a-
        // page threshold, is enough to decide advance/retreat/stay; no
        // need to separately consult `context.velocity`.
        let rawDelta = (target.rect.origin.y - fromY) / pageHeight
        var page = fromPage
        if rawDelta > 0.5 {
            page = fromPage + 1
        } else if rawDelta < -0.5 {
            page = fromPage - 1
        }

        if let guardedPage, page == CGFloat(guardedPage), fromPage == CGFloat(guardedPage) - 1 {
            guard rawDelta >= resistantFraction else {
                Haptics.rigid()
                target.rect.origin.y = fromY
                return
            }
        }

        // Tell native to stay exactly where the live drag ended -- we're
        // taking over the actual move via `onCommit` below, same as a
        // dot-rail tap already does. Deferred one run-loop tick (matching
        // `PagerScrollViewFinder`'s own precedent elsewhere in this file)
        // so this state write never lands mid-gesture-callback.
        target.rect.origin.y = fromY
        guard page != fromPage else { return }
        let targetPage = Int(page)
        DispatchQueue.main.async {
            onCommit(targetPage)
        }
    }
}

/// Sets the pager's `UIScrollView.decelerationRate`. Originally tuned well
/// below the system's own `.fast` preset (0.99) -- down to 0.85 -- to "make
/// the swipe feel snappier," but that turned out to overshoot badly: at 0.85
/// the glide after lifting a finger decays almost instantly, so the page
/// snap completes in a single abrupt jump instead of a smooth transition --
/// confirmed live as "way too fast." First reverted to the system's own
/// `.normal` preset (0.998) -- still confirmed live as "way too fast," so
/// pushed further still, to `0.9993`. These are exponential-decay rates
/// applied continuously while the page glides into its settled position
/// (not a fixed-duration animation), so small increments this close to 1.0
/// produce a much larger jump in visual glide duration than the raw numbers
/// suggest -- `0.9993` reads as a clearly slower, more deliberate transition
/// than `.normal` did, without going so close to 1.0 that the page appears
/// to drift rather than settle. This doesn't fight SwiftUI's own scroll
/// reconciliation the way a manual
/// `contentOffset` override did (see `LoopGuardedPaging`'s doc comment for
/// that regression). SwiftUI's
/// `ScrollView` exposes no modifier for `decelerationRate`, so this places
/// an invisible, zero-size `UIView` inside the scroll content and walks its
/// `superview` chain to find the real `UIScrollView` SwiftUI creates under
/// the hood -- must live *inside* the scrollable content (not a
/// `.background{}` on the `ScrollView` itself, which composites as a
/// sibling, not a descendant -- confirmed live to never find anything).
///
/// Deferred to the next run-loop tick (`DispatchQueue.main.async`): reading
/// `superview` the instant `makeUIView` runs, before this view has actually
/// been inserted into the real hierarchy, would silently find nothing.
private struct PagerScrollViewFinder: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        view.isHidden = true
        view.isUserInteractionEnabled = false
        DispatchQueue.main.async { Self.apply(startingFrom: view) }
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        DispatchQueue.main.async { Self.apply(startingFrom: uiView) }
    }

    private static func apply(startingFrom view: UIView) {
        var current: UIView? = view
        while let v = current {
            if let scrollView = v as? UIScrollView {
                scrollView.decelerationRate = UIScrollView.DecelerationRate(rawValue: 0.9993)
                return
            }
            current = v.superview
        }
    }
}

/// Vertical, Reels/Shorts-style paging container: one full-screen page per
/// index, snapping via `LoopGuardedPaging` (standard page-to-page paging,
/// with extra resistance on the specific swipe into the wrap-around loop
/// row -- see its own doc comment). A real swipe is tracked read-only via
/// `.scrollPosition(id:)` (for the dot rail + page-change haptic); a dot
/// tap/drag jumps via `ScrollViewReader.scrollTo(_:anchor:)` instead -- the
/// purpose-built API for jumping straight to an arbitrary id, vs. driving
/// the same `scrollPosition` binding both ways.
private struct TastePagerContainer<Content: View>: View {
    let count: Int
    /// When true, swiping past the last page doesn't just stop -- one more
    /// row is appended (index `count`, outside the numbered/dot-indicated
    /// range) that triggers a full-screen bubble-rise transition, then jumps
    /// back to page 0 underneath it while fully covered. Reached by a
    /// perfectly normal forward swipe like any other page, so it needs no
    /// custom overscroll-detection gesture of its own.
    let loopsAround: Bool
    /// Page index, plus the real top/bottom safe-area insets (status bar,
    /// tab bar) for that page to apply *itself* -- deliberately not applied
    /// by this container from the outside (see the `body` note on why that
    /// broke full-bleed backgrounds like the hero page's aurora wash).
    let content: (Int, CGFloat, CGFloat) -> Content

    @State private var currentPage: Int = 0
    @State private var isLooping = false
    /// Non-nil only while the wrap-around transition is actively running --
    /// `HalftoneLoopOverlay` times its whole animation off this start mark,
    /// and its `TimelineView` only exists (and only ticks every frame)
    /// while this is set, so the pager pays nothing for it the rest of the
    /// time.
    @State private var loopTransitionStart: Date?
    /// Debounces the loop trigger against `currentPage` landing on the
    /// guarded row -- see `scheduleLoopCheck` for why this exists instead
    /// of firing immediately.
    @State private var pendingLoopCheck: Task<Void, Never>?

    init(count: Int, loopsAround: Bool = false, @ViewBuilder content: @escaping (Int, CGFloat, CGFloat) -> Content) {
        self.count = count
        self.loopsAround = loopsAround
        self.content = content
    }

    private var totalRows: Int { loopsAround ? count + 1 : count }

    var body: some View {
        // Measure-then-ignore: an outer `GeometryReader` that does *not*
        // ignore safe area exists purely to read `probeGeo.safeAreaInsets`
        // correctly -- including the tab bar's reserved height when this is
        // embedded in `MainTabView`, which is real, automatic SwiftUI
        // safe-area propagation, not something bespoke. The *inner*
        // `GeometryReader` carries the actual `.ignoresSafeArea()` (see its
        // own note for why that specific placement is load-bearing for the
        // paging math) and uses the probe's insets to pad every page
        // manually instead of guessing. Two failed simpler attempts before
        // this one: a full `.ignoresSafeArea()` alone let the first page
        // render underneath the tab bar (it escapes *every* ambient
        // safe-area context, not just the device notch this container
        // wants to bleed under); reading insets from `UIWindow` directly
        // (instead of this probe) got the device's physical home-indicator
        // inset but had no idea a tab bar was reserving additional space on
        // top of it.
        GeometryReader { probeGeo in
            let topInset = probeGeo.safeAreaInsets.top
            let bottomInset = probeGeo.safeAreaInsets.bottom

            // `.ignoresSafeArea()` on this reader (not just its background)
            // is load-bearing, confirmed live: a plain `GeometryReader`
            // reports its *safe-area-excluded* size, but
            // `.scrollTargetBehavior(.paging)` snaps against the view's
            // *full* bounds regardless -- a small, constant per-page gap
            // between "declared page height" and "actual snap distance"
            // that compounds linearly with page index. Landing on a page
            // several swipes in came up short of its own top, with the
            // next page's edge already bleeding in at the bottom.
            GeometryReader { outerGeo in
                ScrollViewReader { proxy in
                    ScrollView(.vertical) {
                        VStack(spacing: 0) {
                            ForEach(0..<totalRows, id: \.self) { i in
                                Group {
                                    if i == count {
                                        // Present but invisible -- its only job is to
                                        // give the pager one more page to land on
                                        // past the last real one. Detecting "the
                                        // user swiped past the last real page" is
                                        // handled by `currentPage` landing here
                                        // (below), not by this row itself -- see
                                        // that handler's comment for why.
                                        Color.clear
                                    } else {
                                        content(i, topInset, bottomInset)
                                    }
                                }
                                .frame(width: outerGeo.size.width, height: outerGeo.size.height)
                                .clipped()
                                .id(i)
                            }
                        }
                        .scrollTargetLayout()
                        .background {
                            // Must live *inside* the ScrollView's own
                            // scrollable content, not as a `.background{}`
                            // on the `ScrollView` itself -- that would place
                            // it as a *sibling* of the real `UIScrollView`,
                            // not a descendant, so walking `superview` from
                            // there would climb past it and never find it
                            // (confirmed live). See `PagerScrollViewFinder`'s
                            // own doc comment for what it's for.
                            PagerScrollViewFinder()
                        }
                    }
                    .scrollTargetBehavior(LoopGuardedPaging(guardedPage: loopsAround ? count : nil, onCommit: { page in
                        jump(to: page, proxy: proxy)
                    }))
                    .scrollPosition(id: Binding(
                        get: { Optional(currentPage) },
                        set: { if let v = $0 { currentPage = v } }
                    ))
                    .scrollIndicators(.hidden)
                    .scrollBounceBehavior(.basedOnSize, axes: .vertical)
                    .background(Color.sjCream.ignoresSafeArea())
                    .overlay(alignment: .trailing) {
                        if count > 1 {
                            PageIndicatorDots(count: count, current: currentPage) { target in
                                jump(to: target, proxy: proxy)
                            }
                            .padding(.trailing, 6)
                        }
                    }
                    // Triggers the loop off `currentPage` landing on the
                    // guarded row, debounced -- not off visibility. The
                    // previous approach (`onScrollVisibilityChange`,
                    // threshold 0.6) fired the instant the row crossed 60%
                    // visible, which for a real finger-drag swipe happens
                    // well *before* release, not after: `runLoopTransition`
                    // was starting the cover/reset sequence while the
                    // user's finger was potentially still down and the
                    // gesture still live, racing the reset against whatever
                    // the still-active drag did next. That race could never
                    // show up in any prior verification here, since every
                    // debug harness used `scrollTo`/`jump()` to arrive at
                    // the guarded row -- never a real touch, so never an
                    // active gesture to race against.
                    //
                    // Debouncing sidesteps needing to know exactly when
                    // `currentPage` updates relative to touch-up (continuously
                    // during a drag, or only after it settles -- genuinely
                    // unclear, and unverifiable here either way): every
                    // change to `currentPage` restarts a short wait, so the
                    // real transition only ever commits once the position
                    // has actually stopped changing, regardless of whether
                    // that stability arrived because the finger lifted or
                    // because the scroll simply settled.
                    .onChange(of: currentPage) { old, new in
                        guard old != new else { return }
                        if loopsAround, new == count {
                            scheduleLoopCheck(proxy: proxy)
                        } else {
                            pendingLoopCheck?.cancel()
                            pendingLoopCheck = nil
                            Haptics.light()
                        }
                    }
                }
            }
            .ignoresSafeArea()
        }
        .overlay {
            if loopsAround, let start = loopTransitionStart {
                // Hit-testable, not ignored -- this sits above the whole
                // pager (ScrollView + dot rail), so while it's on screen it
                // also doubles as a shield absorbing any stray touch during
                // the transition. Earlier this was `.allowsHitTesting(false)`
                // plus `.scrollDisabled(isLooping)` on the ScrollView itself
                // and a matching `.allowsHitTesting(!isLooping)` on the dot
                // rail -- three separate flags for one goal. Dropped in
                // favor of this single mechanism after a report that the
                // scroll-disabled approach could still leave the pager
                // landing on a blank page: toggling a `ScrollView`'s own
                // `scrollDisabled` state mid-gesture-settle is a plausible
                // way to disrupt the view's real scroll-decelerating
                // physics; this shield never touches the ScrollView's own
                // enabled state at all, so it can't interfere with
                // `runLoopTransition`'s reset no matter how or when the
                // preceding swipe settled.
                HalftoneLoopOverlay(startDate: start)
                    .ignoresSafeArea()
            }
        }
    }

    private func jump(to target: Int, proxy: ScrollViewProxy) {
        currentPage = target
        // Was a `.spring(response: 2.5, dampingFraction: 0.75)` -- tuned up from
        // 0.4/0.8 across two earlier rounds of "still too fast," each time by
        // raising `response` (roughly the settle time). Still confirmed "way too
        // fast" after all that, with the user's own hunch pointing at exactly
        // the right thing: "maybe it's the snap." A spring's motion is
        // front-loaded regardless of how long `response` is -- it attacks
        // quickly toward the target and only the *tail* (a barely-visible
        // wobble/settle) stretches out over the rest of that time, so a longer
        // response doesn't actually make the visible motion look slower, just
        // extends an invisible tail. Switched to a plain `.easeInOut`, which
        // spends its entire duration in uniform, gradual motion with no fast
        // attack phase -- the right tool for "slow gliding transition," which a
        // spring never was regardless of its parameters. Same sharing rationale
        // as before: used by dot-tap/drag-scrub jumps too, not split into a
        // separate swipe-only duration.
        withAnimation(.easeInOut(duration: 0.85)) {
            proxy.scrollTo(target, anchor: .top)
        }
    }

    /// Waits a short quiet period after `currentPage` lands on the guarded
    /// row before actually committing to the loop transition. Cancelled and
    /// restarted every time `currentPage` changes again (see the
    /// `.onChange` above) -- so a swipe that's still actively moving
    /// through or past the guarded row keeps deferring the real trigger,
    /// and it only fires once the position has genuinely stopped changing
    /// for 220ms, however that stability came about.
    private func scheduleLoopCheck(proxy: ScrollViewProxy) {
        pendingLoopCheck?.cancel()
        pendingLoopCheck = Task {
            try? await Task.sleep(for: .milliseconds(220))
            guard !Task.isCancelled else { return }
            runLoopTransition(proxy: proxy)
        }
    }

    /// Starts `HalftoneLoopOverlay`'s self-timed animation and schedules the
    /// one side effect it can't do itself: jumping the pager back to page 0
    /// underneath it. Timed against `HalftoneLoopOverlay.coverDuration` --
    /// the moment the ignite sweep finishes and the screen is fully inked,
    /// same "swap underneath while covered" trick as before, just keyed to
    /// the new per-dot sweep instead of a rigid rise/hold/rise offset.
    ///
    /// Haptics are a deliberate two-beat arc, not one flat tap -- user ask:
    /// make this "more dramatic." A heavy impact lands the instant the
    /// commit is decided (the drag has already crossed the resistant
    /// gate -- this is the payoff for pushing through it), then a
    /// `.success` notification pattern marks the moment the reveal
    /// actually completes and the hero page is back on screen -- the
    /// "you've arrived" beat, distinct in feel from the "it's happening"
    /// beat at the start.
    private func runLoopTransition(proxy: ScrollViewProxy) {
        guard !isLooping else { return }
        isLooping = true
        Haptics.heavy()
        loopTransitionStart = Date()
        Task {
            try? await Task.sleep(for: .milliseconds(Int(HalftoneLoopOverlay.coverDuration * 1000)))
            // A short, real animation rather than `disablesAnimations` --
            // still completely hidden (the overlay stays fully opaque for
            // ~260ms after this point, easily long enough to cover a
            // 150ms scroll), but goes through the same code path an
            // ordinary animated `scrollTo` would, rather than relying on
            // animation-suppression machinery that's never been confirmed
            // safe to combine with whatever state a real gesture's gone
            // through settling onto the guarded page.
            currentPage = 0
            withAnimation(.linear(duration: 0.15)) {
                proxy.scrollTo(0, anchor: .top)
            }
            let remaining = HalftoneLoopOverlay.totalDuration - HalftoneLoopOverlay.coverDuration
            try? await Task.sleep(for: .milliseconds(Int(remaining * 1000)))
            loopTransitionStart = nil
            isLooping = false
            Haptics.success()
        }
    }
}

/// One dot in the wrap-around transition's halftone field: a fixed screen
/// position plus a reveal `threshold` in 0...1, driven mostly by how close
/// the dot sits to the bottom edge (so the sweep climbs bottom-to-top) with
/// a little per-dot jitter mixed in so the frontier reads as scattered ink
/// rather than a ruled line. Both the covering sweep and the uncovering
/// sweep read this *same* threshold -- a dot that ignites early also
/// extinguishes early, so the cover and the reveal are one continuous
/// bottom-up motion instead of a mirrored reverse.
private struct HalftoneDot {
    let x: CGFloat
    let y: CGFloat
    let radius: CGFloat
    let color: Color
    let threshold: Double
}

/// The wrap-around transition's visual: the app's own flower-mark halftone
/// (see `logo-flower.svg` -- cyan/magenta/yellow dot grids at the classic
/// offset-print screen angles, 15°/75°/0°, plus a sparse black key layer at
/// 45°, composited with multiply blending) instead of the flat bubble field
/// this replaced. Live feedback on that version ("the last to first slide
/// transition is a bit off") led to trying the logo's own texture directly;
/// a follow-up ("dots a bit smaller... I want the dots to appear randomly
/// and cover the screen from bottom up, and disappear bottom up again")
/// set the two concrete requirements this implements: no sliding image --
/// every dot ignites/extinguishes individually from its own fixed
/// position -- and a bottom-up direction on both halves, not a mirror.
///
/// Rendered as a fixed overlay on the *whole* pager (see
/// `TastePagerContainer.body`), independent of scroll position, same
/// reasoning as the bubble field it replaced: the reveal has to land on
/// something still on screen, not a row that already scrolled away.
/// `TimelineView(.animation)` + `Canvas` (not individual `Circle()` views --
/// several thousand of those would be prohibitively expensive) redraws the
/// whole field every frame purely from elapsed time since `startDate`, the
/// pattern Apple's own Canvas/TimelineView guidance recommends for
/// procedural animation that isn't just interpolating a single SwiftUI
/// layout property.
private struct HalftoneLoopOverlay: View {
    let startDate: Date

    /// Total transition length and its four phases as fractions of the
    /// whole: covering (bottom-up ignite), held (fully inked -- this is
    /// when `runLoopTransition` jumps the pager back to page 0
    /// underneath), uncovering (the same per-dot thresholds, bottom-up
    /// extinguish), then a short gap before the field goes idle.
    static let totalDuration: Double = 1.3
    private static let coverEnd = 0.35
    private static let holdEnd = 0.55
    private static let uncoverEnd = 0.90
    static var coverDuration: Double { totalDuration * coverEnd }

    private static let pitch: CGFloat = 13
    private static let fill: CGFloat = 0.58
    private static let yellowBias: CGFloat = 0.68
    private static let blackAmount: CGFloat = 0.18
    private static let jitter: Double = 0.35
    private static let popWidth: Double = 0.11

    private enum Phase { case cover, hold, uncover, gap }

    var body: some View {
        GeometryReader { geo in
            let dots = Self.dots(for: geo.size)
            TimelineView(.animation) { timeline in
                Canvas { context, size in
                    let elapsed = timeline.date.timeIntervalSince(startDate)
                    Self.draw(context: &context, size: size, dots: dots, t: elapsed / Self.totalDuration)
                }
            }
        }
    }

    private static func draw(context: inout GraphicsContext, size: CGSize, dots: [HalftoneDot], t: Double) {
        let phase: Phase
        let rawProgress: Double
        if t < coverEnd {
            phase = .cover; rawProgress = t / coverEnd
        } else if t < holdEnd {
            phase = .hold; rawProgress = 1
        } else if t < uncoverEnd {
            phase = .uncover; rawProgress = (t - holdEnd) / (uncoverEnd - holdEnd)
        } else {
            phase = .gap; rawProgress = 0
        }
        let progress = easeInOutCubic(clamp01(rawProgress))

        // Dot gaps alone rarely add up to full opacity -- fill solid during
        // the hold so the page swap underneath is genuinely hidden, not
        // just mostly hidden.
        if phase == .hold {
            context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color.sjCream))
        }

        context.blendMode = .multiply
        for dot in dots {
            let alpha: Double
            switch phase {
            case .cover:
                alpha = easeOutCubic(clamp01((progress - dot.threshold) / popWidth))
            case .hold:
                alpha = 1
            case .uncover:
                alpha = 1 - easeOutCubic(clamp01((progress - dot.threshold) / popWidth))
            case .gap:
                alpha = 0
            }
            guard alpha > 0.01 else { continue }
            let r = dot.radius * (0.55 + 0.45 * alpha)
            let rect = CGRect(x: dot.x - r, y: dot.y - r, width: r * 2, height: r * 2)
            context.fill(Path(ellipseIn: rect), with: .color(dot.color.opacity(alpha)))
        }
    }

    private static func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }
    private static func easeInOutCubic(_ x: Double) -> Double { x < 0.5 ? 4 * x * x * x : 1 - pow(-2 * x + 2, 3) / 2 }
    private static func easeOutCubic(_ x: Double) -> Double { 1 - pow(1 - x, 3) }

    /// Builds the fixed dot field once per screen size (not per frame -- a
    /// `TimelineView` tick redraws its own `Canvas` subtree without forcing
    /// this `GeometryReader` to re-run). A deterministic PRNG (not
    /// `.random`, which would reshuffle the ignite order every redraw)
    /// lays out each channel's rotated grid; thresholds are then min-max
    /// normalized across the whole field so the sweep spans the full
    /// 0...1 range regardless of screen size.
    private static func dots(for size: CGSize) -> [HalftoneDot] {
        guard size.width > 0, size.height > 0 else { return [] }
        var rng = SeededRNG(seed: 20_260_911)

        struct Layer { let angleDeg: Double; let color: Color; let radius: CGFloat; let pitchMultiplier: CGFloat }
        let layers: [Layer] = [
            Layer(angleDeg: 15, color: Color(red: 0, green: 1, blue: 1), radius: (pitch / 2) * fill, pitchMultiplier: 1),
            Layer(angleDeg: 75, color: Color(red: 1, green: 0, blue: 1), radius: (pitch / 2) * fill * 0.97, pitchMultiplier: 1),
            Layer(angleDeg: 0, color: Color(red: 1, green: 1, blue: 0), radius: (pitch / 2) * fill * yellowBias, pitchMultiplier: 1),
            Layer(angleDeg: 45, color: .black, radius: (pitch / 2) * fill * blackAmount, pitchMultiplier: 1.4)
        ]

        var raw: [(x: CGFloat, y: CGFloat, radius: CGFloat, color: Color, rand: Double)] = []
        for layer in layers {
            let p = pitch * layer.pitchMultiplier
            let a = layer.angleDeg * .pi / 180
            let cosA = CGFloat(cos(a)), sinA = CGFloat(sin(a))
            let diag = sqrt(size.width * size.width + size.height * size.height) * 0.75 + p
            var ly = -diag
            while ly <= diag {
                var lx = -diag
                while lx <= diag {
                    let sx = size.width / 2 + lx * cosA - ly * sinA
                    let sy = size.height / 2 + lx * sinA + ly * cosA
                    if sx >= -layer.radius, sx <= size.width + layer.radius,
                       sy >= -layer.radius, sy <= size.height + layer.radius {
                        raw.append((sx, sy, layer.radius, layer.color, rng.nextUnit()))
                    }
                    lx += p
                }
                ly += p
            }
        }

        var minT = Double.infinity, maxT = -Double.infinity
        var thresholds: [Double] = []
        thresholds.reserveCapacity(raw.count)
        for d in raw {
            let yNorm = min(1, max(0, Double(d.y / size.height)))
            let base = 1 - yNorm // bottom (yNorm~1) ignites early; top (yNorm~0) ignites late
            let threshold = base + (d.rand - 0.5) * jitter
            minT = min(minT, threshold)
            maxT = max(maxT, threshold)
            thresholds.append(threshold)
        }
        let span = max(1e-6, maxT - minT)
        return zip(raw, thresholds).map { d, threshold in
            HalftoneDot(x: d.x, y: d.y, radius: d.radius, color: d.color, threshold: (threshold - minT) / span)
        }
    }
}

/// Deterministic PRNG (mulberry32) so the halftone field's per-dot jitter
/// is stable across redraws -- `.random` would reshuffle the ignite order
/// every time the field is rebuilt.
private struct SeededRNG {
    private var state: UInt32
    init(seed: UInt32) { state = seed }
    mutating func nextUnit() -> Double {
        state = state &+ 0x6D2B_79F5
        var z = state
        z = (z ^ (z >> 15)) &* (z | 1)
        z ^= (z &+ (z ^ (z >> 7)) &* (z | 61))
        z ^= (z >> 14)
        return Double(z) / Double(UInt32.max)
    }
}

/// Trailing vertical dot rail -- current page reads as a taller capsule.
/// A single `DragGesture(minimumDistance: 0)` over the whole rail handles
/// both a tap (fires once, at the touch-down location) and a press-and-drag
/// scrub (maps the finger's position along the rail to a page index
/// continuously, jumping as it changes) -- the quick way to cross many
/// sections at once instead of swiping through each one.
private struct PageIndicatorDots: View {
    let count: Int
    let current: Int
    let onSelect: (Int) -> Void

    @State private var isDragging = false

    private let dotHeight: CGFloat = 16
    private let dotSpacing: CGFloat = 4
    private var totalHeight: CGFloat { CGFloat(count) * dotHeight + CGFloat(max(0, count - 1)) * dotSpacing }

    var body: some View {
        GeometryReader { geo in
            VStack(spacing: dotSpacing) {
                ForEach(0..<count, id: \.self) { i in
                    let isActive = i == current
                    Capsule()
                        .fill(isActive ? Color.sjBlue : Color.sjMuted.opacity(0.28))
                        .frame(width: isActive ? (isDragging ? 6 : 4) : 3, height: isActive ? 14 : 5)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        isDragging = true
                        let ratio = min(max(value.location.y / geo.size.height, 0), 1)
                        let index = min(count - 1, max(0, Int(ratio * CGFloat(count))))
                        if index != current { onSelect(index) }
                    }
                    .onEnded { _ in isDragging = false }
            )
        }
        .frame(width: 24, height: totalHeight)
        .animation(.easeOut(duration: 0.2), value: current)
        .animation(.easeOut(duration: 0.15), value: isDragging)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(localized: "Section"))
        .accessibilityValue(String(format: String(localized: "%1$d of %2$d"), current + 1, count))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: onSelect(min(count - 1, current + 1))
            case .decrement: onSelect(max(0, current - 1))
            @unknown default: break
            }
        }
    }
}

/// Shared full-page chrome: numbered title + optional lead sentence pinned
/// near the top, content filling the rest of the screen directly (no boxed
/// card) -- a plain white "surface" card here was reading as a small,
/// centered card floating on a mostly-empty screen rather than a native
/// full-bleed page, live feedback after the first full-screen pass. Content
/// now sits straight on the page's own cream canvas -- the same layering
/// every other screen in this app already uses (colorful content directly
/// on `sjCream`, not everything boxed in a white card) -- and fills the
/// full remaining height instead of being centered inside dead space.
private struct TastePageChrome<Content: View>: View {
    let no: String
    let title: String
    var lead: String? = nil
    var topInset: CGFloat = 0
    var bottomInset: CGFloat = 0
    @ViewBuilder var content: Content

    /// Boxed so `.sheet(item:)` has the `Identifiable` it needs -- a fresh
    /// box (and so a fresh `SharePreviewSheet`) each tap, rather than one
    /// long-lived optional view reused across taps.
    @State private var pendingShare: TasteShareBox?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(no)
                        .font(.jakarta(11, weight: .black))
                        .monospacedDigit()
                        .foregroundStyle(Color.sjBlue.opacity(0.6))
                    Text(title)
                        .font(.jakarta(23, weight: .black))
                        .foregroundStyle(Color.sjInk)
                }
                Spacer(minLength: 8)
                TasteShareButton {
                    Haptics.light()
                    pendingShare = TasteShareBox(view: AnyView(TasteShareCard(no: no, title: title) { content }))
                }
            }
            if let lead {
                Text(lead)
                    .font(.jakarta(13.5))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.top, 6)
                    .fixedSize(horizontal: false, vertical: true)
            }
            RevealSection {
                VStack(alignment: .leading, spacing: 0) { content }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
            }
            .frame(maxHeight: .infinity)
        }
        .padding(.horizontal, 24)
        .padding(.top, 28 + topInset)
        .padding(.bottom, 36 + bottomInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .sheet(item: $pendingShare) { box in
            SharePreviewSheet { box.view }
        }
    }
}

/// Boxes an `AnyView` share card so it can be handed to `.sheet(item:)`,
/// which needs `Identifiable` -- used by both `TastePageChrome` (every
/// numbered section) and the hero page's own share button.
private struct TasteShareBox: Identifiable {
    let id = UUID()
    let view: AnyView
}

/// Top-right share button, same visual language as the hero page's existing
/// Refresh pill (translucent surface, blue hairline) -- one shared button
/// so every section's share affordance looks identical.
private struct TasteShareButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image("icon-share")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 14, height: 14)
                .foregroundStyle(Color.sjInk)
                .frame(width: 36, height: 36)
                .background {
                    Circle()
                        .fill(Color.clear)
                        .glassEffect(.regular, in: Circle())
                }
        }
        .buttonStyle(.plain)
    }
}

/// Generic branded card for sharing any Taste-tab section to Instagram --
/// user ask: "make each section shareable... same as sharing a post." Wraps
/// whichever section's own `content` closure is handed to it (reused
/// as-is, no separate bespoke redesign per section) in a fixed-width,
/// sillajuku-branded frame sized for a story sticker, through the exact
/// same `SharePreviewSheet` pipeline (background picker, drag/resize,
/// Instagram Story/Reels/Post, Save, More) every other share in this app
/// already uses.
///
/// The content area is a *fixed* height, not `maxHeight: .infinity` --
/// several sections' own content (`TasteMapView`'s and `StandingsList`'s
/// internal `ScrollView`s in particular) size themselves relative to
/// whatever height their parent proposes, and this card's parent (an
/// `ImageRenderer` snapshot with no ancestor `GeometryReader` bounding it)
/// would otherwise propose an unbounded height, rendering the section's
/// *entire* unscrolled content at whatever size that turns out to be
/// instead of a consistent, story-shaped card.
private struct TasteShareCard<Content: View>: View {
    let no: String
    let title: String
    @ViewBuilder var content: Content

    private static var cardWidth: CGFloat { 320 }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !no.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(no)
                        .font(.jakarta(11, weight: .black))
                        .monospacedDigit()
                        .foregroundStyle(Color.sjBlue.opacity(0.6))
                    // `.fixedSize` forces genuine multi-line wrapping instead
                    // of the ideal-single-line-then-truncate default an
                    // `HStack` child otherwise gets -- this card is
                    // narrower than the full-screen page these titles were
                    // written for, so several truncate to an ellipsis
                    // without it (confirmed live: "Where your music
                    // comes…").
                    Text(title)
                        .font(.jakarta(19, weight: .black))
                        .foregroundStyle(Color.sjInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            content
                .environment(\.isTasteShareSnapshot, true)
                .frame(width: Self.cardWidth - 40, height: 420, alignment: .top)
                .clipped()
            HStack(spacing: 6) {
                Image("logo-flower")
                    .resizable().scaledToFit()
                    .frame(width: 15, height: 15)
                Image("logo-text")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(height: 9)
                    .foregroundStyle(Color.sjInk.opacity(0.55))
            }
        }
        .padding(20)
        .frame(width: Self.cardWidth)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 22))
    }
}

/// The "Where your music comes from" page's content -- scene breakdown (when
/// present) plus canon reach, merged into one page and wrapped in its own
/// `ScrollView` since the combined height can exceed one screen (see the
/// `.scene` case in `page(_:no:...)`). A dedicated `View` type, not inline
/// content, specifically so it can read `isTasteShareSnapshot` itself: that
/// environment value is set by `TasteShareCard` at the exact point this
/// content is re-embedded for the share sheet, and only a distinct view type
/// gets re-evaluated (and so re-reads the environment) at each embed site --
/// inline content built once inside `TasteReportView.page()` would resolve
/// its branch a single time, in the live page's context, and that same
/// resolved value would be reused verbatim in the share card too.
private struct SceneCanonContent: View {
    let sceneShares: [(label: String, share: Double, color: Color)]
    let prestigeShare: Double?

    /// See `StandingsList`'s matching property for why: a `ScrollView`
    /// renders blank when snapshotted by `ImageRenderer` outside a window,
    /// confirmed with an isolated repro. Swapped for a plain `VStack` (still
    /// bounded by the parent's fixed-height `.clipped()` frame) when sharing.
    @Environment(\.isTasteShareSnapshot) private var isTasteShareSnapshot

    var body: some View {
        Group {
            if isTasteShareSnapshot {
                rows
            } else {
                ScrollView(.vertical) {
                    rows
                }
                .scrollIndicators(.hidden)
            }
        }
        .frame(maxHeight: .infinity)
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !sceneShares.isEmpty {
                sceneBreakdown
                Divider().padding(.vertical, 24)
            }
            Text(String(localized: "Canon reach"))
                .font(.jakarta(11, weight: .bold))
                .kerning(0.4)
                .textCase(.uppercase)
                .foregroundStyle(Color.sjMuted.opacity(0.7))
                .padding(.bottom, 16)
            canonGauge
                .frame(maxWidth: .infinity)
        }
    }

    private var sceneBreakdown: some View {
        VStack(alignment: .leading, spacing: 0) {
            StackedBarView(segments: sceneShares.map { (share: $0.share, color: $0.color) })
                .padding(.top, 12)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(sceneShares.enumerated()), id: \.offset) { _, s in
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

    private var canonGauge: some View {
        VStack(spacing: 24) {
            CanonRadialGauge(pct: prestigeShare ?? 0, label: String(localized: "in the canon"))
            Text(String(format: String(localized: "%d%% of what you rate sits in the curated canon; the rest is your own discovery."),
                        Int(((prestigeShare ?? 0) * 100).rounded())))
                .font(.jakarta(15))
                .foregroundStyle(Color.sjMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
        }
        .frame(maxWidth: .infinity)
    }
}

/// Vertical list of every genre's you-vs-community comparison, shown all at
/// once inside its own scroll region -- user ask: "remove the horizontal
/// swipe and display everything at once." Was a horizontally-paged
/// one-card-at-a-time carousel (see git history), built specifically to
/// avoid a long vertical list running past the screen on a full-height
/// page; that's solved here by capping this list's own height instead of
/// avoiding vertical layout altogether -- a nested `ScrollView(.vertical)`
/// inside the pager's own vertical `ScrollView` coordinates through the
/// standard same-axis nested-scroll behavior (the inner list scrolls until
/// it can't, then the pager's own vertical swipe takes over), unlike the
/// orthogonal horizontal-vs-vertical gesture conflict a sideways carousel
/// had to dodge.
private struct StandingsList: View {
    let standings: [TasteProfileResponse.GenreStandingRow]

    /// `ImageRenderer` (used to snapshot this content for Instagram sharing)
    /// never attaches its source view to a real window -- and a `ScrollView`
    /// backed by `UIScrollView` renders as entirely blank when snapshotted
    /// that way (confirmed with an isolated repro: identical row content,
    /// same fixed-height frame, only the `ScrollView` wrapper differed --
    /// live view rendered correctly, the exported image was blank). Live
    /// scrolling has no meaning in a static export anyway, so the snapshot
    /// path swaps in a plain `VStack` (still bounded by the parent's fixed
    /// height + `.clipped()`) instead of trying to work around the
    /// limitation. See the same fix on `TasteMapView` and `SceneCanonContent`.
    @Environment(\.isTasteShareSnapshot) private var isTasteShareSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Spacer()
                HStack(spacing: 5) {
                    Circle().fill(Color.sjBlue).frame(width: 11, height: 11)
                    Text("You").font(.jakarta(13)).foregroundStyle(Color.sjMuted)
                }
                HStack(spacing: 5) {
                    Circle().fill(Color.sjMuted.opacity(0.5)).frame(width: 11, height: 11)
                    Text("Community").font(.jakarta(13)).foregroundStyle(Color.sjMuted)
                }
            }
            DumbbellAxisView()

            Group {
                if isTasteShareSnapshot {
                    cardStack
                } else {
                    ScrollView(.vertical) {
                        cardStack
                    }
                    .scrollIndicators(.hidden)
                }
            }
            .frame(maxHeight: .infinity)
        }
    }

    private var cardStack: some View {
        VStack(spacing: 12) {
            ForEach(Array(standings.enumerated()), id: \.offset) { _, s in
                card(s)
            }
        }
    }

    @ViewBuilder
    private func card(_ s: TasteProfileResponse.GenreStandingRow) -> some View {
        let diff = s.userAvg - s.communityAvg
        VStack(alignment: .leading, spacing: 14) {
            Text(s.genre)
                .font(.jakarta(22, weight: .black))
                .foregroundStyle(Color.sjInk)
            HStack(spacing: 4) {
                Image(diff >= 0 ? "icon-arrow-up" : "icon-arrow-down")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 11, height: 11)
                Text("\(String(format: "%.2f", abs(diff))) \(diff >= 0 ? String(localized: "above average") : String(localized: "below average"))")
                    .font(.jakarta(14, weight: .semibold))
            }
            .foregroundStyle(diff >= 0 ? Color.sjBlue : Color.sjMuted)
            DumbbellView(user: s.userAvg, community: s.communityAvg)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.sjBorder.opacity(0.6), lineWidth: 1))
        .padding(.horizontal, 2)
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

    @Environment(\.isTasteShareSnapshot) private var isTasteShareSnapshot
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
            .scaleEffect(x: (grown || isTasteShareSnapshot) ? 1 : 0, anchor: .leading)
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
                    .frame(width: 14, height: 14)
                    .overlay(Circle().stroke(Color.sjSurface, lineWidth: 2))
                    .position(x: c, y: geo.size.height / 2)
                Circle().fill(Color.sjBlue)
                    .frame(width: 14, height: 14)
                    .overlay(Circle().stroke(Color.sjSurface, lineWidth: 2))
                    .position(x: u, y: geo.size.height / 2)
                if showTip {
                    BinTooltip(text: "\(String(localized: "You")) \(String(format: "%.2f", user)) · \(String(localized: "Community")) \(String(format: "%.2f", community))")
                        .position(x: min(max(mid, 44), w - 44), y: -14)
                }
            }
            .contentShape(Rectangle())
            .onTapGesture {
                Haptics.selection()
                showTip.toggle()
            }
        }
        .frame(height: 22)
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
                    .font(.jakarta(12))
                    .monospacedDigit()
                    .foregroundStyle(Color.sjMuted.opacity(0.6))
                    .position(x: geo.size.width * pos(Double(v)), y: 8)
            }
        }
        .frame(height: 16)
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

/// Tap-to-reveal gesture over `count` equal-width bins spanning `width` --
/// touch equivalent of web's pointer-hover `useBinHover`. Tapping a bin shows
/// its tooltip; tapping the same one again hides it; tapping a different one
/// switches to it.
///
/// Was a `DragGesture`-based press-and-drag-to-scrub (live preview while
/// dragging across bins). Even direction-gated -- `minimumDistance: 10` +
/// only updating `hover` once horizontal translation dominated vertical,
/// the same fix already proven on `HallOfFameView`'s ring -- it still
/// swallowed some intended page-swipes: that gating only controls what this
/// gesture's *callback* does, not whether the `DragGesture` itself engages
/// and competes for the touch in the first place, which happens the moment
/// total movement crosses `minimumDistance` regardless of direction.
/// Confirmed live still too unreliable ("swiping on top of the chart
/// doesn't recognize it as a swipe"). A `SpatialTapGesture` sidesteps the
/// whole class of conflict -- a tap has no press-and-move recognition phase
/// to race a pan/swipe gesture over in the first place, so every part of
/// these charts is reliably swipeable now, tap-to-reveal or not. Trade-off
/// confirmed with the user: no more live drag-across-bins preview, just
/// tap each bin individually.
private func binTapGesture(count: Int, width: CGFloat, hover: Binding<Int?>) -> some Gesture {
    SpatialTapGesture()
        .onEnded { value in
            guard count > 0, width > 0 else { return }
            let i = min(count - 1, max(0, Int((value.location.x / width) * CGFloat(count))))
            hover.wrappedValue = (hover.wrappedValue == i) ? nil : i
        }
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
                .simultaneousGesture(binTapGesture(count: years.count, width: geo.size.width, hover: $hover))
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

    @Environment(\.isTasteShareSnapshot) private var isTasteShareSnapshot
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
                                            .scaleEffect(y: (grown || isTasteShareSnapshot) ? 1 : 0, anchor: .bottom)
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
                    .simultaneousGesture(binTapGesture(count: bins.count, width: geo.size.width, hover: $hover))
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
            Circle().stroke(Color.sjBlue.opacity(0.12), lineWidth: 13)
            Circle()
                .trim(from: 0, to: animatedPct)
                .stroke(Color.sjBlue, style: StrokeStyle(lineWidth: 13, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 4) {
                Text("\(Int((pct * 100).rounded()))%")
                    .font(.jakarta(34, weight: .black))
                    .monospacedDigit()
                    .foregroundStyle(Color.sjInk)
                Text(label)
                    .font(.jakarta(11, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 10)
            }
        }
        .frame(width: 180, height: 180)
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

    @Environment(\.isTasteShareSnapshot) private var isTasteShareSnapshot
    @State private var hover: Int? = nil
    @State private var grown = UIAccessibility.isReduceMotionEnabled

    private var maxCount: Int { max(1, timeline.map(\.count).max() ?? 1) }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                HStack(alignment: .bottom, spacing: 2) {
                    ForEach(Array(timeline.enumerated()), id: \.offset) { i, m in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(i == peakIndex ? Color.sjBlue : (hover == i ? Color.sjBlue.opacity(0.6) : Color.sjBorder))
                            .frame(height: max(3, CGFloat(m.count) / CGFloat(maxCount) * 52))
                            .frame(maxWidth: .infinity)
                            .scaleEffect(y: (grown || isTasteShareSnapshot) ? 1 : 0, anchor: .bottom)
                            .animation(.timingCurve(0.22, 0.61, 0.36, 1, duration: 0.7).delay(Double(i) * 0.03), value: grown)
                    }
                }
                .frame(height: 52, alignment: .bottom)
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
            .simultaneousGesture(binTapGesture(count: timeline.count, width: geo.size.width, hover: $hover))
        }
        .frame(height: 52)
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

/// Mobile port of web's rotating 3D "hall of fame" ring for albums tied at
/// the user's top score. Web spins a real CSS `perspective`/`rotateY` ring
/// where several covers are visible at once, tilted and dimmed by distance
/// from the front; this reproduces that same geometry natively with
/// `rotation3DEffect` + a manually computed arc position per card (SwiftUI
/// has no direct equivalent of "rotate a group, then counter-rotate each
/// child" the way nested CSS transforms do, so each card's angle is computed
/// directly as `(index - turn) * stepDegrees` instead). `turn` is continuous
/// (not integer-snapped) during an active drag for 1:1 finger tracking, then
/// eases to the nearest whole step on release -- same idea as web's
/// monotonic `turn` counter, which is also what makes wrapping past the last
/// album continue smoothly into the first rather than bouncing at an edge.
/// A single top album renders as one static, non-orbiting card, mirroring
/// web's `n === 1` branch.
private struct HallOfFameView: View {
    let albums: [TasteProfileResponse.TasteTopAlbum]
    let score: Double

    private var n: Int { albums.count }
    private let cover: CGFloat = 208
    private var stepDeg: Double { n > 0 ? 360.0 / Double(n) : 0 }
    // Radius so neighbouring covers don't collide -- same formula as web's,
    // just working in points instead of px and scaled to `cover`'s size.
    private var radius: CGFloat {
        guard n > 1 else { return 0 }
        return max(148, cover / 2 / CGFloat(tan(Double.pi / Double(n))) + 20)
    }
    private let dragPxPerStep: CGFloat = 70

    @State private var turn: Double = 0
    @State private var dragStartTurn: Double = 0
    @State private var isDragging = false
    @State private var autoRotateTask: Task<Void, Never>?
    @State private var floated = false

    /// `turn` folded onto `albums` and rounded to the nearest whole step --
    /// what the dots/meta/front-card-highlight all read as "current", even
    /// while `turn` itself is mid-drag and fractional.
    private var activeIndex: Int {
        guard n > 0 else { return 0 }
        let r = Int(turn.rounded())
        return ((r % n) + n) % n
    }
    private var front: TasteProfileResponse.TasteTopAlbum { albums[min(activeIndex, max(n - 1, 0))] }

    var body: some View {
        VStack(spacing: 10) {
            Text("Your #1 Album")
                .font(.jakarta(10, weight: .black))
                .kerning(1)
                .textCase(.uppercase)
                .foregroundStyle(Color.sjBlue.opacity(0.7))
                .frame(maxWidth: .infinity, alignment: .leading)

            if n == 1 {
                coverArt(albums[0], frontAmount: 1)
                    .frame(width: cover, height: cover)
                    .offset(y: floated ? -7 : 0)
                    .onAppear {
                        guard !UIAccessibility.isReduceMotionEnabled else { return }
                        withAnimation(.easeInOut(duration: 2.75).repeatForever(autoreverses: true)) {
                            floated = true
                        }
                    }
            } else {
                ZStack {
                    ForEach(Array(albums.enumerated()), id: \.element.id) { i, album in
                        ringCard(album, index: i)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: cover + 24)
                .clipped()
                .contentShape(Rectangle())
                .simultaneousGesture(dragGesture)
                .onAppear { restartAutoRotate() }
                .onDisappear { autoRotateTask?.cancel() }
                .onChange(of: activeIndex) { old, new in
                    guard old != new else { return }
                    Haptics.light()
                }

                // Tappable, like web's dots (jump straight to that album) --
                // previously purely decorative here.
                HStack(spacing: 5) {
                    ForEach(albums.indices, id: \.self) { i in
                        Button {
                            goTo(i)
                        } label: {
                            Capsule()
                                .fill(i == activeIndex ? Color.sjBlue : Color.sjMuted.opacity(0.35))
                                .frame(width: i == activeIndex ? 16 : 6, height: 6)
                                .animation(.easeOut(duration: 0.25), value: activeIndex)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(albums[i].title)
                    }
                }

                Text(String(format: String(localized: "%1$d albums tied at %2$@"), n, String(format: "%.1f", score)))
                    .font(.jakarta(11))
                    .foregroundStyle(Color.sjMuted)
            }

            // Front album's meta -- a single shared block below the ring/card
            // (not per-card) that swaps content as the front album changes,
            // same structure as web's.
            VStack(spacing: 2) {
                Text(front.title)
                    .font(.jakarta(14, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                Text(front.artist)
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
                Text(String(format: "%.1f", front.score))
                    .font(.jakarta(14, weight: .black))
                    .foregroundStyle(Spectrum.number(front.score))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 3)
                    .background(Spectrum.fill(front.score))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .padding(.top, 2)
            }
            .id(front.id)
            .transition(.opacity)
            .animation(.easeOut(duration: 0.25), value: front.id)
            .frame(maxWidth: 240)
            .padding(.top, n == 1 ? 10 : 2)
        }
    }

    /// One cover positioned on the ring: `theta` is its angle relative to
    /// the current front (`(index - turn) * stepDeg`), which drives both its
    /// arc position (`sin`) and its own facing tilt (`rotation3DEffect`) --
    /// together these read as a card mounted on a slowly spinning drum, the
    /// same illusion web's nested `rotateY`/`translateZ` transforms create.
    /// Depth (`cos`) drives scale/z-order *and* opacity/brightness/border
    /// falloff -- continuous functions of `depth`, not the discrete "is this
    /// the front card" boolean an earlier version used (that caused its own
    /// glitch: those properties snapping instantly at the transition's
    /// halfway point). Live feedback after that fix: the edge-on moment
    /// (`depth ≈ 0`, where `rotation3DEffect` alone already renders a card
    /// near zero-width) was *still* visible as a stray vertical line,
    /// because `frontAmount`'s old floor kept every off-front card at a
    /// minimum 22% opacity -- including right at its thinnest. `frontAmount`
    /// cubed pushes opacity to (imperceptibly close to) zero well before a
    /// card reaches edge-on, so only the current "spotlight" cover -- and
    /// whichever neighbor is actively swinging into or out of it -- are
    /// ever visibly on screen, matching the ask directly: the rest are
    /// effectively invisible, not just dimmed.
    @ViewBuilder
    private func ringCard(_ album: TasteProfileResponse.TasteTopAlbum, index: Int) -> some View {
        let theta = (Double(index) - turn) * stepDeg
        let rad = theta * .pi / 180
        let depth = cos(rad)                    // 1 at front, -1 at the far back -- continuous
        let xOffset = CGFloat(sin(rad)) * radius
        let frontAmount = max(0, depth)          // 0...1, continuous "how front-facing"
        let spotlight = frontAmount * frontAmount * frontAmount // steep falloff -- invisible well before edge-on
        let scale = 0.62 + 0.38 * ((depth + 1) / 2)
        let opacity = spotlight
        let dim = -(0.45 * (1 - spotlight))

        coverArt(album, frontAmount: spotlight)
            .frame(width: cover, height: cover)
            .rotation3DEffect(.degrees(theta), axis: (x: 0, y: 1, z: 0), perspective: 0.3)
            .scaleEffect(scale)
            .opacity(opacity)
            .brightness(dim)
            .offset(x: xOffset)
            .zIndex(depth)
    }

    /// Horizontal-only, and attached with `.simultaneousGesture` (not plain
    /// `.gesture`) -- this ring now lives on a page inside a *vertically*
    /// paging `ScrollView`, and a bare `DragGesture` with no axis check would
    /// compete with (and could win against) that ancestor's own pan gesture
    /// for any touch that starts inside the ring's `cover+24`-tall hit box,
    /// stalling the page-swipe. Web sidesteps the same conflict with CSS
    /// `touch-action: pan-y` on the ring wrapper (`page.tsx`'s `HallOfFame`),
    /// which has no SwiftUI `DragGesture` equivalent -- reproduced here by
    /// (1) `simultaneousGesture` so this never exclusively claims the touch
    /// away from the ScrollView, and (2) only reacting once the drag's
    /// horizontal component dominates its vertical one, so an intended
    /// vertical page-swipe that happens to start over the ring never spins it.
    /// `minimumDistance: 10`, not the ~4pt SwiftUI default -- live feedback
    /// was that swiping still felt off after the axis check alone; a wider
    /// margin gives a vertical swipe more room to declare itself unambiguous
    /// before this gesture engages at all, rather than engaging almost
    /// immediately and relying purely on the per-frame axis guard below.
    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                if !isDragging {
                    isDragging = true
                    dragStartTurn = turn
                    autoRotateTask?.cancel() // don't fight an active drag
                }
                // Continuous, not step-quantized -- tracks the finger 1:1 rather
                // than jumping a whole cover per fixed pixel distance. Clamped to
                // ±1 step from where the drag started so one swipe can only ever
                // advance a single album, no matter how far the finger travels --
                // unclamped, a swipe covering several multiples of dragPxPerStep
                // spun straight through multiple covers in one gesture (confirmed
                // live -- "goes around the carousel multiple times" on a long swipe).
                let raw = dragStartTurn - Double(value.translation.width) / Double(dragPxPerStep)
                turn = min(dragStartTurn + 1, max(dragStartTurn - 1, raw))
            }
            .onEnded { _ in
                guard isDragging else { return }
                isDragging = false
                withAnimation(.spring(response: 0.45, dampingFraction: 0.82)) {
                    turn = turn.rounded()
                }
                restartAutoRotate()
            }
    }

    /// Jump straight to album `i` (dot tap) by the shortest signed path, then
    /// restart the auto-rotate timer from zero -- otherwise a tap right
    /// before the next auto-tick could get immediately overridden, same
    /// reasoning as web's `resetKey`.
    private func goTo(_ i: Int) {
        guard albums.indices.contains(i), n > 0 else { return }
        let cur = activeIndex
        var d = ((i - cur) % n + n) % n
        if d > n / 2 { d -= n }
        withAnimation(.spring(response: 0.5, dampingFraction: 0.85)) {
            turn += Double(d)
        }
        restartAutoRotate()
    }

    private func restartAutoRotate() {
        autoRotateTask?.cancel()
        autoRotateTask = Task { await autoRotate() }
    }

    /// Auto-advances through the tied albums every 3.4s, same cadence as
    /// web's `HallOfFame` ring -- structured-concurrency equivalent of its
    /// `setInterval`, restarted (not just left running) on manual interaction
    /// via `restartAutoRotate()`, and stopped when the view disappears.
    /// Off under Reduce Motion, matching web's `usePrefersReducedMotion` gate.
    private func autoRotate() async {
        guard !UIAccessibility.isReduceMotionEnabled, n > 1 else { return }
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(3.4))
            guard !Task.isCancelled else { return }
            withAnimation(.spring(response: 0.6, dampingFraction: 0.85)) {
                turn += 1
            }
        }
    }

    /// `frontAmount` (0...1, continuous) replaces an earlier plain `isFront`
    /// boolean for the same reason as `ringCard`'s own switch to continuous
    /// values -- a hard on/off border and shadow here were popping in sync
    /// with that same discrete flip. The shadow was also toned down
    /// outright, not just made continuous: live feedback was that even its
    /// old *resting* value on back covers ("a grey border beneath the
    /// album cover") read as an unwanted border rather than a depth cue.
    @ViewBuilder
    private func coverArt(_ album: TasteProfileResponse.TasteTopAlbum, frontAmount: Double) -> some View {
        Group {
            if let s = album.coverUrl, let url = URL(string: s) {
                CachedImage(url: url) { Color.sjBorder }
                    .scaledToFill()
            } else {
                Color.sjBorder
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.sjBlue.opacity(0.4 * frontAmount), lineWidth: 2)
        )
        .shadow(color: .black.opacity(0.04 + 0.10 * frontAmount), radius: 3 + 5 * frontAmount, y: 1 + 2 * frontAmount)
    }
}

private struct StatTileView<Content: View>: View {
    let value: String
    let label: String
    /// Explanation of what the stat means -- web's hover tooltip ported as a
    /// tap-to-reveal disclosure instead, since touch has no hover.
    var tip: String? = nil
    @ViewBuilder var content: Content

    @State private var showTip = false

    init(value: String, label: String, tip: String? = nil, @ViewBuilder content: () -> Content = { EmptyView() }) {
        self.value = value
        self.label = label
        self.tip = tip
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(value)
                    .font(.jakarta(28, weight: .black))
                    .foregroundStyle(Color.sjInk)
                if tip != nil {
                    Spacer(minLength: 0)
                    Button {
                        Haptics.selection()
                        withAnimation(.easeOut(duration: 0.15)) { showTip.toggle() }
                    } label: {
                        Image(systemName: "info.circle")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.sjMuted.opacity(0.55))
                    }
                    .buttonStyle(.plain)
                }
            }
            Text(label)
                .font(.jakarta(12.5))
                .foregroundStyle(Color.sjMuted)
            content
            if showTip, let tip {
                Text(tip)
                    .font(.jakarta(10.5))
                    .foregroundStyle(Color.sjMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.vertical, 22)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.sjBorder.opacity(0.6), lineWidth: 1))
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
                    Button(action: {
                        Haptics.light()
                        onGoToAdd()
                    }) {
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
