import Foundation
import Observation
import Supabase
import AuthenticationServices
import CryptoKit

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
                errorMessage = "Sign In with Apple failed: no identity token received."
                return
            }
            try await supabase.auth.signInWithIdToken(
                credentials: .init(provider: .apple, idToken: idToken, nonce: rawNonce)
            )
        } catch {
            appleSignInHandler = nil
            if (error as? ASAuthorizationError)?.code != .canceled {
                errorMessage = error.localizedDescription
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
                scopes: scopes
            )
        } catch {
            errorMessage = error.localizedDescription
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
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? UIWindow()
    }
}
