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

            // This step is only reachable for Google/Spotify sign-in now —
            // `OnboardingView.init` skips it entirely for `provider == "apple"`
            // (Guideline 4: Sign in with Apple users must never be asked to
            // (re-)confirm a name Authentication Services already supplied, so
            // the fix lives at the step-list level, not here). Continue stays
            // unconditional regardless, since there's no reason to block
            // onboarding on an optional field; `OnboardingView.finish()` falls
            // back to the username if it's left empty.
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
