import SwiftUI

/// A profile bio clamped to 3 lines, with a "See more" / "See less" toggle
/// that only appears when the text actually overflows. Port of web's
/// `ProfileView` bio (`line-clamp-3` + more/less, 2026-09-27).
///
/// Overflow is detected by measuring the full text and the clamped text in
/// hidden copies of the same width; they differ only when lines were cut.
struct ExpandableBioText: View {
    let text: String
    var font: Font = .jakarta(13)
    var alignment: TextAlignment = .leading
    var lineLimit = 3

    @State private var expanded = false
    @State private var fullHeight: CGFloat = 0
    @State private var clampedHeight: CGFloat = 0

    private var overflows: Bool { fullHeight > clampedHeight + 1 }

    private var frameAlignment: Alignment {
        alignment == .center ? .center : .leading
    }

    var body: some View {
        VStack(alignment: alignment == .center ? .center : .leading, spacing: 2) {
            bioText
                .lineLimit(expanded ? nil : lineLimit)
                .background(measurements)

            if overflows || expanded {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { expanded.toggle() }
                } label: {
                    Text(expanded ? String(localized: "See less") : String(localized: "See more"))
                        .font(.jakarta(12, weight: .semibold))
                        .foregroundStyle(Color.sjBlue)
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: frameAlignment)
    }

    private var bioText: some View {
        Text(text)
            .font(font)
            .foregroundStyle(Color.sjMuted)
            .multilineTextAlignment(alignment)
            .frame(maxWidth: .infinity, alignment: frameAlignment)
    }

    /// Two invisible copies at the same width: one unclamped, one clamped.
    private var measurements: some View {
        ZStack {
            bioText
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { fullHeight = $0 }
            bioText
                .lineLimit(lineLimit)
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { clampedHeight = $0 }
        }
        .hidden()
        .accessibilityHidden(true)
    }
}
