import SwiftUI
import Supabase

struct OnboardingView: View {
    let provider: String
    @State private var stepIndex = 0
    @State private var data = OnboardingData()
    @State private var isSaving = false
    @Environment(AppState.self) private var appState

    enum Step { case name, username, ratingMode, notifications }
    let steps: [Step] = [.name, .username, .ratingMode, .notifications]

    var body: some View {
        ZStack(alignment: .top) {
            Color.sjCream.ignoresSafeArea()

            // Progress indicator
            HStack(spacing: 6) {
                ForEach(0..<steps.count, id: \.self) { i in
                    Capsule()
                        .fill(i == stepIndex ? Color.sjInk : Color.sjBorder)
                        .frame(width: i == stepIndex ? 20 : 6, height: 6)
                        .animation(.spring(duration: 0.3), value: stepIndex)
                }
            }
            .padding(.top, 64)

            // Step content
            Group {
                switch steps[stepIndex] {
                case .name:
                    StepName(data: $data, onNext: advance)
                case .username:
                    StepUsername(data: $data, onNext: advance)
                case .ratingMode:
                    StepRatingMode(data: $data, onNext: advance)
                case .notifications:
                    StepNotifications(isSaving: isSaving, onFinish: finish)
                }
            }
            .transition(.asymmetric(
                insertion: .move(edge: .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
            .id(stepIndex)
        }
        .onAppear { loadProviderName() }
    }

    private func loadProviderName() {
        guard let meta = supabase.auth.currentUser?.userMetadata else { return }
        for key in ["full_name", "name"] {
            if let json = meta[key], case .string(let value) = json, !value.isEmpty {
                data.displayName = value
                return
            }
        }
    }

    private func advance() {
        guard stepIndex + 1 < steps.count else { return }
        withAnimation(.easeInOut(duration: 0.28)) { stepIndex += 1 }
    }

    private func finish() async {
        guard let user = supabase.auth.currentUser else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let typed = data.displayName.trimmingCharacters(in: .whitespaces)
            let displayName = !typed.isEmpty ? typed
                : (user.email?.components(separatedBy: "@").first ?? "")
            let insert = ProfileInsert(
                id: user.id,
                displayName: displayName,
                username: data.username,
                ratingMode: data.ratingMode
            )
            try await supabase
                .from("profiles")
                .upsert(insert)
                .execute()
            appState.authState = .authenticated
        } catch {
            // TODO: surface save error to user
        }
    }
}

struct OnboardingData {
    var displayName: String = ""
    var username: String = ""
    var selectedGenres: [String] = []
    var ratingMode: String = "manual"
}
