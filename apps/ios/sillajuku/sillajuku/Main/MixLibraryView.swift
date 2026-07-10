import SwiftUI
import Supabase

// MARK: - Models

struct Mix: Codable, Identifiable, Hashable {
    let id: UUID
    let userId: UUID
    var name: String
    var isPublic: Bool
    let isDefault: Bool
    let createdAt: Date
    var description: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, name, description
        case userId    = "user_id"
        case isPublic  = "is_public"
        case isDefault = "is_default"
        case createdAt = "created_at"
    }
}

struct MixItem: Codable, Identifiable {
    let id: UUID
    let mixId: UUID
    let releaseId: UUID
    let createdAt: Date
    let releases: MixRelease

    enum CodingKeys: String, CodingKey {
        case id
        case releases  = "release_groups"
        case mixId     = "mix_id"
        case releaseId = "release_group_id"
        case createdAt = "created_at"
    }
}

struct MixRelease: Codable, Identifiable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    let releaseType: String?
    let titleNative: String?
    let primaryArtist: NativeArtistRef?

    enum CodingKeys: String, CodingKey {
        case id, title
        case artist      = "artist_display"
        case coverUrl    = "cover_url"
        case releaseType = "release_group_type"
        case titleNative = "native_title"
        case primaryArtist = "artists"
    }

    var artistNative: String? { primaryArtist?.nameNative }
    var displayTitle: String { titleNative?.isPredominantlyHangul == true ? titleNative! : title }
    var displayArtist: String { artistNative?.isPredominantlyHangul == true ? artistNative! : artist }

    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl,
                releaseType: releaseType, releaseDate: nil, titleNative: titleNative, artistNative: artistNative,
                tracklist: nil, totalTracks: nil)
    }

    var typeLabel: String {
        switch releaseType?.lowercased() {
        case "album":  return String(localized: "Album")
        case "single": return String(localized: "Single")
        case "ep":     return String(localized: "EP")
        default:       return String(localized: "Release")
        }
    }
}

// MARK: - Mix Library ViewModel (lives in ProfileView, survives tab switches)

@Observable
final class MixLibraryViewModel {
    var mixes: [Mix] = []
    var itemCounts: [UUID: Int] = [:]
    var isLoading = true
    private var hasLoaded = false

    func load(userId: UUID) async {
        guard !hasLoaded else { return }
        hasLoaded = true
        isLoading = true
        let loaded: [Mix] = (try? await supabase
            .from("mixes")
            .select("*")
            .eq("user_id", value: userId)
            .order("is_default", ascending: false)
            .order("created_at", ascending: true)
            .execute()
            .value) ?? []
        mixes = loaded

        struct CountRow: Decodable {
            let mixId: UUID
            enum CodingKeys: String, CodingKey { case mixId = "mix_id" }
        }
        let mixIds = loaded.map(\.id.uuidString)
        if !mixIds.isEmpty,
           let rows: [CountRow] = try? await supabase
            .from("mix_items")
            .select("mix_id")
            .in("mix_id", values: mixIds)
            .execute()
            .value {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.mixId, default: 0] += 1 }
            itemCounts = counts
        }
        isLoading = false
    }

    func reload(userId: UUID) async {
        hasLoaded = false
        await load(userId: userId)
    }
}

// MARK: - Mix Library (profile bookmarks tab content)

struct MixLibraryView: View {
    let userId: UUID
    var viewModel: MixLibraryViewModel
    @State private var showCreate = false

    var body: some View {
        Group {
            if viewModel.isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.top, 60)
            } else if viewModel.mixes.isEmpty {
                emptyState
            } else {
                mixList
            }
        }
        .task { await viewModel.load(userId: userId) }
        .sheet(isPresented: $showCreate, onDismiss: { Task { await viewModel.reload(userId: userId) } }) {
            CreateMixView()
        }
        .onReceive(NotificationCenter.default.publisher(for: .mixLibraryChanged)) { _ in
            Task { await viewModel.reload(userId: userId) }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "music.note.list")
                .font(.system(size: 36))
                .foregroundStyle(Color.sjBorder)
            Text("No mixes yet")
                .font(.system(size: 15))
                .foregroundStyle(Color.sjMuted)
            Button("Create a Mix") { showCreate = true }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.sjAmber)
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .padding(.top, 24)
    }

    private var mixList: some View {
        LazyVStack(spacing: 0, pinnedViews: []) {
            Button {
                showCreate = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.sjAmber)
                    Text("Create a Mix")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.sjAmber)
                    Spacer()
                }
                .padding(.horizontal, 18)
                .padding(.vertical, 14)
            }
            .buttonStyle(.plain)

            Divider()

            ForEach(viewModel.mixes) { mix in
                NavigationLink(value: mix) {
                    MixRow(mix: mix, count: viewModel.itemCounts[mix.id] ?? 0)
                }
                .buttonStyle(.plain)
                Divider().padding(.leading, 18)
            }
        }
    }
}

// MARK: - Mix row

// Not private -- reused by ForeignMixLibraryView (UserProfileView.swift) to
// render another user's public mixes with the exact same row look.
struct MixRow: View {
    let mix: Mix
    let count: Int

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.sjAmber.opacity(0.12))
                    .frame(width: 52, height: 52)
                Image(systemName: mix.isDefault ? "clock.fill" : "music.note.list")
                    .font(.system(size: 20))
                    .foregroundStyle(Color.sjAmber)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(mix.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.sjInk)

                HStack(spacing: 6) {
                    Text(count == 1 ? String(localized: "1 release") : String(format: String(localized: "%d releases"), count))
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)

                    if mix.isPublic {
                        Text("·")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjBorder)
                        HStack(spacing: 3) {
                            Image(systemName: "globe")
                                .font(.system(size: 10))
                            Text("Public")
                                .font(.system(size: 12))
                        }
                        .foregroundStyle(Color.sjMuted)
                    }
                }
            }

            Spacer(minLength: 0)

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.sjBorder)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 13)
        .contentShape(Rectangle())
    }
}

// MARK: - Mix detail

struct MixDetailView: View {
    @State private var mix: Mix
    @Environment(\.dismiss) private var dismiss
    @Environment(\.editMode) private var editMode

    @State private var items: [MixItem] = []
    @State private var isLoading = true

    @State private var isLiked = false
    @State private var likeCount = 0
    @State private var sharePosts: [MixShareSharerRow] = []
    @State private var showShareComposer = false
    @State private var showDeleteConfirm = false

    // Live-edited while the system EditButton() is active -- populated from
    // `mix` on entering edit mode, written back to `mix` + the DB on Done.
    // Replaces the old EditMixView sheet's explicit Save/Cancel: reordering
    // and deleting tracklist rows already auto-commit the moment you tap
    // Done, so name/description/visibility now follow the same convention
    // instead of being the one thing behind a separate sheet.
    @State private var editableName = ""
    @State private var editableDescription = ""
    @State private var editableIsPublic = false

    init(mix: Mix) {
        _mix = State(initialValue: mix)
    }

    // This view is reached both from the owner's own MixLibraryView AND from
    // another user's public Lists tab (ForeignMixLibraryView, in
    // UserProfileView.swift) -- RLS would block the actual mutation for a
    // foreign mix regardless, but showing edit/delete affordances at all for
    // content that isn't yours is a real UX bug, not just a redundant check.
    private var isOwnMix: Bool { mix.userId == supabase.auth.currentUser?.id }

    // An explicit closure literal, not a `isOwnMix ? deleteItems : nil`
    // ternary -- combining a bare method reference with `nil` in a ternary
    // genuinely confused the type checker (crashed the compiler's own
    // diagnostic generation rather than just erroring), even though the
    // target type is spelled out below.
    private var deleteAction: ((IndexSet) -> Void)? {
        guard isOwnMix else { return nil }
        return { offsets in deleteItems(at: offsets) }
    }

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    Section {
                        heroSection
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.sjCream)
                        if !sharePosts.isEmpty {
                            sharedBySection
                                .listRowInsets(EdgeInsets())
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.sjCream)
                        }
                    }

                    if items.isEmpty {
                        Section {
                            emptyStateRow
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.sjCream)
                        }
                    } else {
                        Section {
                            ForEach(items) { item in
                                NavigationLink(value: item.releases.asRelease) {
                                    MixItemRow(item: item)
                                }
                                .albumContextMenu(item.releases.asRelease)
                                .listRowBackground(Color.sjSurface)
                                .listRowSeparatorTint(Color.sjBorder.opacity(0.5))
                            }
                            .onDelete(perform: deleteAction)
                        }
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(mix.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Not gated on !items.isEmpty anymore -- edit mode now also
            // drives the name/description/visibility fields in heroSection,
            // which an empty mix still needs to be able to edit.
            if isOwnMix {
                EditButton()
                    .foregroundStyle(Color.sjAmber)
            }
        }
        .task { await load() }
        .onChange(of: editMode?.wrappedValue) { oldValue, newValue in
            if newValue == .active {
                editableName = mix.name
                editableDescription = mix.description ?? ""
                editableIsPublic = mix.isPublic
            } else if oldValue == .active {
                Task { await saveMixEdits() }
            }
        }
        .confirmationDialog("Delete this mix? This can't be undone.", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await deleteMix() } }
            Button("Cancel", role: .cancel) {}
        }
        .sheet(isPresented: $showShareComposer) {
            MixShareComposerView(mix: mix)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
        }
    }

    private var emptyStateRow: some View {
        VStack(spacing: 12) {
            Image(systemName: "music.note")
                .font(.system(size: 40))
                .foregroundStyle(Color.sjBorder)
            Text("Nothing in this mix yet")
                .font(.system(size: 15))
                .foregroundStyle(Color.sjMuted)
            Text("Save releases from your feed to add them here.")
                .font(.system(size: 13))
                .foregroundStyle(Color.sjMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 24)
    }

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                if isOwnMix, editMode?.wrappedValue == .active {
                    VStack(alignment: .leading, spacing: 8) {
                        // Plain TextFields look identical to static Text until
                        // focused -- a visible box is the only thing that tells
                        // the user these are tappable, not just labels.
                        TextField("Mix name", text: $editableName)
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                            .textFieldStyle(.plain)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(Color.sjSurface)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay {
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.sjBorder, lineWidth: 1)
                            }
                        TextField("Add a description…", text: $editableDescription, axis: .vertical)
                            .font(.system(size: 14))
                            .foregroundStyle(Color.sjMuted)
                            .textFieldStyle(.plain)
                            .lineLimit(1...4)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(Color.sjSurface)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay {
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.sjBorder, lineWidth: 1)
                            }
                        HStack(spacing: 6) {
                            Image(systemName: "globe")
                                .font(.system(size: 10))
                            Text("Public")
                                .font(.system(size: 12))
                            Toggle("", isOn: $editableIsPublic)
                                .labelsHidden()
                                .tint(Color.sjAmber)
                        }
                        .foregroundStyle(Color.sjMuted)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(mix.name)
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                        if let d = mix.description, !d.isEmpty {
                            Text(d)
                                .font(.system(size: 14))
                                .foregroundStyle(Color.sjMuted)
                        }
                        if mix.isPublic {
                            HStack(spacing: 3) {
                                Image(systemName: "globe")
                                    .font(.system(size: 10))
                                Text("Public")
                                    .font(.system(size: 12))
                            }
                            .foregroundStyle(Color.sjMuted)
                        }
                    }
                }
                Spacer(minLength: 0)
            }

            HStack(spacing: 20) {
                Button { Task { await toggleMixLike() } } label: {
                    HStack(spacing: 5) {
                        Image(systemName: isLiked ? "heart.fill" : "heart")
                            .foregroundStyle(isLiked ? .red : Color.sjInk)
                        Text("\(likeCount)")
                            .foregroundStyle(Color.sjMuted)
                    }
                }
                .buttonStyle(.plain)

                if mix.isPublic {
                    Button { showShareComposer = true } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "square.and.arrow.up")
                                .foregroundStyle(Color.sjBlue)
                            Text("Share")
                                .foregroundStyle(Color.sjBlue)
                        }
                    }
                    .buttonStyle(.plain)
                }

                if isOwnMix, !mix.isDefault {
                    Button { showDeleteConfirm = true } label: {
                        Image(systemName: "trash")
                            .foregroundStyle(.red)
                    }
                    .buttonStyle(.plain)
                }
            }
            .font(.system(size: 15, weight: .medium))
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var sharedBySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Shared by")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .tracking(0.6)
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 10)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(sharePosts) { share in
                        NavigationLink(value: UserProfileDestination(userId: share.userId, handle: share.profiles?.handle ?? String(localized: "someone"))) {
                            VStack(spacing: 6) {
                                Image(systemName: "person.circle.fill")
                                    .font(.system(size: 40))
                                    .foregroundStyle(Color(uiColor: .systemGray3))
                                Text("@" + (share.profiles?.handle ?? String(localized: "someone")))
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(Color.sjInk)
                                    .lineLimit(1)
                                    .frame(width: 64)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
        .padding(.bottom, 8)
    }

    private func load() async {
        isLoading = true
        async let itemsTask: [MixItem] = (try? await supabase
            .from("mix_items")
            .select("id, mix_id, release_group_id, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))")
            .eq("mix_id", value: mix.id)
            .order("created_at", ascending: false)
            .execute()
            .value) ?? []
        items = await itemsTask
        await loadMixSocial()
        isLoading = false
    }

    private func loadMixSocial() async {
        async let countTask: Int = {
            let resp = try? await supabase
                .from("mix_likes")
                .select("*", count: .exact)
                .eq("mix_id", value: mix.id)
                .execute()
            return resp?.count ?? 0
        }()
        async let likedTask: Bool = {
            guard let uid = supabase.auth.currentUser?.id else { return false }
            struct Row: Decodable {}
            let rows: [Row] = (try? await supabase
                .from("mix_likes")
                .select("user_id")
                .eq("mix_id", value: mix.id)
                .eq("user_id", value: uid)
                .execute()
                .value) ?? []
            return !rows.isEmpty
        }()
        async let sharesTask: [MixShareSharerRow] = (try? await supabase
            .from("mix_shares")
            .select("id, user_id, profiles!mix_shares_user_id_fkey(username, display_name)")
            .eq("mix_id", value: mix.id)
            .order("created_at", ascending: false)
            .limit(20)
            .execute()
            .value) ?? []
        let (count, liked, shares) = await (countTask, likedTask, sharesTask)
        // Sharing the same mix more than once inserts a new mix_shares row each time
        // (each is its own feed post) -- but "Shared by" is about *who*, not how many
        // times, so keep only the first (most recent, since the query above is
        // already created_at-desc) row per user.
        var seenUserIds = Set<UUID>()
        let dedupedShares = shares.filter { seenUserIds.insert($0.userId).inserted }
        (likeCount, isLiked, sharePosts) = (count, liked, dedupedShares)
    }

    private func toggleMixLike() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = isLiked
        isLiked.toggle()
        likeCount += wasLiked ? -1 : 1
        do {
            if wasLiked {
                try await supabase
                    .from("mix_likes")
                    .delete()
                    .eq("user_id", value: userId)
                    .eq("mix_id", value: mix.id)
                    .execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let mixId: UUID
                    enum CodingKeys: String, CodingKey { case userId = "user_id"; case mixId = "mix_id" }
                }
                try await supabase
                    .from("mix_likes")
                    .insert(Payload(userId: userId, mixId: mix.id))
                    .execute()
            }
        } catch {
            // Printed, not just swallowed -- a missing migration, an RLS
            // policy blocking the write, and a real network failure all
            // land here identically otherwise, with no way to tell them apart.
            print("MixDetailView.toggleMixLike failed for mix \(mix.id): \(error)")
            isLiked = wasLiked
            likeCount += wasLiked ? 1 : -1
        }
    }

    private func saveMixEdits() async {
        let trimmedName = editableName.trimmingCharacters(in: .whitespaces)
        // An emptied name is left uncommitted (silently keeps the old value)
        // rather than writing it -- `mixes.name` has a non-empty DB check,
        // and there's no separate Save button anymore to disable/validate
        // against the way EditMixView's sheet used to.
        guard !trimmedName.isEmpty else { return }
        let trimmedDescription = editableDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        struct Patch: Encodable {
            let name: String
            let description: String?
            let isPublic: Bool
            enum CodingKeys: String, CodingKey { case name, description; case isPublic = "is_public" }
        }
        do {
            try await supabase
                .from("mixes")
                .update(Patch(name: trimmedName, description: trimmedDescription.isEmpty ? nil : trimmedDescription, isPublic: editableIsPublic))
                .eq("id", value: mix.id)
                .execute()
            mix.name = trimmedName
            mix.description = trimmedDescription.isEmpty ? nil : trimmedDescription
            mix.isPublic = editableIsPublic
            NotificationCenter.default.post(name: .mixLibraryChanged, object: nil)
        } catch {
            print("MixDetailView.saveMixEdits failed for mix \(mix.id): \(error)")
        }
    }

    private func deleteMix() async {
        _ = try? await supabase.from("mixes").delete().eq("id", value: mix.id).execute()
        NotificationCenter.default.post(name: .mixLibraryChanged, object: nil)
        dismiss()
    }

    private func deleteItems(at offsets: IndexSet) {
        let toDelete = offsets.map { items[$0] }
        items.remove(atOffsets: offsets)
        Task {
            for item in toDelete {
                _ = try? await supabase
                    .from("mix_items")
                    .delete()
                    .eq("id", value: item.id)
                    .execute()
            }
        }
    }
}

private struct MixShareSharerRow: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let profiles: SharerProfile?

    struct SharerProfile: Codable {
        let username: String?
        let displayName: String?
        enum CodingKeys: String, CodingKey { case username; case displayName = "display_name" }
        var handle: String { username ?? displayName ?? String(localized: "someone") }
    }

    enum CodingKeys: String, CodingKey {
        case id, profiles
        case userId = "user_id"
    }
}

// MARK: - Mix item row

private struct MixItemRow: View {
    let item: MixItem

    var body: some View {
        HStack(spacing: 12) {
            CoverImage(url: item.releases.coverUrl, cornerRadius: 8)
                .frame(width: 50, height: 50)
                .accessibilityHidden(true) // title/artist text alongside already describes it

            VStack(alignment: .leading, spacing: 3) {
                Text(item.releases.displayTitle)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(item.releases.typeLabel + " · " + item.releases.displayArtist)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Create Mix sheet

struct CreateMixView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var description = ""
    @State private var isPublic = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Mix name", text: $name)
                        .font(.system(size: 16))
                } header: {
                    Text("Name")
                }

                Section {
                    TextField("Add a description…", text: $description, axis: .vertical)
                        .lineLimit(2...5)
                } header: {
                    Text("Description")
                }

                Section {
                    Toggle("Public", isOn: $isPublic)
                        .tint(Color.sjAmber)
                } footer: {
                    Text(isPublic
                         ? "Anyone can see this mix on your profile."
                         : "Only you can see this mix.")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                }

                if let err = errorMessage {
                    Section {
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundStyle(.red)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("New Mix")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Color.sjMuted)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await create() }
                    } label: {
                        if isSaving {
                            ProgressView().scaleEffect(0.8)
                        } else {
                            Text("Create")
                                .fontWeight(.semibold)
                        }
                    }
                    .foregroundStyle(Color.sjAmber)
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                }
            }
        }
    }

    private func create() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let trimmed = name.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }

        isSaving = true
        let trimmedDesc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        struct Payload: Encodable {
            let userId: UUID; let name: String; let description: String?; let isPublic: Bool; let isDefault: Bool
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case name; case description
                case isPublic = "is_public"; case isDefault = "is_default"
            }
        }
        do {
            try await supabase
                .from("mixes")
                .insert(Payload(userId: userId, name: trimmed, description: trimmedDesc.isEmpty ? nil : trimmedDesc,
                                 isPublic: isPublic, isDefault: false))
                .execute()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

// MARK: - Mix picker sheet (shown when user has custom mixes)

struct MixPickerView: View {
    let releaseId: UUID
    let releaseTitle: String
    @Environment(\.dismiss) private var dismiss

    @State private var mixes: [Mix] = []
    @State private var selectedIds: Set<UUID> = []
    @State private var isLoading = true
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List(mixes) { mix in
                        Button {
                            if selectedIds.contains(mix.id) {
                                selectedIds.remove(mix.id)
                            } else {
                                selectedIds.insert(mix.id)
                            }
                        } label: {
                            HStack(spacing: 14) {
                                Image(systemName: mix.isDefault ? "clock.fill" : "music.note.list")
                                    .font(.system(size: 16))
                                    .foregroundStyle(Color.sjAmber)
                                    .frame(width: 24)

                                Text(mix.name)
                                    .font(.system(size: 15))
                                    .foregroundStyle(Color.sjInk)

                                Spacer()

                                if selectedIds.contains(mix.id) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Color.sjAmber)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .listRowBackground(Color.sjSurface)
                        .listRowSeparatorTint(Color.sjBorder.opacity(0.5))
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Save to Mix")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(Color.sjMuted)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView().scaleEffect(0.8)
                        } else {
                            Text("Save")
                                .fontWeight(.semibold)
                        }
                    }
                    .foregroundStyle(Color.sjAmber)
                    .disabled(selectedIds.isEmpty || isSaving)
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard let userId = supabase.auth.currentUser?.id else { isLoading = false; return }
        isLoading = true

        let loaded: [Mix] = (try? await supabase
            .from("mixes")
            .select("*")
            .eq("user_id", value: userId)
            .order("is_default", ascending: false)
            .order("created_at", ascending: true)
            .execute()
            .value) ?? []
        mixes = loaded

        // Pre-select mixes that already contain this release
        struct ExistingItem: Decodable {
            let mixId: UUID
            enum CodingKeys: String, CodingKey { case mixId = "mix_id" }
        }
        let mixIds = loaded.map(\.id.uuidString)
        if !mixIds.isEmpty,
           let existing: [ExistingItem] = try? await supabase
            .from("mix_items")
            .select("mix_id")
            .eq("release_group_id", value: releaseId)
            .in("mix_id", values: mixIds)
            .execute()
            .value {
            selectedIds = Set(existing.map(\.mixId))
        }

        isLoading = false
    }

    private func save() async {
        isSaving = true
        struct Payload: Encodable {
            let mixId: UUID; let releaseGroupId: UUID
            enum CodingKeys: String, CodingKey { case mixId = "mix_id"; case releaseGroupId = "release_group_id" }
        }
        for mixId in selectedIds {
            _ = try? await supabase
                .from("mix_items")
                .upsert(Payload(mixId: mixId, releaseGroupId: releaseId), onConflict: "mix_id,release_group_id")
                .execute()
        }
        // Remove from mixes that were deselected
        let deselected = Set(mixes.map(\.id)).subtracting(selectedIds)
        for mixId in deselected {
            _ = try? await supabase
                .from("mix_items")
                .delete()
                .eq("mix_id", value: mixId)
                .eq("release_group_id", value: releaseId)
                .execute()
        }
        isSaving = false
        dismiss()
    }
}
