import SwiftUI

// Top-level, not nested in SwipeableTabPager -- a PreferenceKey nested in a generic type can't
// declare a static stored property (Swift: "static stored properties not supported in generic
// types").
private struct SwipeableTabPagerWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
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
        .highPriorityGesture(swipeGesture)
    }

    // Verified directly (via idb swipe + screenshot, ProfileView's original) that plain
    // .gesture() does NOT out-prioritize a child's own tap gesture -- a swipe was still being
    // read as a tap on a NavigationLink underneath and pushed into its destination instead of
    // switching tabs. .highPriorityGesture forces this to win once it actually recognizes a
    // drag. It only "wins" after minimumDistance is crossed -- a real tap (released before
    // that) never triggers this gesture at all, so it still falls through to the view
    // underneath normally.
    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                var t = value.translation.width
                if t > 0, activeIndex == 0 { t = 0 }                            // can't go before the first tab
                if t < 0, activeIndex == allCases.count - 1 { t = 0 }            // or past the last one
                dragTranslation = t
            }
            .onEnded { value in
                // A gesture that stayed vertical-dominant the whole time (a scroll attempt that
                // happened to cross minimumDistance) never set dragTranslation -- spring back to
                // 0 (a no-op, since it's already 0) instead of evaluating a page turn.
                guard abs(value.translation.width) > abs(value.translation.height) else {
                    withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.82)) {
                        dragTranslation = 0
                    }
                    return
                }
                let idx = activeIndex
                var t = value.translation.width
                if t > 0, idx == 0 { t = 0 }
                if t < 0, idx == allCases.count - 1 { t = 0 }
                dragTranslation = t

                // A fast flick completes the page turn even short of the distance threshold --
                // matches native paging's feel, which factors in velocity, not just where the
                // finger happened to be at release.
                let isFastFlick = abs(value.velocity.width) > 500
                let distanceThreshold = contentWidth * 0.25
                var newIdx = idx
                if (t < -distanceThreshold || (isFastFlick && t < 0)), idx < allCases.count - 1 {
                    newIdx = idx + 1
                } else if (t > distanceThreshold || (isFastFlick && t > 0)), idx > 0 {
                    newIdx = idx - 1
                }

                if newIdx != idx {
                    // Finish the page turn in the same direction the finger was already moving,
                    // then swap selection and zero the offset at the exact instant it completes --
                    // the new page is already sitting at that same visual position, so the swap
                    // itself is imperceptible.
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
}
