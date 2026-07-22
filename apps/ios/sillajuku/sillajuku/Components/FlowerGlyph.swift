import SwiftUI

/// The flower glyph used by quick-rate controls -- template-rendered so it
/// tints via `.foregroundStyle` like an SF Symbol. Mirrors web's
/// `components/sj/FlowerGlyph.tsx` (same `icon-flower` asset both platforms
/// already ship, web's copy having originally been ported from iOS).
struct FlowerGlyph: View {
    var size: CGFloat = 20

    var body: some View {
        Image("icon-flower")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
    }
}
