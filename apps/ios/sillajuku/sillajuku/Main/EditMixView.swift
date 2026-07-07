import SwiftUI
import Supabase

// Owner-only sheet: rename, edit description, toggle public/private, or
// delete a mix. Mirrors CreateMixView's field set (plus description, which
// CreateMixView also gained once the DB column existed).
struct EditMixView: View {
    let originalMix: Mix
    let onSaved: (Mix) -> Void
    let onDeleted: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var description: String
    @State private var isPublic: Bool
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var showDeleteConfirm = false

    init(mix: Mix, onSaved: @escaping (Mix) -> Void, onDeleted: @escaping () -> Void) {
        self.originalMix = mix
        _name = State(initialValue: mix.name)
        _description = State(initialValue: mix.description ?? "")
        _isPublic = State(initialValue: mix.isPublic)
        self.onSaved = onSaved
        self.onDeleted = onDeleted
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Mix name", text: $name)
                        .font(.system(size: 16))
                }

                Section("Description") {
                    TextField("Add a description…", text: $description, axis: .vertical)
                        .lineLimit(3...6)
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

                if !originalMix.isDefault {
                    Section {
                        Button("Delete Mix", role: .destructive) { showDeleteConfirm = true }
                    }
                } else {
                    Section {
                        Text("Your default \"Listen Later\" mix can't be deleted.")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjMuted)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Edit Mix")
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
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isSaving)
                }
            }
            .confirmationDialog("Delete this mix? This can't be undone.", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
                Button("Delete", role: .destructive) { Task { await deleteMix() } }
                Button("Cancel", role: .cancel) {}
            }
        }
    }

    private func save() async {
        isSaving = true
        struct Patch: Encodable {
            let name: String
            let description: String?
            let isPublic: Bool
            enum CodingKeys: String, CodingKey { case name, description; case isPublic = "is_public" }
        }
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        let trimmedDesc = description.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            try await supabase
                .from("mixes")
                .update(Patch(name: trimmedName, description: trimmedDesc.isEmpty ? nil : trimmedDesc, isPublic: isPublic))
                .eq("id", value: originalMix.id)
                .execute()
            onSaved(Mix(id: originalMix.id, userId: originalMix.userId, name: trimmedName,
                         isPublic: isPublic, isDefault: originalMix.isDefault, createdAt: originalMix.createdAt,
                         description: trimmedDesc.isEmpty ? nil : trimmedDesc))
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    private func deleteMix() async {
        _ = try? await supabase.from("mixes").delete().eq("id", value: originalMix.id).execute()
        onDeleted()
    }
}
