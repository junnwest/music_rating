import SwiftUI

/// A "Rate this Album"/"+" style button that morphs in place into the
/// drag-to-rate `FlowerRateControl`, using iOS 26 Liquid Glass
/// (`GlassEffectContainer` + `glassEffectID`) so the glass shell shape
/// interpolates between states instead of cross-fading between unrelated
/// views. No sheet is ever presented -- the caller's `onRate` fires the
/// moment the drag commits a score.
///
/// Deliberately for FRESH ratings only (`currentScore` is always nil going
/// in) -- editing an existing rating still goes through
/// `ManualRatingSheet`/`TrackRatingSheet`, which have their own entry points
/// (a FeedCard's "Edit" menu action, a tap-to-precise fallback) unrelated to
/// this component.
///
/// Once a drag commits, this view intentionally stays showing the flower
/// (no reset back to `.idle`) rather than trying to render any "rated" state
/// of its own -- the caller is expected to swap this whole component out for
/// its real rated UI (a score pill, a FeedCard, ...) once its own data
/// reflects the new rating, same as it already had to do before the rating
/// existed at all. This avoids a visible flash back to the full idle button
/// while the caller's own state/network round-trip is still catching up.
struct MorphingRateButton<IdleLabel: View>: View {
    @ViewBuilder var idleLabel: () -> IdleLabel
    /// The idle button's glass shape -- a rounded rect for a full-width album
    /// button, a circle for a compact track-row "+".
    var idleShape: AnyShape = AnyShape(Capsule())
    var idleTint: Color = Color.sjBlue
    /// High by design -- reads as solid vivid blue (the pre-glass look) while
    /// still being a real glass material underneath, so glassEffectID keeps
    /// morphing it smoothly into the flower rather than needing a flat
    /// (non-glass) idle state that could only cross-fade.
    var idleTintOpacity: Double = 0.95
    /// Same size FlowerRateControl already defaults to everywhere else in the
    /// app (cover quick-rate buttons) -- one consistent flower size, not a
    /// bespoke bigger one for this flow.
    var flowerSize: CGFloat = 30
    var ratingStep: Double = 0.5
    var accessibilityLabelText: String = ""
    /// When set, ties the flower's geometry (position + size) to whatever
    /// else in the host view shares the same `matchedGeometryID` in this
    /// namespace -- typically a `ScoreBadge` the caller shows once the
    /// rating lands, so the flower visibly morphs into that exact badge at
    /// its exact final position, instead of one view vanishing and an
    /// unrelated one appearing elsewhere. nil (default) opts out entirely.
    var matchedGeometryNamespace: Namespace.ID? = nil
    var matchedGeometryID: String = "scoreBadge"
    /// Fires once the drag commits a score (0.5-5.0).
    let onRate: (Double) -> Void

    private enum Phase { case idle, rating }
    @State private var phase: Phase = .idle
    @Namespace private var glassNamespace

    var body: some View {
        GlassEffectContainer(spacing: 40) {
            switch phase {
            case .idle:
                Button {
                    withAnimation(.bouncy) { phase = .rating }
                } label: {
                    idleLabel()
                }
                .buttonStyle(.plain)
                .glassEffect(.regular.tint(idleTint.opacity(idleTintOpacity)), in: idleShape)
                .glassEffectID("rateControl", in: glassNamespace)

            case .rating:
                // Plain .regular (no .interactive()) -- that modifier is
                // documented for Button-driven glass; FlowerRateControl is a
                // bespoke DragGesture view, not a Button, so it's left off
                // rather than assuming untested behavior.
                Group {
                    if let matchedGeometryNamespace {
                        flowerView
                            .matchedGeometryEffect(id: matchedGeometryID, in: matchedGeometryNamespace)
                    } else {
                        flowerView
                    }
                }
                .glassEffect(.regular, in: Circle())
                .glassEffectID("rateControl", in: glassNamespace)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var flowerView: some View {
        FlowerRateControl(
            onRate: onRate,
            size: flowerSize,
            currentScore: nil,
            accessibilityLabelText: accessibilityLabelText,
            ratingStep: ratingStep
        )
    }
}
