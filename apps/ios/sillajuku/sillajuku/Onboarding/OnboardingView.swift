import SwiftUI
import Supabase

struct OnboardingView: View {
	let provider: String
	@State private var stepIndex = 0
	@State private var data = OnboardingData()
	@State private var isSaving = false
	@State private var saveError: String? = nil
	@Environment(AppState.self) private var appState

	enum Step { case name, username, ratingMode, notifications, appleMusic }

	var steps: [Step] {
		var s: [Step] = [.name, .username, .ratingMode, .notifications]
		if provider == "apple" { s.append(.appleMusic) }
		return s
	}

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
					StepNotifications(isSaving: isSaving, onNext: advance)
				case .appleMusic:
					StepAppleMusic(isSaving: isSaving, onFinish: finish)
				}
			}
			.transition(.asymmetric(
				insertion: .move(edge: .trailing).combined(with: .opacity),
				removal: .move(edge: .leading).combined(with: .opacity)
			))
			.id(stepIndex)
		}
		.onAppear { loadProviderName() }
		.alert(isPresented: Binding(
			get: { saveError != nil },
			set: { if !$0 { saveError = nil } }
		)) { errorAlert }
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
		let next = stepIndex + 1
		guard next < steps.count else {
			Task { await finish() }
			return
		}
		withAnimation(.easeInOut(duration: 0.28)) { stepIndex = next }
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
			saveError = "Something went wrong. Please check your connection and try again."
		}
	}
}

extension OnboardingView {
	var errorAlert: Alert {
		Alert(
			title: Text("Couldn't save your profile"),
			message: Text(saveError ?? "Please try again."),
			dismissButton: .default(Text("OK")) { saveError = nil }
		)
	}
}

struct OnboardingData {
	var displayName: String = ""
	var username: String = ""
	var selectedGenres: [String] = []
	var ratingMode: String = "manual"
}
