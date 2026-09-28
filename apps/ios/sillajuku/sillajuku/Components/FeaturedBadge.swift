import SwiftUI
import Supabase

/// The badges a user can own, in automatic-pick priority order. Raw values
/// match `profiles.featured_badge` (migration 20260928000002).
enum FeaturedBadge: String, CaseIterable, Identifiable {
    case verified, founding, quest

    var id: String { rawValue }

    /// Every badge this user owns, in priority order.
    static func owned(isVerified: Bool, foundingNumber: Int?, badgeColor: String?) -> [FeaturedBadge] {
        var out: [FeaturedBadge] = []
        if isVerified { out.append(.verified) }
        if foundingNumber != nil { out.append(.founding) }
        if badgeColor.flatMap(QuestBadgeColor.init(rawValue:)) != nil { out.append(.quest) }
        return out
    }

    /// The one badge posts show: the user's choice if they still own it,
    /// otherwise the first owned badge (verified > founding > quest).
    static func resolve(featured: String?, isVerified: Bool, foundingNumber: Int?, badgeColor: String?) -> FeaturedBadge? {
        let owned = owned(isVerified: isVerified, foundingNumber: foundingNumber, badgeColor: badgeColor)
        if let choice = featured.flatMap(FeaturedBadge.init(rawValue:)), owned.contains(choice) { return choice }
        return owned.first
    }
}

/// A single badge beside an @handle on posts -- posts show one badge so the
/// handle never gets squeezed onto two lines. Profile headers show them all.
struct PostBadgeView: View {
    let isVerified: Bool
    let foundingNumber: Int?
    let badgeColor: String?
    let featured: String?
    var size: CGFloat = 13

    var body: some View {
        if let badge = FeaturedBadge.resolve(featured: featured, isVerified: isVerified,
                                             foundingNumber: foundingNumber, badgeColor: badgeColor) {
            BadgeGlyph(badge: badge, foundingNumber: foundingNumber, badgeColor: badgeColor, size: size, compact: true)
        }
    }
}

/// Draws one badge. `compact` = the rocket-only founding badge used in rows.
struct BadgeGlyph: View {
    let badge: FeaturedBadge
    let foundingNumber: Int?
    let badgeColor: String?
    var size: CGFloat = 13
    var compact = true

    var body: some View {
        switch badge {
        case .verified:
            VerifiedBadgeView()
                .frame(width: size, height: size)
                .accessibilityLabel(String(localized: "Verified"))
        case .founding:
            if let foundingNumber {
                FoundingNumberBadge(number: foundingNumber, size: size, compact: compact)
            }
        case .quest:
            if let color = badgeColor.flatMap(QuestBadgeColor.init(rawValue:)) {
                QuestBadgeView(color: color.color)
                    .frame(width: size, height: size)
                    .accessibilityLabel(String(localized: "Quests complete"))
            }
        }
    }
}

/// Own profile: every owned badge, and which one shows on your posts.
struct FeaturedBadgePickerSheet: View {
    let isVerified: Bool
    let foundingNumber: Int?
    let badgeColor: String?
    let featured: String?
    /// Called after a successful save with the new raw value.
    let onSaved: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selection: FeaturedBadge?
    @State private var isSaving = false

    private var owned: [FeaturedBadge] {
        FeaturedBadge.owned(isVerified: isVerified, foundingNumber: foundingNumber, badgeColor: badgeColor)
    }

    private func title(_ badge: FeaturedBadge) -> String {
        switch badge {
        case .verified: return String(localized: "Verified")
        case .founding: return foundingNumber.map { String(format: String(localized: "Founding member #%@"), $0.foundingDigits) }
                               ?? String(localized: "Founding badge")
        case .quest:    return String(localized: "Quests complete")
        }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(owned) { badge in
                        Button {
                            Haptics.selection()
                            selection = badge
                        } label: {
                            HStack(spacing: 12) {
                                BadgeGlyph(badge: badge, foundingNumber: foundingNumber, badgeColor: badgeColor,
                                           size: 26, compact: badge != .founding)
                                    .frame(width: 30)
                                Text(title(badge))
                                    .font(.jakarta(15, weight: .semibold))
                                    .foregroundStyle(Color.sjInk)
                                Spacer()
                                if selection == badge {
                                    Image("icon-check")
                                        .renderingMode(.template)
                                        .resizable().scaledToFit()
                                        .frame(width: 16, height: 16)
                                        .foregroundStyle(Color.sjBlue)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } footer: {
                    Text("Your profile shows every badge you own. Posts show only the one you pick here.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Badges")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(selection == nil || isSaving)
                }
            }
        }
        .presentationDetents([.medium])
        .onAppear {
            selection = FeaturedBadge.resolve(featured: featured, isVerified: isVerified,
                                              foundingNumber: foundingNumber, badgeColor: badgeColor)
        }
    }

    private func save() async {
        guard let selection, let userId = supabase.auth.currentUser?.id else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await supabase.from("profiles")
                .update(["featured_badge": selection.rawValue])
                .eq("id", value: userId).execute()
            onSaved(selection.rawValue)
            dismiss()
        } catch {
            print("FeaturedBadgePickerSheet.save failed: \(error)")
        }
    }
}
