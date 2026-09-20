import SwiftUI
import UserNotifications

struct StepNotifications: View {
    let isSaving: Bool
    let onNext: () async -> Void

    // Starts optimistic (not .denied) so the default Continue button renders
    // immediately instead of flashing the denied variant while this loads.
    @State private var status: UNAuthorizationStatus = .authorized
    @State private var isRequesting = false
    @Environment(\.scenePhase) private var scenePhase

    private var isBusy: Bool { isRequesting || isSaving }

    // Already decided (either way) on this device -- from an earlier
    // TestFlight/dev build, or an earlier account signed in on the same
    // device/simulator, since notification authorization is per-device-app,
    // not per-account. requestAuthorization() is a silent no-op once decided
    // either direction, which is what made both "already denied" (fixed
    // above) and this "already granted" case look identically broken:
    // tapping Continue produced no visible popup and no visible feedback.
    private var isAlreadyGranted: Bool {
        [.authorized, .provisional, .ephemeral].contains(status)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 110)

            VStack(alignment: .leading, spacing: 8) {
                Text("Turn on notifications.")
                    .font(.jakarta(28, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text(subtitle)
                    .font(.jakarta(16))
                    .foregroundStyle(Color.sjMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)

            Spacer()

            if isAlreadyGranted {
                Button(action: { Task { await onNext() } }) {
                    HStack(spacing: 10) {
                        if isSaving {
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
                .disabled(isSaving)
                .padding(.horizontal, 24)
                .padding(.bottom, 48)
            } else if status == .denied {
                // Same denied-state pattern already used by
                // MainTabView.openNotificationSettings() and
                // ConnectedAccountsView's Apple Music row: once denied,
                // requestAuthorization() just silently re-returns .denied,
                // so the only real action left is Settings.
                Button(action: { Task { await openSettings() } }) {
                    Text("Open Settings")
                        .font(.jakarta(16, weight: .semibold))
                        .foregroundStyle(Color.sjCream)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(Color.sjInk)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal, 24)

                Button(action: { Task { await onNext() } }) {
                    Text(isSaving ? "Saving…" : "Continue without notifications")
                        .font(.jakarta(14, weight: .semibold))
                        .foregroundStyle(Color.sjMuted)
                }
                .disabled(isSaving)
                .padding(.top, 14)
                .padding(.horizontal, 24)
                .padding(.bottom, 48)
            } else {
                // Same shape as StepAppleMusic.swift, same two-round fix history
                // (App Review, Guideline 5.1.1(iv)): "Continue" instead of "Allow X"
                // (2026-07-21), and — found during the 2026-07-28 pre-final-submit
                // guideline pass, not from a rejection letter naming this screen
                // specifically — the "Skip for now" escape hatch removed too. A
                // custom pre-permission screen must always lead into the system
                // request, not offer a way to close it and never see the prompt.
                // "Continue" is the only action; declining happens in the system
                // sheet, and `requestAndFinish()` calls `onNext()` unconditionally
                // either way, so declining skips the permission, not onboarding.
                Button(action: { Task { await requestAndFinish() } }) {
                    HStack(spacing: 10) {
                        if isBusy {
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
                .padding(.horizontal, 24)
                .padding(.bottom, 48)
            }
        }
        .task { status = await PushTokenService.authorizationStatus() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { status = await PushTokenService.authorizationStatus() }
            }
        }
    }

    private func requestAndFinish() async {
        isRequesting = true
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])
        isRequesting = false
        await onNext()
    }

    private func openSettings() async {
        // Jumps straight to Settings > sillajuku > Notifications (one tap
        // from Allow) instead of openSettingsURLString's general app page,
        // which would still require the user to find and tap "Notifications"
        // themselves. There's no way to shortcut past Settings entirely --
        // once permission is decided, iOS blocks every app, not just this
        // one, from ever re-showing the real system Allow/Don't Allow prompt.
        let url = URL(string: UIApplication.openNotificationSettingsURLString)
            ?? URL(string: UIApplication.openSettingsURLString)
        if let url {
            await UIApplication.shared.open(url)
        }
    }

    private var subtitle: String {
        if isAlreadyGranted {
            return String(localized: "Notifications are already on for sillajuku on this device.")
        }
        if status == .denied {
            return String(localized: "Notifications are off for sillajuku on this device. Turn them on in Settings to hear about friends' activity.")
        }
        return String(localized: "Get notified when friends rate albums, follow you, or comment.")
    }
}
