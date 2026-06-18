import Foundation

@Observable
class AppState {
    var authState: AppAuthState = .loading
}

enum AppAuthState: Equatable {
    case loading
    case unauthenticated
    case onboarding(provider: String)
    case authenticated

    static func == (lhs: AppAuthState, rhs: AppAuthState) -> Bool {
        switch (lhs, rhs) {
        case (.loading, .loading), (.unauthenticated, .unauthenticated), (.authenticated, .authenticated):
            return true
        case (.onboarding(let a), .onboarding(let b)):
            return a == b
        default:
            return false
        }
    }
}
