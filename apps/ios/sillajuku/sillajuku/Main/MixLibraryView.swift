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

    enum CodingKeys: String, CodingKey {
        case id, name
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

private struct MixRow: View {
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
    let mix: Mix

    @State private var items: [MixItem] = []
    @State private var isLoading = true

    var body: some View {
        Group {
            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if items.isEmpty {
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
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(items) { item in
                        NavigationLink(value: item.releases.asRelease) {
                            MixItemRow(item: item)
                        }
                        .listRowBackground(Color.sjSurface)
                        .listRowSeparatorTint(Color.sjBorder.opacity(0.5))
                    }
                    .onDelete(perform: deleteItems)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(mix.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !items.isEmpty {
                EditButton()
                    .foregroundStyle(Color.sjAmber)
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        items = (try? await supabase
            .from("mix_items")
            .select("id, mix_id, release_group_id, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))")
            .eq("mix_id", value: mix.id)
            .order("created_at", ascending: false)
            .execute()
            .value) ?? []
        isLoading = false
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
        struct Payload: Encodable {
            let userId: UUID; let name: String; let isPublic: Bool; let isDefault: Bool
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case name; case isPublic = "is_public"; case isDefault = "is_default"
            }
        }
        do {
            try await supabase
                .from("mixes")
                .insert(Payload(userId: userId, name: trimmed, isPublic: isPublic, isDefault: false))
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
