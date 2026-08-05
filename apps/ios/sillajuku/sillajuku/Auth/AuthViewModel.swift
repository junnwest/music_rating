import Foundation
import Observation
import Supabase
import AuthenticationServices
import CryptoKit
import Sentry

@Observable
class AuthViewModel {
    var isLoading = false
    var errorMessage: String?

    // Retained during the Apple Sign In flow (ASAuthorizationController.delegate is weak)
    private var appleSignInHandler: AppleSignInHandler?

    func signInWithSpotify() async {
        await signIn(provider: .spotify, scopes: "user-top-read user-read-recently-played")
    }

    func signInWithGoogle() async {
        await signIn(provider: .google)
    }

    func signInWithApple() async {
        isLoading = true
        defer { isLoading = false }

        let rawNonce    = randomNonceString()
        let hashedNonce = sha256(rawNonce)

        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        request.nonce = hashedNonce

        do {
            let credential: ASAuthorizationAppleIDCredential = try await withCheckedThrowingContinuation { continuation in
                let handler = AppleSignInHandler(continuation: continuation)
                self.appleSignInHandler = handler
                let controller = ASAuthorizationController(authorizationRequests: [request])
                controller.delegate = handler
                controller.presentationContextProvider = handler
                controller.performRequests()
            }
            appleSignInHandler = nil

            guard let tokenData = credential.identityToken,
                  let idToken   = String(data: tokenData, encoding: .utf8) else {
                errorMessage = String(localized: "Sign In with Apple failed: no identity token received.")
                return
            }
            try await supabase.auth.signInWithIdToken(
                credentials: .init(provider: .apple, idToken: idToken, nonce: rawNonce)
            )
        } catch {
            appleSignInHandler = nil
            if (error as? ASAuthorizationError)?.code != .canceled {
                // App Review rejected build 13 (Guideline 2.1(a), 2026-07-31, iPad
                // Air 11" M3) for "an error message was displayed" during Sign in
                // with Apple, with no repro steps or error text given. Capturing to
                // Sentry here means any recurrence — on this device class or any
                // other — leaves an actual stack trace/error code instead of
                // another blind-guess round.
                SentrySDK.capture(error: error)
                // Same Apple ID gets reused across every App Review resubmission
                // (documented in this file's onboarding-adjacent history) — if
                // Supabase's identity linking ever conflicts for that reused
                // identity, don't surface the raw backend string.
                if let authError = error as? AuthError, authError.errorCode == .identityAlreadyExists {
                    errorMessage = String(localized: "This Apple ID is already linked to a different sillajuku account. Sign in with the account you originally used, or contact support to unlink it.")
                } else {
                    errorMessage = error.localizedDescription
                }
            }
        }
    }

    // MARK: - OAuth (Spotify, Google)

    private func signIn(provider: Provider, scopes: String? = nil) async {
        isLoading = true
        defer { isLoading = false }
        do {
            try await supabase.auth.signInWithOAuth(
                provider: provider,
                redirectTo: Config.oauthRedirectURL,
                scopes: scopes,
                queryParams: accountChooserParams(for: provider)
            )
        } catch {
            SentrySDK.capture(error: error)
            errorMessage = error.localizedDescription
        }
    }

    // Without this, both providers silently reuse whichever account already has a
    // trusted session on-device: Google skips its own account picker entirely, and
    // Spotify skips its login/consent screen — so signing out and choosing the same
    // OAuth button again just re-authenticates the same account with no way to pick
    // a different one. Each provider needs its own parameter to force that dialog
    // back open; GoTrue forwards arbitrary queryParams straight through to the
    // provider's own /authorize URL. Sign in with Apple is unaffected — it's a
    // native ASAuthorizationController flow, not this OAuth path, and account
    // switching there is the device's own Apple ID setting, outside this app.
    private func accountChooserParams(for provider: Provider) -> [(name: String, value: String?)] {
        switch provider {
        case .google:
            return [("prompt", "select_account")]
        case .spotify:
            return [("show_dialog", "true")]
        default:
            return []
        }
    }

    // MARK: - Apple Sign In helpers

    private func randomNonceString(length: Int = 32) -> String {
        var bytes = [UInt8](repeating: 0, count: length)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    private func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Apple Sign In delegate

private final class AppleSignInHandler: NSObject,
                                        ASAuthorizationControllerDelegate,
                                        ASAuthorizationControllerPresentationContextProviding {
    private let continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>

    init(continuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>) {
        self.continuation = continuation
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithAuthorization authorization: ASAuthorization) {
        if let credential = authorization.credential as? ASAuthorizationAppleIDCredential {
            continuation.resume(returning: credential)
        } else {
            continuation.resume(throwing: ASAuthorizationError(.unknown))
        }
    }

    func authorizationController(controller: ASAuthorizationController,
                                 didCompleteWithError error: Error) {
        continuation.resume(throwing: error)
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        // App Review rejected build 13 (Guideline 2.1(a), 2026-07-31) for an
        // unspecified error during Sign in with Apple on iPad Air 11" M3 — no
        // repro steps given. This app does NOT declare
        // UIApplicationSupportsMultipleScenes, so it can never have more than
        // one UIWindowScene of its own alive at once — Split View/Stage Manager
        // with a *different* app doesn't add entries to *our* connectedScenes
        // (each app is its own process with its own scene list), so multi-app
        // multitasking was never actually a way to get more than one scene
        // here. The real, narrower risk the old
        // `.first { $0.isKeyWindow } ?? UIWindow()` missed: our single window
        // can be transiently NOT flagged key during a scene activation-state
        // transition (e.g. right as the app (re)gains focus), and the old
        // fallback then handed ASAuthorizationController a disconnected,
        // scene-less window with nothing to present on. This is the strongest
        // available hypothesis (matches the exact code path and the "error
        // message displayed" symptom), though Apple gave no error text to
        // confirm it, and the timing window is closer to a race condition than
        // something a manual repro can force on demand — the `SentrySDK.capture`
        // in the catch block above is the fallback if this isn't the whole
        // story. The fix below is a strict improvement regardless of the exact
        // trigger: it only ever prefers a real window over the old blank one.
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let activeKeyWindow = scenes
            .first(where: { $0.activationState == .foregroundActive })?
            .windows.first(where: \.isKeyWindow) {
            return activeKeyWindow
        }
        if let anyKeyWindow = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
            return anyKeyWindow
        }
        if let anyWindow = scenes.flatMap(\.windows).first {
            return anyWindow
        }
        return UIWindow()
    }
}
