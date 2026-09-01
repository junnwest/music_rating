import SwiftUI
import Supabase
import UIKit
import UserNotifications

// A per-subtab visibility override: .inherit stores NULL in the DB (falls
// back to profileVisibility), .pub/.priv store an explicit value that wins
// over the general setting.
enum VisibilityOverride: String, CaseIterable {
    case inherit = "Same as profile"
    case pub     = "Public"
    case priv    = "Private"

    var dbValue: String? { self == .inherit ? nil : rawValue }
    var label: LocalizedStringKey { LocalizedStringKey(rawValue) }

    static func from(_ value: String?) -> VisibilityOverride {
        switch value {
        case "Public":  return .pub
        case "Private": return .priv
        default:        return .inherit
        }
    }
}

struct SettingsView: View {
    var viewModel: ProfileViewModel
    @AppStorage("appearanceMode") private var appearanceMode = "system"
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @Environment(\.scenePhase) private var scenePhase

    @State private var ratingStep: Double  = 0.5

    // Notifications
    @State private var notifyLikes       = true
    @State private var notifyReplies     = true
    @State private var notifyFollowers   = true
    @State private var notifyRankings    = true
    @State private var notifyCapsule     = true
    // OS-level permission -- distinct from the in-app toggles above, which
    // stay meaningless (saved, but never delivered) while this isn't
    // .authorized/.provisional/.ephemeral.
    @State private var notificationStatus: UNAuthorizationStatus = .notDetermined
    @State private var isRequestingNotifications = false

    // Privacy -- profileVisibility is the general Public/Private account
    // toggle; the three Advanced overrides default to .inherit (NULL in the
    // DB, meaning "same as profileVisibility") until explicitly set.
    @State private var profileVisibility = "Public"
    @State private var catalogOverride: VisibilityOverride = .inherit
    @State private var libraryOverride: VisibilityOverride = .inherit
    @State private var statsOverride:   VisibilityOverride = .inherit

    // App icon (unlocked at 5 verified invites)
    @State private var verifiedInviteCount = 0
    @State private var currentIconName: String? = UIApplication.shared.alternateIconName

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
                    NavigationLink("Connected Accounts") {
                        ConnectedAccountsView()
                    }
                }

                // MARK: Preferences
                Section("Preferences") {
                    appearancePicker
                    ratingPrecisionPicker
                }

                // MARK: App Icon (unlocked at 5 verified invites)
                if verifiedInviteCount >= 5 {
                    Section("App Icon") {
                        appIconPicker
                    }
                }

                // MARK: Notifications
                Section {
                    notificationsPermissionRow
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
                } header: {
                    Text("Notifications")
                } footer: {
                    if !isNotificationsAuthorized {
                        Text("Notifications are off in iOS Settings — the toggles above won't do anything until you turn them back on.")
                    }
                }
                .tint(Color.sjAmber)

                // MARK: Privacy
                Section {
                    Picker("Account", selection: $profileVisibility) { generalVisibilityOptions }
                        .onChange(of: profileVisibility) { _, v in saveText("profile_visibility", v) }

                    DisclosureGroup("Advanced") {
                        overrideRow("Catalog", $catalogOverride, column: "catalog_visibility")
                        overrideRow("Library", $libraryOverride, column: "library_visibility")
                        overrideRow("Stats",   $statsOverride,   column: "stats_visibility")
                    }
                } header: {
                    Text("Privacy")
                } footer: {
                    Text(profileVisibility == "Private"
                         ? "Private accounts are only visible to followers."
                         : "Public accounts are visible to everyone.")
                }

                // MARK: Support
                Section("Support") {
                    Link(destination: Config.webBaseURL.appendingPathComponent("/help")) {
                        HStack {
                            Label("Help & Feedback", image: "icon-help-circle")
                            Spacer()
                            Image("icon-arrow-up-right")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 12, height: 12)
                                .foregroundStyle(Color.sjMuted)
                        }
                    }
                    .foregroundStyle(Color.sjInk)
                }

                // MARK: Legal
                Section("Legal") {
                    Link(destination: Config.webBaseURL.appendingPathComponent("/terms")) {
                        HStack {
                            Label("Terms of Service", image: "icon-file-text")
                            Spacer()
                            Image("icon-arrow-up-right")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 12, height: 12)
                                .foregroundStyle(Color.sjMuted)
                        }
                    }
                    .foregroundStyle(Color.sjInk)

                    Link(destination: Config.webBaseURL.appendingPathComponent("/privacy")) {
                        HStack {
                            Label("Privacy Policy", image: "icon-hand")
                            Spacer()
                            Image("icon-arrow-up-right")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 12, height: 12)
                                .foregroundStyle(Color.sjMuted)
                        }
                    }
                    .foregroundStyle(Color.sjInk)
                }

                // MARK: Danger zone
                Section("Danger Zone") {
                    Button(role: .destructive) { showSignOutConfirm = true } label: {
                        Label("Sign Out", image: "icon-log-out")
                    }
                    Button(role: .destructive) {
                        deleteUsernameInput = ""
                        deleteError = nil
                        showDeleteConfirm = true
                    } label: {
                        Label("Delete Account", image: "icon-trash")
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
            .task { await loadVerifiedInviteCount() }
            .task { await refreshNotificationStatus() }
            .onChange(of: viewModel.profile?.ratingStep)          { _, _ in loadPreferences() }
            .onChange(of: viewModel.profile?.notifyLikes)         { _, _ in loadPreferences() }
            .onChange(of: viewModel.profile?.profileVisibility)   { _, _ in loadPreferences() }
            .onChange(of: scenePhase) { _, phase in
                // Covers the "denied -> Settings app -> granted" round trip,
                // which returns here with no callback of our own to hook.
                if phase == .active { Task { await refreshNotificationStatus() } }
            }
        }
    }

    // MARK: - OS notification permission

    private var isNotificationsAuthorized: Bool {
        [.authorized, .provisional, .ephemeral].contains(notificationStatus)
    }

    private var notificationsPermissionRow: some View {
        HStack(spacing: 12) {
            Image("icon-bell")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 16, height: 16)
                .foregroundStyle(Color.sjInk)
                .frame(width: 24)

            Text("Push notifications")
                .foregroundStyle(Color.sjInk)

            Spacer()

            if isNotificationsAuthorized {
                Text("On")
                    .font(.jakarta(12, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
            } else {
                Button {
                    Task { await enableNotifications() }
                } label: {
                    if isRequestingNotifications {
                        ProgressView().scaleEffect(0.75)
                    } else {
                        // Denied can't be re-prompted in-app -- only iOS Settings can
                        // change it now (same reasoning as ConnectedAccountsView's
                        // Apple Music row).
                        Text(notificationStatus == .notDetermined ? "Turn On" : "Open Settings")
                            .font(.jakarta(13, weight: .semibold))
                            .foregroundStyle(Color.sjBlue)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isRequestingNotifications)
            }
        }
    }

    private func refreshNotificationStatus() async {
        notificationStatus = await PushTokenService.authorizationStatus()
    }

    private func enableNotifications() async {
        if notificationStatus == .notDetermined {
            isRequestingNotifications = true
            await PushTokenService.requestAndRegister()
            await refreshNotificationStatus()
            isRequestingNotifications = false
            return
        }
        if let url = URL(string: UIApplication.openSettingsURLString) {
            await UIApplication.shared.open(url)
        }
    }

    // MARK: - Preference pickers

    private var appearancePicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Appearance")
                .font(.jakarta(13, weight: .semibold))
                .foregroundStyle(Color.sjInk)

            HStack(spacing: 8) {
                ForEach([("icon-sun", "Light", "light"),
                         ("icon-contrast", "System", "system"),
                         ("icon-moon", "Dark", "dark")] as [(String, LocalizedStringKey, String)], id: \.2) { icon, label, value in
                    segmentButton(icon: icon, label: label, selected: appearanceMode == value) {
                        appearanceMode = value
                    }
                }
            }
            .sensoryFeedback(.selection, trigger: appearanceMode)
        }
        .padding(.vertical, 6)
    }

    private var ratingPrecisionPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Rating Precision")
                .font(.jakarta(13, weight: .semibold))
                .foregroundStyle(Color.sjInk)

            HStack(spacing: 8) {
                ForEach([(0.5, "Half star"), (0.1, "Tenth")] as [(Double, LocalizedStringKey)], id: \.0) { step, label in
                    Button {
                        ratingStep = step
                        saveRatingStep(step)
                    } label: {
                        Text(label)
                            .font(.jakarta(12, weight: .semibold))
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
            .sensoryFeedback(.selection, trigger: ratingStep)
        }
        .padding(.vertical, 6)
    }

    // Unlocked once verifiedInviteCount >= 5 (checked at the call site above).
    // Flower artwork is unchanged from the shipped icon — only the background
    // color differs per option, matching the palette chosen when this reward
    // was designed.
    // `id` is a separate, always-non-nil field from `name` -- `name` is what
    // gets passed to setAlternateIconName (nil means "the default icon"), but
    // ForEach needs a Hashable identity, and LocalizedStringKey (the `label`
    // type) doesn't conform to Hashable.
    private static let iconOptions: [(id: String, name: String?, label: LocalizedStringKey, swatch: Color)] = [
        ("default",     nil,           "Default",    Color(red: 0.957, green: 0.945, blue: 0.914)),
        ("sand",        "Sand",        "Sand",       Color(red: 0.929, green: 0.890, blue: 0.827)),
        ("blush",       "Blush",       "Blush",      Color(red: 0.953, green: 0.863, blue: 0.878)),
        ("powderBlue",  "PowderBlue",  "Powder Blue", Color(red: 0.847, green: 0.902, blue: 0.941)),
        ("lavender",    "Lavender",    "Lavender",   Color(red: 0.890, green: 0.863, blue: 0.933)),
        ("mint",        "Mint",        "Mint",       Color(red: 0.843, green: 0.937, blue: 0.882)),
        ("terracotta",  "Terracotta",  "Terracotta", Color(red: 0.910, green: 0.765, blue: 0.659)),
        ("black",       "Black",       "Black",      Color(red: 0, green: 0, blue: 0)),
    ]

    private var appIconPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(Self.iconOptions, id: \.id) { option in
                    Button {
                        setIcon(option.name)
                    } label: {
                        VStack(spacing: 6) {
                            Circle()
                                .fill(option.swatch)
                                .frame(width: 44, height: 44)
                                .overlay(
                                    Circle().stroke(
                                        currentIconName == option.name ? Color.sjAmber : Color.sjBorder,
                                        lineWidth: currentIconName == option.name ? 2 : 1
                                    )
                                )
                                .overlay {
                                    if currentIconName == option.name {
                                        Image("icon-check")
                                            .renderingMode(.template)
                                            .resizable().scaledToFit()
                                            .frame(width: 14, height: 14)
                                            .foregroundStyle(option.name == "Black" ? .white : Color.sjInk)
                                    }
                                }
                            Text(option.label)
                                .font(.jakarta(10, weight: .medium))
                                .foregroundStyle(Color.sjMuted)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 6)
        }
    }

    private func setIcon(_ name: String?) {
        guard currentIconName != name else { return }
        UIApplication.shared.setAlternateIconName(name) { error in
            if error == nil { currentIconName = name }
        }
    }

    private func loadVerifiedInviteCount() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        async let resp = supabase.from("referrals").select("*", count: .exact)
            .eq("referrer_id", value: userId)
            .not("verified_at", operator: .is, value: AnyJSON.null)
            .execute()
        verifiedInviteCount = (try? await resp)?.count ?? 0
    }

    @ViewBuilder
    private var generalVisibilityOptions: some View {
        ForEach([("Public", "Public"), ("Private", "Private")] as [(LocalizedStringKey, String)], id: \.1) { label, value in
            Text(label).tag(value)
        }
    }

    private func overrideRow(_ label: LocalizedStringKey, _ selection: Binding<VisibilityOverride>, column: String) -> some View {
        Picker(label, selection: selection) {
            ForEach(VisibilityOverride.allCases, id: \.self) { option in
                Text(option.label).tag(option)
            }
        }
        .onChange(of: selection.wrappedValue) { _, v in saveNullableText(column, v.dbValue) }
    }

    private func segmentButton(icon: String, label: LocalizedStringKey, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(icon)
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 12, height: 12)
                Text(label).font(.jakarta(12, weight: .semibold))
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
                Text("This will permanently delete your account and all your data — ratings, reviews, mixes, and followers. This cannot be undone.")
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjMuted)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Type your username to confirm:")
                        .font(.jakarta(13, weight: .semibold))
                        .foregroundStyle(Color.sjInk)

                    HStack(spacing: 2) {
                        Text("@").foregroundStyle(Color.sjMuted)
                        TextField(viewModel.profile?.username ?? String(localized: "username"), text: $deleteUsernameInput)
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
                        .font(.jakarta(13))
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
                                .font(.jakarta(16, weight: .semibold))
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
        ratingStep           = p.ratingStep ?? 0.5
        notifyLikes          = p.notifyLikes ?? true
        notifyReplies        = p.notifyReplies ?? true
        notifyFollowers      = p.notifyFollowers ?? true
        notifyRankings       = p.notifyRankings ?? true
        notifyCapsule        = p.notifyCapsule ?? true
        profileVisibility    = p.profileVisibility ?? "Public"
        catalogOverride      = .from(p.catalogVisibility)
        libraryOverride      = .from(p.libraryVisibility)
        statsOverride        = .from(p.statsVisibility)
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

    // nil serializes as JSON `null` (verified against the vendored
    // PostgrestQueryBuilder.update() + Swift's Optional: Encodable
    // conformance), correctly clearing an override column back to "inherit
    // from profileVisibility" rather than merely omitting the field.
    private func saveNullableText(_ column: String, _ value: String?) {
        guard let user = supabase.auth.currentUser else { return }
        Task {
            try? await supabase.from("profiles")
                .update([column: value])
                .eq("id", value: user.id).execute()
        }
    }

    private func deleteAccount() async {
        guard let session = try? await supabase.auth.session else {
            deleteError = String(localized: "Not signed in.")
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
                deleteError = (body?["error"] as? String) ?? String(localized: "Failed to delete account. Please try again.")
            }
        } catch {
            deleteError = String(localized: "Network error. Please try again.")
        }

        isDeleting = false
    }
}
