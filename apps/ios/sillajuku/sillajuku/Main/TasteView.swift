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

    var isUnlocked: Bool { ratingCount >= Self.unlockThreshold }
    var remaining: Int   { max(0, Self.unlockThreshold - ratingCount) }

    private func fetchCount(table: String, userId: UUID) async -> Int? {
        (try? await supabase.from(table)
            .select("*", head: true, count: .exact).eq("user_id", value: userId).execute())?.count
    }

    func load() async {
        guard let user = supabase.auth.currentUser else { isLoading = false; return }
        isLoading = true
        loadFailed = false

        // Cheap counts only, just to decide the unlock gate -- matching ProfileView's
        // `totalRatings` so the unlock progress agrees with the "Rated" stat on the profile.
        // The report itself comes from web's own /api/taste/profile (one algorithm, one
        // source of truth).
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
            // No refresh=1: that skips the route's cache on every load, forcing a full
            // recomputation per visit -- the exact Vercel-CPU bug fixed on web 2026-07-15.
            report = await WebAPI.get("/api/taste/profile", authed: true)
        }

        isLoading = false
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
                } else if vm.loadFailed {
                    tasteFailed
                } else if !vm.isUnlocked {
                    TasteLockView(ratingCount: vm.ratingCount, onGoToAdd: onGoToAdd)
                } else if let report = vm.report {
                    TasteReportView(report: report)
                } else {
                    TasteLockView(ratingCount: vm.ratingCount, onGoToAdd: onGoToAdd)
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

    private var tasteFailed: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "wifi.slash")
                    .font(.system(size: 36))
                    .foregroundStyle(Color.sjBorder)
                Text("Couldn't load your taste progress.")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
                Button("Retry") { Task { await vm.load() } }
                    .font(.system(size: 14, weight: .semibold))
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

    private var stats: TasteProfileResponse.TasteStats { report.stats }
    private var charts: TasteProfileResponse.TasteCharts { report.charts }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 16) {
                headerCard
                if !report.clusters.isEmpty { territoryCard }
                ForEach(Array(report.clusters.enumerated()), id: \.offset) { i, world in
                    WorldCard(world: world, color: TasteViz.color(i), overallAvg: stats.avgScore)
                }
                if !charts.decades.isEmpty, stats.meanYear != nil { decadeCard }
                if charts.scoreDist.reduce(0, +) > 0, stats.avgScore != nil { scoreCard }
                if charts.scenes != nil { sceneCard }
                canonCard
                statsCard
                if !report.standings.isEmpty { standingsCard }
                if !report.disliked.isEmpty { dislikedCard }
                Text("That's your taste snapshot.")
                    .font(.system(size: 11.5))
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

    // ── Header ──

    private func worldName(_ w: TasteProfileResponse.TasteWorld) -> String {
        if w.tags.count > 1 { return "\(w.tags[0].display) × \(w.tags[1].display)" }
        return w.tags.first?.display ?? ""
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Taste Report")
                .font(.system(size: 10, weight: .black))
                .kerning(1.2)
                .textCase(.uppercase)
                .foregroundStyle(Color.sjBlue.opacity(0.7))
            Text(report.clusters.count >= 2
                 ? String(format: String(localized: "Your taste lives in\n%d worlds."), report.clusters.count)
                 : String(localized: "Your taste lives in\none world."))
                .font(.system(size: 24, weight: .black))
                .foregroundStyle(Color.sjInk)
                .padding(.top, 8)
            Text(String(format: String(localized: "Based on %1$d ratings across %2$d genres, analyzed into %3$d worlds."),
                        report.ratingCount, report.totalTags, report.clusters.count))
                .font(.system(size: 12.5))
                .foregroundStyle(Color.sjMuted)
                .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
        .background(Color.sjBlue.opacity(0.07))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.sjBlue.opacity(0.15), lineWidth: 1))
    }

    // ── Territory ──

    private var territoryCard: some View {
        ReportCard {
            CardTitle(String(localized: "Your taste, as territory"))
            CardSub(String(localized: "Each bubble is a world you rate in — bigger means more of your taste."))
            TasteTerritoryView(
                worlds: report.clusters.enumerated().map { i, w in
                    .init(share: w.share, primary: w.tags.first?.display ?? "",
                          full: worldName(w), color: TasteViz.color(i))
                }
            )
        }
    }

    // ── Decades ──

    private var decadeCard: some View {
        let decades = charts.decades
        let span = decades.count > 0 ? decades[decades.count - 1].decade + 10 - decades[0].decade : 0
        let peak = decades.indices.max(by: { decades[$0].count < decades[$1].count }) ?? 0
        let sd = Int((stats.sdYears ?? 0).rounded())
        let text = (stats.sdYears ?? 0) >= 12
            ? String(format: String(localized: "Your library centers on %1$d, but spans ±%2$d years — you roam freely across eras."), stats.meanYear ?? 0, sd)
            : String(format: String(localized: "Your library centers on %1$d and stays close (±%2$d years) — you know your era."), stats.meanYear ?? 0, sd)
        return ReportCard {
            CardTitle(String(localized: "Across the decades"))
            CardSub(text)
            ColumnChartView(
                bins: decades.map(\.count),
                xLabels: decades.enumerated().map { i, d in
                    decades.count <= 7 || i % 2 == 0 ? String(d.decade) : nil
                },
                peakIndex: peak,
                mean: span > 0 && stats.meanYear != nil
                    ? (pos: Double((stats.meanYear ?? 0) - decades[0].decade) / Double(span),
                       label: "\(String(localized: "avg")) \(stats.meanYear ?? 0)")
                    : nil
            )
        }
    }

    // ── Score distribution ──

    private var scoreCard: some View {
        let dist = charts.scoreDist
        let peak = dist.indices.max(by: { dist[$0] < dist[$1] }) ?? 0
        let avg = stats.avgScore ?? 0
        let sd = stats.sdScore ?? 0
        let text = sd >= 0.9
            ? String(format: String(localized: "You average %1$@ but use the whole scale (±%2$@) — scores from you are earned."),
                     String(format: "%.2f", avg), String(format: "%.2f", sd))
            : String(format: String(localized: "You average %1$@ within a tight ±%2$@ band — a consistent, predictable scorer."),
                     String(format: "%.2f", avg), String(format: "%.2f", sd))
        return ReportCard {
            CardTitle(String(localized: "How you score"))
            CardSub(text)
            ColumnChartView(
                bins: dist,
                xLabels: dist.indices.map { $0 % 2 == 1 ? String(format: "%g", Double($0 + 1) / 2) : nil },
                peakIndex: peak,
                mean: (pos: (avg - 0.25) / 5, label: "\(String(localized: "avg")) \(String(format: "%.2f", avg))")
            )
        }
    }

    // ── Scene mix ──

    private var sceneCard: some View {
        let shares = TasteViz.sceneShares(charts.scenes)
        let lead = shares.max(by: { $0.share < $1.share })
        return ReportCard {
            CardTitle(String(localized: "Where your music comes from"))
            if let lead {
                CardSub(String(format: String(localized: "Your biggest source is the %1$@, at %2$d%% of what you rate."),
                               lead.label, Int((lead.share * 100).rounded())))
            }
            StackedBarView(segments: shares.map { (share: $0.share, color: $0.color) })
                .padding(.top, 12)

            // Legend
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(shares.enumerated()), id: \.offset) { _, s in
                    HStack(spacing: 6) {
                        Circle().fill(s.color).frame(width: 10, height: 10)
                        Text(s.label)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                        Text("\(Int((s.share * 100).rounded()))%")
                            .font(.system(size: 12))
                            .monospacedDigit()
                            .foregroundStyle(Color.sjMuted)
                    }
                }
            }
            .padding(.top, 10)
        }
    }

    // ── Canon reach ──

    private var canonCard: some View {
        let pct = Int(((stats.prestigeShare ?? 0) * 100).rounded())
        return ReportCard {
            CardTitle(String(localized: "Canon reach"))
            Text("\(pct)%")
                .font(.system(size: 28, weight: .black))
                .foregroundStyle(Color.sjInk)
                .padding(.top, 10)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.sjBlue.opacity(0.12))
                    Capsule().fill(Color.sjBlue)
                        .frame(width: geo.size.width * CGFloat(min(1, stats.prestigeShare ?? 0)))
                }
            }
            .frame(height: 10)
            .padding(.top, 10)
            CardSub(String(format: String(localized: "%d%% of what you rate sits in the curated canon; the rest is your own discovery."), pct))
        }
    }

    // ── Stats ──

    private var statsCard: some View {
        ReportCard {
            CardTitle(String(localized: "By the numbers"))
            if let top = report.topAlbum {
                HStack(spacing: 14) {
                    Group {
                        if let s = top.coverUrl, let url = URL(string: s) {
                            CachedImage(url: url) { Color.sjBorder }
                                .scaledToFill()
                        } else {
                            Color.sjBorder
                        }
                    }
                    .frame(width: 88, height: 88)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Your #1 Album")
                            .font(.system(size: 10, weight: .black))
                            .kerning(1)
                            .textCase(.uppercase)
                            .foregroundStyle(Color.sjBlue.opacity(0.7))
                        Text(top.title)
                            .font(.system(size: 13.5, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(2)
                        Text(top.artist)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)
                        Text(String(format: "%.1f", top.score))
                            .font(.system(size: 15, weight: .black))
                            .foregroundStyle(Color.sjBlue)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.top, 12)
            }
            let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
            LazyVGrid(columns: columns, spacing: 10) {
                StatTileView(value: "\(report.ratingCount)", label: String(localized: "ratings"))
                StatTileView(
                    value: stats.avgScore.map { String(format: "%.2f", $0) } ?? "—",
                    label: stats.sdScore.map { "\(String(localized: "average score")) (±\(String(format: "%.2f", $0)))" }
                        ?? String(localized: "average score")
                )
                StatTileView(value: "\(stats.fiveStars)", label: String(localized: "perfect scores"))
                StatTileView(value: peakMonthName ?? "—", label: String(localized: "peak month")) {
                    timelineSparkline
                }
            }
            .padding(.top, 12)
        }
    }

    private var peakMonthName: String? {
        guard let i = charts.peakMonthIndex, charts.timeline.indices.contains(i) else { return nil }
        let month = Int(charts.timeline[i].month.suffix(2)) ?? 1
        var comps = DateComponents(); comps.month = month
        let date = Calendar.current.date(from: comps) ?? Date()
        let fmt = DateFormatter(); fmt.dateFormat = "MMM"
        return fmt.string(from: date)
    }

    private var timelineSparkline: some View {
        let maxCount = max(1, charts.timeline.map(\.count).max() ?? 1)
        return HStack(alignment: .bottom, spacing: 2) {
            ForEach(Array(charts.timeline.enumerated()), id: \.offset) { i, m in
                RoundedRectangle(cornerRadius: 1)
                    .fill(i == charts.peakMonthIndex ? Color.sjBlue : Color.sjBorder)
                    .frame(height: max(2, CGFloat(m.count) / CGFloat(maxCount) * 24))
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: 24, alignment: .bottom)
        .padding(.top, 4)
    }

    // ── Standings ──

    private var standingsCard: some View {
        ReportCard {
            HStack(alignment: .firstTextBaseline) {
                CardTitle(String(localized: "You vs the community"))
                Spacer()
                HStack(spacing: 10) {
                    HStack(spacing: 4) {
                        Circle().fill(Color.sjBlue).frame(width: 9, height: 9)
                        Text("You").font(.system(size: 11)).foregroundStyle(Color.sjMuted)
                    }
                    HStack(spacing: 4) {
                        Circle().fill(Color.sjMuted.opacity(0.5)).frame(width: 9, height: 9)
                        Text("Community").font(.system(size: 11)).foregroundStyle(Color.sjMuted)
                    }
                }
            }
            VStack(spacing: 16) {
                ForEach(Array(report.standings.enumerated()), id: \.offset) { _, s in
                    let diff = s.userAvg - s.communityAvg
                    VStack(spacing: 6) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(s.genre)
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(Color.sjInk)
                            Spacer()
                            HStack(spacing: 3) {
                                Image(systemName: diff >= 0 ? "arrow.up" : "arrow.down")
                                    .font(.system(size: 9, weight: .bold))
                                Text("\(String(format: "%.2f", abs(diff))) \(diff >= 0 ? String(localized: "above average") : String(localized: "below average"))")
                                    .font(.system(size: 11.5, weight: .semibold))
                            }
                            .foregroundStyle(diff >= 0 ? Color.sjBlue : Color.sjMuted)
                        }
                        DumbbellView(user: s.userAvg, community: s.communityAvg)
                    }
                }
            }
            .padding(.top, 14)
        }
    }

    // ── Disliked ──

    private var dislikedCard: some View {
        ReportCard {
            CardTitle(String(localized: "Not your thing"))
            FlowChips(items: report.disliked.map(\.display))
                .padding(.top, 10)
        }
    }
}

// MARK: - World card

private struct WorldCard: View {
    let world: TasteProfileResponse.TasteWorld
    let color: Color
    let overallAvg: Double?

    private var name: String {
        if world.tags.count > 1 { return "\(world.tags[0].display) × \(world.tags[1].display)" }
        return world.tags.first?.display ?? ""
    }

    private var classification: String {
        var parts: [String] = []
        if let meanYear = world.meanYear {
            let decade = Int(meanYear / 10) * 10
            parts.append((world.sdYears ?? 0) >= 12
                ? String(localized: "across decades")
                : String(format: String(localized: "mostly %ds"), decade))
        }
        parts.append(TasteViz.sceneLabel(world.dominantScene))
        return parts.joined(separator: " · ")
    }

    private var avgLine: String? {
        guard let avg = world.avgScore else { return nil }
        var line = String(format: String(localized: "You rate this world %@ on average —"), String(format: "%.2f", avg))
        if let overall = overallAvg {
            let diff = avg - overall
            if abs(diff) < 0.1 {
                line += " " + String(localized: "right at your usual level.")
            } else if diff > 0 {
                line += " " + String(format: String(localized: "%@ above your usual."), String(format: "%.2f", abs(diff)))
            } else {
                line += " " + String(format: String(localized: "%@ below your usual."), String(format: "%.2f", abs(diff)))
            }
        }
        return line
    }

    var body: some View {
        ReportCard {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 8) {
                    Circle().fill(color).frame(width: 10, height: 10)
                    Text(name)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                }
                Spacer()
                Text(String(format: String(localized: "%d%% of your taste"), Int((world.share * 100).rounded())))
                    .font(.system(size: 12, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Color.sjMuted)
            }
            Text(classification)
                .font(.system(size: 11.5, weight: .semibold))
                .kerning(0.3)
                .foregroundStyle(Color.sjMuted.opacity(0.8))
                .padding(.top, 3)
            if let avgLine {
                Text(avgLine)
                    .font(.system(size: 12.5))
                    .foregroundStyle(Color.sjMuted)
                    .padding(.top, 3)
            }
            Text("Sub-genres")
                .font(.system(size: 10, weight: .bold))
                .kerning(0.8)
                .textCase(.uppercase)
                .foregroundStyle(Color.sjMuted.opacity(0.6))
                .padding(.top, 12)
            VStack(spacing: 6) {
                ForEach(Array(world.tags.enumerated()), id: \.offset) { _, tag in
                    HStack(spacing: 10) {
                        Text(tag.display)
                            .font(.system(size: 11.5))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)
                            .frame(width: 110, alignment: .trailing)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.sjBorder.opacity(0.6))
                                Capsule().fill(color)
                                    .frame(width: geo.size.width * CGFloat(tag.avg / 5))
                            }
                        }
                        .frame(height: 6)
                        Text(String(format: "%.1f", tag.avg))
                            .font(.system(size: 11.5, weight: .bold))
                            .monospacedDigit()
                            .foregroundStyle(Color.sjInk)
                            .frame(width: 28, alignment: .leading)
                    }
                }
            }
            .padding(.top, 8)
        }
    }
}

// MARK: - Territory (packed bubbles)

private struct TasteTerritoryView: View {
    struct World {
        let share: Double
        let primary: String
        let full: String
        let color: Color
    }

    let worlds: [World]

    /// Greedy circle packing, a direct port of web's `packCircles`: largest at
    /// the centre, each next at the free tangent spot closest to the centre.
    /// Deterministic — same shares in, same layout out.
    private struct Placed {
        let index: Int
        let r: CGFloat
        let x: CGFloat
        let y: CGFloat
    }

    private var layout: (placed: [Placed], bounds: CGRect) {
        let items = worlds.enumerated()
            .map { (index: $0.offset, r: CGFloat(sqrt(max($0.element.share, 0.0001)) * 100)) }
            .sorted { $0.r > $1.r }
        var placed: [Placed] = []
        let eps: CGFloat = 0.5
        func overlaps(_ x: CGFloat, _ y: CGFloat, _ r: CGFloat) -> Bool {
            placed.contains { hypot($0.x - x, $0.y - y) < $0.r + r - eps }
        }
        for (i, item) in items.enumerated() {
            if i == 0 {
                placed.append(Placed(index: item.index, r: item.r, x: 0, y: 0))
                continue
            }
            var best: (x: CGFloat, y: CGFloat, d: CGFloat)? = nil
            for p in placed {
                let ring = p.r + item.r
                for a in stride(from: 0, to: 360, by: 6) {
                    let rad = CGFloat(a) * .pi / 180
                    let x = p.x + ring * cos(rad)
                    let y = p.y + ring * sin(rad)
                    if overlaps(x, y, item.r) { continue }
                    let d = hypot(x, y)
                    if best == nil || d < best!.d { best = (x, y, d) }
                }
            }
            placed.append(Placed(index: item.index, r: item.r, x: best?.x ?? 0, y: best?.y ?? 0))
        }
        var minX: CGFloat = .infinity, minY: CGFloat = .infinity
        var maxX: CGFloat = -.infinity, maxY: CGFloat = -.infinity
        for p in placed {
            minX = min(minX, p.x - p.r); minY = min(minY, p.y - p.r)
            maxX = max(maxX, p.x + p.r); maxY = max(maxY, p.y + p.r)
        }
        let pad: CGFloat = 5
        return (placed, CGRect(x: minX - pad, y: minY - pad,
                               width: maxX - minX + pad * 2, height: maxY - minY + pad * 2))
    }

    var body: some View {
        let (placed, bounds) = layout
        VStack(alignment: .leading, spacing: 0) {
            GeometryReader { geo in
                let scale = min(geo.size.width / bounds.width, geo.size.height / bounds.height)
                let offsetX = (geo.size.width - bounds.width * scale) / 2 - bounds.minX * scale
                let offsetY = (geo.size.height - bounds.height * scale) / 2 - bounds.minY * scale
                ZStack {
                    ForEach(placed, id: \.index) { p in
                        let world = worlds[p.index]
                        let r = p.r * scale
                        ZStack {
                            Circle()
                                .fill(world.color)
                                .overlay(Circle().stroke(Color.sjSurface, lineWidth: 2))
                            if r > 26 {
                                VStack(spacing: 1) {
                                    Text(world.primary)
                                        .font(.system(size: min(r * 0.32, 15), weight: .heavy))
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.6)
                                        .padding(.horizontal, 4)
                                    Text("\(Int((world.share * 100).rounded()))%")
                                        .font(.system(size: min(r * 0.3, 13), weight: .heavy))
                                        .opacity(0.9)
                                }
                                .foregroundStyle(.white)
                                .shadow(color: .black.opacity(0.25), radius: 1)
                            } else if r > 11 {
                                Text("\(Int((world.share * 100).rounded()))%")
                                    .font(.system(size: min(r * 0.5, 13), weight: .heavy))
                                    .foregroundStyle(.white)
                                    .shadow(color: .black.opacity(0.25), radius: 1)
                            }
                        }
                        .frame(width: r * 2, height: r * 2)
                        .position(x: p.x * scale + offsetX, y: p.y * scale + offsetY)
                    }
                }
            }
            .frame(height: 260)
            .padding(.top, 12)

            // Legend
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(worlds.enumerated()), id: \.offset) { _, w in
                    HStack(spacing: 6) {
                        Circle().fill(w.color).frame(width: 10, height: 10)
                        Text(w.full)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(1)
                        Text("\(Int((w.share * 100).rounded()))%")
                            .font(.system(size: 12))
                            .monospacedDigit()
                            .foregroundStyle(Color.sjMuted)
                    }
                }
            }
            .padding(.top, 10)
        }
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
                                        .font(.system(size: 10, weight: .semibold))
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
                            .font(.system(size: 10, weight: .semibold))
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
                        .font(.system(size: 10))
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

/// Part-to-whole stacked bar with 2pt gaps.
private struct StackedBarView: View {
    let segments: [(share: Double, color: Color)]

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
        }
        .frame(height: 14)
    }
}

/// You-vs-community dumbbell on a fixed 0.5–5.0 track.
private struct DumbbellView: View {
    let user: Double
    let community: Double

    private func pos(_ v: Double) -> CGFloat {
        CGFloat(min(0.98, max(0.02, (v - 0.5) / 4.5)))
    }

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let u = pos(user) * w
            let c = pos(community) * w
            ZStack {
                Capsule().fill(Color.sjBorder.opacity(0.7))
                    .frame(height: 2)
                Rectangle().fill(Color.sjMuted.opacity(0.4))
                    .frame(width: abs(u - c), height: 2)
                    .position(x: (u + c) / 2, y: geo.size.height / 2)
                Circle().fill(Color.sjMuted.opacity(0.5))
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(Color.sjSurface, lineWidth: 2))
                    .position(x: c, y: geo.size.height / 2)
                Circle().fill(Color.sjBlue)
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(Color.sjSurface, lineWidth: 2))
                    .position(x: u, y: geo.size.height / 2)
            }
        }
        .frame(height: 18)
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
                .font(.system(size: 19, weight: .black))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.system(size: 11))
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
                    .font(.system(size: 12.5))
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
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Color.sjInk)
    }
}

private struct CardSub: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text)
            .font(.system(size: 12.5))
            .foregroundStyle(Color.sjMuted)
            .padding(.top, 4)
            .fixedSize(horizontal: false, vertical: true)
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
