import Foundation
import Observation
import Supabase

/// Backs the Settings -> Connected Accounts screen: which OAuth identities
/// are linked (Spotify/Apple/Google) and whether a phone number is attached.
/// Linking reuses supabase-swift's generic OAuth `linkIdentity(provider:)`
/// for all three providers -- including Apple -- rather than the native
/// Sign-In-With-Apple flow AuthViewModel uses for initial signup. Supabase
/// supports Apple as a normal web-redirect OAuth provider too, so this stays
/// one consistent flow instead of duplicating ASAuthorizationController
/// plumbing here. The existing `.onOpenURL` handler in sillajukuApp.swift
/// already completes this generically (`session(from: url)` exchanges
/// whatever PKCE flow is pending, login or link) -- no changes needed there.
@Observable
final class ConnectedAccountsViewModel {
    private(set) var isLoading = true
    private(set) var identities: [UserIdentity] = []
    var errorMessage: String?
    var isWorking = false

    var phoneNumber: String? {
        let phone = supabase.auth.currentUser?.phone
        return (phone?.isEmpty ?? true) ? nil : phone
    }
    var hasVerifiedPhone: Bool { supabase.auth.currentUser?.phoneConfirmedAt != nil }

    func load() async {
        isLoading = true
        identities = (try? await supabase.auth.userIdentities()) ?? []
        isLoading = false
    }

    func isLinked(_ provider: Provider) -> Bool {
        identities.contains { $0.provider == provider.rawValue }
    }

    // Never let the last remaining sign-in method be unlinked -- that would
    // permanently lock the user out of their own account with no way back in.
    var canUnlinkAnother: Bool { identities.count > 1 }

    func link(_ provider: Provider) async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }
        do {
            try await supabase.auth.linkIdentity(
                provider: provider,
                redirectTo: Config.oauthRedirectURL,
                queryParams: Self.accountChooserParams(for: provider)
            )
            // Nothing to reload yet -- linking finishes asynchronously via the
            // OAuth redirect + onOpenURL, not this call returning.
        } catch {
            print("ConnectedAccountsViewModel.link(\(provider.rawValue)) failed: \(error)")
            errorMessage = String(localized: "Couldn't connect that account. Try again.")
        }
    }

    // Same fix as AuthViewModel.signIn's initial-login path, needed here too:
    // linking a second Google/Spotify account from Settings would otherwise
    // silently reuse whichever account already has a trusted on-device session,
    // with no way to pick a different one to connect.
    private static func accountChooserParams(for provider: Provider) -> [(name: String, value: String?)] {
        switch provider {
        case .google:
            return [("prompt", "select_account")]
        case .spotify:
            return [("show_dialog", "true")]
        default:
            return []
        }
    }

    func unlink(_ provider: Provider) async {
        guard canUnlinkAnother, let identity = identities.first(where: { $0.provider == provider.rawValue }) else { return }
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }
        do {
            try await supabase.auth.unlinkIdentity(identity)
            await load()
        } catch {
            print("ConnectedAccountsViewModel.unlink(\(provider.rawValue)) failed: \(error)")
            errorMessage = String(localized: "Couldn't disconnect that account. Try again.")
        }
    }

    func disconnectPhone() async {
        errorMessage = nil
        isWorking = true
        defer { isWorking = false }
        do {
            try await supabase.rpc("disconnect_phone").execute()
        } catch {
            print("ConnectedAccountsViewModel.disconnectPhone failed: \(error)")
            errorMessage = String(localized: "Couldn't disconnect your phone number. Try again.")
        }
    }
}
