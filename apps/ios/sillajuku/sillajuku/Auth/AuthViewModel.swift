import Supabase

@Observable
class AuthViewModel {
    var isLoading = false
    var errorMessage: String?

    func signInWithSpotify() async {
        await signIn(provider: .spotify, scopes: "user-top-read user-read-recently-played")
    }

    func signInWithGoogle() async {
        await signIn(provider: .google)
    }

    func signInWithApple() async {
        await signIn(provider: .apple)
    }

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
}
