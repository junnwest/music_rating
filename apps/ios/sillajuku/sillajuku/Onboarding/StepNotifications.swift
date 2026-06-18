import SwiftUI
import UserNotifications

struct StepNotifications: View {
    let isSaving: Bool
    let onFinish: () async -> Void

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 20) {
                Image(systemName: "bell.badge.fill")
                    .font(.system(size: 64))
                    .foregroundStyle(Color.sjAmber)

                VStack(spacing: 10) {
                    Text("Stay in the loop")
                        .font(.system(size: 28, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                    Text("Get notified when friends rate albums, follow you, or comment.")
                        .font(.system(size: 16))
                        .foregroundStyle(Color.sjMuted)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 36)
                }
            }

            Spacer()

            VStack(spacing: 12) {
                Button(action: { Task { await requestAndFinish() } }) {
                    HStack(spacing: 10) {
                        if isSaving {
                            ProgressView()
                                .scaleEffect(0.8)
                                .tint(.white)
                        }
                        Text(isSaving ? "Saving…" : "Allow Notifications")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.sjInk)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isSaving)

                Button(action: { Task { await onFinish() } }) {
                    Text("Skip for now")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                        .padding(.vertical, 8)
                }
                .disabled(isSaving)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
    }

    private func requestAndFinish() async {
        try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])
        await onFinish()
    }
}
