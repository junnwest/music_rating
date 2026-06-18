import SwiftUI

struct StepProfile: View {
    @Binding var data: OnboardingData
    let onNext: () -> Void

    @State private var usernameAvailable: Bool? = nil
    @State private var isChecking = false
    @State private var checkTask: Task<Void, Never>? = nil

    var canContinue: Bool {
        !data.displayName.trimmingCharacters(in: .whitespaces).isEmpty &&
        data.username.count >= 3 &&
        usernameAvailable == true &&
        !isChecking
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 110)

            VStack(alignment: .leading, spacing: 8) {
                Text("Set up your profile")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("This is how others will find you.")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)

            VStack(spacing: 16) {
                // Display name
                VStack(alignment: .leading, spacing: 6) {
                    Text("Display Name")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                    TextField("Your name", text: $data.displayName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 16))
                        .padding(14)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
                }

                // Username
                VStack(alignment: .leading, spacing: 6) {
                    Text("Username")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                    HStack {
                        TextField("username", text: $data.username)
                            .textFieldStyle(.plain)
                            .font(.system(size: 16))
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .onChange(of: data.username) { scheduleCheck() }
                        if isChecking {
                            ProgressView().scaleEffect(0.75)
                        } else if let available = usernameAvailable {
                            Image(systemName: available ? "checkmark.circle.fill" : "xmark.circle.fill")
                                .foregroundStyle(available ? .green : .red)
                        }
                    }
                    .padding(14)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))

                    if usernameAvailable == false {
                        Text("That username is already taken.")
                            .font(.system(size: 12))
                            .foregroundStyle(.red)
                    }
                }
            }
            .padding(.horizontal, 24)

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
    }

    private func scheduleCheck() {
        usernameAvailable = nil
        checkTask?.cancel()
        let username = data.username
        guard username.count >= 3 else { return }
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
