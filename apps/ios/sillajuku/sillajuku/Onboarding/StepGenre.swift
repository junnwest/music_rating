import SwiftUI
import Supabase

struct StepUsername: View {
    @Binding var data: OnboardingData
    let onNext: () -> Void

    @FocusState private var isFocused: Bool
    @State private var usernameAvailable: Bool? = nil
    @State private var isChecking = false
    @State private var checkTask: Task<Void, Never>? = nil

    var canContinue: Bool {
        Username.isValid(data.username) &&
        usernameAvailable == true &&
        !isChecking
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 110)

            Text("Create a username.")
                .font(.jakarta(28, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    TextField("username", text: Binding(
                        get: { data.username },
                        set: { data.username = Username.normalize($0) }
                    ))
                        .textFieldStyle(.plain)
                        .font(.jakarta(16))
                        .foregroundStyle(Color.sjInk)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .focused($isFocused)
                        .submitLabel(.next)
                        .onSubmit { if canContinue { onNext() } }
                        .onChange(of: data.username) { scheduleCheck() }

                    if isChecking {
                        ProgressView().scaleEffect(0.75)
                    } else if let available = usernameAvailable {
                        Image(available ? "icon-check-circle" : "icon-circle-x")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 18, height: 18)
                            .foregroundStyle(available ? .green : .red)
                    }
                }
                .padding(14)
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))

                if usernameAvailable == false {
                    Text("That username is already taken.")
                        .font(.jakarta(12))
                        .foregroundStyle(.red)
                        .padding(.horizontal, 2)
                }
            }
            .padding(.horizontal, 24)

            Spacer()

            Button(action: onNext) {
                Text("Continue")
                    .font(.jakarta(16, weight: .semibold))
                    .foregroundStyle(Color.sjCream)
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

    private func scheduleCheck() {
        usernameAvailable = nil
        checkTask?.cancel()
        let username = data.username
        guard Username.isValid(username) else { return }
        isChecking = true
        checkTask = Task {
            try? await Task.sleep(for: .milliseconds(500))
            guard !Task.isCancelled, data.username == username else { return }
            struct Row: Decodable { let id: UUID }
            do {
                let rows: [Row] = try await supabase
                    .from("profiles")
                    .select("id")
                    .eq("username", value: username)
                    .limit(1)
                    .execute()
                    .value
                usernameAvailable = rows.isEmpty
            } catch {
                usernameAvailable = nil
            }
            isChecking = false
        }
    }
}
