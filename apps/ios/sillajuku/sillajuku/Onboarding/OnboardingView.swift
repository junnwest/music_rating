import SwiftUI
import Supabase

struct OnboardingView: View {
	let provider: String
	@State private var stepIndex = 0
	@State private var data: OnboardingData
	@State private var isSaving = false
	@State private var saveError: String? = nil
	@Environment(AppState.self) private var appState

	enum Step { case name, username, ratingMode, notifications, appleMusic }

	let steps: [Step]

	/// App Review rejection 2026-07-16 (Guideline 4 — Sign in with Apple):
	/// the name question must not be asked when the auth provider already
	/// supplied one. So the name step only exists when no provider name is
	/// available (email-hidden cases, lost metadata); otherwise the provided
	/// name is used silently — still editable later in Edit Profile. Resolved
	/// in init, not onAppear, so `steps` never changes after first render.
	init(provider: String) {
		self.provider = provider
		var data = OnboardingData()
		if let meta = supabase.auth.currentUser?.userMetadata {
			for key in ["full_name", "name"] {
				if let json = meta[key], case .string(let value) = json, !value.isEmpty {
					data.displayName = value
					break
				}
			}
		}
		var s: [Step] = data.displayName.isEmpty ? [.name] : []
		s += [.username, .ratingMode, .notifications]
		if provider == "apple" { s.append(.appleMusic) }
		self.steps = s
		self._data = State(initialValue: data)
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
		.alert(isPresented: Binding(
			get: { saveError != nil },
			set: { if !$0 { saveError = nil } }
		)) { errorAlert }
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
			saveError = String(localized: "Something went wrong. Please check your connection and try again.")
		}
	}
}

extension OnboardingView {
	var errorAlert: Alert {
		Alert(
			title: Text("Couldn't save your profile"),
			message: Text(saveError ?? String(localized: "Please try again.")),
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
