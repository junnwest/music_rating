import SwiftUI
import Supabase
import UserNotifications

final class AppDelegate: NSObject, UIApplicationDelegate {
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
                Color.sjCream.ignoresSafeArea()
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
