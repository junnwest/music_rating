import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house.fill") {
                Text("Home") // TODO: HomeView()
            }
            Tab("Search", systemImage: "magnifyingglass") {
                Text("Search") // TODO: SearchView()
            }
            Tab("Rankings", systemImage: "chart.bar.fill") {
                Text("Rankings") // TODO: RankingsView()
            }
            Tab("Activity", systemImage: "bell.fill") {
                Text("Activity") // TODO: ActivityView()
            }
            Tab("Profile", systemImage: "person.fill") {
                Text("Profile") // TODO: ProfileView()
            }
        }
        .tint(Color.sjAmber)
    }
}
