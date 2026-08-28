import SwiftUI
import Supabase
import UserNotifications
import Sentry

extension Notification.Name {
    static let sjSpotifyTokenRefreshed = Notification.Name("sjSpotifyTokenRefreshed")
    static let sjAppleMusicAuthorized = Notification.Name("sjAppleMusicAuthorized")
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
    static func requestPermissionAndRegister() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            guard granted else { return }
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
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
                    Task { try? await supabase.auth.session(from: url) }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    // Universal Link path — only relevant when the app is already
                    // installed (the rare case for an invite; the clipboard handoff
                    // in ReferralClipboardHandoff.swift covers the common one).
                    // Saved unconditionally, not just attempted directly — if this
                    // fires while signed out (no auth.uid() for the RPC to key on),
                    // a direct attempt would just throw and be lost. Persisting it
                    // lets observeAuth() retry once a real session shows up, rather
                    // than silently dropping a genuine link tap.
                    guard let url = activity.webpageURL, let code = InviteLink.code(from: url) else { return }
                    PendingReferralStore.save(code)
                    Task { await PendingReferralStore.consumeAndRedeem() }
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
            let onboarded = await checkOnboarded(userId: session.user.id)
            if onboarded {
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

    private func checkOnboarded(userId: UUID) async -> Bool {
        do {
            let profile: Profile = try await supabase
                .from("profiles")
                .select("id, username")
                .eq("id", value: userId)
                .single()
                .execute()
                .value
            return !(profile.username?.isEmpty ?? true)
        } catch {
            return false
        }
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
private struct LaunchLoadingView: View {
    private let networkMonitor = NetworkMonitor.shared

    @State private var progress: Double = 0
    @State private var progressTask: Task<Void, Never>?
    @State private var breathing = false

    var body: some View {
        ZStack {
            Color.white.ignoresSafeArea()
            VStack(spacing: 18) {
                Image("logo-flower")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 152, height: 152)
                    .scaleEffect(breathing ? 1.04 : 1.0)
                    .opacity(breathing ? 0.88 : 1.0)
                    .animation(.easeInOut(duration: 3).repeatForever(autoreverses: true), value: breathing)

                Image("logo-text")
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(height: 16)
                    .foregroundStyle(Color.sjInk)
                    .opacity(0.5)

                Group {
                    if networkMonitor.isConnected {
                        progressGauge.transition(.opacity)
                    } else {
                        disconnectedNotice.transition(.opacity)
                    }
                }
                .animation(.easeInOut(duration: 0.25), value: networkMonitor.isConnected)
            }
        }
        .onAppear {
            breathing = true
            startProgress()
        }
        .onDisappear { progressTask?.cancel() }
        // Same reasoning as MainTabView's AppLoadingView: forced light so the
        // wordmark stays legible against the literal-white background
        // regardless of system/app dark mode.
        .colorScheme(.light)
    }

    // MARK: Progress gauge

    private var progressGauge: some View {
        ZStack {
            Circle()
                .stroke(Color.sjBorder, lineWidth: 3)
                .frame(width: 34, height: 34)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(Color.sjAmber, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .frame(width: 34, height: 34)
                .rotationEffect(.degrees(-90))
            Text("\(Int(progress * 100))%")
                .font(.jakarta(10, weight: .bold).width(.condensed))
                .foregroundStyle(Color.sjMuted)
        }
        .padding(.top, 6)
    }

    /// Time-based easing toward a cap short of 100% — there's no set of
    /// discrete sub-steps to measure here (unlike the Home feed's
    /// multi-fetch load), just one opaque wait for Supabase's first auth
    /// event, so this approximates progress by feel rather than claiming a
    /// literal percent-of-work-done. Deliberately never reaches 100% on its
    /// own: `RootView` swaps this whole view out the instant auth actually
    /// resolves, so hitting "100%" here first would either be a lie (still
    /// waiting) or a race against the real transition.
    private func startProgress() {
        progressTask?.cancel()
        progressTask = Task {
            let start = Date()
            while !Task.isCancelled {
                let elapsed = Date().timeIntervalSince(start)
                progress = 0.92 * (1 - exp(-elapsed / 1.4))
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }
    }

    // MARK: Disconnected notice

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
        // instant the path comes back, which flips this back to
        // progressGauge on its own (the real auth check never stopped
        // running underneath and just completes normally once it can).
    }
}
