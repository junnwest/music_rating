import SwiftUI

enum AppTab: Hashable { case home, rankings, add, taste, profile }

struct MainTabView: View {
    @State private var homeVM      = HomeViewModel()
    @State private var chartsVM    = ChartsViewModel()
    @State private var profileVM   = ProfileViewModel()
    @State private var discoveryVM = DiscoveryViewModel()

    @State private var selectedTab: AppTab = .home
    @State private var homeScrollTrigger   = UUID()

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
                    Tab("Home", systemImage: "house.fill", value: AppTab.home) {
                        HomeView(
                            viewModel: homeVM,
                            scrollToTopTrigger: homeScrollTrigger,
                            onOwnProfileTap: { selectedTab = .profile }
                        )
                    }
                    Tab("Charts", systemImage: "trophy.fill", value: AppTab.rankings) {
                        ChartsView(viewModel: chartsVM)
                    }
                    Tab("Add", systemImage: "plus", value: AppTab.add) {
                        SearchView(discoveryVM: discoveryVM)
                    }
                    Tab("Taste", systemImage: "sparkles", value: AppTab.taste) {
                        TasteView(onGoToAdd: { selectedTab = .add })
                    }
                    Tab("Profile", systemImage: "person.fill", value: AppTab.profile) {
                        ProfileView(viewModel: profileVM)
                    }
                }
                .tint(Color.sjAmber)
            }
        }
        .task {
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.homeVM.load() }
                group.addTask { await self.chartsVM.load() }
                group.addTask { await self.discoveryVM.load() }
            }
        }
    }
}

// MARK: - Loading view

private struct AppLoadingView: View {
    @State private var breathing = false
    @State private var dotPhase  = false

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
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
    }
}
