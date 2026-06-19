import SwiftUI
import Observation
import Supabase

@Observable
class SearchViewModel {
    var query = ""
    var results: [Release] = []
    var isSearching = false

    func search() async {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard q.count >= 2 else {
            results = []
            return
        }
        isSearching = true
        defer { isSearching = false }
        results = (try? await supabase
            .from("recommendable_releases")
            .select("id, title, artist, cover_url, title_native, artist_native")
            .or("title.ilike.%\(q)%,artist.ilike.%\(q)%,title_native.ilike.%\(q)%,artist_native.ilike.%\(q)%")
            .order("prestige", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []
    }
}

struct SearchView: View {
    @State private var viewModel = SearchViewModel()
    @State private var searchTask: Task<Void, Never>?

    private let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchBar
                Divider()
                resultArea
            }
            .navigationDestination(for: Release.self) { release in
                AlbumDetailView(release: release)
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.sjMuted)
            TextField("Artists, albums...", text: $viewModel.query)
                .font(.system(size: 16))
                .foregroundStyle(Color.sjInk)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: viewModel.query) {
                    searchTask?.cancel()
                    let q = viewModel.query
                    searchTask = Task {
                        try? await Task.sleep(for: .milliseconds(300))
                        guard !Task.isCancelled, viewModel.query == q else { return }
                        await viewModel.search()
                    }
                }
            if viewModel.isSearching {
                ProgressView().scaleEffect(0.75)
            } else if !viewModel.query.isEmpty {
                Button {
                    viewModel.query = ""
                    viewModel.results = []
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(12)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder, lineWidth: 1))
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var resultArea: some View {
        if viewModel.results.isEmpty && !viewModel.isSearching {
            VStack(spacing: 12) {
                Image(systemName: viewModel.query.count >= 2 ? "magnifyingglass" : "music.quarternote.3")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.sjBorder)
                Text(viewModel.query.count >= 2
                     ? "No results for \"\(viewModel.query)\""
                     : "Search for artists or albums")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(viewModel.results) { release in
                        NavigationLink(value: release) {
                            AlbumCard(release: release)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
        }
    }
}

#Preview {
    SearchView()
}
