import SwiftUI
import UIKit

enum AppTab: Hashable { case home, rankings, add, taste, profile }

struct MainTabView: View {
    @State private var homeVM      = HomeViewModel()
    @State private var chartsVM    = ChartsViewModel()
    @State private var profileVM   = ProfileViewModel()
    @State private var discoveryVM = DiscoveryViewModel()
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
    // button rather than just another tab icon.
    private static func addTabImage(dark: Bool) -> UIImage {
        let fillColor: Color = dark ? .white : .black
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

    // Two pre-rendered variants — picked per-appearance at the call site via
    // @Environment(\.colorScheme) below. (UIImage has no dynamicProvider
    // initializer the way UIColor does; that's UIColor-only.)
    private static let addTabImageLight = addTabImage(dark: false)
    private static let addTabImageDark  = addTabImage(dark: true)

    @Environment(\.colorScheme) private var colorScheme

    // Custom binding that detects re-tapping the current tab
    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { selectedTab },
            set: { newVal in
                if newVal == selectedTab, newVal == .home {
                    homeScrollTrigger = UUID()
                }
                selectedTab = newVal
            }
        )
    }

    var body: some View {
        Group {
            if homeVM.isLoading || chartsVM.isLoading || discoveryVM.isLoading {
                AppLoadingView()
            } else {
                TabView(selection: tabSelection) {
                    HomeView(
                        viewModel: homeVM,
                        scrollToTopTrigger: homeScrollTrigger,
                        onOwnProfileTap: { selectedTab = .profile }
                    )
                    .tabItem {
                        Image(systemName: "house.fill")
                        Text(String(localized: "Home"))
                    }
                    .tag(AppTab.home)

                    ChartsView(viewModel: chartsVM)
                        .tabItem {
                            Image(systemName: "trophy.fill")
                            Text(String(localized: "Charts"))
                        }
                        .tag(AppTab.rankings)

                    SearchView(discoveryVM: discoveryVM, onGoToSettings: {
                        selectedTab = .profile
                        pendingOpenSettings = true
                    })
                        .tabItem {
                            Image(uiImage: colorScheme == .dark ? MainTabView.addTabImageDark : MainTabView.addTabImageLight)
                                .renderingMode(.original)
                            Text(String(localized: "Add"))
                        }
                        .tag(AppTab.add)

                    TasteView(onGoToAdd: { selectedTab = .add })
                        .tabItem {
                            Image(systemName: "sparkles")
                            Text(String(localized: "Taste"))
                        }
                        .tag(AppTab.taste)

                    // No tab badge here -- SwiftUI's .badge() has no size control, and it
                    // rendered too large. The nudge lives solely on the checklist icon in
                    // Profile's own nav bar (small, size fully under our control there).
                    ProfileView(viewModel: profileVM, questVM: questVM, onGoToAdd: { selectedTab = .add }, openSettingsTrigger: $pendingOpenSettings)
                        .tabItem {
                            Image(systemName: "person.fill")
                            Text(String(localized: "Profile"))
                        }
                        .tag(AppTab.profile)
                }
                .tint(Color.sjAmber)
            }
        }
        .task {
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.homeVM.load() }
                group.addTask { await self.chartsVM.load() }
                group.addTask { await self.discoveryVM.load() }
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
            selectedTab = .profile
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
