import SwiftUI
import UIKit

enum AppTab: Hashable { case home, rankings, add, taste, profile }

struct MainTabView: View {
    @State private var homeVM      = HomeViewModel()
    @State private var chartsVM    = ChartsViewModel()
    @State private var profileVM   = ProfileViewModel()
    @State private var discoveryVM = DiscoveryViewModel()
    @State private var tasteVM     = TasteViewModel()
    // Hoisted (not owned by ProfileView) so the tab badge, the nav-bar dot in
    // Profile, and the checklist sheet itself all read the SAME loaded state --
    // the badge/dot show based on actual completion (isFullyComplete), not a
    // one-time "have you opened this" flag, so they need real quest data, not
    // just a local UserDefaults bool.
    @State private var questVM = QuestChecklistViewModel()

    @State private var selectedTab: AppTab = .home
    @State private var homeScrollTrigger   = UUID()
    @State private var showBadgeRedeem     = false
    // Set true by SearchView's Quick Add mode-gate popup ("Go to Settings"); ProfileView
    // watches this binding and auto-opens its own Settings sheet, then resets it to false.
    @State private var pendingOpenSettings = false

    // Rendered once per appearance: a rounded rect (wider than tall) with a
    // plus *cut out* of it — the plus is a transparent hole (via
    // .destinationOut), not a colored fill, and the rect's own fill is the
    // inverse of the current color scheme (black rect in light mode, white
    // rect in dark mode) so it always reads as a punched-through action
    // button rather than just another tab icon. `.renderingMode(.alwaysOriginal)`
    // below means this fill color is final -- unlike the other four tabs' SF
    // Symbols (template images that pick up the TabView's .tint(Color.sjAmber)
    // automatically when selected), this one won't turn blue on its own, so the
    // call site swaps in the sjBlue-filled variant by hand when Add is selected.
    private static func addTabImage(fillColor: Color) -> UIImage {
        let shape = ZStack {
            RoundedRectangle(cornerRadius: 11, style: .continuous)
                .fill(fillColor)
            Group {
                Rectangle().frame(width: 11, height: 2.2)
                Rectangle().frame(width: 2.2, height: 11)
            }
            .blendMode(.destinationOut)
        }
        .compositingGroup()
        .frame(width: 40, height: 26)
        let renderer = ImageRenderer(content: shape)
        renderer.scale = 3
        renderer.isOpaque = false
        let image = renderer.uiImage ?? UIImage()
        return image.withRenderingMode(.alwaysOriginal)
    }

    // Three pre-rendered variants — picked per-appearance/selection state at the
    // call site via @Environment(\.colorScheme) and selectedTab below. (UIImage
    // has no dynamicProvider initializer the way UIColor does; that's UIColor-only.)
    // sjBlue isn't scheme-adaptive, so the selected variant needs no light/dark split.
    private static let addTabImageLight    = addTabImage(fillColor: .black)
    private static let addTabImageDark     = addTabImage(fillColor: .white)
    private static let addTabImageSelected = addTabImage(fillColor: .sjBlue)

    @Environment(\.colorScheme) private var colorScheme

    // Tabs the user has actually switched to at least once. SwiftUI's TabView
    // (unlike List/LazyVStack) builds ALL of its static children -- and fires
    // their .task -- the moment the TabView itself appears, not just the
    // selected one. That defeated the "Charts/Add/Taste/Profile load lazily on
    // first visit" intent described below: all four were actually firing their
    // full load() pipelines simultaneously, competing for the same connections,
    // right as the tab bar first appeared -- exactly the kind of eager-cold-launch
    // contention this same comment already measured and fixed once before (by
    // moving the calls out of MainTabView's own .task), just reintroduced one
    // level down via TabView's own eagerness instead of an explicit taskgroup.
    // Placeholder-until-visited (below) makes each tab's view -- and its .task --
    // not exist at all until actually selected, so only one loads at a time.
    @State private var visitedTabs: Set<AppTab> = [.home]

    // The ONLY way selectedTab should be mutated -- every jump (user tap via
    // tabSelection below, or a programmatic one like onGoToAdd/onOwnProfileTap)
    // must also mark the destination visited, or it renders as the blank
    // Color.clear placeholder the first time something jumps to a tab the user
    // hasn't tapped directly yet.
    private func goTo(_ tab: AppTab) {
        selectedTab = tab
        visitedTabs.insert(tab)
    }

    // Custom binding that detects re-tapping the current tab
    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { selectedTab },
            set: { newVal in
                if newVal == selectedTab, newVal == .home {
                    homeScrollTrigger = UUID()
                }
                goTo(newVal)
            }
        )
    }

    var body: some View {
        Group {
            // Only Home gates the launch splash -- it's the actual landing tab and
            // the only one still eagerly loaded here. Charts/Discovery load lazily
            // now (their own `.task`, first-visit-only), which can only run once
            // their view is actually in the hierarchy -- gating this on their
            // isLoading too created a deadlock: the TabView (and their views inside
            // it) could never render while this stayed true, but their `.load()`
            // could never run to flip it false without that same TabView existing.
            if homeVM.isLoading {
                AppLoadingView()
            } else {
                TabView(selection: tabSelection) {
                    HomeView(
                        viewModel: homeVM,
                        scrollToTopTrigger: homeScrollTrigger,
                        onOwnProfileTap: { goTo(.profile) }
                    )
                    .tabItem {
                        Image("icon-home").renderingMode(.template)
                        Text(String(localized: "Home"))
                    }
                    .tag(AppTab.home)

                    Group {
                        if visitedTabs.contains(.rankings) {
                            ChartsView(viewModel: chartsVM)
                        } else {
                            Color.clear
                        }
                    }
                        .tabItem {
                            Image("icon-trophy").renderingMode(.template)
                            Text(String(localized: "Charts"))
                        }
                        .tag(AppTab.rankings)

                    Group {
                        if visitedTabs.contains(.add) {
                            SearchView(discoveryVM: discoveryVM, onGoToSettings: {
                                goTo(.profile)
                                pendingOpenSettings = true
                            })
                        } else {
                            Color.clear
                        }
                    }
                        .tabItem {
                            Image(uiImage: selectedTab == .add
                                  ? MainTabView.addTabImageSelected
                                  : (colorScheme == .dark ? MainTabView.addTabImageDark : MainTabView.addTabImageLight))
                                .renderingMode(.original)
                            Text(String(localized: "Add"))
                        }
                        .tag(AppTab.add)

                    Group {
                        if visitedTabs.contains(.taste) {
                            TasteView(viewModel: tasteVM, onGoToAdd: { goTo(.add) })
                        } else {
                            Color.clear
                        }
                    }
                        .tabItem {
                            Image("icon-sparkles").renderingMode(.template)
                            Text(String(localized: "Taste"))
                        }
                        .tag(AppTab.taste)

                    // No tab badge here -- SwiftUI's .badge() has no size control, and it
                    // rendered too large. The nudge lives solely on the checklist icon in
                    // Profile's own nav bar (small, size fully under our control there).
                    Group {
                        if visitedTabs.contains(.profile) {
                            ProfileView(viewModel: profileVM, questVM: questVM, onGoToAdd: { goTo(.add) }, openSettingsTrigger: $pendingOpenSettings)
                        } else {
                            Color.clear
                        }
                    }
                        .tabItem {
                            Image("icon-user").renderingMode(.template)
                            Text(String(localized: "Profile"))
                        }
                        .tag(AppTab.profile)
                }
                .tint(Color.sjAmber)
                .sensoryFeedback(.selection, trigger: selectedTab)
            }
        }
        .task {
            // Charts and Discovery are deliberately NOT preloaded here anymore --
            // ChartsView and SearchView each already have their own `.task {
            // await viewModel.load() }`, guarded by the same `hasLoaded` flag
            // Profile uses, so they load lazily on first visit exactly like
            // Profile always has. Eagerly firing all four here at once (measured
            // via a temporary timing probe) meant Charts/Discovery's own dozen-plus
            // concurrent queries were still in flight when a user went straight to
            // a different tab (e.g. Profile) on cold launch -- that tab's own,
            // otherwise-fast load had to queue up behind unrelated work nobody
            // had asked for yet. Home stays eager because it's the actual landing
            // tab; Quest stays eager because shouldOfferBadgeRedeem below needs to
            // be known at launch regardless of which tab is showing, and it was
            // never a meaningful contributor to the pileup (fastest of the four).
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.homeVM.load() }
                group.addTask { await self.questVM.load() }
            }
            // Every launch, not once-ever -- there's no dismiss-and-forget
            // state to track. If quests are done and the badge is still
            // unclaimed, this fires again next session until the user
            // actually picks a color.
            if questVM.shouldOfferBadgeRedeem {
                showBadgeRedeem = true
            }
        }
        .sheet(isPresented: $showBadgeRedeem) {
            BadgeRedeemView(vm: questVM)
        }
        .onReceive(NotificationCenter.default.publisher(for: .mixShared)) { _ in
            goTo(.profile)
        }
    }
}

// MARK: - Loading view

private struct AppLoadingView: View {
    @State private var breathing = false
    @State private var dotPhase  = false

    var body: some View {
        ZStack {
            // Deliberately literal white, not the adaptive sjCream — stays white even in
            // dark mode (user request; a prior attempt at this apparently never landed).
            Color.white.ignoresSafeArea()
            VStack(spacing: 14) {
                Image("logo-flower")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 152, height: 152)
                    .scaleEffect(breathing ? 1.04 : 1.0)
                    .opacity(breathing ? 0.88 : 1.0)
                    .animation(.easeInOut(duration: 3).repeatForever(autoreverses: true), value: breathing)

                Image("logo-text")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(height: 16)
                    .foregroundStyle(Color.sjInk)
                    .opacity(0.5)

                HStack(spacing: 6) {
                    ForEach(0..<3, id: \.self) { i in
                        Circle()
                            .fill(Color.sjAmber)
                            .frame(width: 5, height: 5)
                            .offset(y: dotPhase ? -5 : 0)
                            .opacity(dotPhase ? 1.0 : 0.4)
                            .animation(
                                .easeInOut(duration: 0.45).repeatForever(autoreverses: true).delay(Double(i) * 0.15),
                                value: dotPhase
                            )
                    }
                }
                .padding(.top, 4)
            }
        }
        .onAppear { breathing = true; dotPhase = true }
        // sjInk/sjMuted are adaptive (sjInk's dark value is near-white) — force this whole
        // subtree to resolve light-mode colors so the wordmark stays legible against the
        // literal-white background above regardless of system/app dark mode.
        .colorScheme(.light)
    }
}
