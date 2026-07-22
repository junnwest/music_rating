import SwiftUI

/// Radii are literal drag distances from the button's centre: `offset` is a
/// dead zone (release inside = cancel), then each whole star is `step`
/// further out. Values ported verbatim from web's `FlowerRateControl.tsx` --
/// already tuned for touch there ("comfortable on a phone, and 0.1 of a
/// star is ~3.4px, so tenths stay distinguishable").
enum RateGaugeGeometry {
    static let tapThreshold: Double = 8
    static let offset: Double = 36
    static let step: Double = 34
    static let maxRadius: Double = offset + 5 * step

    static func scoreRadius(_ score: Double) -> Double { offset + score * step }

    /// Distance -> score rounded to 0.1, or nil inside the dead zone (a cancel).
    static func distanceToScore(_ dist: Double) -> Double? {
        guard dist >= offset else { return nil }
        let stars = (dist - offset) / step
        let tenths = (stars * 10).rounded() / 10
        return min(5, max(0.5, tenths))
    }
}

/// Drag-to-rate flower control -- press the flower and drag outward; distance
/// from the button's centre maps to a score (farther = higher, 0.1 steps). A
/// press with no meaningful drag is a tap -> `onRequestPrecise` (open the full
/// rating sheet). Ports web's `components/sj/FlowerRateControl.tsx` gesture
/// math; the live gauge (arc + dotted baseline) renders in a floating
/// overlay window (`RateGaugeOverlay`) so it isn't clipped by whatever
/// scrolling container the button sits inside.
struct FlowerRateControl: View {
    /// Commit a drag-selected score (0.5-5.0).
    let onRate: (Double) -> Void
    /// A tap (no drag) -- hand off to the precise rating sheet.
    var onRequestPrecise: (() -> Void)? = nil
    var size: CGFloat = 30
    /// If already rated, the resting score to show (still re-ratable on press).
    var currentScore: Double? = nil
    var accessibilityLabelText: String = ""

    @State private var isDragging = false
    @State private var dragScore: Double? = nil
    @State private var dragAngle: Double = 0
    @State private var maxDist: Double = 0

    private var shown: Double? { isDragging ? dragScore : currentScore }
    private var showNumber: Bool { shown != nil }

    var body: some View {
        GeometryReader { geo in
            buttonContent
                .gesture(
                    DragGesture(minimumDistance: 0, coordinateSpace: .global)
                        .onChanged { value in
                            let rect = geo.frame(in: .global)
                            let origin = CGPoint(x: rect.midX, y: rect.midY)
                            if !isDragging {
                                isDragging = true
                                maxDist = 0
                            }
                            let dx = Double(value.location.x - origin.x)
                            let dy = Double(value.location.y - origin.y)
                            let dist = (dx * dx + dy * dy).squareRoot()
                            maxDist = max(maxDist, dist)
                            if dist > 1 { dragAngle = atan2(dy, dx) }
                            dragScore = RateGaugeGeometry.distanceToScore(dist)
                            RateGaugeOverlay.shared.show(origin: origin, angle: dragAngle, score: dragScore)
                        }
                        .onEnded { _ in
                            defer {
                                isDragging = false
                                RateGaugeOverlay.shared.hide()
                            }
                            if maxDist < RateGaugeGeometry.tapThreshold {
                                onRequestPrecise?()
                                return
                            }
                            guard let s = dragScore else { return } // released in dead zone -> cancel
                            onRate(s)
                        }
                )
        }
        .frame(width: size, height: size)
    }

    private var buttonContent: some View {
        ZStack {
            Circle()
                .fill(showNumber ? AnyShapeStyle(ScoreSpectrum.fill(for: shown!)) : AnyShapeStyle(.white))
                .shadow(color: .black.opacity(0.12), radius: 3, y: 1)

            FlowerGlyph(size: size * 0.56)
                .foregroundStyle(Color.sjBlue)
                .opacity(showNumber ? 0 : 1)
                .scaleEffect(showNumber ? 0.82 : 1)

            Text(shown != nil ? String(format: "%.1f", shown!) : "")
                .font(.system(size: size * 0.4, weight: .black))
                .foregroundStyle(showNumber ? ScoreSpectrum.numberColor(for: shown!) : .clear)
                .opacity(showNumber ? 1 : 0)
                .scaleEffect(showNumber ? 1 : 0.6)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .frame(width: size, height: size)
        .contentShape(Circle())
        .animation(.easeOut(duration: 0.13), value: showNumber)
        .accessibilityLabel(accessibilityLabelText)
    }
}

// MARK: - Gauge overlay content

private let arcSpan: Double = 52 * .pi / 180 // total sweep of the arc, radians
private let arcSegments = 22

/// The live gauge: a dotted horizontal baseline out of the (stationary) flower
/// with whole-star ticks, plus one thin arc at the current score's radius,
/// centred on the drag angle and fading toward both ends. Ports web's
/// `DragGauge` (part of FlowerRateControl.tsx) onto `Canvas`.
struct RateGaugeView: View {
    let origin: CGPoint
    let angle: Double
    let score: Double?

    private var cancel: Bool { score == nil }
    private var color: Color { ScoreSpectrum.ringColor(for: score ?? 0.5) }
    private var radius: Double { RateGaugeGeometry.scoreRadius(score ?? 0.5) }

    var body: some View {
        Canvas { context, _ in
            let ox = Double(origin.x), oy = Double(origin.y)

            // Dotted baseline, both halves, starting at the dead-zone edge.
            for side in [-1.0, 1.0] {
                var path = Path()
                path.move(to: CGPoint(x: ox + side * RateGaugeGeometry.offset, y: oy))
                path.addLine(to: CGPoint(x: ox + side * RateGaugeGeometry.maxRadius, y: oy))
                context.stroke(
                    path,
                    with: .color(Color.gray.opacity(0.4)),
                    style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [1, 5])
                )
            }

            // Whole-star ticks.
            for s in 1...5 {
                let r = RateGaugeGeometry.scoreRadius(Double(s))
                let reached = !cancel && score! >= Double(s)
                for side in [-1.0, 1.0] {
                    var path = Path()
                    let x = ox + side * r
                    path.move(to: CGPoint(x: x, y: oy - 3))
                    path.addLine(to: CGPoint(x: x, y: oy + 3))
                    context.stroke(
                        path,
                        with: .color(reached ? color.opacity(0.55) : Color.gray.opacity(0.28)),
                        lineWidth: reached ? 1.5 : 1
                    )
                }
            }

            // Dead-zone edge.
            var deadZone = Path()
            deadZone.addEllipse(in: CGRect(
                x: ox - RateGaugeGeometry.offset, y: oy - RateGaugeGeometry.offset,
                width: RateGaugeGeometry.offset * 2, height: RateGaugeGeometry.offset * 2
            ))
            context.stroke(
                deadZone,
                with: .color(cancel ? Color.gray.opacity(0.35) : color.opacity(0.18)),
                style: StrokeStyle(lineWidth: 1, dash: [2, 4])
            )

            // Fading arc, centred on the drag angle.
            guard !cancel else { return }
            let step = arcSpan / Double(arcSegments)
            for i in 0..<arcSegments {
                let t = (Double(i) + 0.5) / Double(arcSegments)
                let a0 = angle - arcSpan / 2 + Double(i) * step
                let a1 = a0 + step * 1.04 // slight overlap so strokes read continuous
                let fade = pow(sin(t * .pi), 1.4) // opaque mid-arc, vanishing at both ends
                var seg = Path()
                seg.move(to: CGPoint(x: ox + radius * cos(a0), y: oy + radius * sin(a0)))
                seg.addLine(to: CGPoint(x: ox + radius * cos(a1), y: oy + radius * sin(a1)))
                context.stroke(
                    seg,
                    with: .color(color.opacity(fade * 0.95)),
                    style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
                )
            }
        }
        .allowsHitTesting(false)
        .ignoresSafeArea()
    }
}
