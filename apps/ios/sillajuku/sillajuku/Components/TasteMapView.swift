import SwiftUI

/// The taste map: a ranked list of the user's taste worlds -- one row per
/// world, ordered by mass, each showing a hero album cover, name, share of
/// their ratings, average score, and a proportional bar. Tap a world to drill
/// into its sub-genres as their own ranked rows; tap a sub-genre to open a
/// sheet with the user's own albums in it plus a few recommendations.
///
/// Was a squarified-treemap grid of variable-size tiles through two earlier
/// passes this session -- both live-verified and both rejected (too cramped,
/// then a busy cover-mosaic, then still reading as unpolished with clipped
/// text at small tile sizes: a treemap fundamentally fights a ~360pt-wide
/// phone screen, where any given tile can be too small to hold a genre name).
/// A plain list has no small-tile problem at all: every row is full-width, so
/// text never needs to fit inside a shrinking box. Semantically the same data
/// web's `TasteGraph.tsx` inspector panel already shows in this exact shape
/// (cover + name + proportional bar + share); this makes it the primary view
/// instead of a secondary detail panel next to a treemap.
struct TasteMapView: View {
    let data: TasteProfileResponse.TasteGraph

    @State private var worldIndex: Int? = nil
    @State private var sheetTarget: TasteMapSheetTarget? = nil

    /// Every rated album, indexed by each tag it carries -- built once per
    /// render and threaded through the cover lookups below rather than
    /// recomputed per row.
    private var albumsByTag: [String: [TasteProfileResponse.TasteGraph.GraphAlbum]] {
        var m: [String: [TasteProfileResponse.TasteGraph.GraphAlbum]] = [:]
        for a in data.albums {
            for tg in a.tags { m[tg, default: []].append(a) }
        }
        return m
    }

    /// A world's hero cover: its highest-scored rated album across any of its tags.
    private func worldHeroCover(_ world: TasteProfileResponse.TasteGraph.GraphWorld,
                                 in byTag: [String: [TasteProfileResponse.TasteGraph.GraphAlbum]]) -> String? {
        var seen = Set<UUID>()
        var best: (cover: String, score: Double)?
        for tag in world.tags {
            for a in byTag[tag.tag] ?? [] {
                guard !seen.contains(a.id) else { continue }
                seen.insert(a.id)
                guard let cover = a.coverUrl else { continue }
                if best == nil || a.score > best!.score { best = (cover, a.score) }
            }
        }
        return best?.cover
    }

    private func tagHeroCover(_ tag: TasteProfileResponse.TasteGraph.GraphWorld.GraphTag,
                               in byTag: [String: [TasteProfileResponse.TasteGraph.GraphAlbum]]) -> String? {
        (byTag[tag.tag] ?? []).max(by: { $0.score < $1.score })?.coverUrl
    }

    private var worldOrder: [Int] {
        data.worlds.indices.sorted { data.worlds[$0].share > data.worlds[$1].share }
    }

    private var openWorld: TasteProfileResponse.TasteGraph.GraphWorld? {
        guard let worldIndex, data.worlds.indices.contains(worldIndex) else { return nil }
        return data.worlds[worldIndex]
    }

    private var tagOrder: [Int] {
        guard let openWorld else { return [] }
        return openWorld.tags.indices.sorted { openWorld.tags[$0].share > openWorld.tags[$1].share }
    }

    var body: some View {
        let byTag = albumsByTag

        VStack(alignment: .leading, spacing: 12) {
            if let openWorld {
                Button(action: { withAnimation(.easeOut(duration: 0.22)) { worldIndex = nil } }) {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.left")
                            .font(.jakarta(11, weight: .bold))
                        Text(String(localized: "All worlds"))
                            .font(.jakarta(13, weight: .semibold))
                    }
                    .foregroundStyle(Color.sjBlue)
                }
                .transition(.opacity)
            }

            VStack(spacing: 0) {
                if let openWorld {
                    ForEach(Array(tagOrder.enumerated()), id: \.element) { i, idx in
                        let tag = openWorld.tags[idx]
                        if i > 0 { Divider() }
                        MapRow(
                            label: tag.display,
                            meta: "\(Int((tag.share * 100).rounded()))% \(String(localized: "share"))",
                            avg: tag.avg,
                            pct: tag.share,
                            cover: tagHeroCover(tag, in: byTag),
                            onTap: { openSheet(world: openWorld, tag: tag) }
                        )
                    }
                } else {
                    ForEach(Array(worldOrder.enumerated()), id: \.element) { i, idx in
                        let w = data.worlds[idx]
                        if i > 0 { Divider() }
                        MapRow(
                            label: w.primary,
                            meta: "\(Int((w.share * 100).rounded()))% \(String(localized: "share"))",
                            avg: w.avg,
                            pct: w.share,
                            cover: worldHeroCover(w, in: byTag),
                            onTap: { withAnimation(.easeOut(duration: 0.22)) { worldIndex = idx } }
                        )
                    }
                }
            }
            .id(openWorld?.key ?? "worlds")
            .transition(.opacity)

            RampLegendView(label: String(localized: "score"), width: 64)
        }
        .sheet(item: $sheetTarget) { target in
            TasteMapSheet(target: target)
        }
    }

    private func openSheet(world: TasteProfileResponse.TasteGraph.GraphWorld,
                            tag: TasteProfileResponse.TasteGraph.GraphWorld.GraphTag) {
        let albums = data.albums.filter { $0.tags.contains(tag.tag) }.prefix(10)
        let recs = (data.recs["tag:\(tag.tag)"] ?? data.recs[world.key] ?? []).prefix(5)
        sheetTarget = TasteMapSheetTarget(
            id: "tag:\(tag.tag)", title: tag.display, subtitle: world.label, avg: tag.avg,
            albums: Array(albums), recs: Array(recs)
        )
    }
}

// MARK: - Row

/// A single ranked row -- a world at the top level, a sub-genre when drilled
/// in. Deliberately built from the app's own established row furniture
/// rather than bespoke chrome: `CoverImage` (same shimmer-placeholder cover
/// used by `ProfileView`'s rated list and `HomeView`'s feed), `ScoreBadge`
/// (the app-wide Liquid Glass score indicator -- `AlbumDetailView`,
/// `ProfileView`, `HomeView` all use it at its default size, so this does
/// too), and the flat divider-separated list shape `MixLibraryView`'s
/// `MixRow` uses (no per-row card, no border, no rounded background) --
/// matching those fixes the "doesn't look like the rest of the app" feedback
/// an earlier card-chip-mosaic version got. The one genuinely new element is
/// the proportional share bar, which has no existing analog to match; it
/// borrows the flat single-color capsule shape `RankingsView`'s progress bar
/// already uses, just tinted by score via the shared `Spectrum` ramp instead
/// of the fixed app-blue those bars use, since color-as-score is this
/// component's whole point (see the ramp legend below the list).
private struct MapRow: View {
    let label: String
    let meta: String
    let avg: Double?
    let pct: Double
    let cover: String?
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 14) {
                CoverImage(url: cover)
                    .frame(width: 52, height: 52)

                VStack(alignment: .leading, spacing: 4) {
                    Text(label)
                        .font(.jakarta(15, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)

                    Text(meta)
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)

                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.sjBorder)
                            Capsule()
                                .fill(Spectrum.ring(avg ?? 3))
                                .frame(width: max(4, geo.size.width * min(1, pct)))
                        }
                    }
                    .frame(height: 5)
                    .padding(.top, 2)
                }

                Spacer(minLength: 4)

                if let avg {
                    ScoreBadge(score: avg, badgeSize: 34, ringStroke: 2, ringGap: 1.5)
                }

                Image(systemName: "chevron.right")
                    .font(.jakarta(11, weight: .medium))
                    .foregroundStyle(Color.sjBorder)
            }
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(label) · \(meta)")
    }
}

// MARK: - Sheet target

private struct TasteMapSheetTarget: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let avg: Double
    let albums: [TasteProfileResponse.TasteGraph.GraphAlbum]
    let recs: [TasteProfileResponse.TasteGraph.GraphRec]
}

private extension TasteProfileResponse.TasteGraph.GraphAlbum {
    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl, releaseType: nil,
                releaseDate: nil, titleNative: nil, artistNative: nil, tracklist: nil, totalTracks: nil)
    }
}

private extension TasteProfileResponse.TasteGraph.GraphRec {
    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl, releaseType: nil,
                releaseDate: nil, titleNative: nil, artistNative: nil, tracklist: nil, totalTracks: nil)
    }
}

// MARK: - Drill-down sheet

private struct TasteMapSheet: View {
    let target: TasteMapSheetTarget

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(target.subtitle)
                            .font(.jakarta(10, weight: .bold))
                            .kerning(0.6)
                            .textCase(.uppercase)
                            .foregroundStyle(Color.sjMuted.opacity(0.6))
                        Text(target.title)
                            .font(.jakarta(21, weight: .black))
                            .foregroundStyle(Color.sjInk)
                        Text(String(format: String(localized: "Average score %.2f"), target.avg))
                            .font(.jakarta(12.5))
                            .foregroundStyle(Color.sjMuted)
                    }

                    if !target.albums.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(String(localized: "Your albums"))
                                .font(.jakarta(11, weight: .bold))
                                .kerning(0.4)
                                .textCase(.uppercase)
                                .foregroundStyle(Color.sjMuted.opacity(0.7))
                            ForEach(target.albums, id: \.id) { a in
                                NavigationLink(value: a.asRelease) {
                                    TasteMapAlbumRow(title: a.title, artist: a.artist, coverUrl: a.coverUrl,
                                                      trailing: String(format: "%.1f", a.score))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    } else {
                        Text(String(localized: "No rated albums here yet."))
                            .font(.jakarta(12.5))
                            .foregroundStyle(Color.sjMuted)
                    }

                    if !target.recs.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(String(localized: "Recommended"))
                                .font(.jakarta(11, weight: .bold))
                                .kerning(0.4)
                                .textCase(.uppercase)
                                .foregroundStyle(Color.sjMuted.opacity(0.7))
                            ForEach(target.recs, id: \.id) { r in
                                NavigationLink(value: r.asRelease) {
                                    TasteMapAlbumRow(title: r.title, artist: r.artist, coverUrl: r.coverUrl, trailing: nil)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(20)
            }
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
            .background(Color.sjCream.ignoresSafeArea())
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

private struct TasteMapAlbumRow: View {
    let title: String
    let artist: String
    let coverUrl: String?
    let trailing: String?

    var body: some View {
        HStack(spacing: 10) {
            Group {
                if let coverUrl, let url = URL(string: coverUrl) {
                    CachedImage(url: url) { Color.sjBorder }
                        .scaledToFill()
                } else {
                    Color.sjBorder
                }
            }
            .frame(width: 42, height: 42)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.jakarta(13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(artist)
                    .font(.jakarta(11.5))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing)
                    .font(.jakarta(12.5, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.sjBlue)
            }
        }
    }
}
