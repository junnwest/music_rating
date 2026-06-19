import SwiftUI

struct MainTabView: View {
    @State private var homeVM = HomeViewModel()
    @State private var rankingsVM = RankingsViewModel()
    @State private var feedVM = ActivityViewModel()
    @State private var profileVM = ProfileViewModel()

    var body: some View {
        Group {
            if homeVM.isLoading {
                AppLoadingView()
            } else {
                TabView {
                    Tab("Home", systemImage: "house.fill") {
                        HomeView(viewModel: homeVM)
                    }
                    Tab("Rankings", systemImage: "chart.bar.fill") {
                        RankingsView(viewModel: rankingsVM)
                    }
                    Tab("Add", systemImage: "magnifyingglass") {
                        SearchView()
                    }
                    Tab("Feed", systemImage: "bell.fill") {
                        ActivityView(viewModel: feedVM)
                    }
                    Tab("Profile", systemImage: "person.fill") {
                        ProfileView(viewModel: profileVM)
                    }
                }
                .tint(Color.sjAmber)
            }
        }
        .task { await homeVM.load() }
    }
}

private struct AppLoadingView: View {
    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            VStack(spacing: 10) {
                Image("logo-flower")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 64, height: 64)
                Image("logo-text")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 22)
                    .colorMultiply(Color.sjInk)
                ProgressView()
                    .tint(Color.sjMuted)
                    .padding(.top, 8)
            }
        }
    }
}
