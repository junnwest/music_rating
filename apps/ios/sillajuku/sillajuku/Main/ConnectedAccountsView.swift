import SwiftUI
import Supabase
import MusicKit

struct ConnectedAccountsView: View {
    @State private var vm = ConnectedAccountsViewModel()
    @State private var showPhoneVerification = false
    @State private var showDisconnectPhoneConfirm = false
    @State private var unlinkTarget: Provider?
    // Local, not on ConnectedAccountsViewModel -- MusicKit authorization is a device
    // permission (MusicAuthorization.currentStatus), not a Supabase-linked identity like
    // the social providers below, so it doesn't belong in that model's `identities` list.
    @State private var appleMusicStatus = MusicAuthorization.currentStatus
    @State private var isRequestingAppleMusic = false
    @Environment(\.scenePhase) private var scenePhase

    private static let socialProviders: [(provider: Provider, label: LocalizedStringKey, icon: ProviderIcon)] = [
        (.spotify, "Spotify", .asset("icon-spotify")),
        (.apple,   "Apple",   .system("apple.logo")),
        (.google,  "Google",  .asset("icon-google")),
    ]

    enum ProviderIcon { case asset(String), system(String) }

    var body: some View {
        List {
            Section {
                ForEach(Self.socialProviders, id: \.provider) { entry in
                    providerRow(entry)
                }
            } header: {
                Text("Social accounts")
            } footer: {
                Text("Connect more than one so you can always sign back in, even if you lose access to one of them.")
            }

            Section {
                appleMusicRow
            } header: {
                Text("Music library")
            } footer: {
                Text("Lets Quick Add and Home suggest albums from your Apple Music library, recently played, and heavy rotation. Skipped this during setup? Connect it here any time.")
            }

            Section {
                phoneRow
            } header: {
                Text("Phone number")
            } footer: {
                if vm.hasVerifiedPhone {
                    Text("Used to verify invites and prevent duplicate accounts.")
                } else {
                    Text("Required before you can invite friends.")
                }
            }

            if let errorMessage = vm.errorMessage {
                Text(errorMessage)
                    .font(.jakarta(13))
                    .foregroundStyle(.red)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Connected Accounts")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load() }
        .onChange(of: scenePhase) { _, phase in
            // Linking a social account finishes via an external Safari/OAuth
            // redirect, not this screen directly -- reload once control
            // actually returns to the app so a newly-linked identity shows up
            // without the user having to back out and back in manually.
            if phase == .active {
                Task { await vm.load() }
                // Covers the "denied -> Settings app -> granted" path, which returns
                // here with no callback of our own to hook.
                appleMusicStatus = MusicAuthorization.currentStatus
            }
        }
        .sheet(isPresented: $showPhoneVerification, onDismiss: { Task { await vm.load() } }) {
            PhoneVerificationView()
        }
        .confirmationDialog(
            "Disconnect this phone number?",
            isPresented: $showDisconnectPhoneConfirm,
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                Task { await vm.disconnectPhone() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You'll need to verify a phone number again before you can invite friends. Credit you've already given won't be affected.")
        }
        .confirmationDialog(
            "Disconnect this account?",
            isPresented: Binding(get: { unlinkTarget != nil }, set: { if !$0 { unlinkTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("Disconnect", role: .destructive) {
                if let provider = unlinkTarget { Task { await vm.unlink(provider) } }
                unlinkTarget = nil
            }
            Button("Cancel", role: .cancel) { unlinkTarget = nil }
        } message: {
            Text("You won't be able to sign in with this account anymore.")
        }
    }

    @ViewBuilder
    private func providerRow(_ entry: (provider: Provider, label: LocalizedStringKey, icon: ProviderIcon)) -> some View {
        let linked = vm.isLinked(entry.provider)
        HStack(spacing: 12) {
            providerIcon(entry.icon)
                .frame(width: 24, height: 24)

            Text(entry.label)
                .foregroundStyle(Color.sjInk)

            Spacer()

            if linked {
                Text("Connected")
                    .font(.jakarta(12, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
            }

            Button {
                if linked {
                    unlinkTarget = entry.provider
                } else {
                    Task { await vm.link(entry.provider) }
                }
            } label: {
                Text(linked ? "Disconnect" : "Connect")
                    .font(.jakarta(13, weight: .semibold))
                    .foregroundStyle(linked ? .red : Color.sjBlue)
            }
            .buttonStyle(.plain)
            .disabled(vm.isWorking || (linked && !vm.canUnlinkAnother))
        }
    }

    @ViewBuilder
    private func providerIcon(_ icon: ProviderIcon) -> some View {
        switch icon {
        case .asset(let name):
            Image(name).resizable().scaledToFit()
        case .system(let name):
            Image(systemName: name).font(.jakarta(18)).foregroundStyle(Color.sjInk)
        }
    }

    private var appleMusicRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "music.note")
                .font(.jakarta(16))
                .foregroundStyle(Color.sjInk)
                .frame(width: 24)

            Text("Apple Music")
                .foregroundStyle(Color.sjInk)

            Spacer()

            switch appleMusicStatus {
            case .authorized:
                Text("Connected")
                    .font(.jakarta(12, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
            default:
                Button {
                    Task { await connectAppleMusic() }
                } label: {
                    if isRequestingAppleMusic {
                        ProgressView().scaleEffect(0.75)
                    } else {
                        // Denied/restricted can't be re-prompted in-app (MusicAuthorization.request()
                        // just returns the same status again) -- only iOS Settings can change it now.
                        Text(appleMusicStatus == .notDetermined ? "Connect" : "Open Settings")
                            .font(.jakarta(13, weight: .semibold))
                            .foregroundStyle(Color.sjBlue)
                    }
                }
                .buttonStyle(.plain)
                .disabled(isRequestingAppleMusic)
            }
        }
    }

    private func connectAppleMusic() async {
        if appleMusicStatus != .notDetermined {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                await UIApplication.shared.open(url)
            }
            return
        }
        isRequestingAppleMusic = true
        let granted = await MusicKitService.requestAuthorization()
        appleMusicStatus = MusicAuthorization.currentStatus
        isRequestingAppleMusic = false
        // DiscoveryViewModel has no reference here -- Quick Add and Home pick this up via
        // the same scenePhase/notification hooks Spotify already uses (SearchView.swift).
        if granted { NotificationCenter.default.post(name: .sjAppleMusicAuthorized, object: nil) }
    }

    private var phoneRow: some View {
        HStack(spacing: 12) {
            Image(systemName: "phone.fill")
                .font(.jakarta(16))
                .foregroundStyle(Color.sjInk)
                .frame(width: 24)

            if vm.hasVerifiedPhone, let phone = vm.phoneNumber {
                Text(maskedPhone(phone))
                    .foregroundStyle(Color.sjInk)
            } else {
                Text("Not connected")
                    .foregroundStyle(Color.sjMuted)
            }

            Spacer()

            Button {
                if vm.hasVerifiedPhone {
                    showDisconnectPhoneConfirm = true
                } else {
                    showPhoneVerification = true
                }
            } label: {
                Text(vm.hasVerifiedPhone ? "Disconnect" : "Connect")
                    .font(.jakarta(13, weight: .semibold))
                    .foregroundStyle(vm.hasVerifiedPhone ? .red : Color.sjBlue)
            }
            .buttonStyle(.plain)
            .disabled(vm.isWorking)
        }
    }

    // Keeps the last 4 digits visible, masks the rest -- same idea as showing
    // a masked card number, since this is otherwise a real, personally
    // identifying phone number displayed in plain Settings UI.
    private func maskedPhone(_ phone: String) -> String {
        let digits = phone.filter(\.isNumber)
        guard digits.count > 4 else { return "+\(digits)" }
        let last4 = digits.suffix(4)
        return "+\(String(repeating: "•", count: digits.count - 4))\(last4)"
    }
}

#Preview {
    NavigationStack { ConnectedAccountsView() }
}
