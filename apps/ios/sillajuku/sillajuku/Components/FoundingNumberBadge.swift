import SwiftUI

/// Founding badge for the first 500 members (claim_founding_badge, migration
/// 20260926000003): an orange square with the rocket on top and the member
/// number "001"…"500" underneath. Replaced the old beta-tester rocket badge.

extension Int {
    /// Always three digits: 7 → "007".
    var foundingDigits: String { String(format: "%03d", self) }
}

extension Color {
    /// The rocket's launch orange.
    static let sjLaunchOrange = Color(red: 1.0, green: 0.478, blue: 0.0) // #FF7A00
}

// MARK: - Inline (next to the @handle)

struct FoundingNumberBadge: View {
    let number: Int
    /// Side of the square.
    var size: CGFloat = 17
    /// Rocket only, for small rows (comments, feed cards) where three digits
    /// would be too small to read. The number is still in the VoiceOver label.
    var compact = false

    var body: some View {
        Group {
            if compact {
                Image("icon-rocket-filled")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .padding(size * 0.2)
            } else {
                VStack(spacing: size * 0.02) {
                    Image("icon-rocket-filled")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(height: size * 0.44)
                    Text(number.foundingDigits)
                        .font(.jakarta(size * 0.32, weight: .heavy))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .padding(size * 0.08)
            }
        }
        .foregroundStyle(.white)
        .frame(width: size, height: size)
        .background(RoundedRectangle(cornerRadius: size * 0.2).fill(Color.sjLaunchOrange))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(format: String(localized: "Founding member number %d"), number))
    }
}

// MARK: - Hero (Quests card)

struct FoundingBadgeHero: View {
    /// nil = not claimed yet: shows "???" in a muted tile.
    let number: Int?
    var size: CGFloat = 96

    var body: some View {
        VStack(spacing: size * 0.03) {
            Image("icon-rocket-filled")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(height: size * 0.36)
            Text(number?.foundingDigits ?? "???")
                .font(.jakarta(size * 0.26, weight: .heavy))
                .monospacedDigit()
            Text("FIRST 500")
                .font(.jakarta(size * 0.07, weight: .bold))
                .tracking(size * 0.012)
                .opacity(0.85)
        }
        .foregroundStyle(number == nil ? Color.sjMuted : .white)
        .frame(width: size, height: size)
        .background(RoundedRectangle(cornerRadius: size * 0.16)
            .fill(number == nil ? Color.sjBorder.opacity(0.5) : Color.sjLaunchOrange))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(number.map { String(format: String(localized: "Founding member number %d of 500"), $0) }
                            ?? String(localized: "Founding badge, not claimed"))
    }
}
