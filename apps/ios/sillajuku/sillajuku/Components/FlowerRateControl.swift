import SwiftUI
import UIKit

/// Radii are literal drag distances from the button's centre: `offset` is a
/// dead zone (release inside = cancel), then each whole star is `step`
/// further out. Values ported verbatim from web's `FlowerRateControl.tsx` --
/// already tuned for touch there ("comfortable on a phone, and 0.1 of a
/// star is ~3.4px, so tenths stay distinguishable").
enum RateGaugeGeometry {
    static let tapThreshold: Double = 8
    static let offset: Double = 36
    static let step: Double = 34
    static let maxRadius: Double = offset + 5 * step

    static func scoreRadius(_ score: Double) -> Double { offset + score * step }

    /// Distance -> score snapped to `ratingStep` (the user's manual rating precision --
    /// 0.5 for half-star, 0.1 for decimal), or nil inside the dead zone (a cancel).
    /// Previously hardcoded to 0.1 regardless of the caller's step, so the drag gauge
    /// let a half-star user land on a decimal score -- the tap-to-open precise sheet
    /// already respected `ratingStep`, only the drag itself didn't.
    static func distanceToScore(_ dist: Double, ratingStep: Double) -> Double? {
        guard dist >= offset else { return nil }
        let stars = (dist - offset) / step
        let snapped = (stars / ratingStep).rounded() * ratingStep
        return min(5, max(0.5, snapped))
    }

    /// Fixed screen position for the drag-to-delete target -- deliberately
    /// NOT relative to the flower's own origin (which can be anywhere on
    /// screen), so it's one predictable spot regardless of which flower is
    /// being dragged. Top-center, clear of the status bar/Dynamic Island on
    /// all current devices. Same non-safe-area-aware convention the rest of
    /// this gauge overlay already uses (raw window/screen coordinates).
    static var deleteZoneCenter: CGPoint {
        CGPoint(x: UIScreen.main.bounds.width / 2, y: 150)
    }
    /// Hit-test radius around `deleteZoneCenter` -- matches Apple's minimum
    /// recommended touch target (44pt).
    static let deleteZoneRadius: Double = 44
}

/// Exclusive-by-default long-press-then-drag recognizer, replacing the plain
/// SwiftUI `LongPressGesture.sequenced(before: DragGesture(...))`
/// `FlowerRateControl` used to attach. Three attempts before landing here:
///
/// 1. Plain `.gesture()` (exclusive) -- reported live as blocking scroll
///    outright when a touch started on this control.
/// 2. `.simultaneousGesture()`, later a custom `UIGestureRecognizer` with
///    `shouldRecognizeSimultaneouslyWith` opting in to concurrency
///    specifically with `UIPanGestureRecognizer`. This "fixed" scroll by
///    letting both this control *and* the scroll view genuinely,
///    independently track the same touch at once -- which is exactly the
///    problem confirmed live afterward: once both are truly simultaneous,
///    nothing this control does *after* activating (disabling the scroll
///    view, `.scrollDisabled`, anything reactive) can retroactively decouple
///    a scroll that was never coupled to this control's own state in the
///    first place. Simultaneity wasn't a partial fix, it was the actual bug.
/// 3. Landed here: back to *not* simultaneous with pan at all -- plain UIKit
///    priority governs the conflict instead, the same mechanism a native
///    context menu already relies on to coexist correctly with scrolling in
///    every iOS app (hold still on an app icon in a horizontal carousel:
///    the menu wins; swipe instead: the scroll wins -- nobody needs to
///    "unstick" anything after the fact, because only one of them was ever
///    actually tracking). What attempt 1 almost certainly got wrong wasn't
///    exclusivity itself, but `allowableMovement` -- how far a touch can
///    drift during the hold before this recognizer gives up and lets the
///    scroll view's own (non-simultaneous, so *waiting-on-us*) pan proceed.
///    Left at the system default (10pt) in earlier rounds, a fast flick
///    still has to travel that whole 10pt, held back by this control the
///    entire way, before the scroll view is released -- read as "blocked"
///    rather than "brief lag." Tightened significantly below.
///
/// `shouldBeRequiredToFailBy` still explicitly forces every *non-pan*
/// recognizer -- including whatever internal recognizer a context menu's
/// press-and-hold uses -- to wait for this one to resolve first, rather than
/// leaving that conflict to an ordinary priority race; confirmed live this
/// part already worked correctly.
///
/// `UILongPressGestureRecognizer` is used directly (not a custom subclass)
/// since its own built-in behavior already matches what's needed: it holds
/// in `.possible` and fails if the touch moves more than `allowableMovement`
/// before `minimumPressDuration` elapses, then once `.began` fires it keeps
/// reporting `.changed` on any further movement with no distance cap --
/// exactly the "hold still, then drag freely in any direction" shape a
/// sequenced LongPress+Drag was reconstructing by hand.
private struct FlowerPressDragRecognizer: UIGestureRecognizerRepresentable {
    var minimumPressDuration: TimeInterval
    var allowableMovement: CGFloat
    /// Fires on `.began` and every `.changed`, with the current touch
    /// location in the same `.global` coordinate space `FlowerRateControl`
    /// already computes its button-center origin in.
    var onUpdate: (CGPoint) -> Void
    /// Fires once on `.ended` -- a press that reached `.began` and was then
    /// released normally. Never fires for a press that failed before
    /// `.began` (a quick tap, or movement past `allowableMovement`, e.g. a
    /// scroll) -- nothing was ever shown for those, so there's nothing to
    /// commit or clean up.
    var onEnded: () -> Void
    /// Fires on `.cancelled` (system-interrupted after `.began` -- an
    /// incoming call, a system gesture, etc.). Distinct from the ordinary
    /// pre-`.began` failure case above, which needs no cleanup at all.
    var onCancelled: () -> Void

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        /// Set true on `.began`, cleared on every terminal state (`.ended`,
        /// `.cancelled`, `.failed`) via `handleUIGestureRecognizerAction`
        /// below. `RateGaugeOverlay` is a single global singleton (the
        /// floating gauge window is shared across every flower in the app,
        /// not per-instance), so if *this* recognizer's own view is torn
        /// down mid-drag -- confirmed live: a paginated list loading a new
        /// row while a flower was actively being dragged -- without a
        /// terminal state ever reaching `handleUIGestureRecognizerAction`
        /// first, nothing would ever call `RateGaugeOverlay.shared.hide()`,
        /// leaving its floating gauge window stuck on screen ("the flower
        /// target is left in the screen idle") for good. `deinit` runs
        /// deterministically once this Coordinator's last reference (held by
        /// the torn-down recognizer/view) goes away, regardless of whether
        /// UIKit ever got to deliver a clean terminal state first, so it's
        /// used here as the guaranteed last chance to catch that and clean
        /// up.
        var isActive = false

        deinit {
            guard isActive else { return }
            // `deinit` is nonisolated even though this whole app runs on the
            // main actor by default -- UIKit view/gesture-recognizer
            // teardown (what triggers this) always happens on the main
            // thread in practice, so this is the standard escape hatch for
            // telling the compiler what's already true at runtime rather
            // than a genuine cross-actor hop.
            MainActor.assumeIsolated {
                RateGaugeOverlay.shared.hide()
            }
        }

        // No `shouldRecognizeSimultaneouslyWith` override -- UIKit's default
        // (exclusive/non-simultaneous) is exactly what's wanted now for
        // *every* other recognizer, pan included: let plain priority decide
        // who actually wins a given touch, rather than letting both track it
        // independently. See this type's own doc comment for why the
        // opposite choice (opting in to simultaneity with pan) was the bug,
        // not the fix.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer) -> Bool {
            !(otherGestureRecognizer is UIPanGestureRecognizer)
        }
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator {
        Coordinator()
    }

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let recognizer = UILongPressGestureRecognizer()
        recognizer.minimumPressDuration = minimumPressDuration
        recognizer.allowableMovement = allowableMovement
        recognizer.delegate = context.coordinator
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        recognizer.minimumPressDuration = minimumPressDuration
        recognizer.allowableMovement = allowableMovement
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        switch recognizer.state {
        case .began:
            context.coordinator.isActive = true
            onUpdate(context.converter.location(in: .global))
        case .changed:
            onUpdate(context.converter.location(in: .global))
        case .ended:
            context.coordinator.isActive = false
            onEnded()
        case .cancelled, .failed:
            context.coordinator.isActive = false
            onCancelled()
        default:
            break
        }
    }
}

/// Drag-to-rate flower control -- press the flower and drag outward; distance
/// from the button's centre maps to a score (farther = higher, 0.1 steps). A
/// press with no meaningful drag is a tap -> `onRequestPrecise` (open the full
/// rating sheet). Ports web's `components/sj/FlowerRateControl.tsx` gesture
/// math; the live gauge (arc + dotted baseline) renders in a floating
/// overlay window (`RateGaugeOverlay`) so it isn't clipped by whatever
/// scrolling container the button sits inside.
///
/// When `currentScore` is already set (re-rating an existing item) and the
/// caller supplies `onDelete`, dragging into the fixed delete zone (see
/// `RateGaugeGeometry.deleteZoneCenter`) instead deletes the rating -- the
/// overlay shows a trash target so this is discoverable without adding any
/// new chrome to the flower itself. The background treatment (the diffusing
/// scrim) is otherwise identical to a fresh rating's drag -- it used to swap
/// to a full-screen material blur here, which made re-rating an already-rated
/// item look and feel like a different gesture from rating a fresh one.
/// Fresh ratings (`currentScore == nil`) never show the trash target -- there's
/// nothing yet to delete.
struct FlowerRateControl: View {
    /// Commit a drag-selected score (0.5-5.0).
    let onRate: (Double) -> Void
    /// A tap (no drag) -- hand off to the precise rating sheet.
    var onRequestPrecise: (() -> Void)? = nil
    var size: CGFloat = 30
    /// If already rated, the resting score to show (still re-ratable on press).
    var currentScore: Double? = nil
    var accessibilityLabelText: String = ""
    /// The user's manual rating precision (0.5 half-star / 0.1 decimal, from
    /// `profiles.manual_rating_step`) -- the drag snaps to this, same as the
    /// tap-to-open precise sheet already does.
    var ratingStep: Double = 0.5
    /// Dragging into the fixed delete zone and releasing calls this instead
    /// of `onRate`. Only offered when `currentScore != nil` -- see the
    /// struct doc comment.
    var onDelete: (() -> Void)? = nil

    @State private var isDragging = false
    @State private var dragScore: Double? = nil
    @State private var dragAngle: Double = 0
    @State private var maxDist: Double = 0
    @State private var isOverDeleteZone = false

    private var shown: Double? { isDragging ? dragScore : currentScore }
    private var showNumber: Bool { shown != nil }
    private var canDelete: Bool { currentScore != nil && onDelete != nil }

    /// How long a press must hold still before the drag-to-rate gesture starts
    /// tracking at all -- so a quick tap still reads as a tap (see the
    /// separate, undelayed `.onTapGesture` below) rather than immediately
    /// engaging the drag machinery. Also, indirectly, what lets this control
    /// reliably win against a context menu's own (longer) press-and-hold
    /// threshold on the same touch -- see `FlowerPressDragRecognizer`'s doc
    /// comment for the full mechanism.
    private static let holdBeforeDrag: TimeInterval = 0.2
    /// How far a press can move before `holdBeforeDrag` elapses without
    /// failing this control's own recognizer -- passed straight through to
    /// `UILongPressGestureRecognizer.allowableMovement` (system default is
    /// `10`). This control's recognizer is exclusive with an enclosing
    /// `ScrollView`'s own pan (see `FlowerPressDragRecognizer`'s doc
    /// comment), so the scroll view has to wait for this one to fail before
    /// it can begin, for the entire distance set here -- at the system
    /// default, a fast flick starting on this control had to travel the
    /// full 10pt, held back the whole way, before scrolling was released,
    /// which read as "blocked" rather than a brief lag. Tightened well below
    /// the default so that hand-off happens close to instantly for anything
    /// resembling a real scroll, while still comfortably covering the small,
    /// mostly-still wobble of an intentional press-and-hold.
    private static let allowableMovement: CGFloat = 4

    var body: some View {
        GeometryReader { geo in
            buttonContent
                // A quick tap (shorter than `holdBeforeDrag`) would never reach
                // the sequenced gesture below at all -- LongPressGesture only
                // fires once its minimum duration has actually elapsed, so an
                // ordinary fast tap needs its own, separate, undelayed
                // recognizer to still open the precise sheet.
                .onTapGesture { onRequestPrecise?() }
                // See `FlowerPressDragRecognizer`'s own doc comment for why
                // this needs to be a real `UIGestureRecognizer` + delegate
                // rather than a plain SwiftUI `LongPressGesture.sequenced`:
                // `.gesture()`/`.simultaneousGesture()` can't tell this
                // control's two different ancestor conflicts (scroll,
                // context menu) apart, and each needs the opposite answer.
                .gesture(
                    FlowerPressDragRecognizer(
                        minimumPressDuration: Self.holdBeforeDrag,
                        allowableMovement: Self.allowableMovement,
                        onUpdate: { location in
                            let rect = geo.frame(in: .global)
                            let origin = CGPoint(x: rect.midX, y: rect.midY)
                            if !isDragging {
                                isDragging = true
                                maxDist = 0
                            }
                            let dx = Double(location.x - origin.x)
                            let dy = Double(location.y - origin.y)
                            let dist = (dx * dx + dy * dy).squareRoot()
                            maxDist = max(maxDist, dist)
                            if dist > 1 { dragAngle = atan2(dy, dx) }
                            dragScore = RateGaugeGeometry.distanceToScore(dist, ratingStep: ratingStep)

                            if canDelete {
                                let trash = RateGaugeGeometry.deleteZoneCenter
                                let tdx = Double(location.x - trash.x)
                                let tdy = Double(location.y - trash.y)
                                let distToTrash = (tdx * tdx + tdy * tdy).squareRoot()
                                // Also require having left the dead zone first, so a
                                // flower that happens to sit right next to the fixed
                                // trash spot doesn't delete on a near-tap.
                                isOverDeleteZone = maxDist >= RateGaugeGeometry.offset
                                    && distToTrash < RateGaugeGeometry.deleteZoneRadius
                            }

                            RateGaugeOverlay.shared.show(
                                origin: origin, angle: dragAngle, score: dragScore, size: size,
                                canDelete: canDelete, isOverDeleteZone: isOverDeleteZone
                            )
                        },
                        onEnded: {
                            defer {
                                isDragging = false
                                isOverDeleteZone = false
                                RateGaugeOverlay.shared.hide()
                            }
                            if isOverDeleteZone {
                                onDelete?()
                                return
                            }
                            if maxDist < RateGaugeGeometry.tapThreshold {
                                onRequestPrecise?()
                                return
                            }
                            guard let s = dragScore else { return } // released in dead zone -> cancel
                            onRate(s)
                        },
                        onCancelled: {
                            guard isDragging else { return }
                            isDragging = false
                            isOverDeleteZone = false
                            RateGaugeOverlay.shared.hide()
                        }
                    )
                )
        }
        .frame(width: size, height: size)
        // Deliberately the most dramatic haptic in the app -- this is the quick
        // add-a-rating-without-opening-the-sheet gesture (search/feed/profile
        // cards), so every step is a full-intensity heavy impact, and hitting
        // the 5.0 ceiling escalates further to the .success pattern (the same
        // celebratory multi-pulse used for the quest badge unlock) rather than
        // just another impact -- a clearly distinct "topped it out" moment.
        .sensoryFeedback(trigger: dragScore) { old, new in
            guard let new else { return nil } // dead zone / cancel -- no feedback
            return new >= 5.0 && (old ?? 0) < 5.0 ? .success : .impact(weight: .heavy, intensity: 1.0)
        }
        // Distinct from the per-star impact above -- crossing into the
        // delete zone is a mode change (rating -> deleting), not another
        // step, so it gets sensoryFeedback's own dedicated warning pattern.
        .sensoryFeedback(.warning, trigger: isOverDeleteZone) { old, new in !old && new }
    }

    private var buttonContent: some View {
        ZStack {
            FlowerGlyph(size: size * 0.56)
                .foregroundStyle(Color.sjBlue)
                .opacity(showNumber || isOverDeleteZone ? 0 : 1)
                .scaleEffect(showNumber ? 0.82 : 1)

            Image("icon-trash")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: size * 0.4, height: size * 0.4)
                .foregroundStyle(.white)
                .opacity(isOverDeleteZone ? 1 : 0)
                .scaleEffect(isOverDeleteZone ? 1 : 0.6)

            Text(shown != nil ? String(format: "%.1f", shown!) : "")
                .font(.jakarta(size * 0.4, weight: .black))
                .foregroundStyle(showNumber ? ScoreSpectrum.numberColor(for: shown!) : .clear)
                .opacity(showNumber && !isOverDeleteZone ? 1 : 0)
                .scaleEffect(showNumber ? 1 : 0.6)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .frame(width: size, height: size)
        // Liquid Glass, matching ScoreBadge's own rated-circle treatment --
        // was a flat opaque `Circle().fill(.white)` before, which read as a
        // plain solid button with no material at all next to every other
        // rating surface in the app (ScoreBadge, the artist-tab bubble) that
        // already uses `.glassEffect`. Neutral/untinted at rest, tinted with
        // the same score-spectrum color ScoreBadge uses once rated, red while
        // hovering the delete zone.
        .glassEffect(
            isOverDeleteZone ? .regular.tint(Color.red)
                : showNumber ? .regular.tint(ScoreSpectrum.fill(for: shown!))
                : .regular,
            in: Circle()
        )
        .contentShape(Circle())
        // Hidden while dragging -- the overlay window (RateGaugeOverlay)
        // draws a duplicate of this exact content lifted and popped forward
        // in front of the diffusing fade (see RateGaugeView.poppedFlower),
        // matching web's portal-based approach. Opacity 0 rather than
        // removing the view: the DragGesture is attached here and keeps
        // receiving touch events regardless of opacity, same as web relying
        // on pointer capture surviving a CSS opacity change.
        .opacity(isDragging ? 0 : 1)
        .animation(.easeOut(duration: 0.13), value: showNumber)
        .animation(.easeOut(duration: 0.13), value: isOverDeleteZone)
        .accessibilityLabel(accessibilityLabelText)
    }
}

// MARK: - Gauge overlay content

private let arcSpan: Double = 52 * .pi / 180 // total sweep of the arc, radians
private let arcSegments = 22

/// The live gauge: a diffusing dark scrim behind a popped-forward flower,
/// concentric star-scale rings, a dotted baseline, plus one thin arc at the
/// current score's radius, centred on the drag angle and fading toward both
/// ends. Ports web's `DragGauge` (part of `FlowerRateControl.tsx`) -- same
/// "flower lifts in front of a fade that diffuses outward from behind it"
/// treatment, used identically whether this is a fresh rating or a re-rate.
/// When `canDelete` is set, also draws the fixed trash target described on
/// `FlowerRateControl`, layered on top of the same scrim -- this used to
/// swap the scrim out for a full-screen material blur instead, which made
/// the two flows feel inconsistent with each other.
struct RateGaugeView: View {
    let origin: CGPoint
    let angle: Double
    let score: Double?
    let size: CGFloat
    var canDelete: Bool = false
    var isOverDeleteZone: Bool = false

    private var cancel: Bool { score == nil }
    private var color: Color { ScoreSpectrum.ringColor(for: score ?? 0.5) }
    private var radius: Double { RateGaugeGeometry.scoreRadius(score ?? 0.5) }

    // Drives the pop/diffuse-in on appear -- flips true immediately after
    // mount so the "before" state (flat, undiffused) genuinely paints first
    // and `withAnimation` has something to animate from, mirroring web's
    // requestAnimationFrame-gated `shown` flag.
    @State private var popped = false

    var body: some View {
        ZStack {
            diffusingScrim

            // Arc/rings/baseline fade out once primed to delete -- they no
            // longer mean anything (the drag isn't going to commit a score).
            gaugeCanvas
                .opacity(isOverDeleteZone ? 0 : 1)

            if canDelete {
                trashTarget
            }

            poppedFlower
        }
        // On the whole ZStack -- `origin` and
        // `deleteZoneCenter` are both raw global/window coordinates (from
        // DragGesture's .global space and UIScreen.main.bounds), but without
        // this, the ZStack's own layout frame -- and so trashTarget's
        // .position() and gaugeCanvas's default sizing -- is inset by the
        // window's safe area, so the trash icon rendered ~59pt below where
        // it actually hit-tested (confirmed live: releasing on the visible
        // icon didn't delete; releasing well above it did).
        .ignoresSafeArea()
        .animation(.easeOut(duration: 0.15), value: isOverDeleteZone)
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.46)) {
                popped = true
            }
        }
    }

    /// Fully clear right behind the (lifted) flower, building to its darkest
    /// through the gauge band, dissolving to nothing beyond -- and animated:
    /// grows from a tight disc to full reach on press, scaled about the
    /// button's own centre, rather than snapping on as a flat wash. The
    /// gradient itself is drawn once at full size; only `.scaleEffect`
    /// animates (Canvas content doesn't tween on its own), same trick as
    /// web's CSS `transform: scale()` on a static gradient.
    private var diffusingScrim: some View {
        let maxR = RateGaugeGeometry.maxRadius
        let endRadius = maxR * 1.62
        let stops: [Gradient.Stop] = [
            .init(color: Self.scrimColor(0), location: 0),
            .init(color: Self.scrimColor(0.05), location: RateGaugeGeometry.offset * 0.72 / endRadius),
            .init(color: Self.scrimColor(0.30), location: (RateGaugeGeometry.offset + RateGaugeGeometry.step * 0.9) / endRadius),
            .init(color: Self.scrimColor(0.42), location: (RateGaugeGeometry.offset + RateGaugeGeometry.step * 2.4) / endRadius),
            .init(color: Self.scrimColor(0.30), location: maxR / endRadius),
            .init(color: Self.scrimColor(0), location: 1),
        ]
        return Circle()
            .fill(RadialGradient(gradient: Gradient(stops: stops), center: .center, startRadius: 0, endRadius: endRadius))
            .frame(width: endRadius * 2, height: endRadius * 2)
            .position(origin)
            // Default .center anchor is correct here -- .position(origin)
            // already centres the circle's own centre at origin, so scaling
            // around .center (the shape's own centre) scales around origin.
            .scaleEffect(popped ? 1 : 0.35)
            .opacity(popped ? 1 : 0)
    }

    private static func scrimColor(_ opacity: Double) -> Color {
        Color(.sRGB, red: 8.0 / 255, green: 8.0 / 255, blue: 12.0 / 255, opacity: opacity)
    }

    /// The flower itself, lifted out of the page and popped forward in 3D --
    /// rendered here (above the scrim) so it sits genuinely in front of the
    /// fade rather than under it. Mirrors `FlowerRateControl.buttonContent`'s
    /// flower<->score crossfade (duplicated rather than shared, same as
    /// web's own `DragGauge`, which inlines the same markup rather than
    /// factoring out a shared subcomponent); the in-flow original is hidden
    /// while this is up.
    private var poppedFlower: some View {
        let showNumber = score != nil
        return ZStack {
            FlowerGlyph(size: size * 0.56)
                .foregroundStyle(Color.sjBlue)
                .opacity(showNumber || isOverDeleteZone ? 0 : 1)
                .scaleEffect(showNumber ? 0.82 : 1)
            Image("icon-trash")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: size * 0.4, height: size * 0.4)
                .foregroundStyle(.white)
                .opacity(isOverDeleteZone ? 1 : 0)
                .scaleEffect(isOverDeleteZone ? 1 : 0.6)
            Text(score != nil ? String(format: "%.1f", score!) : "")
                .font(.jakarta(size * 0.4, weight: .black))
                .foregroundStyle(showNumber ? ScoreSpectrum.numberColor(for: score!) : .clear)
                .opacity(showNumber && !isOverDeleteZone ? 1 : 0)
                .scaleEffect(showNumber ? 1 : 0.6)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .frame(width: size, height: size)
        // Same glass treatment as the in-flow buttonContent this is a popped-forward
        // duplicate of -- kept in sync so the control doesn't visibly switch from
        // glass to a flat fill the moment a drag starts.
        .glassEffect(
            isOverDeleteZone ? .regular.tint(Color.red)
                : showNumber ? .regular.tint(ScoreSpectrum.fill(for: score!))
                : .regular,
            in: Circle()
        )
        .shadow(color: .black.opacity(popped ? 0.6 : 0.3), radius: popped ? 12 : 3, y: popped ? 8 : 1)
        .shadow(color: .black.opacity(popped ? 0.4 : 0), radius: popped ? 5 : 0, y: popped ? 3 : 0)
        .scaleEffect(popped ? 1.22 : 1)
        .offset(y: popped ? -3 : 0)
        .position(origin)
        .animation(.timingCurve(0.34, 1.5, 0.64, 1, duration: 0.22), value: popped)
        .animation(.easeOut(duration: 0.13), value: showNumber)
        .animation(.easeOut(duration: 0.13), value: isOverDeleteZone)
    }

    private var trashTarget: some View {
        let center = RateGaugeGeometry.deleteZoneCenter
        let size: CGFloat = isOverDeleteZone ? 60 : 48
        return ZStack {
            Circle()
                .fill(isOverDeleteZone ? Color.red : Color.red.opacity(0.85))
                .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
            Image("icon-trash")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: size * 0.42, height: size * 0.42)
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .scaleEffect(isOverDeleteZone ? 1.1 : 1)
        .position(center)
    }

    private var gaugeCanvas: some View {
        Canvas { context, _ in
            let ox = Double(origin.x), oy = Double(origin.y)

            // Dotted baseline, both halves, starting at the dead-zone edge.
            for side in [-1.0, 1.0] {
                var path = Path()
                path.move(to: CGPoint(x: ox + side * RateGaugeGeometry.offset, y: oy))
                path.addLine(to: CGPoint(x: ox + side * RateGaugeGeometry.maxRadius, y: oy))
                context.stroke(
                    path,
                    with: .color(Color.gray.opacity(0.4)),
                    style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [1, 5])
                )
            }

            // Concentric star-scale rings -- one full circle at each whole-star
            // radius, the gauge's primary scale. Faint dashed by default, but
            // a solid colour-filled ring once the drag has reached that star,
            // so "you're past 3★" reads unmistakably against the scrim.
            for s in 1...5 {
                let r = RateGaugeGeometry.scoreRadius(Double(s))
                let reached = !cancel && score! >= Double(s)
                var ring = Path()
                ring.addEllipse(in: CGRect(x: ox - r, y: oy - r, width: r * 2, height: r * 2))
                context.stroke(
                    ring,
                    with: .color(reached ? color.opacity(0.7) : Color(.sRGB, red: 232/255, green: 234/255, blue: 244/255).opacity(0.24)),
                    style: reached
                        ? StrokeStyle(lineWidth: 1.75)
                        : StrokeStyle(lineWidth: 1, dash: [2, 5])
                )
            }

            // Dead-zone edge.
            var deadZone = Path()
            deadZone.addEllipse(in: CGRect(
                x: ox - RateGaugeGeometry.offset, y: oy - RateGaugeGeometry.offset,
                width: RateGaugeGeometry.offset * 2, height: RateGaugeGeometry.offset * 2
            ))
            context.stroke(
                deadZone,
                with: .color(cancel ? Color.gray.opacity(0.35) : color.opacity(0.18)),
                style: StrokeStyle(lineWidth: 1, dash: [2, 4])
            )

            // Fading arc, centred on the drag angle.
            guard !cancel else { return }
            let step = arcSpan / Double(arcSegments)
            for i in 0..<arcSegments {
                let t = (Double(i) + 0.5) / Double(arcSegments)
                let a0 = angle - arcSpan / 2 + Double(i) * step
                let a1 = a0 + step * 1.04 // slight overlap so strokes read continuous
                let fade = pow(sin(t * .pi), 1.4) // opaque mid-arc, vanishing at both ends
                var seg = Path()
                seg.move(to: CGPoint(x: ox + radius * cos(a0), y: oy + radius * sin(a0)))
                seg.addLine(to: CGPoint(x: ox + radius * cos(a1), y: oy + radius * sin(a1)))
                context.stroke(
                    seg,
                    with: .color(color.opacity(fade * 0.95)),
                    style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
                )
            }
        }
        .ignoresSafeArea()
    }
}
