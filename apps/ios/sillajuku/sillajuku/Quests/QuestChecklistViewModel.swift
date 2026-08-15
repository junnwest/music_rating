import Foundation
import Observation
import Supabase

/// Every item here is live-derived from data/gates that already exist elsewhere
/// in the app (profiles.avatar_url/bio, a ratings count, a follows count, the
/// get_rankings_unlock_status RPC) -- same pattern TasteViewModel/RankingsView
/// already use for their own unlocks. Only the invite-count fields are backed
/// by genuinely new schema (referrals/verified_phones, migration 20260706000006).
@Observable
final class QuestChecklistViewModel {
    private(set) var isLoading = true

    // Full profile, not just the fields this checklist needs -- EditProfileView
    // populates its displayName/username/bio fields FROM this object, so a
    // partial/nil profile passed to it would show blank fields and risk
    // overwriting real data on save. Always pass this through, never nil.
    private(set) var profile: Profile?

    private(set) var hasAvatar = false
    private(set) var hasBio = false

    // Album-only count -- basis for "rate your first release".
    private(set) var albumRatingCount = 0
    // Albums + songs, matching TasteViewModel's own basis exactly so this quest
    // item's "complete" state can never disagree with whether Taste is actually
    // unlocked.
    private(set) var combinedRatingCount = 0

    private(set) var followingCount = 0

    // Whether THIS account has verified its own phone (Supabase's own
    // auth.users.phone_confirmed_at, exposed directly on the session's User
    // object -- no extra query needed). Gates the ability to invite others at
    // all, not just whether an invite counts -- see InviteView.
    private(set) var hasVerifiedPhone = false

    private(set) var referralCode: String?
    private(set) var verifiedInviteCount = 0

    // Whether THIS account was itself redeemed via someone else's referral
    // code -- lets the "Connect your phone number" quest item explain that
    // verifying also credits whoever invited them, which is otherwise
    // completely invisible (redemption happens silently on first launch,
    // see ReferralClipboardHandoff/PendingReferralStore). Same query
    // InviteViewModel.wasInvited already uses.
    private(set) var wasInvited = false

    private(set) var rankingsUnlock: RankingsUnlockStatus?

    var hasFirstRating: Bool { albumRatingCount >= 1 }
    var hasFiveRatings: Bool { albumRatingCount >= 5 }
    var hasTasteUnlock: Bool { combinedRatingCount >= TasteViewModel.unlockThreshold }
    var hasFollow: Bool { followingCount >= 1 }
    var hasFirstInvite: Bool { verifiedInviteCount >= 1 }
    var hasFiveInvites: Bool { verifiedInviteCount >= 5 }
    var albumsChartsUnlocked: Bool { rankingsUnlock?.albumUnlocked ?? false }
    var songsChartsUnlocked: Bool { rankingsUnlock?.songUnlocked ?? false }

    // Deliberately excludes the two community-wide Charts unlocks -- those
    // depend on the whole user base, not this one person, so gating the
    // nudge dot on them could leave it lit indefinitely for someone who's
    // personally finished everything else. This is what the badge/dot use.
    var personalQuestsComplete: Bool {
        hasAvatar && hasBio && hasTasteUnlock && hasFollow && hasVerifiedPhone && hasFiveInvites
    }

    var isFullyComplete: Bool {
        personalQuestsComplete && albumsChartsUnlocked && songsChartsUnlocked
    }

    var hasClaimedBadge: Bool { profile?.badgeColor != nil }

    // Gates the redeem sheet MainTabView auto-presents on every launch: done
    // with quests, but the one-time color choice hasn't happened yet.
    var shouldOfferBadgeRedeem: Bool { personalQuestsComplete && !hasClaimedBadge }

    // The DB trigger (prevent_badge_color_change) is the real guarantee this
    // can't be changed later -- the `!hasClaimedBadge` guard here just avoids
    // a doomed round-trip, not a security boundary.
    @discardableResult
    func claimBadge(_ color: QuestBadgeColor) async -> Bool {
        guard let userId = supabase.auth.currentUser?.id, !hasClaimedBadge else { return false }
        struct Patch: Encodable {
            let badgeColor: String
            enum CodingKeys: String, CodingKey { case badgeColor = "badge_color" }
        }
        do {
            try await supabase
                .from("profiles")
                .update(Patch(badgeColor: color.rawValue))
                .eq("id", value: userId)
                .execute()
            profile?.badgeColor = color.rawValue
            return true
        } catch {
            print("QuestChecklistViewModel.claimBadge failed for user \(userId): \(error)")
            return false
        }
    }

    func load() async {
        guard let userId = supabase.auth.currentUser?.id else { isLoading = false; return }
        isLoading = true

        // Synchronous -- currentUser is already in memory, no network call.
        hasVerifiedPhone = supabase.auth.currentUser?.phoneConfirmedAt != nil

        async let profileTask: Void = loadProfile(userId: userId)
        async let ratingsTask: Void = loadRatingCounts(userId: userId)
        async let followTask: Void = loadFollowingCount(userId: userId)
        async let inviteTask: Void = loadInviteProgress(userId: userId)
        async let rankingsTask: Void = loadRankingsUnlock()
        async let wasInvitedTask: Void = loadWasInvited(userId: userId)

        _ = await (profileTask, ratingsTask, followTask, inviteTask, rankingsTask, wasInvitedTask)
        isLoading = false
    }

    private func loadProfile(userId: UUID) async {
        let row: Profile? = try? await supabase
            .from("profiles")
            .select("id, display_name, username, bio, avatar_url, referral_code, badge_color")
            .eq("id", value: userId)
            .single()
            .execute()
            .value
        profile = row
        hasAvatar = !(row?.avatarUrl?.isEmpty ?? true)
        hasBio = !(row?.bio?.isEmpty ?? true)
        referralCode = row?.referralCode
    }

    private func loadRatingCounts(userId: UUID) async {
        async let albumResp = supabase.from("ratings").select("*", count: .exact)
            .eq("user_id", value: userId).execute()
        async let songResp = supabase.from("track_ratings").select("*", count: .exact)
            .eq("user_id", value: userId).execute()

        let albums = (try? await albumResp)?.count ?? 0
        let songs  = (try? await songResp)?.count ?? 0
        albumRatingCount = albums
        combinedRatingCount = albums + songs
    }

    private func loadFollowingCount(userId: UUID) async {
        async let resp = supabase.from("follows").select("*", count: .exact)
            .eq("follower_id", value: userId).execute()
        followingCount = (try? await resp)?.count ?? 0
    }

    private func loadInviteProgress(userId: UUID) async {
        async let resp = supabase.from("referrals").select("*", count: .exact)
            .eq("referrer_id", value: userId)
            .not("verified_at", operator: .is, value: AnyJSON.null)
            .execute()
        verifiedInviteCount = (try? await resp)?.count ?? 0
    }

    private func loadWasInvited(userId: UUID) async {
        struct Row: Codable { let id: UUID }
        let rows: [Row] = (try? await supabase
            .from("referrals").select("id")
            .eq("invited_user_id", value: userId)
            .execute().value) ?? []
        wasInvited = !rows.isEmpty
    }

    private func loadRankingsUnlock() async {
        let rows: [RankingsUnlockStatus] = (try? await supabase
            .rpc("get_rankings_unlock_status")
            .execute()
            .value) ?? []
        rankingsUnlock = rows.first
    }
}
