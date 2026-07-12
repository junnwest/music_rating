import SwiftUI

/// Score-adaptive color spectrum: hue sweeps from red (0°) at the bottom of
/// the real rating scale (0.5) to sjBlue's own hue (~206°) at a perfect 5.0.
/// Saturation/lightness stay fixed — only the hue moves — so every score
/// reads as "the same badge," just recolored.
enum ScoreSpectrum {
    private static let maxHue = 205.7

    static func hue(for score: Double) -> Double {
        min(max(maxHue * (score - 0.5) / 4.5, 0), maxHue)
    }

    static func fill(for score: Double) -> Color {
        Color(hslHue: hue(for: score), saturation: 0.65, lightness: 0.89)
    }

    static func numberColor(for score: Double) -> Color {
        Color(hslHue: hue(for: score), saturation: 0.73, lightness: 0.29)
    }

    static func ringColor(for score: Double) -> Color {
        Color(hslHue: hue(for: score), saturation: 0.70, lightness: 0.45)
    }

    /// Non-linear visibility: a great score should pop, a mediocre one
    /// shouldn't compete for attention. Power curve (not three flat bands)
    /// so there's no visible snap crossing 4.0/4.5 — it stays near-zero well
    /// under 4.0, becomes noticeable through 4.0–4.5, and closes in on fully
    /// opaque by 5.0. Floor keeps even a 0.5 badge faintly present rather
    /// than fully gone (reads as "de-emphasized," not "missing asset").
    static func opacity(for score: Double) -> Double {
        let x = min(max((score - 0.5) / 4.5, 0), 1)
        return max(pow(x, 9), 0.06)
    }
}

private extension Color {
    /// Matches CSS `hsl(h, s%, l%)` semantics exactly — SwiftUI's native
    /// `Color(hue:saturation:brightness:)` is HSB, a different model that
    /// would NOT reproduce the same colors from the approved mockup.
    init(hslHue h: Double, saturation s: Double, lightness l: Double) {
        let c = (1 - abs(2 * l - 1)) * s
        let x = c * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1))
        let m = l - c / 2
        let (r, g, b): (Double, Double, Double)
        switch h {
        case 0..<60:    (r, g, b) = (c, x, 0)
        case 60..<120:  (r, g, b) = (x, c, 0)
        case 120..<180: (r, g, b) = (0, c, x)
        case 180..<240: (r, g, b) = (0, x, c)
        case 240..<300: (r, g, b) = (x, 0, c)
        default:        (r, g, b) = (c, 0, x)
        }
        self.init(red: r + m, green: g + m, blue: b + m)
    }
}

/// The approved score badge: a Liquid Glass circle (flower watermark + score
/// number) wrapped in a progress ring. Ring arc length is a plain
/// `score / 5.0` (2.5 = exactly half); ring/badge color follows
/// `ScoreSpectrum`, a different formula on purpose — one is "how much of the
/// scale," the other is "how it should feel."
struct ScoreBadge: View {
    let score: Double

    /// Diameter of the glass badge itself. The ring is drawn tight around
    /// it (`ringGap` + `ringStroke` beyond the badge's edge), not against
    /// some separately-tunable outer size — that's what kept the ring
    /// floating away from the badge before.
    var badgeSize: CGFloat = 48
    var ringStroke: CGFloat = 3
    var ringGap: CGFloat = 2

    private var ringDiameter: CGFloat { badgeSize + 2 * (ringGap + ringStroke) }
    private var flowerSize: CGFloat { badgeSize * 0.66 }
    private var numberSize: CGFloat { badgeSize * 0.37 }
    private var fraction: CGFloat { CGFloat(min(max(score / 5.0, 0), 1)) }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.sjBorder, lineWidth: ringStroke)
                .frame(width: ringDiameter, height: ringDiameter)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(ScoreSpectrum.ringColor(for: score),
                        style: StrokeStyle(lineWidth: ringStroke, lineCap: .round))
                .frame(width: ringDiameter, height: ringDiameter)
                .rotationEffect(.degrees(-90))

            ZStack {
                Image("icon-flower")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: flowerSize, height: flowerSize)
                    .foregroundStyle(.white.opacity(0.9))
                    .shadow(color: .black.opacity(0.3), radius: 1, y: 1)
                    .opacity(ScoreSpectrum.opacity(for: score))

                // Different digit glyphs render at slightly different widths
                // at this weight/condensed-width combo (e.g. "4.5" vs "1.0"),
                // which was truncating some scores to "4…" in a fixed-size
                // Text with no scale fallback. Explicit width + a scale
                // floor guarantees every "X.X" fits without ever ellipsizing.
                Text(String(format: "%.1f", score))
                    .font(.system(size: numberSize, weight: .heavy).width(.condensed))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: badgeSize * 0.86)
                    .scaleEffect(y: 1.14)
                    .foregroundStyle(ScoreSpectrum.numberColor(for: score))
                    .shadow(color: .white.opacity(0.55), radius: 3)
            }
            .frame(width: badgeSize, height: badgeSize)
            .glassEffect(.regular.tint(ScoreSpectrum.fill(for: score)), in: Circle())
        }
        .frame(width: ringDiameter, height: ringDiameter)
    }
}

#Preview {
    VStack(spacing: 20) {
        HStack(spacing: 16) {
            ScoreBadge(score: 2.0)
            ScoreBadge(score: 3.0)
            ScoreBadge(score: 3.5)
            ScoreBadge(score: 3.8)
        }
        HStack(spacing: 16) {
            ScoreBadge(score: 4.0)
            ScoreBadge(score: 4.2)
            ScoreBadge(score: 4.5)
            ScoreBadge(score: 4.7)
            ScoreBadge(score: 5.0)
        }
    }
    .padding()
    .background(Color.sjCream)
}
