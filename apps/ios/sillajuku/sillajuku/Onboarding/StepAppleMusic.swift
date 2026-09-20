import SwiftUI
import MusicKit
import Supabase

struct StepAppleMusic: View {
    let isSaving: Bool
    let onFinish: () async -> Void

    @State private var isRequesting = false
    @State private var isRequestingSpotify = false
    // Starts true so the Spotify row doesn't flash in and back out while the
    // identity check below resolves -- this screen only shows for provider ==
    // "apple" signups (OnboardingView.init), who realistically never have
    // Spotify linked yet, so "hidden until proven linked" would be the wrong
    // default flicker to show first.
    @State private var spotifyLinked = true
    @Environment(\.scenePhase) private var scenePhase

    private var isBusy: Bool { isRequesting || isRequestingSpotify || isSaving }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 90)

            VStack(alignment: .leading, spacing: 8) {
                Text("Connect your music.")
                    .font(.jakarta(28, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("We only use your listening history to suggest albums worth rating — never posted or shared anywhere.")
                    .font(.jakarta(16))
                    .foregroundStyle(Color.sjMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 28)

            VStack(spacing: 10) {
                connectionRow(
                    icon: { Image("icon-music")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 16, height: 16)
                        .foregroundStyle(Color.sjInk)
                    },
                    title: "Apple Music",
                    detail: "Uses your library and recently played.",
                    isBusy: isRequesting,
                    action: { Task { await requestAppleMusic() } }
                )

                if !spotifyLinked {
                    connectionRow(
                        // Spotify's mark is a full-color asset everywhere else
                        // in this app (AuthView, ConnectedAccountsView) — no
                        // .renderingMode(.template), unlike icon-music's
                        // single-color glyph.
                        icon: { Image("icon-spotify")
                            .resizable().scaledToFit()
                        },
                        title: "Spotify",
                        detail: "Uses your top artists and recently played.",
                        isBusy: isRequestingSpotify,
                        action: { Task { await requestSpotify() } }
                    )
                }
            }
            .padding(.horizontal, 24)

            Spacer()

            // App Review, Guideline 5.1.1(iv) — two rounds:
            // 2026-07-21: a custom pre-permission screen must not word its own
            // button "Allow X" (that's the system sheet's language) — fixed to
            // "Continue".
            // 2026-07-27 (build 11, still rejected): a "Skip for now" button let
            // the user close this message and delay the real permission prompt
            // indefinitely. Apple's rule is that a custom pre-permission screen
            // must always lead into the system request — it can gate whether the
            // request fires, not offer an escape from ever seeing it. The skip
            // button is gone; "Continue" is the only action and always calls
            // `requestAndFinish()`, which fires the real MusicKit dialog. A user
            // who doesn't want library access still declines it there (system
            // "Don't Allow") — `requestAndFinish()` calls `onFinish()`
            // unconditionally after the request resolves, so declining doesn't
            // block onboarding, it just skips the permission itself.
            //
            // 2026-09-20: user asked to "allow users to skip" here again — given
            // that history, deliberately did NOT reintroduce a button that
            // bypasses the system dialog (same shape as the two rejections
            // above). This button's behavior is unchanged; only the caption
            // below it was added, so a user who doesn't want to grant anything
            // can see up front that tapping Continue and declining the prompt is
            // safe and won't block onboarding — the actual bypass already exists
            // (via "Don't Allow"), it just wasn't legible before.
            VStack(spacing: 10) {
                Button(action: { Task { await requestAndFinish() } }) {
                    HStack(spacing: 10) {
                        if isRequesting {
                            ProgressView()
                                .scaleEffect(0.8)
                                .tint(Color.sjCream)
                        }
                        Text(isSaving ? "Saving…" : "Continue")
                            .font(.jakarta(16, weight: .semibold))
                            .foregroundStyle(Color.sjCream)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.sjInk)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isBusy)

                Text("You can always connect these later in Settings.")
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
        .task { await refreshSpotifyLinked() }
        .onChange(of: scenePhase) { _, phase in
            // Linking Spotify finishes via an external Safari/OAuth redirect,
            // not this screen directly -- same pattern as ConnectedAccountsView.
            if phase == .active { Task { await refreshSpotifyLinked() } }
        }
    }

    @ViewBuilder
    private func connectionRow(@ViewBuilder icon: () -> some View, title: LocalizedStringKey, detail: LocalizedStringKey, isBusy: Bool, action: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            icon()
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.jakarta(15, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                Text(detail)
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
            }

            Spacer()

            Button(action: action) {
                if isBusy {
                    ProgressView().scaleEffect(0.75)
                } else {
                    Text("Connect")
                        .font(.jakarta(13, weight: .semibold))
                        .foregroundStyle(Color.sjBlue)
                }
            }
            .buttonStyle(.plain)
            .disabled(isBusy)
        }
        .padding(14)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func requestAppleMusic() async {
        isRequesting = true
        await MusicKitService.requestAuthorization()
        isRequesting = false
    }

    private func requestSpotify() async {
        isRequestingSpotify = true
        defer { isRequestingSpotify = false }
        try? await supabase.auth.linkIdentity(
            provider: .spotify,
            redirectTo: Config.oauthRedirectURL,
            queryParams: [("show_dialog", "true")]
        )
        // Nothing to reload yet -- linking finishes asynchronously via the
        // OAuth redirect + onOpenURL, then refreshSpotifyLinked() on the
        // scenePhase-active hook above picks it up.
    }

    private func refreshSpotifyLinked() async {
        let identities = (try? await supabase.auth.userIdentities()) ?? []
        spotifyLinked = identities.contains { $0.provider == Provider.spotify.rawValue }
    }

    private func requestAndFinish() async {
        isRequesting = true
        await MusicKitService.requestAuthorization()
        isRequesting = false
        await onFinish()
    }
}
