import SwiftUI
import UserNotifications

struct StepNotifications: View {
    let isSaving: Bool
    let onNext: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 110)

            VStack(alignment: .leading, spacing: 8) {
                Text("Turn on notifications.")
                    .font(.jakarta(28, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("Get notified when friends rate albums, follow you, or comment.")
                    .font(.jakarta(16))
                    .foregroundStyle(Color.sjMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)

            Spacer()

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
        }
    }

    private func requestAndFinish() async {
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])
        await onNext()
    }
}
