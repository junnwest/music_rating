import SwiftUI

struct StepName: View {
    @Binding var data: OnboardingData
    let onNext: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 110)

            Text("What's your name?")
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)

            TextField("Your name", text: $data.displayName)
                .textFieldStyle(.plain)
                .font(.system(size: 16))
                .foregroundStyle(Color.sjInk)
                .textInputAutocapitalization(.words)
                .focused($isFocused)
                .submitLabel(.next)
                .onSubmit(onNext)
                .padding(14)
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
                .padding(.horizontal, 24)

            Spacer()

            // App Review (Guideline 4 — rejected 2026-07-16 and again on build 9,
            // 2026-07-20) for gating Continue on this field being non-empty: Apple
            // only ever sends a name on an Apple ID's first-ever authorization, so
            // every repeat authorization — including every App Review pass, which
            // reuses the same Apple ID across resubmissions — arrives with nothing
            // to pre-fill, and a disabled Continue turned an occasionally-empty
            // field into an always-blocking one for reviewers. Continue must stay
            // enabled unconditionally here regardless of whether the field starts
            // pre-filled, edited, or left empty; `OnboardingView.finish()` handles
            // an empty submission by falling back to the username rather than
            // blocking on it.
            Button(action: onNext) {
                Text("Continue")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.sjCream)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.sjInk)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
        .onAppear { isFocused = true }
    }
}
