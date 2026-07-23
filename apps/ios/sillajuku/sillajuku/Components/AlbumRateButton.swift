import SwiftUI
import Supabase

/// Self-contained drag-to-rate button for any album cover, anywhere in the
/// app. Renders the flower gauge; a drag commits a quick score, a tap opens
/// the precise `ManualRatingSheet`, and a rated button shows its score and
/// stays re-ratable. Manages its own `ratings` upsert/delete -- drop it onto
/// a cover with no per-page plumbing. Renders nothing for signed-out users.
/// Ports web's `components/sj/AlbumRateButton.tsx`.
///
/// Callers in Instinct rating mode should not render this at all (mirrors
/// web's page-level `ratingMode !== 'instinct'` gate) -- a direct score
/// doesn't fit that rating model.
///
/// `initialScore` seeds the button when nothing else on the page needs to
/// know about changes. A page that renders a *second* rating surface for the
/// same release (the album page's hero cover alongside its full rating
/// section) should pass `externalScore` instead, so both surfaces read/write
/// the same value and never drift.
struct AlbumRateButton: View {
    let release: Release
    var initialScore: Double? = nil
    var externalScore: Binding<Double?>? = nil
    var ratingStep: Double = 0.5
    var onScoreChange: ((Double?) -> Void)? = nil
    var size: CGFloat = 30

    @State private var internalShown: Double?
    @State private var modalOpen = false

    private var shown: Double? { externalScore?.wrappedValue ?? internalShown }
    private var shownBinding: Binding<Double?> {
        externalScore ?? Binding(get: { internalShown }, set: { internalShown = $0 })
    }

    init(release: Release, initialScore: Double? = nil, externalScore: Binding<Double?>? = nil,
         ratingStep: Double = 0.5, onScoreChange: ((Double?) -> Void)? = nil, size: CGFloat = 30) {
        self.release = release
        self.initialScore = initialScore
        self.externalScore = externalScore
        self.ratingStep = ratingStep
        self.onScoreChange = onScoreChange
        self.size = size
        self._internalShown = State(initialValue: initialScore)
    }

    var body: some View {
        if supabase.auth.currentUser?.id != nil {
            FlowerRateControl(
                onRate: { s in Task { await quickRate(s) } },
                onRequestPrecise: { modalOpen = true },
                size: size,
                currentScore: shown,
                accessibilityLabelText: String(format: String(localized: "Rate %@"), release.displayTitle),
                ratingStep: ratingStep
            )
            .sheet(isPresented: $modalOpen) {
                ManualRatingSheet(release: release, existingScore: shownBinding, ratingStep: ratingStep) { s in
                    Task { await saveModal(s) }
                }
            }
        }
    }

    private func setShown(_ s: Double?) {
        if externalScore != nil { externalScore!.wrappedValue = s } else { internalShown = s }
    }

    private func quickRate(_ s: Double) async {
        setShown(s)
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct Upsert: Encodable {
            let userId: UUID; let releaseGroupId: UUID; let score: Double
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case releaseGroupId = "release_group_id"; case score
            }
        }
        try? await supabase.from("ratings")
            .upsert(Upsert(userId: userId, releaseGroupId: release.id, score: s),
                    onConflict: "user_id,release_group_id")
            .execute()
        onScoreChange?(s)
    }

    private func saveModal(_ s: Double?) async {
        setShown(s)
        guard let userId = supabase.auth.currentUser?.id else { return }
        if let s {
            struct Upsert: Encodable {
                let userId: UUID; let releaseGroupId: UUID; let score: Double
                enum CodingKeys: String, CodingKey {
                    case userId = "user_id"; case releaseGroupId = "release_group_id"; case score
                }
            }
            try? await supabase.from("ratings")
                .upsert(Upsert(userId: userId, releaseGroupId: release.id, score: s),
                        onConflict: "user_id,release_group_id")
                .execute()
        } else {
            try? await supabase.from("ratings")
                .delete()
                .eq("user_id", value: userId)
                .eq("release_group_id", value: release.id)
                .execute()
        }
        onScoreChange?(s)
    }
}
