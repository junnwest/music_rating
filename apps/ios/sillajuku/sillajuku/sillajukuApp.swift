import SwiftUI
import Supabase
import UserNotifications
import Sentry

extension Notification.Name {
    static let sjSpotifyTokenRefreshed = Notification.Name("sjSpotifyTokenRefreshed")
    static let sjAppleMusicAuthorized = Notification.Name("sjAppleMusicAuthorized")
    static let sjEmailConfirmed = Notification.Name("sjEmailConfirmed")
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        SentrySDK.start { options in
            options.dsn = Config.sentryDSN
            #if DEBUG
            options.environment = "development"
            #else
            options.environment = "production"
            #endif
            options.tracesSampleRate = 0.1
        }

        // Default URLCache is 4 MB memory / 20 MB disk — not enough for an image-heavy tab.
        // 50 MB memory holds ~400 thumbnails at 300px; 300 MB disk survives app restarts.
        URLCache.shared = URLCache(
            memoryCapacity: 50 * 1024 * 1024,
            diskCapacity:  300 * 1024 * 1024,
            directory: nil
        )
        return true
    }

    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        .portrait
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await PushTokenService.save(token: token) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Simulator will always fail — safe to ignore
    }
}

// MARK: - Push token persistence

enum PushTokenService {
    /// Fire-and-forget entry point (app launch) -- wraps `requestAndRegister()`
    /// for callers that don't need the result.
    static func requestPermissionAndRegister() {
        Task { await requestAndRegister() }
    }

    /// Same request, awaitable -- lets UI (e.g. a Settings row) re-check
    /// `authorizationStatus()` the instant the system prompt resolves,
    /// instead of guessing with a delay.
    @discardableResult
    static func requestAndRegister() async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        if granted {
            await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
        }
        return granted
    }

    /// Current OS-level permission, for UI that needs to nudge a user who's
    /// denied/never-decided rather than just fire-and-forget requesting it
    /// (once denied, `requestAuthorization` silently re-returns `.denied` --
    /// only the Settings app can change it from there).
    static func authorizationStatus() async -> UNAuthorizationStatus {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    static func save(token: String) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        _ = try? await supabase
            .from("profiles")
            .update(["push_token": token])
            .eq("id", value: userId)
            .execute()
    }
}

@main
struct sillajukuApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @State private var appState = AppState()
    @AppStorage("appearanceMode") private var appearanceMode = "system"

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .preferredColorScheme(colorScheme)
                .onOpenURL { url in
                    // sillajuku://auth/confirmed -- the web confirmed page's
                    // fallback trigger for this same custom scheme (see
                    // app/(auth)/auth/confirmed/page.tsx), used because the
                    // Universal Link version (onContinueUserActivity below)
                    // can't reach it: Supabase's email confirmation link
                    // routes through <project>.supabase.co/auth/v1/verify
                    // and 30x-redirects here, and Universal Links only ever
                    // intercept a DIRECT user tap on a matching https:// link,
                    // never a page merely reached via a redirect chain. A
                    // custom scheme has no such restriction.
                    if url.host == "auth", url.path == "/confirmed" {
                        NotificationCenter.default.post(name: .sjEmailConfirmed, object: nil)
                        return
                    }
                    Task {
                        // Was `try? await ... session(from: url)` -- completely silent on
                        // failure, no way to tell "this genuinely wasn't an auth callback URL"
                        // (harmless, expected) from "this WAS one and the exchange failed"
                        // (a real problem with no error shown anywhere). Confirmed live
                        // 2026-09-21: linking Apple from Connected Accounts visually completed
                        // (Face ID, no error dialog) but the identity never actually landed --
                        // this silent catch is the only place that could be swallowing why.
                        do {
                            try await supabase.auth.session(from: url)
                        } catch {
                            SentrySDK.capture(error: error)
                        }
                    }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    // Universal Link path — only relevant when the app is already
                    // installed (the rare case for an invite; the clipboard handoff
                    // in ReferralClipboardHandoff.swift/BetaInvite.swift covers the
                    // common one). Saved unconditionally, not just attempted
                    // directly — if this fires while signed out (no auth.uid() for
                    // the RPC to key on), a direct attempt would just throw and be
                    // lost. Persisting it lets observeAuth() retry once a real
                    // session shows up, rather than silently dropping a genuine
                    // link tap. The three path shapes (/i/<code>, /beta/<token>,
                    // /auth/confirmed) are mutually exclusive, so only one of
                    // these ever matches.
                    guard let url = activity.webpageURL else { return }
                    if let code = InviteLink.code(from: url) {
                        PendingReferralStore.save(code)
                        Task { await PendingReferralStore.consumeAndRedeem() }
                    } else if let token = BetaInviteLink.token(from: url) {
                        PendingBetaTokenStore.save(token)
                        Task { await PendingBetaTokenStore.consumeAndRedeem() }
                    } else if url.path == "/auth/confirmed" {
                        // Reached when a user, mid-Spotify-signup, confirms their
                        // email (Spotify doesn't assert a verified email, so a
                        // brand-new signup can hit Supabase's own confirmation
                        // gate) — see app/(auth)/auth/confirmed/page.tsx for the
                        // matching web fallback. No session to establish here
                        // (that page isn't an OAuth callback, just a landing
                        // point); AuthView listens for this to show a "you're
                        // verified, continue below" banner instead of a bare,
                        // unexplained sign-in screen.
                        NotificationCenter.default.post(name: .sjEmailConfirmed, object: nil)
                    }
                }
        }
    }

    private var colorScheme: ColorScheme? {
        switch appearanceMode {
        case "light": return .light
        case "dark":  return .dark
        default:      return nil  // system
        }
    }
}

struct RootView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            switch appState.authState {
            case .loading:
                LaunchLoadingView()
            case .unauthenticated:
                AuthView()
            case .onboarding(let provider):
                OnboardingView(provider: provider)
            case .authenticated:
                MainTabView()
                    .task { PushTokenService.requestPermissionAndRegister() }
            case .deactivated:
                DeactivatedAccountView()
            }
        }
        .task { await observeAuth() }
    }

    private func observeAuth() async {
        for await (_, session) in supabase.auth.authStateChanges {
            guard let session else {
                appState.authState = .unauthenticated
                continue
            }
            // Capture the Spotify provider token the moment it arrives —
            // before any subsequent session refresh drops it from the session object.
            if let token = session.providerToken {
                UserDefaults.standard.set(token, forKey: "sj_spotify_provider_token")
                NotificationCenter.default.post(name: .sjSpotifyTokenRefreshed, object: nil)
            }
            if let refresh = session.providerRefreshToken {
                UserDefaults.standard.set(refresh, forKey: "sj_spotify_provider_refresh_token")
                Task { await SpotifyService.saveTasteRefreshToken(refresh) }
            }
            // Best-effort, never blocks the auth transition above/below it —
            // a valid session is confirmed at this point, so it's safe to
            // attempt the once-per-device clipboard check here, and to retry
            // any Universal-Link code that arrived before a session existed.
            Task { await ReferralClipboardHandoff.checkAndRedeemOnce() }
            Task { await PendingReferralStore.consumeAndRedeem() }
            Task { await BetaTokenClipboardHandoff.checkAndRedeemOnce() }
            Task { await PendingBetaTokenStore.consumeAndRedeem() }
            let status = await checkAccount(userId: session.user.id)
            if status.deactivated {
                appState.authState = .deactivated
            } else if status.onboarded {
                appState.authState = .authenticated
            } else {
                var provider = "unknown"
                if let json = session.user.appMetadata["provider"],
                   case .string(let p) = json {
                    provider = p
                }
                appState.authState = .onboarding(provider: provider)
            }
        }
    }

    private func checkAccount(userId: UUID) async -> (onboarded: Bool, deactivated: Bool) {
        struct Row: Decodable {
            let username: String?
            let deactivatedAt: Date?
            enum CodingKeys: String, CodingKey {
                case username
                case deactivatedAt = "deactivated_at"
            }
        }
        // Falls back to username only if deactivated_at can't be read (e.g.
        // migration 20260926000002 not applied yet) -- otherwise every user
        // would be sent back to onboarding.
        for columns in ["username, deactivated_at", "username"] {
            if let row: Row = try? await supabase
                .from("profiles")
                .select(columns)
                .eq("id", value: userId)
                .single()
                .execute()
                .value {
                return (!(row.username?.isEmpty ?? true), row.deactivatedAt != nil)
            }
        }
        return (false, false)
    }
}

// MARK: - Launch loading

/// Shown while `RootView.observeAuth()` waits for Supabase's first auth
/// event — the very first thing on screen on a cold launch, before there's
/// even a session to know whether the user is signed in or not. Two states:
/// a percentage gauge while waiting normally, or a "no internet" notice the
/// instant `NetworkMonitor` reports the path down — without this, a
/// disconnected device (this auth check needs network for anything beyond a
/// cached signed-out state) would otherwise sit on a blank screen
/// indefinitely with no explanation.
/// Static, not animated -- per user request, the breathing logo and the
/// progress percentage/gauge (there was never a real set of discrete steps
/// to measure here, just one opaque wait for Supabase's first auth event)
/// were both removed in favor of the same calm, motionless treatment
/// `AuthView`'s sign-up screen already uses: flower + wordmark centered
/// over a cream canvas, with two oversized, low-opacity flowers watermarked
/// into the corners. The no-internet notice stays -- it's real state, not
/// decoration, and needs no animation to communicate it.
private struct LaunchLoadingView: View {
    private let networkMonitor = NetworkMonitor.shared

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()

            // Decorative flowers -- same positions/sizes as AuthView's,
            // ignoresSafeArea so geo covers the full screen (no .clipped()
            // needed, physical screen edges handle it).
            GeometryReader { geo in
                let topFlowerSize = geo.size.width * 1.4
                Image("logo-flower")
                    .resizable()
                    .scaledToFit()
                    .frame(width: topFlowerSize)
                    .opacity(0.09)
                    .position(x: geo.size.width * 0.82, y: geo.size.width * 0.22 + topFlowerSize * 0.5 - geo.size.width * 0.3)

                Image("logo-flower")
                    .resizable()
                    .scaledToFit()
                    .frame(width: geo.size.width)
                    .opacity(0.09)
                    .position(x: geo.size.width * 0.18, y: geo.size.height - geo.size.width * 0.22)
            }
            .ignoresSafeArea()

            VStack(spacing: 18) {
                Image("logo-flower")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 152, height: 152)

                Image("logo-text")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(height: 16)
                    .foregroundStyle(Color.sjInk)

                if !networkMonitor.isConnected {
                    disconnectedNotice.transition(.opacity)
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: networkMonitor.isConnected)
        // Same reasoning as MainTabView's AppLoadingView: forced light so the
        // wordmark stays legible against the cream background regardless of
        // system/app dark mode.
        .colorScheme(.light)
    }

    private var disconnectedNotice: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                Image("icon-wifi-off")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 13, height: 13)
                Text("No internet connection")
                    .font(.jakarta(13, weight: .semibold))
            }
            .foregroundStyle(Color.sjInk)

            Text("Waiting for a connection to sign you in.")
                .font(.jakarta(12))
                .foregroundStyle(Color.sjMuted)
                .multilineTextAlignment(.center)
        }
        .padding(.top, 6)
        // No retry button needed — NWPathMonitor pushes the update the
        // instant the path comes back, which clears this notice on its own
        // (the real auth check never stopped running underneath and just
        // completes normally once it can).
    }
}
