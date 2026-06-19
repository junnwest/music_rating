import SwiftUI

struct StepName: View {
    @Binding var data: OnboardingData
    let onNext: () -> Void

    @FocusState private var isFocused: Bool

    var canContinue: Bool {
        !data.displayName.trimmingCharacters(in: .whitespaces).isEmpty
    }

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
                .padding(14)
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
                .padding(.horizontal, 24)
                .focused($isFocused)
                .submitLabel(.next)
                .onSubmit { if canContinue { onNext() } }

            Spacer()

            Button(action: onNext) {
                Text("Continue")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(canContinue ? Color.sjInk : Color.sjBorder)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(!canContinue)
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
        .onAppear { isFocused = true }
    }
}
