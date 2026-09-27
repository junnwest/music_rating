import SwiftUI
import Supabase

// Ports of two web Taste features (2026-09-26):
//  - the country mix that replaced the kr/jp/west/other scene bar (P8), and
//  - "list the ratings behind a bar" for the year / score / country charts.
// Same rules as web's CountryMix (TasteCharts.tsx) and useMyRatings/BucketList
// (taste/page.tsx), so the two platforms agree on every count.

// MARK: - The user's album ratings, loaded once on first use

struct TasteDrillRating: Identifiable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    let score: Double?
    let year: Int?
    let country: String?

    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl, releaseType: nil, releaseDate: nil,
                titleNative: nil, artistNative: nil, tracklist: nil, totalTracks: nil)
    }
}

@MainActor
@Observable
final class TasteDrillRatings {
    enum State { case idle, loading, failed, ready([TasteDrillRating]) }
    private(set) var state = State.idle

    /// Same buckets as /api/taste/profile: release year from
    /// first_release_date (≥ 1900), the primary artist's country trimmed and
    /// upper-cased (missing = Unknown).
    func loadIfNeeded() async {
        guard case .idle = state, let userId = supabase.auth.currentUser?.id else { return }
        state = .loading
        struct Row: Decodable {
            let score: Double?
            let releaseGroups: RG?
            struct RG: Decodable {
                let id: UUID
                let title: String
                let artistDisplay: String
                let coverUrl: String?
                let firstReleaseDate: String?
                let artists: Artist?
                struct Artist: Decodable { let country: String? }
                enum CodingKeys: String, CodingKey {
                    case id, title, artists
                    case artistDisplay = "artist_display", coverUrl = "cover_url"
                    case firstReleaseDate = "first_release_date"
                }
            }
            enum CodingKeys: String, CodingKey { case score; case releaseGroups = "release_groups" }
        }
        var out: [TasteDrillRating] = []
        var from = 0
        while true {
            let page: [Row]
            do {
                page = try await supabase.from("ratings")
                    .select("score, release_groups(id, title, artist_display, cover_url, first_release_date, artists!release_groups_primary_artist_id_fkey(country))")
                    .eq("user_id", value: userId)
                    .range(from: from, to: from + 999)
                    .execute().value
            } catch {
                print("TasteDrillRatings.load failed: \(error)")
                state = .failed
                return
            }
            for r in page {
                guard let rg = r.releaseGroups else { continue }
                let year = rg.firstReleaseDate.flatMap { Int($0.prefix(4)) }.flatMap { $0 >= 1900 ? $0 : nil }
                let country = rg.artists?.country?.trimmingCharacters(in: .whitespaces).uppercased()
                out.append(TasteDrillRating(id: rg.id, title: rg.title, artist: rg.artistDisplay, coverUrl: rg.coverUrl,
                                            score: r.score, year: year,
                                            country: (country?.isEmpty ?? true) ? nil : country))
            }
            if page.count < 1000 { break }
            from += 1000
        }
        state = .ready(out)
    }
}

/// Half-star bin, same as the report's score distribution (0 = 0.5★ … 9 = 5.0★).
func tasteScoreBin(_ score: Double) -> Int { max(0, min(9, Int((score * 2).rounded()) - 1)) }

/// One bar's worth of ratings.
struct TasteDrillBucket: Identifiable {
    enum Filter {
        case year(Int)
        case scoreBin(Int)
        /// nil = artists with no country ("Unknown").
        case countries([String]?)
    }
    let id = UUID()
    let title: String
    let filter: Filter

    func matches(_ r: TasteDrillRating) -> Bool {
        switch filter {
        case .year(let y):      return r.score != nil && r.year == y
        case .scoreBin(let b):  return r.score.map { tasteScoreBin($0) == b } ?? false
        case .countries(let c): return c.map { codes in r.country.map(codes.contains) ?? false } ?? (r.country == nil)
        }
    }
}

/// "View N ratings ›" -- shown under a chart once a bar is selected.
struct TasteViewRatingsButton: View {
    let count: Int
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(count == 1 ? String(localized: "View 1 rating")
                                : String(format: String(localized: "View %d ratings"), count))
                Image("icon-chevron-right").renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 10, height: 10)
            }
            .font(.jakarta(13, weight: .semibold))
            .foregroundStyle(Color.sjBlue)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(Color.sjBlue.opacity(0.1), in: Capsule())
        }
        .buttonStyle(.plain)
        .transition(.opacity)
    }
}

/// The ratings behind one bar: best first, each opening its album.
struct TasteBucketSheet: View {
    let bucket: TasteDrillBucket
    var store: TasteDrillRatings
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                switch store.state {
                case .idle, .loading:
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                case .failed:
                    message(String(localized: "Couldn't load your ratings. Please try again."))
                case .ready(let rows):
                    let items = rows.filter(bucket.matches).sorted {
                        ($0.score ?? -1, $1.title) > ($1.score ?? -1, $0.title)
                    }
                    if items.isEmpty {
                        message(String(localized: "No ratings here."))
                    } else {
                        List(items) { r in
                            NavigationLink(value: r.asRelease) { row(r) }
                                .listRowBackground(Color.sjSurface)
                        }
                        .listStyle(.plain)
                        .scrollContentBackground(.hidden)
                    }
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
        }
        .task { await store.loadIfNeeded() }
    }

    private var title: String {
        if case .ready(let rows) = store.state {
            let n = rows.filter(bucket.matches).count
            return "\(bucket.title) · " + (n == 1 ? String(localized: "1 rated") : String(format: String(localized: "%d rated"), n))
        }
        return bucket.title
    }

    private func row(_ r: TasteDrillRating) -> some View {
        HStack(spacing: 12) {
            CoverImage(url: r.coverUrl, cornerRadius: 6)
                .frame(width: 44, height: 44)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(r.title).font(.jakarta(14, weight: .semibold)).foregroundStyle(Color.sjInk).lineLimit(1)
                Text(r.year.map { "\(r.artist) · \($0)" } ?? r.artist)
                    .font(.jakarta(12)).foregroundStyle(Color.sjMuted).lineLimit(1)
            }
            Spacer(minLength: 8)
            if let s = r.score { ScoreBadge(score: s, badgeSize: 30, ringStroke: 1.5, ringGap: 1) }
        }
        .padding(.vertical, 2)
    }

    private func message(_ text: String) -> some View {
        Text(text).font(.jakarta(14)).foregroundStyle(Color.sjMuted)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Country mix

/// Mirrors /api/taste/profile's charts.countries.
struct TasteCountryMix: Decodable {
    struct Item: Decodable { let code: String; let count: Int }
    let items: [Item]
    let unknown: Int
    let total: Int
}

enum TasteCountry {
    /// ISO 3166 code → name in the app's language; MusicBrainz pseudo-regions by hand.
    static func name(_ code: String) -> String {
        switch code {
        case "XW": return String(localized: "Worldwide")
        case "XE": return String(localized: "Europe")
        default:   return Locale.current.localizedString(forRegionCode: code) ?? code
        }
    }

    /// Neutral colour for Other / Unknown (web's --viz-other).
    static let other = Color(UIColor { $0.userInterfaceStyle == .dark
        ? UIColor(red: 0x6F / 255, green: 0x6A / 255, blue: 0x64 / 255, alpha: 1)
        : UIColor(red: 0xA9 / 255, green: 0xA3 / 255, blue: 0x9C / 255, alpha: 1) })

    /// "Your biggest source is Korea, at 62% of what you rate."
    static func leadText(_ mix: TasteCountryMix) -> String? {
        guard let lead = mix.items.first else { return nil }
        let pct = Int((Double(lead.count) / Double(max(mix.total, 1)) * 100).rounded())
        return String(format: String(localized: "Your biggest source is %1$@, at %2$d%% of what you rate."), name(lead.code), pct)
    }
}

/// Where your music comes from, by the primary artist's country. Top
/// countries until they cover ~90% (at most 4 -- web's narrow layout), the
/// rest folded into "Other (k countries)" which expands to the full list,
/// "Unknown" as its own striped slot. Tapping a segment or legend entry
/// selects it; the page then offers the ratings behind it.
struct CountryMixView: View {
    let data: TasteCountryMix
    var onShowRatings: ((TasteDrillBucket) -> Void)? = nil

    @State private var selected: String?
    @State private var showAll = false
    @State private var grown = UIAccessibility.isReduceMotionEnabled
    @Environment(\.isTasteShareSnapshot) private var isTasteShareSnapshot

    private struct Slice { let key: String; let label: String; let count: Int; let color: Color; let codes: [String]? }

    private var layout: (shown: [TasteCountryMix.Item], rest: [TasteCountryMix.Item]) {
        let cap = 4
        let total = Double(max(data.total, 1))
        var shown: [TasteCountryMix.Item] = []
        var covered = 0
        for it in data.items {
            if shown.count >= cap || (!shown.isEmpty && Double(covered) / total >= 0.9) { break }
            shown.append(it); covered += it.count
        }
        var rest = Array(data.items.dropFirst(shown.count))
        // "Other (1 country)" says less than the country itself -- just show it.
        if rest.count == 1 && shown.count < 5 { shown.append(rest[0]); rest = [] }
        return (shown, rest)
    }

    private var slices: [Slice] {
        let (shown, rest) = layout
        var out = shown.enumerated().map { i, it in
            Slice(key: it.code, label: TasteCountry.name(it.code), count: it.count, color: TasteViz.color(i), codes: [it.code])
        }
        let restCount = rest.reduce(0) { $0 + $1.count }
        if restCount > 0 {
            out.append(Slice(key: "__other", label: otherLabel(rest.count), count: restCount,
                             color: TasteCountry.other, codes: rest.map(\.code)))
        }
        if data.unknown > 0 {
            out.append(Slice(key: "__unknown", label: String(localized: "Unknown"), count: data.unknown,
                             color: TasteCountry.other, codes: nil))
        }
        return out
    }

    private func otherLabel(_ n: Int) -> String { String(format: String(localized: "Other (%d countries)"), n) }

    private func pctLabel(_ n: Int) -> String {
        let p = Int((Double(n) / Double(max(data.total, 1)) * 100).rounded())
        return p == 0 ? "<1%" : "\(p)%"
    }

    private func select(_ key: String) {
        Haptics.selection()
        withAnimation(.easeInOut(duration: 0.15)) { selected = (selected == key) ? nil : key }
    }

    var body: some View {
        let all = slices
        VStack(alignment: .leading, spacing: 0) {
            bar(all).padding(.top, 12)
            legend(all).padding(.top, 10)
            if showAll { restList.padding(.top, 8) }
            if let key = selected, let s = sliceFor(key, in: all), let onShowRatings, !isTasteShareSnapshot {
                TasteViewRatingsButton(count: s.count) {
                    onShowRatings(TasteDrillBucket(title: s.label, filter: .countries(s.codes)))
                }
                .padding(.top, 12)
            }
        }
    }

    /// A selection can also be a single country inside the expanded Other list.
    private func sliceFor(_ key: String, in all: [Slice]) -> Slice? {
        if let s = all.first(where: { $0.key == key }) { return s }
        guard let it = layout.rest.first(where: { $0.code == key }) else { return nil }
        return Slice(key: it.code, label: TasteCountry.name(it.code), count: it.count, color: TasteCountry.other, codes: [it.code])
    }

    private func bar(_ all: [Slice]) -> some View {
        GeometryReader { geo in
            let gaps = CGFloat(max(0, all.count - 1)) * 2
            let available = geo.size.width - gaps
            HStack(spacing: 2) {
                ForEach(all, id: \.key) { s in
                    segment(s)
                        .frame(width: max(6, available * CGFloat(s.count) / CGFloat(max(data.total, 1))))
                        .opacity(selected == nil || selected == s.key ? 1 : 0.4)
                        .contentShape(Rectangle())
                        .onTapGesture { select(s.key) }
                        .accessibilityElement()
                        .accessibilityLabel("\(s.label), \(pctLabel(s.count))")
                        .accessibilityAddTraits(.isButton)
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

    @ViewBuilder
    private func segment(_ s: Slice) -> some View {
        if s.key == "__unknown" {
            RoundedRectangle(cornerRadius: 3).fill(s.color.opacity(0.35))
                .overlay(Stripes().stroke(s.color, lineWidth: 1.5).clipShape(RoundedRectangle(cornerRadius: 3)))
        } else {
            RoundedRectangle(cornerRadius: 3).fill(s.color)
        }
    }

    private func legend(_ all: [Slice]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(all, id: \.key) { s in
                Button {
                    if s.key == "__other" {
                        withAnimation(.easeInOut(duration: 0.2)) { showAll.toggle() }
                    } else {
                        select(s.key)
                    }
                } label: {
                    HStack(spacing: 6) {
                        Group {
                            if s.key == "__unknown" {
                                Circle().fill(s.color.opacity(0.35)).overlay(Circle().stroke(s.color, lineWidth: 1))
                            } else {
                                Circle().fill(s.color)
                            }
                        }
                        .frame(width: 10, height: 10)
                        Text(s.label)
                            .font(.jakarta(12, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                            .underline(s.key == "__other" || selected == s.key, pattern: s.key == "__other" ? .dot : .solid)
                        Text(pctLabel(s.count)).font(.jakarta(12)).monospacedDigit().foregroundStyle(Color.sjMuted)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var restList: some View {
        let rest = layout.rest
        return LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 4) {
            ForEach(rest, id: \.code) { it in
                Button { select(it.code) } label: {
                    HStack(spacing: 4) {
                        Text(TasteCountry.name(it.code)).lineLimit(1)
                            .underline(selected == it.code)
                            .foregroundStyle(selected == it.code ? Color.sjInk : Color.sjMuted)
                        Spacer(minLength: 2)
                        Text(pctLabel(it.count)).monospacedDigit().foregroundStyle(Color.sjMuted)
                    }
                    .font(.jakarta(11.5))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.leading, 14)
        .overlay(alignment: .leading) { Rectangle().fill(Color.sjBorder).frame(width: 1) }
        .transition(.opacity)
    }
}

/// Diagonal hatching for the "Unknown" slot.
private struct Stripes: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        var x = -r.height
        while x < r.width {
            p.move(to: CGPoint(x: x, y: r.maxY))
            p.addLine(to: CGPoint(x: x + r.height, y: r.minY))
            x += 5
        }
        return p
    }
}
