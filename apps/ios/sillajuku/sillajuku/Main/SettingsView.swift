import SwiftUI
import Supabase

struct SettingsView: View {
    var viewModel: ProfileViewModel
    @AppStorage("appearanceMode") private var appearanceMode = "system"
    @Environment(\.dismiss) private var dismiss

    @State private var ratingMode: String  = "manual"
    @State private var ratingStep: Double  = 0.5

    // Notifications
    @State private var notifyLikes       = true
    @State private var notifyReplies     = true
    @State private var notifyFollowers   = true
    @State private var notifyRankings    = true
    @State private var notifyCapsule     = true

    // Privacy
    @State private var profileVisibility  = "Public"
    @State private var catalogVisibility  = "Public"
    @State private var listenLaterVisible = "Public"

    // Sign out
    @State private var showSignOutConfirm = false

    // Delete account
    @State private var showDeleteConfirm  = false
    @State private var deleteUsernameInput = ""
    @State private var isDeleting         = false
    @State private var deleteError: String?

    var body: some View {
        NavigationStack {
            List {
                // MARK: Account
                Section("Account") {
                    NavigationLink("Edit Profile") {
                        EditProfileView(profile: viewModel.profile)
                            .onDisappear { Task { await viewModel.reload() } }
                    }
                }

                // MARK: Preferences
                Section("Preferences") {
                    appearancePicker
                    ratingModePicker
                    if ratingMode == "manual" { ratingPrecisionPicker }
                }

                // MARK: Notifications
                Section("Notifications") {
                    Toggle("Likes on my ratings",    isOn: $notifyLikes)
                    Toggle("Replies to my comments", isOn: $notifyReplies)
                    Toggle("New followers",          isOn: $notifyFollowers)
                    Toggle("Ranking updates",        isOn: $notifyRankings)
                    Toggle("Monthly capsule",        isOn: $notifyCapsule)
                }
                .tint(Color.sjAmber)

                // MARK: Privacy
                Section("Privacy") {
                    Picker("Profile",      selection: $profileVisibility)  { visibilityOptions }
                    Picker("Catalog",      selection: $catalogVisibility)  { visibilityOptions }
                    Picker("Listen Later", selection: $listenLaterVisible) { visibilityOptions }
                }

                // MARK: Danger zone
                Section("Danger Zone") {
                    Button(role: .destructive) { showSignOutConfirm = true } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    Button(role: .destructive) {
                        deleteUsernameInput = ""
                        deleteError = nil
                        showDeleteConfirm = true
                    } label: {
                        Label("Delete Account", systemImage: "trash")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .confirmationDialog("Sign out of sillajuku?", isPresented: $showSignOutConfirm, titleVisibility: .visible) {
                Button("Sign Out", role: .destructive) { Task { await viewModel.signOut() } }
                Button("Cancel", role: .cancel) {}
            }
            .sheet(isPresented: $showDeleteConfirm) { deleteAccountSheet }
            .onAppear { loadPreferences() }
        }
    }

    // MARK: - Preference pickers

    private var appearancePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Appearance")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.sjInk)

            HStack(spacing: 8) {
                ForEach([("sun.max", "Light", "light"),
                         ("circle.lefthalf.filled", "System", "system"),
                         ("moon", "Dark", "dark")], id: \.2) { icon, label, value in
                    segmentButton(icon: icon, label: label, selected: appearanceMode == value) {
                        appearanceMode = value
                    }
                }
            }
        }
        .padding(.vertical, 6)
    }

    private var ratingModePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Rating Mode")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.sjInk)

            HStack(spacing: 8) {
                ForEach([("star.fill", "Normal", "manual"),
                         ("arrow.left.arrow.right", "Instinct", "instinct")], id: \.2) { icon, label, value in
                    segmentButton(icon: icon, label: label, selected: ratingMode == value) {
                        ratingMode = value
                        saveRatingMode(value)
                    }
                }
            }
        }
        .padding(.vertical, 6)
    }

    private var ratingPrecisionPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Rating Precision")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.sjInk)

            HStack(spacing: 8) {
                ForEach([(0.5, "Half star"), (0.1, "Tenth")], id: \.0) { step, label in
                    Button {
                        ratingStep = step
                        saveRatingStep(step)
                    } label: {
                        Text(label)
                            .font(.system(size: 12, weight: .semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(ratingStep == step ? Color.sjInk : Color.clear)
                            .foregroundStyle(ratingStep == step ? Color.sjCream : Color.sjMuted)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(ratingStep == step ? Color.clear : Color.sjBorder, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(.vertical, 6)
    }

    @ViewBuilder
    private var visibilityOptions: some View {
        ForEach(["Public", "Followers only", "Private"], id: \.self) { Text($0) }
    }

    private func segmentButton(icon: String, label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 12))
                Text(label).font(.system(size: 12, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(selected ? Color.sjInk : Color.clear)
            .foregroundStyle(selected ? Color.sjCream : Color.sjMuted)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(selected ? Color.clear : Color.sjBorder, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Delete account sheet

    private var deleteAccountSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Text("This will permanently delete your account and all your data — ratings, reviews, lists, and followers. This cannot be undone.")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Type your username to confirm:")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjInk)

                    HStack(spacing: 2) {
                        Text("@").foregroundStyle(Color.sjMuted)
                        TextField(viewModel.profile?.username ?? "username", text: $deleteUsernameInput)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                    }
                    .padding(12)
                    .background(Color.sjSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.sjBorder, lineWidth: 1)
                    )
                }

                if let deleteError {
                    Text(deleteError)
                        .font(.system(size: 13))
                        .foregroundStyle(.red)
                }

                Button {
                    Task { await deleteAccount() }
                } label: {
                    Group {
                        if isDeleting {
                            ProgressView().tint(Color.sjCream)
                        } else {
                            Text("Delete My Account")
                                .font(.system(size: 16, weight: .semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.red)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isDeleting || deleteUsernameInput != (viewModel.profile?.username ?? ""))
                .padding(.top, 4)

                Spacer()
            }
            .padding(20)
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { showDeleteConfirm = false }.disabled(isDeleting)
                }
            }
        }
        .presentationDetents([.medium])
    }

    // MARK: - Persistence

    private func loadPreferences() {
        ratingMode = viewModel.profile?.ratingMode ?? "manual"
    }

    private func saveRatingMode(_ value: String) {
        guard let user = supabase.auth.currentUser else { return }
        Task {
            try? await supabase.from("profiles")
                .update(["rating_mode": value])
                .eq("id", value: user.id).execute()
        }
    }

    private func saveRatingStep(_ value: Double) {
        guard let user = supabase.auth.currentUser else { return }
        Task {
            try? await supabase.from("profiles")
                .update(["manual_rating_step": value])
                .eq("id", value: user.id).execute()
        }
    }

    private func deleteAccount() async {
        guard let session = try? await supabase.auth.session else {
            deleteError = "Not signed in."
            return
        }

        isDeleting  = true
        deleteError = nil

        let endpoint = Config.webBaseURL.appendingPathComponent("/api/account/delete")
        var request  = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(session.accessToken)", forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let http = response as? HTTPURLResponse
            if http?.statusCode == 200 {
                showDeleteConfirm = false
                await viewModel.signOut()
            } else {
                let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                deleteError = (body?["error"] as? String) ?? "Failed to delete account. Please try again."
            }
        } catch {
            deleteError = "Network error. Please try again."
        }

        isDeleting = false
    }
}
