import Foundation
import Supabase

/// Persists a referral code that arrived while no authenticated session
/// existed yet (the Universal Link handler in sillajukuApp.swift), so it
/// survives until a session actually appears instead of being lost. Unlike
/// ReferralClipboardHandoff's one-time-per-device check, this has no
/// "already checked" gate -- a saved code represents a real link tap, not a
/// speculative clipboard peek, so it's worth retrying on every auth-state
/// transition until it's actually consumed.
enum PendingReferralStore {
    private static let key = "pendingReferralCode"

    static func save(_ code: String) {
        UserDefaults.standard.set(code, forKey: key)
    }

    /// No-ops if there's nothing pending or no session yet (safe to call
    /// speculatively on every auth-state change). Once a session exists and
    /// this actually attempts redemption, the stored code is cleared either
    /// way -- success needs no retry, and a failure at that point means the
    /// code itself was bad (wrong/self-referral/already used), which is a
    /// permanent failure, not a "wasn't signed in yet" one.
    static func consumeAndRedeem() async {
        guard let code = UserDefaults.standard.string(forKey: key) else { return }
        guard supabase.auth.currentUser != nil else { return }

        struct Params: Encodable { let p_code: String }
        _ = try? await supabase
            .rpc("redeem_referral_code", params: Params(p_code: code))
            .execute()

        UserDefaults.standard.removeObject(forKey: key)
    }
}
