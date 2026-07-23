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
                Color.white.ignoresSafeArea()
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
