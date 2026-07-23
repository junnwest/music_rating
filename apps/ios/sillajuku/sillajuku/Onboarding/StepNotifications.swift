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
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("Get notified when friends rate albums, follow you, or comment.")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.sjMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)

            Spacer()

            // Same wording fix as StepAppleMusic.swift (App Review, Guideline
            // 5.1.1(iv), 2026-07-21) applied here pre-emptively — this screen has
            // the identical "custom screen + Allow X button" shape and would trip
            // the same rule on notifications once a reviewer reached it.
            VStack(spacing: 12) {
                Button(action: { Task { await requestAndFinish() } }) {
                    HStack(spacing: 10) {
                        if isSaving {
                            ProgressView()
                                .scaleEffect(0.8)
                                .tint(Color.sjCream)
                        }
                        Text(isSaving ? "Saving…" : "Continue")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(Color.sjCream)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.sjInk)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(isSaving)

                Button(action: { Task { await onNext() } }) {
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
        _ = try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])
        await onNext()
    }
}
