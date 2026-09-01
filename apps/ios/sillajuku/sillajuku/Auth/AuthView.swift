import SwiftUI

struct AuthView: View {
    @State private var viewModel = AuthViewModel()
    @State private var showMoreOptions = false

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()

            // Decorative flowers — ignoresSafeArea so geo covers full screen,
            // no .clipped() needed (physical screen edges handle it)
            GeometryReader { geo in
                // Top-right flower
                let topFlowerSize = geo.size.width * 1.4
                Image("logo-flower")
                    .resizable()
                    .scaledToFit()
                    .frame(width: topFlowerSize)
                    .opacity(0.09)
                    .position(x: geo.size.width * 0.82, y: geo.size.width * 0.22 + topFlowerSize * 0.5 - geo.size.width * 0.3)

                // Bottom-left flower
                Image("logo-flower")
                    .resizable()
                    .scaledToFit()
                    .frame(width: geo.size.width)
                    .opacity(0.09)
                    .position(x: geo.size.width * 0.18, y: geo.size.height - geo.size.width * 0.22)
            }
            .ignoresSafeArea()

            // Main content
            VStack(spacing: 0) {
                Spacer()

                // Flower + wordmark
                VStack(spacing: 8) {
                    Image("logo-flower")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 128, height: 128)

                    Image("logo-text")
                        .resizable()
                        .renderingMode(.template)
                        .scaledToFit()
                        .frame(height: 38)
                        .foregroundStyle(Color.sjInk)
                }

                // Small capped gap
                Spacer().frame(maxHeight: 40)

                // Tagline
                Text("Every Record You've Loved.")
                    .font(.jakarta(24, weight: .bold))
                    .foregroundStyle(Color.sjInk.opacity(0.6))
                    .padding(.bottom, 18)
                    .padding(.horizontal, 24)

                // Auth buttons
                VStack(spacing: 12) {
                    SpotifyAuthButton(isLoading: viewModel.isLoading) {
                        Task { await viewModel.signInWithSpotify() }
                    }

                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            showMoreOptions.toggle()
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text("More options")
                                .font(.jakarta(14))
                                .foregroundStyle(Color.sjMuted)
                            Image(showMoreOptions ? "icon-chevron-up" : "icon-chevron-down")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 11, height: 11)
                                .foregroundStyle(Color.sjMuted)
                        }
                    }

                    if showMoreOptions {
                        AppleAuthButton(isLoading: viewModel.isLoading) {
                            Task { await viewModel.signInWithApple() }
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))

                        GoogleAuthButton(isLoading: viewModel.isLoading) {
                            Task { await viewModel.signInWithGoogle() }
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                .padding(.horizontal, 24)

                Spacer()
            }

            // Legal text — always pinned to bottom, outside the flow
            VStack {
                Spacer()
                Text(legalText)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 32)
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

    private var legalText: AttributedString {
        var base = AttributedString(String(localized: "By continuing, you agree to our"))
        base.font = .jakarta(12)
        base.foregroundColor = Color.sjMuted

        let lineBreak = AttributedString("\n")

        var terms = AttributedString(String(localized: "Terms of Service"))
        terms.font = .jakarta(12, weight: .bold)
        terms.foregroundColor = Color.sjMuted
        terms.link = URL(string: "https://sillajuku.com/terms")

        var sep = AttributedString(String(localized: " and "))
        sep.font = .jakarta(12)
        sep.foregroundColor = Color.sjMuted

        var privacy = AttributedString(String(localized: "Privacy Policy"))
        privacy.font = .jakarta(12, weight: .bold)
        privacy.foregroundColor = Color.sjMuted
        privacy.link = URL(string: "https://sillajuku.com/privacy")

        return base + lineBreak + terms + sep + privacy
    }
}

// MARK: - Spotify button

private struct SpotifyAuthButton: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image("icon-spotify")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 24, height: 24)

                Text("Continue with Spotify")
                    .font(.jakarta(16, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .center)
            .background(isLoading ? Color.sjSpotifyGreen.opacity(0.6) : Color.sjSpotifyGreen)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(isLoading)
    }
}

// MARK: - Apple button

private struct AppleAuthButton: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "apple.logo")
                    .font(.jakarta(18, weight: .medium))
                    .foregroundStyle(.white)
                    .frame(width: 24)

                Text("Continue with Apple")
                    .font(.jakarta(16, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .center)
            .background(isLoading ? Color.black.opacity(0.6) : Color.black)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(isLoading)
    }
}

// MARK: - Google button

private struct GoogleAuthButton: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image("icon-google")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 24, height: 24)

                Text("Continue with Google")
                    .font(.jakarta(16, weight: .semibold))
                    .foregroundStyle(Color(red: 0.1, green: 0.1, blue: 0.1))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .center)
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

#Preview("Light") { AuthView() }
#Preview("Dark") { AuthView().preferredColorScheme(.dark) }
