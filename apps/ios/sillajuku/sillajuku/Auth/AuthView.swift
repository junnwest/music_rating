import SwiftUI

struct AuthView: View {
    @State private var viewModel = AuthViewModel()

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer()

                // Logo + tagline
                VStack(spacing: 14) {
                    // TODO: replace with Image("logo-flower") once asset is added to Assets.xcassets
                    Image(systemName: "music.note.list")
                        .font(.system(size: 56))
                        .foregroundStyle(Color.sjInk)

                    Text("sillajuku")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(Color.sjInk)

                    Text("Every record you've loved.")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.sjMuted)
                }

                Spacer()

                // Auth buttons
                VStack(spacing: 12) {
                    SpotifyAuthButton(isLoading: viewModel.isLoading) {
                        Task { await viewModel.signInWithSpotify() }
                    }
                    AppleAuthButton {
                        Task { await viewModel.signInWithApple() }
                    }
                    GoogleAuthButton(isLoading: viewModel.isLoading) {
                        Task { await viewModel.signInWithGoogle() }
                    }
                }
                .padding(.horizontal, 24)

                Text("By continuing, you agree to our Terms and Privacy Policy.")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .padding(.top, 20)
                    .padding(.bottom, 48)
            }
        }
        .alert("Sign-in failed", isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Button("OK") { viewModel.errorMessage = nil }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }
}

// MARK: - Button components

private struct SpotifyAuthButton: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "music.note")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 24)

                Text("Continue with Spotify")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)

                Spacer()

                Text("Recommended")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.sjSpotifyGreen)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.white.opacity(0.9))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
            .background(isLoading ? Color.sjSpotifyGreen.opacity(0.6) : Color.sjSpotifyGreen)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(isLoading)
    }
}

private struct AppleAuthButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "apple.logo")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.white.opacity(0.45))
                    .frame(width: 24)

                Text("Continue with Apple")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.45))

                Spacer()

                Text("Coming soon")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.35))
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
            .background(Color.sjInk.opacity(0.35))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(true)
    }
}

private struct GoogleAuthButton: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text("G")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color(red: 0.263, green: 0.522, blue: 0.957))
                    .frame(width: 24)

                Text("Continue with Google")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.sjInk)

                Spacer()
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity)
            .background(.white)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.sjBorder, lineWidth: 1.5)
            )
        }
        .disabled(isLoading)
    }
}

#Preview {
    AuthView()
}
