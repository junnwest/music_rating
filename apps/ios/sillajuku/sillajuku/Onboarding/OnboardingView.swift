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

	/// App Review rejected the "What's your name?" step under Guideline 4
	/// THREE times: 2026-07-16 and 2026-07-20 (build 9) for making Continue
	/// REQUIRE a non-empty field — Apple only ever sends the name on an Apple
	/// ID's very FIRST authorization, and every authorization since (App Review
	/// reuses the same Apple ID across resubmissions) comes back with nothing,
	/// so a disabled-until-typed Continue turned into an always-blocking gate
	/// for reviewers — and again on 2026-07-27 (build 11), after the field was
	/// restored as an *optional*, pre-filled-when-available step shown to every
	/// provider. That confirms Apple's rule is broader than "don't gate
	/// Continue on it": Sign in with Apple's design guidelines say not to ask
	/// the user to (re-)confirm name/email at all when Authentication Services
	/// already supplied it — showing the screen is itself nonconforming,
	/// whether or not the field is required. Fix: the `.name` step is now
	/// skipped entirely for `provider == "apple"` (Apple already gave us the
	/// name via `userMetadata` on first auth, or nothing on repeat auth — either
	/// way, this app must not ask again). It stays for Google/Spotify, which
	/// aren't governed by this SIWA-specific guideline. `finish()` still falls
	/// back to the username when `data.displayName` is empty, so an Apple
	/// sign-in with no name metadata still gets a real display name without a
	/// screen ever asking for one.
	/// Resolved in init, not onAppear, so `steps` never changes after first render.
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
		var s: [Step] = provider == "apple" ? [.username, .ratingMode, .notifications]
										     : [.name, .username, .ratingMode, .notifications]
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
			// Left blank when Apple gave no name to pre-fill and the user didn't
			// type one — the username, not the private-relay email prefix, since
			// every account has a real, validated username by this point and it
			// reads far better than a relay address's random local part.
			let typed = data.displayName.trimmingCharacters(in: .whitespaces)
			let displayName = !typed.isEmpty ? typed : data.username
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
