import SwiftUI
import Supabase

struct SettingsView: View {
    var viewModel: ProfileViewModel
    @AppStorage("appearanceMode") private var appearanceMode = "system"
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState

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
                        .onChange(of: notifyLikes)    { _, v in saveBool("notify_likes",      v) }
                    Toggle("Replies to my comments", isOn: $notifyReplies)
                        .onChange(of: notifyReplies)  { _, v in saveBool("notify_replies",    v) }
                    Toggle("New followers",          isOn: $notifyFollowers)
                        .onChange(of: notifyFollowers){ _, v in saveBool("notify_followers",  v) }
                    Toggle("Ranking updates",        isOn: $notifyRankings)
                        .onChange(of: notifyRankings) { _, v in saveBool("notify_rankings",   v) }
                    Toggle("Monthly capsule",        isOn: $notifyCapsule)
                        .onChange(of: notifyCapsule)  { _, v in saveBool("notify_capsule",    v) }
                }
                .tint(Color.sjAmber)

                // MARK: Privacy
                Section("Privacy") {
                    Picker("Profile",      selection: $profileVisibility)  { visibilityOptions }
                        .onChange(of: profileVisibility)  { _, v in saveText("profile_visibility",       v) }
                    Picker("Catalog",      selection: $catalogVisibility)  { visibilityOptions }
                        .onChange(of: catalogVisibility)  { _, v in saveText("catalog_visibility",       v) }
                    Picker("Listen Later", selection: $listenLaterVisible) { visibilityOptions }
                        .onChange(of: listenLaterVisible) { _, v in saveText("listen_later_visibility",  v) }
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
                Button("Sign Out", role: .destructive) {
                    Task {
                        await viewModel.signOut()
                        appState.authState = .unauthenticated
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
            .sheet(isPresented: $showDeleteConfirm) { deleteAccountSheet }
            .onAppear { loadPreferences() }
            .onChange(of: viewModel.profile?.ratingMode)          { _, _ in loadPreferences() }
            .onChange(of: viewModel.profile?.ratingStep)          { _, _ in loadPreferences() }
            .onChange(of: viewModel.profile?.notifyLikes)         { _, _ in loadPreferences() }
            .onChange(of: viewModel.profile?.profileVisibility)   { _, _ in loadPreferences() }
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
        guard let p = viewModel.profile else { return }
        ratingMode           = p.ratingMode ?? "manual"
        ratingStep           = p.ratingStep ?? 0.5
        notifyLikes          = p.notifyLikes ?? true
        notifyReplies        = p.notifyReplies ?? true
        notifyFollowers      = p.notifyFollowers ?? true
        notifyRankings       = p.notifyRankings ?? true
        notifyCapsule        = p.notifyCapsule ?? true
        profileVisibility    = p.profileVisibility ?? "Public"
        catalogVisibility    = p.catalogVisibility ?? "Public"
        listenLaterVisible   = p.listenLaterVisibility ?? "Public"
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

    private func saveBool(_ column: String, _ value: Bool) {
        guard let user = supabase.auth.currentUser else { return }
        Task {
            try? await supabase.from("profiles")
                .update([column: value])
                .eq("id", value: user.id).execute()
        }
    }

    private func saveText(_ column: String, _ value: String) {
        guard let user = supabase.auth.currentUser else { return }
        Task {
            try? await supabase.from("profiles")
                .update([column: value])
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
