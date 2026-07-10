import SwiftUI

/// The curated, permanent palette a user picks from when claiming their
/// quest-completion badge. Raw values are stored verbatim in
/// `profiles.badge_color` and mirrored in that column's DB check constraint
/// (`20260708000002_quest_badge.sql`) -- keep the two in sync if this ever
/// changes.
enum QuestBadgeColor: String, CaseIterable, Identifiable {
    case gold, coral, violet, mint, rose

    var id: String { rawValue }

    var color: Color {
        switch self {
        case .gold:   Color(red: 0.776, green: 0.565, blue: 0.161)  // #C6902A
        case .coral:  Color(red: 0.918, green: 0.416, blue: 0.365)  // #EA6A5D
        case .violet: Color(red: 0.522, green: 0.361, blue: 0.816)  // #855CD0
        case .mint:   Color(red: 0.208, green: 0.710, blue: 0.588)  // #35B596
        case .rose:   Color(red: 0.878, green: 0.376, blue: 0.573)  // #E06092
        }
    }

    var label: LocalizedStringKey {
        switch self {
        case .gold:   "Gold"
        case .coral:  "Coral"
        case .violet: "Violet"
        case .mint:   "Mint"
        case .rose:   "Rose"
        }
    }
}

/// The quest-completion badge -- the same flower silhouette the score badge
/// already uses, tinted the user's one-time claimed color. Deliberately not a
/// checkmark/seal shape so it can never be mistaken for the Verified badge
/// even when both appear on the same profile.
struct QuestBadgeView: View {
    let color: Color

    var body: some View {
        Image("icon-flower")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .foregroundStyle(color)
    }
}

/// The verified badge for known critics/artists/creators -- a plain system
/// glyph, not a custom shape, so it renders pixel-identical to every other
/// iOS app's own verified mark.
struct VerifiedBadgeView: View {
    var body: some View {
        Image(systemName: "checkmark.seal.fill")
            .resizable()
            .scaledToFit()
            .foregroundStyle(Color.sjBlue)
    }
}

/// Auto-presented by MainTabView on every launch while
/// `questVM.shouldOfferBadgeRedeem` is true -- i.e. every session until the
/// user actually picks a color. There is no Cancel/dismiss-and-forget path by
/// design (only picking a color satisfies it); a plain swipe-to-dismiss just
/// means it shows again next launch, which is the point.
struct BadgeRedeemView: View {
    let vm: QuestChecklistViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var selected: QuestBadgeColor?
    @State private var isSaving = false
    // Measured (not guessed) so the sheet fits this content exactly, with no
    // leftover gap and no clipped button -- onAppear/onChange rather than a
    // PreferenceKey, which measured unreliably for a similar sizing need
    // elsewhere in this app.
    @State private var contentHeight: CGFloat = 430

    var body: some View {
        // No Spacer -- content sizes to its own height and .presentationDetents
        // below sizes the sheet to match, instead of a full/large-height sheet
        // with a Spacer stretching the button away from everything above it.
        VStack(spacing: 22) {
            VStack(spacing: 14) {
                QuestBadgeView(color: (selected ?? .gold).color)
                    .frame(width: 72, height: 72)
                    .animation(.easeInOut(duration: 0.15), value: selected)

                Text("Quests complete!")
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("Pick a color for your badge. This is permanent — choose carefully, it can't be changed later.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .padding(.top, 20)

            HStack(spacing: 16) {
                ForEach(QuestBadgeColor.allCases) { option in
                    Button {
                        selected = option
                    } label: {
                        VStack(spacing: 6) {
                            Circle()
                                .fill(option.color)
                                .frame(width: 42, height: 42)
                                .overlay {
                                    Circle().stroke(Color.sjInk, lineWidth: selected == option ? 2.5 : 0)
                                        .padding(-3)
                                }
                            Text(option.label)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(Color.sjMuted)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            Button {
                guard let selected else { return }
                isSaving = true
                Task {
                    if await vm.claimBadge(selected) { dismiss() }
                    isSaving = false
                }
            } label: {
                if isSaving {
                    ProgressView().tint(.white).frame(maxWidth: .infinity)
                } else {
                    Text("Claim Badge")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 13)
            .background(selected == nil ? Color.sjBorder : Color.sjBlue)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .disabled(selected == nil || isSaving)
            .padding(.horizontal, 20)
            .padding(.top, 6)
            .padding(.bottom, 20)
        }
        .background(
            GeometryReader { geo in
                Color.sjCream.ignoresSafeArea()
                    .onAppear { contentHeight = geo.size.height }
                    .onChange(of: geo.size.height) { _, newValue in contentHeight = newValue }
            }
        )
        .interactiveDismissDisabled(isSaving)
        .presentationDetents([.height(contentHeight)])
        .presentationDragIndicator(.visible)
    }
}
