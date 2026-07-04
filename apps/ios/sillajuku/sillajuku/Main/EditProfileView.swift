import SwiftUI
import PhotosUI
import Supabase

struct EditProfileView: View {
    let profile: Profile?
    @Environment(\.dismiss) private var dismiss

    @State private var displayName  = ""
    @State private var username     = ""
    @State private var bio          = ""
    @State private var isSaving     = false
    @State private var errorMessage: String?

    // Avatar
    @State private var selectedPhoto: PhotosPickerItem?
    @State private var pendingAvatarData: Data?
    @State private var pendingAvatarImage: Image?

    var body: some View {
        NavigationStack {
            Form {
                // MARK: Avatar picker
                Section {
                    HStack {
                        Spacer()
                        PhotosPicker(selection: $selectedPhoto, matching: .images) {
                            ZStack(alignment: .bottomTrailing) {
                                avatarView
                                    .frame(width: 90, height: 90)

                                Circle()
                                    .fill(Color.sjInk)
                                    .frame(width: 28, height: 28)
                                    .overlay(
                                        Image(systemName: "camera.fill")
                                            .font(.system(size: 12))
                                            .foregroundStyle(Color.sjCream)
                                    )
                                    .offset(x: 2, y: 2)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(String(localized: "Change profile photo"))
                        Spacer()
                    }
                    .listRowBackground(Color.clear)
                    .padding(.vertical, 8)
                }

                // MARK: Display name
                Section("Display Name") {
                    TextField("Your name", text: $displayName)
                }

                // MARK: Username — @-prefix immediately adjacent to text
                Section("Username") {
                    HStack(spacing: 2) {
                        Text("@")
                            .foregroundStyle(Color.sjMuted)
                        TextField("username", text: $username)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    }
                }

                // MARK: Bio
                Section("Bio") {
                    TextField("Tell people about yourself…", text: $bio, axis: .vertical)
                        .lineLimit(4...6)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                            .font(.system(size: 13))
                    }
                }
            }
            .navigationTitle("Edit Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(isSaving)
                }
            }
            .onAppear { loadCurrentValues() }
            .onChange(of: selectedPhoto) { _, newItem in
                Task { await loadSelectedPhoto(newItem) }
            }
        }
    }

    // MARK: - Avatar view

    @ViewBuilder
    private var avatarView: some View {
        if let pendingAvatarImage {
            pendingAvatarImage
                .resizable()
                .scaledToFill()
                .clipShape(Circle())
        } else if let urlStr = profile?.avatarUrl, let url = URL(string: urlStr) {
            CachedImage(url: url) { initialsCircle }
                .scaledToFill()
                .clipShape(Circle())
        } else {
            initialsCircle
        }
    }

    private var initialsCircle: some View {
        Circle()
            .fill(Color.sjAmber.opacity(0.14))
            .overlay(
                Text(String((profile?.displayName ?? displayName).prefix(1).uppercased()).ifEmpty("?"))
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(Color.sjAmber)
            )
    }

    // MARK: - Load selected photo

    private func loadSelectedPhoto(_ item: PhotosPickerItem?) async {
        guard let item,
              let data = try? await item.loadTransferable(type: Data.self),
              let uiImage = UIImage(data: data) else { return }
        pendingAvatarData  = uiImage.jpegData(compressionQuality: 0.8)
        pendingAvatarImage = Image(uiImage: uiImage)
    }

    // MARK: - Load current values

    private func loadCurrentValues() {
        displayName = profile?.displayName ?? ""
        username    = profile?.username    ?? ""
        bio         = profile?.bio         ?? ""
    }

    // MARK: - Save

    private func save() async {
        guard let user = supabase.auth.currentUser else { return }
        let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmedUsername.isEmpty else {
            errorMessage = String(localized: "Username cannot be empty.")
            return
        }

        isSaving     = true
        errorMessage = nil

        do {
            // Upload avatar if a new one was selected.
            // getPublicURL constructs a URL even without a real upload, so we only
            // include avatar_url in the update when the upload itself succeeds.
            var newAvatarUrl: String? = nil
            if let data = pendingAvatarData {
                let path = "\(user.id.uuidString)/avatar.jpg"
                do {
                    try await supabase.storage
                        .from("avatars")
                        .upload(path, data: data, options: FileOptions(contentType: "image/jpeg", upsert: true))
                    let base = try? supabase.storage
                        .from("avatars")
                        .getPublicURL(path: path)
                        .absoluteString
                    // Append a timestamp so the iOS URLSession cache is invalidated
                    // on every upload (the path is fixed per user, so without this
                    // the old avatar stays cached until the app is restarted).
                    newAvatarUrl = base.map { "\($0)?t=\(Int(Date().timeIntervalSince1970))" }
                } catch {
                    // avatars bucket not set up yet — skip avatar, continue saving other fields
                }
            }

            var update: [String: String] = [
                "display_name": displayName.trimmingCharacters(in: .whitespacesAndNewlines),
                "username":     trimmedUsername,
                "bio":          bio.trimmingCharacters(in: .whitespacesAndNewlines),
            ]
            if let url = newAvatarUrl {
                update["avatar_url"] = url
            }

            try await supabase
                .from("profiles")
                .update(update)
                .eq("id", value: user.id)
                .execute()

            dismiss()
        } catch {
            errorMessage = String(localized: "Failed to save. Please try again.")
        }

        isSaving = false
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}
