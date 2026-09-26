import SwiftUI
import Supabase

/// Deactivate / reactivate (migration 20260926000002_account_deactivation).
enum AccountStatus {
    /// Hides the account everywhere; the caller signs out afterwards.
    static func deactivate() async throws {
        try await supabase.rpc("deactivate_my_account").execute()
    }

    static func reactivate() async throws {
        try await supabase.rpc("reactivate_my_account").execute()
    }
}

/// Shown instead of the app when a deactivated account signs in: nothing
/// comes back until the user explicitly chooses Reactivate.
struct DeactivatedAccountView: View {
    @Environment(AppState.self) private var appState
    @State private var isWorking = false
    @State private var errorText: String?

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                Image("icon-moon")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 36, height: 36)
                    .foregroundStyle(Color.sjBlue)
                    .accessibilityHidden(true)
                    .padding(.bottom, 20)

                Text("Your account is deactivated")
                    .font(.jakarta(22, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .multilineTextAlignment(.center)

                Text("Your profile, ratings, Mixes and comments are hidden. Reactivate to bring everything back.")
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.top, 10)
                    .padding(.horizontal, 12)

                Spacer()

                if let errorText {
                    Text(errorText)
                        .font(.jakarta(13))
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .padding(.bottom, 12)
                }

                Button {
                    Task { await reactivate() }
                } label: {
                    Group {
                        if isWorking {
                            ProgressView().tint(.white)
                        } else {
                            Text("Reactivate Account")
                                .font(.jakarta(16, weight: .semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.sjAmber)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isWorking)

                Button("Sign Out") {
                    Task {
                        SpotifyService.clearCache()
                        try? await supabase.auth.signOut()
                        appState.authState = .unauthenticated
                    }
                }
                .font(.jakarta(15, weight: .medium))
                .foregroundStyle(Color.sjMuted)
                .padding(.vertical, 14)
                .disabled(isWorking)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
        }
    }

    private func reactivate() async {
        isWorking = true
        errorText = nil
        do {
            try await AccountStatus.reactivate()
            appState.authState = .authenticated
        } catch {
            errorText = String(localized: "Couldn't reactivate your account. Please try again.")
        }
        isWorking = false
    }
}
