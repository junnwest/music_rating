import SwiftUI

/// Score-adaptive color spectrum: a perceptually-uniform OKLCh ramp, ported
/// from web's `lib/sj/display.ts` (2026-07-17 web change, #2 in that
/// session). 0.5 → deep red, then orange, yellow-green, teal, and blue at
/// 5.0, walked at a *fixed* OKLab lightness per variant (fill/number/ring),
/// so every score reads at the same perceived brightness — unlike the old
/// HSL hue-sweep this replaces, whose yellows blew out and whose blues went
/// muddy at the extremes.
enum ScoreSpectrum {
    private struct Stop { let score: Double; let hue: Double; let chroma: Double }

    /// Hue (OKLCh degrees) and chroma anchors across the 0.5–5.0 range.
    private static let stops: [Stop] = [
        Stop(score: 0.5, hue: 25,  chroma: 0.16),  // deep red
        Stop(score: 1.6, hue: 58,  chroma: 0.145), // orange
        Stop(score: 2.7, hue: 126, chroma: 0.15),  // yellow-green
        Stop(score: 3.8, hue: 196, chroma: 0.115), // teal
        Stop(score: 5.0, hue: 262, chroma: 0.155), // blue
    ]

    private static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

    /// Interpolate the hue/chroma anchors at `score` (clamped to 0.5–5.0).
    private static func stop(for score: Double) -> (hue: Double, chroma: Double) {
        let s = min(max(score, 0.5), 5)
        for i in 0..<(stops.count - 1) {
            let a = stops[i], b = stops[i + 1]
            if s <= b.score {
                let t = (s - a.score) / (b.score - a.score)
                return (lerp(a.hue, b.hue, t), lerp(a.chroma, b.chroma, t))
            }
        }
        let last = stops[stops.count - 1]
        return (last.hue, last.chroma)
    }

    private static func gammaEncode(_ c: Double) -> Double {
        c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1 / 2.4) - 0.055
    }

    /// OKLab → linear sRGB (Björn Ottosson's matrices).
    private static func oklabToLinearRgb(_ L: Double, _ a: Double, _ b: Double) -> (Double, Double, Double) {
        let l_ = L + 0.3963377774 * a + 0.2158037573 * b
        let m_ = L - 0.1055613458 * a - 0.0638541728 * b
        let s_ = L - 0.0894841775 * a - 1.291485548 * b
        let l = l_ * l_ * l_
        let m = m_ * m_ * m_
        let s = s_ * s_ * s_
        return (
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
        )
    }

    /// OKLCh → Color, walking chroma down until it fits sRGB. Cutting chroma
    /// (rather than clipping channels) keeps hue and lightness intact.
    private static func oklch(_ L: Double, _ chroma: Double, _ hueDeg: Double) -> Color {
        let rad = hueDeg * Double.pi / 180
        var c = chroma
        var rgb: (Double, Double, Double) = (0, 0, 0)
        for _ in 0..<24 {
            rgb = oklabToLinearRgb(L, c * cos(rad), c * sin(rad))
            if [rgb.0, rgb.1, rgb.2].allSatisfy({ $0 >= -0.0005 && $0 <= 1.0005 }) { break }
            c *= 0.92
        }
        let r = min(1, max(0, gammaEncode(min(1, max(0, rgb.0)))))
        let g = min(1, max(0, gammaEncode(min(1, max(0, rgb.1)))))
        let b = min(1, max(0, gammaEncode(min(1, max(0, rgb.2)))))
        return Color(red: r, green: g, blue: b)
    }

    /// Any point on the ramp at an arbitrary lightness — matches web's `spectrumColor`.
    static func color(for score: Double, lightness: Double, chromaScale: Double = 1) -> Color {
        let (hue, chroma) = stop(for: score)
        return oklch(lightness, chroma * chromaScale, hue)
    }

    /// Pale badge background.
    static func fill(for score: Double) -> Color { color(for: score, lightness: 0.92, chromaScale: 0.28) }
    /// Dark, legible number/text color on top of `fill`.
    static func numberColor(for score: Double) -> Color { color(for: score, lightness: 0.45, chromaScale: 0.95) }
    /// Mid-tone stroke/accent — the ramp's "true" color.
    static func ringColor(for score: Double) -> Color { color(for: score, lightness: 0.63, chromaScale: 1) }

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
