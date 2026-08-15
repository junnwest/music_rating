import SwiftUI

/// The app's continuous score ramp (0.5–5.0 → color) -- a direct port of web's
/// `spectrumColor`/`spectrumFill`/`spectrumNumber`/`spectrumRing` (`lib/sj/display.ts`).
/// Distinct from `TasteViz`'s fixed categorical palette: this is a magnitude ramp keyed to
/// score, used wherever color *is* the score (score-distribution bars, the taste-map treemap
/// tiles), always beside a stated 1→5 legend rather than as the sole encoding.
enum Spectrum {
    private struct Stop {
        let score: Double
        let hue: Double
        let chroma: Double
    }

    // Hue (OKLCh degrees) and chroma anchors across the 0.5–5.0 score range -- same constants
    // as web's SPECTRUM_STOPS.
    private static let stops: [Stop] = [
        Stop(score: 0.5, hue: 25,  chroma: 0.16),   // deep red
        Stop(score: 1.6, hue: 58,  chroma: 0.145),  // orange
        Stop(score: 2.7, hue: 126, chroma: 0.15),   // yellow-green
        Stop(score: 3.8, hue: 196, chroma: 0.115),  // teal
        Stop(score: 5.0, hue: 262, chroma: 0.155),  // blue
    ]

    private static func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double {
        a + (b - a) * t
    }

    /// Interpolate the hue/chroma anchors at `score` (clamped to 0.5–5.0).
    private static func spectrumStop(_ score: Double) -> (hue: Double, chroma: Double) {
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
    private static func oklabToLinearRGB(_ L: Double, _ a: Double, _ b: Double) -> (Double, Double, Double) {
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

    /// OKLCh → sRGB, walking chroma down until the color fits sRGB. Cutting chroma (rather
    /// than clipping channels) keeps hue and lightness intact -- same gamut-mapping loop as web.
    private static func oklchToRGB(_ L: Double, _ chroma: Double, _ hueDeg: Double) -> (Double, Double, Double) {
        let rad = hueDeg * .pi / 180
        var c = chroma
        var rgb = (0.0, 0.0, 0.0)
        for _ in 0..<24 {
            rgb = oklabToLinearRGB(L, c * cos(rad), c * sin(rad))
            if rgb.0 >= -0.0005 && rgb.0 <= 1.0005
                && rgb.1 >= -0.0005 && rgb.1 <= 1.0005
                && rgb.2 >= -0.0005 && rgb.2 <= 1.0005 {
                break
            }
            c *= 0.92
        }
        func encode(_ v: Double) -> Double {
            gammaEncode(min(1, max(0, v)))
        }
        return (encode(rgb.0), encode(rgb.1), encode(rgb.2))
    }

    /// Any point on the ramp at an arbitrary lightness -- used for gradients/charts.
    static func color(score: Double, lightness: Double, chromaScale: Double = 1) -> Color {
        let (hue, chroma) = spectrumStop(score)
        let (r, g, b) = oklchToRGB(lightness, chroma * chromaScale, hue)
        return Color(red: r, green: g, blue: b)
    }

    /// Pale badge background.
    static func fill(_ score: Double) -> Color {
        color(score: score, lightness: 0.92, chromaScale: 0.28)
    }

    /// Dark, legible number/text color on top of `fill`.
    static func number(_ score: Double) -> Color {
        color(score: score, lightness: 0.45, chromaScale: 0.95)
    }

    /// Mid-tone stroke/accent -- the ramp's "true" color.
    static func ring(_ score: Double) -> Color {
        color(score: score, lightness: 0.63, chromaScale: 1)
    }
}
