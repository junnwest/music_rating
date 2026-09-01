import SwiftUI
import Supabase

// The "share this mix as a post" sheet -- available to anyone viewing a
// public mix, not just its owner (a repost). Posts into mix_shares; the
// resulting card renders in the Home feed via MixShareCard.
struct MixShareComposerView: View {
    let mix: Mix
    @Environment(\.dismiss) private var dismiss

    @State private var caption = ""
    @State private var coverUrls: [String?] = []
    @State private var isLoadingCovers = true
    @State private var isPosting = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                if isLoadingCovers {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 60)
                } else {
                    if !coverUrls.isEmpty {
                        StackedCoversView(coverUrls: coverUrls, size: 80, overlapFraction: 0.5)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(mix.name)
                            .font(.jakarta(16, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                        if let d = mix.description, !d.isEmpty {
                            Text(d)
                                .font(.jakarta(13))
                                .foregroundStyle(Color.sjMuted)
                        }
                    }
                }

                TextField("Add a caption…", text: $caption, axis: .vertical)
                    .lineLimit(2...4)
                    .padding(12)
                    .background(Color.sjSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                if let err = errorMessage {
                    Text(err)
                        .font(.jakarta(13))
                        .foregroundStyle(.red)
                }
            }
            .padding(20)
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Share Mix")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Color.sjMuted)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await post() }
                    } label: {
                        if isPosting {
                            ProgressView().scaleEffect(0.8)
                        } else {
                            Text("Post")
                                .fontWeight(.semibold)
                        }
                    }
                    .foregroundStyle(Color.sjAmber)
                    .disabled(isPosting)
                }
            }
        }
        .task { await loadCovers() }
    }

    private func loadCovers() async {
        struct CoverRow: Decodable {
            let coverUrl: String?
            enum CodingKeys: String, CodingKey { case coverUrl = "cover_url" }
        }
        struct Params: Encodable {
            let pMixIds: [String]
            let pLimit: Int
            enum CodingKeys: String, CodingKey { case pMixIds = "p_mix_ids"; case pLimit = "p_limit" }
        }
        let rows: [CoverRow] = (try? await supabase
            .rpc("get_mix_covers", params: Params(pMixIds: [mix.id.uuidString], pLimit: 10))
            .execute()
            .value) ?? []
        coverUrls = rows.map(\.coverUrl)
        isLoadingCovers = false
    }

    private func post() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        isPosting = true
        struct Payload: Encodable {
            let userId: UUID
            let mixId: UUID
            let caption: String?
            enum CodingKeys: String, CodingKey { case userId = "user_id"; case mixId = "mix_id"; case caption }
        }
        let trimmed = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await supabase
                .from("mix_shares")
                .insert(Payload(userId: userId, mixId: mix.id, caption: trimmed.isEmpty ? nil : trimmed))
                .execute()
            dismiss()
            // Tells MainTabView to switch to Profile and ProfileView to refresh + show
            // the Posts tab -- otherwise there's no way to confirm the share worked
            // (it doesn't appear anywhere in the sheet's own navigation stack).
            NotificationCenter.default.post(name: .mixShared, object: nil)
        } catch {
            errorMessage = error.localizedDescription
        }
        isPosting = false
    }
}
