import UIKit
import Supabase

/// Extracts a beta-redeem token from a sillajuku.com/beta/<token> URL --
/// mirrors InviteLink (ReferralClipboardHandoff.swift) exactly, just scoped
/// to the "/beta/" path instead of "/i/". Kept as a separate parser rather
/// than generalizing both into one, since the two flows redeem via different
/// RPCs and have no other shared behavior.
enum BetaInviteLink {
    static func token(from url: URL) -> String? {
        guard url.pathComponents.count >= 3, url.pathComponents[1] == "beta" else { return nil }
        return url.pathComponents[2]
    }
}

/// Persists a beta-redeem token that arrived while no authenticated session
/// existed yet (the Universal Link handler in sillajukuApp.swift) -- same
/// reasoning as PendingReferralStore: a saved token represents a real link
/// tap, so it's worth retrying on every auth-state transition until consumed.
enum PendingBetaTokenStore {
    private static let key = "pendingBetaToken"

    static func save(_ token: String) {
        UserDefaults.standard.set(token, forKey: key)
    }

    /// No-ops if there's nothing pending or no session yet. Once redemption
    /// is actually attempted, the stored token is cleared either way -- a
    /// failure at that point means the token itself was bad (already
    /// redeemed/unknown), which is permanent, not a "wasn't signed in yet" one.
    static func consumeAndRedeem() async {
        guard let token = UserDefaults.standard.string(forKey: key) else { return }
        guard supabase.auth.currentUser != nil else { return }

        struct Params: Encodable { let p_token: String }
        _ = try? await supabase
            .rpc("redeem_beta_token", params: Params(p_token: token))
            .execute()

        UserDefaults.standard.removeObject(forKey: key)
    }
}

/// Checks the clipboard once per device for the beta-redeem link written by
/// the web landing page (app/beta/[token]/page.tsx) right before it
/// redirects to the App Store -- lets the token survive the install gap for
/// an invited influencer who doesn't have the app yet. Mirrors
/// ReferralClipboardHandoff's use of UIPasteboard's pattern-detection API
/// (rather than reading `.string` directly) to avoid the system "Pasted from
/// X" banner -- see that file's comment for why a plain https URL is used
/// instead of a custom-prefixed string.
enum BetaTokenClipboardHandoff {
    private static let checkedKey = "hasCheckedBetaTokenClipboard"

    static func checkAndRedeemOnce() async {
        guard !UserDefaults.standard.bool(forKey: checkedKey) else { return }
        UserDefaults.standard.set(true, forKey: checkedKey)
        guard supabase.auth.currentUser != nil else { return }

        guard let token = await detectBetaToken() else { return }

        struct Params: Encodable { let p_token: String }
        _ = try? await supabase
            .rpc("redeem_beta_token", params: Params(p_token: token))
            .execute()
    }

    private static func detectBetaToken() async -> String? {
        let values = await withCheckedContinuation { (continuation: CheckedContinuation<[UIPasteboard.DetectionPattern: Any], Never>) in
            UIPasteboard.general.detectValues(for: [.probableWebURL]) { result in
                switch result {
                case .success(let values): continuation.resume(returning: values)
                case .failure: continuation.resume(returning: [:])
                }
            }
        }

        guard let raw = values[.probableWebURL] else { return nil }
        let url: URL?
        if let u = raw as? URL { url = u }
        else if let s = raw as? String { url = URL(string: s) }
        else { url = nil }

        guard let url else { return nil }
        return BetaInviteLink.token(from: url)
    }
}
