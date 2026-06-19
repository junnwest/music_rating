import SwiftUI
import Observation
import Supabase

@Observable
class RankingsViewModel {
    var categories: [RankingCategory] = []
    var isLoading = true
    private var hasLoaded = false

    func load() async {
        guard !hasLoaded else { return }
        hasLoaded = true
        isLoading = true
        categories = (try? await supabase
            .from("ranking_categories")
            .select("id, name, slug, description")
            .order("created_at")
            .execute()
            .value) ?? []
        isLoading = false
    }
}

struct RankingsView: View {
    var viewModel: RankingsViewModel

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.categories.isEmpty {
                    Text("No rankings yet.")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.sjMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(viewModel.categories) { category in
                        CategoryRow(category: category)
                            .listRowBackground(Color.sjSurface)
                            .listRowSeparatorTint(Color.sjBorder)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Rankings")
            .navigationBarTitleDisplayMode(.large)
        }
        .task { await viewModel.load() }
    }
}

private struct CategoryRow: View {
    let category: RankingCategory

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(category.name)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.sjInk)
            if let desc = category.description {
                Text(desc)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 8)
    }
}

#Preview {
    RankingsView(viewModel: RankingsViewModel())
}
