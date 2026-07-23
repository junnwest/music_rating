import SwiftUI
import MusicKit

struct StepAppleMusic: View {
    let isSaving: Bool
    let onFinish: () async -> Void

    @State private var isRequesting = false

    private var isBusy: Bool { isRequesting || isSaving }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 110)

            VStack(alignment: .leading, spacing: 8) {
                Text("Connect Apple Music.")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("We'll use your library and listening history to suggest albums you'll want to rate.")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.sjMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)

            Spacer()

            // App Review (Guideline 5.1.1(iv), 2026-07-21): a custom pre-permission
            // screen must not word its own button "Allow X" — that's the system
            // permission sheet's language, not this button's. "Continue" just
            // proceeds to `requestAndFinish()`, which triggers the real MusicKit
            // authorization dialog.
            VStack(spacing: 12) {
                Button(action: { Task { await requestAndFinish() } }) {
                    HStack(spacing: 10) {
                        if isBusy {
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
                .disabled(isBusy)

                Button(action: { Task { await onFinish() } }) {
                    Text("Skip for now")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                        .padding(.vertical, 8)
                }
                .disabled(isBusy)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
    }

    private func requestAndFinish() async {
        isRequesting = true
        await MusicKitService.requestAuthorization()
        isRequesting = false
        await onFinish()
    }
}
