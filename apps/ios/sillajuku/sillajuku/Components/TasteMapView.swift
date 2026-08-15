import SwiftUI

/// The taste map: a squarified-treemap heatmap of the user's taste worlds --
/// one tile per world, area ∝ their mass in it, colour ∝ how highly they rate
/// it (the app's OKLCh score ramp, `Spectrum`). Tap a world to drill into its
/// sub-genres as their own tiles; tap a sub-genre to open a sheet with the
/// user's own albums in it plus a few recommendations.
///
/// Port of web's `components/sj/TasteGraph.tsx` (2026-08-11 rebuild, which
/// replaced an earlier √share bubble field with this treemap). Web shows the
/// drill-down detail in a permanent side panel; here it's a `.sheet` on tap,
/// the iOS-native equivalent for a phone-width screen -- same data, same
/// squarify layout, adapted presentation.

// MARK: - Squarified treemap layout

private struct MapRect {
    let x: Double
    let y: Double
    let w: Double
    let h: Double
    let i: Int
}

/// Squarified treemap (Bruls, Huizing & van Wijk 2000): pack `values` into the
/// `w`×`h` box as rectangles whose areas are proportional to the values and
/// whose aspect ratios stay as close to square as possible. Deterministic --
/// values are laid out in the given order (callers pre-sort descending). 1:1
/// algorithmic port of web's `squarify`.
private func squarify(_ values: [Double], _ w: Double, _ h: Double) -> [MapRect] {
    guard !values.isEmpty else { return [] }
    let total = max(values.reduce(0, +), 0.0001)
    let scale = (w * h) / total
    let items = values.enumerated().map { (i: $0.offset, area: max($0.element, 0) * scale) }

    var out: [MapRect] = []
    var x = 0.0, y = 0.0, fw = w, fh = h

    func worst(_ row: [(i: Int, area: Double)], _ side: Double) -> Double {
        guard !row.isEmpty else { return .infinity }
        let sum = row.reduce(0.0) { $0 + $1.area }
        let maxA = row.map(\.area).max() ?? 0
        let minA = row.map(\.area).min() ?? 0
        let s2 = sum * sum
        let side2 = side * side
        return max((side2 * maxA) / s2, s2 / (side2 * minA))
    }

    var idx = 0
    while idx < items.count {
        let short = min(fw, fh)
        var row: [(i: Int, area: Double)] = [items[idx]]
        var j = idx + 1
        while j < items.count && worst(row, short) >= worst(row + [items[j]], short) {
            row.append(items[j])
            j += 1
        }
        let rowArea = row.reduce(0.0) { $0 + $1.area }
        if fw <= fh {
            let rh = fw > 0 ? rowArea / fw : 0
            var rx = x
            for r in row {
                let rw = rh > 0 ? r.area / rh : 0
                out.append(MapRect(x: rx, y: y, w: rw, h: rh, i: r.i))
                rx += rw
            }
            y += rh
            fh -= rh
        } else {
            let rw = fh > 0 ? rowArea / fh : 0
            var ry = y
            for r in row {
                let rh2 = rw > 0 ? r.area / rw : 0
                out.append(MapRect(x: x, y: ry, w: rw, h: rh2, i: r.i))
                ry += rh2
            }
            x += rw
            fw -= rw
        }
        idx = j
    }
    return out
}

// MARK: - Tile

/// A single heatmap tile -- a world at the top level, a sub-genre when
/// drilled in. Text drops out (color + accessibility label survive) on tiles
/// too small to hold it, at the same percent-of-box thresholds web uses.
private struct MapTile: View {
    let rect: MapRect
    let label: String
    let sub: String
    var hint: String? = nil
    let avg: Double?
    let onTap: () -> Void

    private var showLabel: Bool { rect.w > 12 && rect.h > 9 }
    private var showSub: Bool { showLabel && rect.w > 18 && rect.h > 16 }
    private var showHint: Bool { hint != nil && showSub && rect.w > 26 && rect.h > 24 }
    private var score: Double { avg ?? 3 }

    var body: some View {
        Button(action: onTap) {
            ZStack(alignment: .bottomLeading) {
                LinearGradient(
                    colors: [Spectrum.color(score: score, lightness: 0.68, chromaScale: 0.92),
                             Spectrum.color(score: score, lightness: 0.5, chromaScale: 1)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                LinearGradient(colors: [.clear, .black.opacity(0.34)], startPoint: .center, endPoint: .bottom)
                if showLabel {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(label)
                            .font(.system(size: rect.w > 24 ? 14 : 12, weight: .heavy))
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                        if showSub {
                            Text(sub)
                                .font(.system(size: 11, weight: .semibold))
                                .monospacedDigit()
                                .opacity(0.85)
                        }
                        if showHint, let hint {
                            Text(hint)
                                .font(.system(size: 10.5, weight: .medium))
                                .opacity(0.7)
                                .lineLimit(1)
                        }
                    }
                    .foregroundStyle(.white)
                    .shadow(color: .black.opacity(0.35), radius: 1)
                    .padding(8)
                }
            }
        }
        .buttonStyle(.plain)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .accessibilityLabel("\(label) · \(sub)")
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

// MARK: - Map

struct TasteMapView: View {
    let data: TasteProfileResponse.TasteGraph

    @State private var worldIndex: Int? = nil
    @State private var sheetTarget: TasteMapSheetTarget? = nil

    private var worldOrder: [Int] {
        data.worlds.indices.sorted { data.worlds[$0].share > data.worlds[$1].share }
    }
    private var worldRects: [MapRect] {
        let rects = squarify(worldOrder.map { max(data.worlds[$0].share, 0.02) }, 100, 100)
        return rects.map { MapRect(x: $0.x, y: $0.y, w: $0.w, h: $0.h, i: worldOrder[$0.i]) }
    }

    private var openWorld: TasteProfileResponse.TasteGraph.GraphWorld? {
        guard let worldIndex, data.worlds.indices.contains(worldIndex) else { return nil }
        return data.worlds[worldIndex]
    }

    private var tagOrder: [Int] {
        guard let openWorld else { return [] }
        return openWorld.tags.indices.sorted { openWorld.tags[$0].share > openWorld.tags[$1].share }
    }
    private var tagRects: [MapRect] {
        guard let openWorld else { return [] }
        let rects = squarify(tagOrder.map { max(openWorld.tags[$0].share, 0.02) }, 100, 100)
        return rects.map { MapRect(x: $0.x, y: $0.y, w: $0.w, h: $0.h, i: tagOrder[$0.i]) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack(alignment: .topLeading) {
                GeometryReader { geo in
                    ZStack {
                        if let openWorld {
                            ForEach(tagRects, id: \.i) { r in
                                let tag = openWorld.tags[r.i]
                                MapTile(
                                    rect: r,
                                    label: tag.display,
                                    sub: String(format: "%.1f★", tag.avg),
                                    avg: tag.avg,
                                    onTap: { openSheet(world: openWorld, tag: tag) }
                                )
                                .frame(width: geo.size.width * r.w / 100, height: geo.size.height * r.h / 100)
                                .position(x: geo.size.width * (r.x + r.w / 2) / 100,
                                          y: geo.size.height * (r.y + r.h / 2) / 100)
                            }
                        } else {
                            ForEach(worldRects, id: \.i) { r in
                                let w = data.worlds[r.i]
                                let pct = Int((w.share * 100).rounded())
                                let hintTags = w.tags.map(\.display).filter { !w.label.contains($0) }.prefix(3)
                                MapTile(
                                    rect: r,
                                    label: w.primary,
                                    sub: w.avg != nil ? "\(pct)% · \(String(format: "%.1f", w.avg!))★" : "\(pct)%",
                                    hint: hintTags.isEmpty ? nil : hintTags.joined(separator: " · "),
                                    avg: w.avg,
                                    onTap: { worldIndex = r.i }
                                )
                                .frame(width: geo.size.width * r.w / 100, height: geo.size.height * r.h / 100)
                                .position(x: geo.size.width * (r.x + r.w / 2) / 100,
                                          y: geo.size.height * (r.y + r.h / 2) / 100)
                            }
                        }
                    }
                }
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: 16))

                if openWorld != nil {
                    Button(action: { worldIndex = nil }) {
                        HStack(spacing: 4) {
                            Image(systemName: "chevron.left")
                            Text(String(localized: "Back"))
                        }
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(.thinMaterial, in: Capsule())
                    }
                    .padding(8)
                }
            }

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

// MARK: - Drill-down sheet

private struct TasteMapSheet: View {
    let target: TasteMapSheetTarget

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(target.subtitle)
                            .font(.system(size: 10, weight: .bold))
                            .kerning(0.6)
                            .textCase(.uppercase)
                            .foregroundStyle(Color.sjMuted.opacity(0.6))
                        Text(target.title)
                            .font(.system(size: 21, weight: .black))
                            .foregroundStyle(Color.sjInk)
                        Text(String(format: String(localized: "Average score %.2f"), target.avg))
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color.sjMuted)
                    }

                    if !target.albums.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(String(localized: "Your albums"))
                                .font(.system(size: 11, weight: .bold))
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
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color.sjMuted)
                    }

                    if !target.recs.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(String(localized: "Recommended"))
                                .font(.system(size: 11, weight: .bold))
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
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(artist)
                    .font(.system(size: 11.5))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 12.5, weight: .bold))
                    .monospacedDigit()
                    .foregroundStyle(Color.sjBlue)
            }
        }
    }
}
