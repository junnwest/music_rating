import Foundation
import Observation
import Supabase

@Observable
final class InviteViewModel {
    private(set) var isLoading = true
    private(set) var myReferralCode: String?

    // Whether THIS account was itself redeemed via someone else's code --
    // about crediting whoever invited THIS user, separate from myReferralCode
    // above (THIS user inviting others). No separate "was it verified" flag
    // needed here -- the same DB trigger that verifies a referral also sets
    // this account's own phoneConfirmedAt, so hasOwnPhoneVerified below always
    // agrees with whether an inbound referral got credited.
    private(set) var wasInvited = false

    // Whether THIS account has verified its own phone -- gates sharing your
    // own code entirely (redeeming someone ELSE's code stays open regardless,
    // since that's about receiving an invite, not sending one). Backstop for
    // the same gate QuestChecklistView already applies when routing taps --
    // this is what actually enforces it if InviteView is ever reached another
    // way. Synchronous (currentUser is already in memory).
    var hasOwnPhoneVerified: Bool { supabase.auth.currentUser?.phoneConfirmedAt != nil }

    var redeemMessage: String?
    var isRedeeming = false

    func load() async {
        guard let userId = supabase.auth.currentUser?.id else { isLoading = false; return }
        isLoading = true

        async let profileTask: String? = {
            struct Row: Codable { let referralCode: String?
                enum CodingKeys: String, CodingKey { case referralCode = "referral_code" }
            }
            let row: Row? = try? await supabase
                .from("profiles").select("referral_code")
                .eq("id", value: userId).single().execute().value
            return row?.referralCode
        }()

        async let inboundTask: Bool = {
            struct Row: Codable { let id: UUID }
            let rows: [Row] = (try? await supabase
                .from("referrals").select("id")
                .eq("invited_user_id", value: userId)
                .execute().value) ?? []
            return !rows.isEmpty
        }()

        myReferralCode = await profileTask
        wasInvited = await inboundTask
        isLoading = false
    }

    /// Returns true on success. Errors are surfaced via redeemMessage rather than thrown,
    /// since a wrong/expired code is an expected user-facing case, not a real failure.
    func redeem(code: String) async -> Bool {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        isRedeeming = true
        defer { isRedeeming = false }

        struct Params: Encodable { let p_code: String }
        let ok: Bool = (try? await supabase
            .rpc("redeem_referral_code", params: Params(p_code: trimmed))
            .execute()
            .value) ?? false

        if ok {
            redeemMessage = String(localized: "Invite code applied.")
            await load()
        } else {
            redeemMessage = String(localized: "That code didn't work — check it and try again.")
        }
        return ok
    }
}
