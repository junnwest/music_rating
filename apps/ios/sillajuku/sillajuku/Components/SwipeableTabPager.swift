import SwiftUI
import UIKit

// Top-level, not nested in SwipeableTabPager -- a PreferenceKey nested in a generic type can't
// declare a static stored property (Swift: "static stored properties not supported in generic
// types").
private struct SwipeableTabPagerWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

// A plain SwiftUI DragGesture recognizes once total movement (in ANY direction) crosses
// minimumDistance -- there's no way to ask it "only claim the touch if the motion turns out to
// be horizontal." Combined with .highPriorityGesture, that means a vertical scroll attempt that
// happens to move `minimumDistance` points gets the touch claimed away from the outer
// ScrollView -- the onChanged/onEnded horizontal-vs-vertical guards then correctly do nothing
// with it, but by then the ScrollView's own pan has already been preempted for that gesture, so
// the touch just dies (no scroll, no page turn). This is why lowering minimumDistance to make
// swiping feel more responsive made ordinary scrolling feel broken -- a lower threshold means
// more scroll attempts cross it and get stolen. A raw UIPanGestureRecognizer can inspect
// direction in touchesMoved and fail itself (.failed) before UIKit's gesture arbitration ever
// commits to a winner, releasing the touch back to the ScrollView untouched -- something no
// SwiftUI-level Gesture composition (.highPriorityGesture/.simultaneousGesture/.exclusively) can
// express, since they all operate after a gesture has already "recognized."
private final class DirectionalPanGestureRecognizer: UIPanGestureRecognizer {
    private var startLocation: CGPoint = .zero
    private let armDistance: CGFloat = 10

    override func reset() {
        super.reset()
        startLocation = .zero
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        if let touch = touches.first { startLocation = touch.location(in: view) }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        if state == .possible, let touch = touches.first {
            let loc = touch.location(in: view)
            let dx = loc.x - startLocation.x
            let dy = loc.y - startLocation.y
            if (abs(dx) >= armDistance || abs(dy) >= armDistance) && abs(dy) > abs(dx) {
                state = .failed
                return
            }
        }
        super.touchesMoved(touches, with: event)
    }
}

@available(iOS 18.0, *)
private struct DirectionalSwipeGesture: UIGestureRecognizerRepresentable {
    let onChanged: (CGFloat) -> Void
    let onEnded: (CGFloat, CGFloat) -> Void

    func makeUIGestureRecognizer(context: Context) -> DirectionalPanGestureRecognizer {
        DirectionalPanGestureRecognizer()
    }

    func updateUIGestureRecognizer(_ recognizer: DirectionalPanGestureRecognizer, context: Context) {}

    func handleUIGestureRecognizerAction(_ recognizer: DirectionalPanGestureRecognizer, context: Context) {
        let translation = recognizer.translation(in: recognizer.view)
        switch recognizer.state {
        case .changed:
            onChanged(translation.x)
        case .ended, .cancelled:
            let velocity = recognizer.velocity(in: recognizer.view)
            onEnded(translation.x, velocity.x)
        default:
            break
        }
    }
}

/// Real 1:1 finger tracking for a horizontally-swipeable subtab area whose content sits inside
/// a taller *vertical* ScrollView (hero + tab bar + this) -- the pattern ProfileView/
/// UserProfileView use for "hero on top, subtabs below." Native `TabView(.page)` can't be nested
/// inside that outer ScrollView without fighting it for the vertical gesture, so this reimplements
/// paging by hand: current page is offset by `dragTranslation` exactly as set in `onChanged` (no
/// animation applied to that write), so holding the finger still mid-drag leaves the content
/// exactly where it is; only release animates, either finishing the page turn or springing back.
///
/// Extracted from ProfileView's original inline copy after two real bugs showed up there and
/// would otherwise have needed fixing twice (UserProfileView never got a swipe gesture of its own
/// at all): swipes felt unresponsive against ArtistPageView's native TabView.page, and a swipe
/// that started on top of a NavigationLink row (album cover, list row) sometimes still triggered
/// that link's navigation instead of switching tabs.
///
/// Fixes applied here vs. the original:
/// - `minimumDistance` lowered 15 -> 10, so a real swipe claims the gesture sooner.
/// - Completion in `onEnded` now honors a fast flick (via `value.velocity`) even when the total
///   drag distance falls short of the 25% (previously 33%, distance-only) page-turn threshold --
///   matches how native paging (UIScrollView-backed) already feels forgiving of short, fast flicks.
/// - `.allowsHitTesting(dragTranslation == 0)` on the page content itself, as defense-in-depth
///   alongside `.highPriorityGesture`: NavigationLink's own tap recognizer has a known history of
///   not reliably yielding to a sibling gesture, so once a real drag is actively offsetting the
///   page, the row content underneath is hit-test-disabled outright rather than relying solely on
///   gesture priority to suppress it.
struct SwipeableTabPager<Tab: Hashable & CaseIterable, Content: View>: View where Tab.AllCases: RandomAccessCollection {
    @Binding var selection: Tab
    var minHeight: CGFloat = 0
    @ViewBuilder var content: (Tab) -> Content

    @State private var dragTranslation: CGFloat = 0
    @State private var contentWidth: CGFloat = UIScreen.main.bounds.width

    private var allCases: [Tab] { Array(Tab.allCases) }
    private var activeIndex: Int { allCases.firstIndex(of: selection) ?? 0 }

    // Which tab is being dragged into view alongside the active one -- only non-nil while
    // actively dragging (dragTranslation != 0), so at rest this is still just one page.
    private var adjacentTab: Tab? {
        guard dragTranslation != 0 else { return nil }
        let idx = activeIndex
        if dragTranslation < 0 {
            return idx < allCases.count - 1 ? allCases[idx + 1] : nil
        } else {
            return idx > 0 ? allCases[idx - 1] : nil
        }
    }

    var body: some View {
        ZStack(alignment: .top) {
            content(selection)
                .frame(width: contentWidth, alignment: .top)
                .offset(x: dragTranslation)
            if let adjacentTab {
                content(adjacentTab)
                    .frame(width: contentWidth, alignment: .top)
                    .offset(x: dragTranslation + (dragTranslation < 0 ? contentWidth : -contentWidth))
            }
        }
        // Disabled only on the page content, not the outer container the gesture below is
        // attached to -- so the gesture keeps tracking the drag to completion even though the
        // rows underneath stop accepting taps partway through.
        .allowsHitTesting(dragTranslation == 0)
        .frame(minHeight: minHeight, alignment: .top)
        .background(
            GeometryReader { geo in
                Color.clear.preference(key: SwipeableTabPagerWidthKey.self, value: geo.size.width)
            }
        )
        .onPreferenceChange(SwipeableTabPagerWidthKey.self) { width in
            if width > 0 { contentWidth = width }
        }
        .clipped()
        .contentShape(Rectangle())
        // Not .highPriorityGesture -- UIGestureRecognizerRepresentable doesn't offer that
        // overload, and doesn't need it: this is a real UIGestureRecognizer attached directly to
        // the hosting view, so once it actually recognizes (a genuine horizontal swipe),
        // UIKit's own default `cancelsTouchesInView = true` behavior already cancels the
        // NavigationLink's tap underneath -- and for a vertical-dominant drag, it fails itself
        // before ever recognizing, so it never competes with the ScrollView at all.
        .gesture(
            DirectionalSwipeGesture(onChanged: handleChanged, onEnded: handleEnded)
        )
    }

    // DirectionalPanGestureRecognizer already refuses to recognize a vertical-dominant drag at
    // all (see its touchesMoved override) -- by the time either of these fires, the gesture has
    // already committed to being a horizontal swipe, so there's no vertical guard to repeat here
    // the way the old plain-DragGesture version needed.
    private func handleChanged(_ translationX: CGFloat) {
        var t = translationX
        if t > 0, activeIndex == 0 { t = 0 }                         // can't go before the first tab
        if t < 0, activeIndex == allCases.count - 1 { t = 0 }        // or past the last one
        dragTranslation = t
    }

    private func handleEnded(_ translationX: CGFloat, velocityX: CGFloat) {
        let idx = activeIndex
        var t = translationX
        if t > 0, idx == 0 { t = 0 }
        if t < 0, idx == allCases.count - 1 { t = 0 }
        dragTranslation = t

        // A fast flick completes the page turn even short of the distance threshold -- matches
        // native paging's feel, which factors in velocity, not just where the finger happened to
        // be at release.
        let isFastFlick = abs(velocityX) > 500
        let distanceThreshold = contentWidth * 0.25
        var newIdx = idx
        if (t < -distanceThreshold || (isFastFlick && t < 0)), idx < allCases.count - 1 {
            newIdx = idx + 1
        } else if (t > distanceThreshold || (isFastFlick && t > 0)), idx > 0 {
            newIdx = idx - 1
        }

        if newIdx != idx {
            // Finish the page turn in the same direction the finger was already moving, then
            // swap selection and zero the offset at the exact instant it completes -- the new
            // page is already sitting at that same visual position, so the swap itself is
            // imperceptible.
            withAnimation(.easeOut(duration: 0.22)) {
                dragTranslation = dragTranslation < 0 ? -contentWidth : contentWidth
            } completion: {
                selection = allCases[newIdx]
                dragTranslation = 0
            }
        } else {
            withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.82)) {
                dragTranslation = 0
            }
        }
    }
}
