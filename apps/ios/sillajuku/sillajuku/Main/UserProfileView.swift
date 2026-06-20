import SwiftUI
import Supabase

// Navigation value used by HomeView's NavigationStack
struct UserProfileDestination: Hashable {
    let userId: UUID
    let handle: String
}

// MARK: - View

struct UserProfileView: View {
    let userId: UUID
    let initialHandle: String

    private struct OtherProfile: Codable {
        let id: UUID
        let username: String?
        let displayName: String?
        let bio: String?
        enum CodingKeys: String, CodingKey {
            case id, username, bio; case displayName = "display_name"
        }
        var handle: String { username ?? displayName ?? "someone" }
        var displayLabel: String { displayName ?? username ?? "someone" }
    }

    struct ProfileRating: Codable, Identifiable {
        let id: UUID
        let score: Double?
        let createdAt: Date
        let releases: FeedRelease

        enum CodingKeys: String, CodingKey {
            case id, score, releases; case createdAt = "created_at"
        }
    }

    @State private var profile: OtherProfile?
    @State private var ratings: [ProfileRating] = []
    @State private var ratingCount   = 0
    @State private var followerCount = 0
    @State private var followingCount = 0
    @State private var isFollowing   = false
    @State private var isLoading     = true
    @State private var isTogglingFollow = false

    private var currentUserId: UUID? { supabase.auth.currentUser?.id }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                profileHeader
                Divider().padding(.top, 20)
                ratingsSection
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("@\(profile?.handle ?? initialHandle)")
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadAll() }
    }

    // MARK: Header

    private var profileHeader: some View {
        VStack(spacing: 14) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 80))
                .foregroundStyle(Color(uiColor: .systemGray3))
                .padding(.top, 24)

            VStack(spacing: 4) {
                Text(profile?.displayLabel ?? initialHandle)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Color.sjInk)

                Text("@\(profile?.handle ?? initialHandle)")
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)
            }

            if let bio = profile?.bio, !bio.isEmpty {
                Text(bio)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            statsRow

            if let cid = currentUserId, cid != userId {
                followButton
            }
        }
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity)
    }

    private var statsRow: some View {
        HStack(spacing: 24) {
            statCell(value: ratingCount, label: "Ratings")
            statCell(value: followerCount, label: "Followers")
            statCell(value: followingCount, label: "Following")
        }
    }

    private func statCell(value: Int, label: String) -> some View {
        VStack(spacing: 3) {
            Text("\(value)")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(Color.sjMuted)
        }
    }

    private var followButton: some View {
        Button {
            Task { await toggleFollow() }
        } label: {
            if isTogglingFollow {
                ProgressView().scaleEffect(0.8)
                    .frame(width: 130, height: 36)
            } else {
                Text(isFollowing ? "Following" : "Follow")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(isFollowing ? Color.sjInk : .white)
                    .frame(width: 130, height: 36)
                    .background(isFollowing ? Color.sjBorder.opacity(0.4) : Color.sjAmber)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
            }
        }
        .buttonStyle(.plain)
        .animation(.easeInOut(duration: 0.15), value: isFollowing)
    }

    // MARK: Ratings

    @ViewBuilder
    private var ratingsSection: some View {
        if isLoading {
            ProgressView().padding(.top, 40)
        } else if ratings.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "music.note.list")
                    .font(.system(size: 40))
                    .foregroundStyle(Color.sjBorder)
                Text("No ratings yet")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.top, 48)
        } else {
            LazyVStack(spacing: 0) {
                ForEach(ratings) { rating in
                    NavigationLink(value: rating.releases.asRelease) {
                        ProfileRatingRow(rating: rating)
                    }
                    .buttonStyle(.plain)
                    Divider().padding(.leading, 74)
                }
            }
            .padding(.top, 4)
        }
    }

    // MARK: Data

    private func loadAll() async {
        isLoading = true
        async let profileFetch: OtherProfile? = loadProfile()
        async let ratingsFetch: [ProfileRating] = loadRatings()
        async let countsFetch: (Int, Int, Int, Bool) = loadCounts()

        let (p, r, (rc, fwer, fwing, following)) = await (profileFetch, ratingsFetch, countsFetch)
        profile = p
        ratings = r
        ratingCount = rc
        followerCount = fwer
        followingCount = fwing
        isFollowing = following
        isLoading = false
    }

    private func loadProfile() async -> OtherProfile? {
        try? await supabase
            .from("profiles")
            .select("id, username, display_name, bio")
            .eq("id", value: userId)
            .single()
            .execute()
            .value
    }

    private func loadRatings() async -> [ProfileRating] {
        (try? await supabase
            .from("ratings")
            .select("id, score, created_at, releases(id, title, artist, cover_url, release_type)")
            .eq("user_id", value: userId)
            .order("created_at", ascending: false)
            .limit(30)
            .execute()
            .value) ?? []
    }

    private func loadCounts() async -> (Int, Int, Int, Bool) {
        async let ratingsResp  = supabase.from("ratings").select("*", count: .exact).eq("user_id", value: userId).execute()
        async let followersResp = supabase.from("follows").select("*", count: .exact).eq("following_id", value: userId).execute()
        async let followingResp = supabase.from("follows").select("*", count: .exact).eq("follower_id", value: userId).execute()

        let rc   = (try? await ratingsResp)?.count  ?? 0
        let fwer = (try? await followersResp)?.count ?? 0
        let fwing = (try? await followingResp)?.count ?? 0

        var following = false
        if let cid = currentUserId {
            let chk = try? await supabase.from("follows").select("*", count: .exact)
                .eq("follower_id", value: cid).eq("following_id", value: userId).execute()
            following = (chk?.count ?? 0) > 0
        }

        return (rc, fwer, fwing, following)
    }

    private func toggleFollow() async {
        guard let cid = currentUserId else { return }
        isTogglingFollow = true
        defer { isTogglingFollow = false }

        do {
            if isFollowing {
                try await supabase.from("follows").delete()
                    .eq("follower_id", value: cid)
                    .eq("following_id", value: userId)
                    .execute()
                isFollowing = false
                followerCount = max(0, followerCount - 1)
            } else {
                struct Payload: Encodable {
                    let followerId: UUID; let followingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case followerId = "follower_id"; case followingId = "following_id"
                    }
                }
                try await supabase.from("follows")
                    .insert(Payload(followerId: cid, followingId: userId))
                    .execute()
                isFollowing = true
                followerCount += 1
            }
        } catch { /* silently handle */ }
    }
}

// MARK: - Profile rating row

private struct ProfileRatingRow: View {
    let rating: UserProfileView.ProfileRating

    var body: some View {
        HStack(spacing: 12) {
            AsyncImage(url: URL(string: rating.releases.coverUrl ?? "")) { phase in
                switch phase {
                case .success(let img): img.resizable().aspectRatio(contentMode: .fill)
                default: Color.sjBorder
                }
            }
            .frame(width: 54, height: 54)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text(rating.releases.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text("\(rating.releases.typeLabel) · \(rating.releases.artist)")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            scoreChip

            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.sjBorder)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var scoreChip: some View {
        if let score = rating.score {
            HStack(spacing: 3) {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 10, height: 10).foregroundStyle(Color.sjAmber)
                Text(scoreLabel(score))
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Color.sjAmber)
            }
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Color.sjAmber.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        } else {
            HStack(spacing: 3) {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 10, height: 10)
                Image(systemName: "lock.fill").font(.system(size: 9))
            }
            .foregroundStyle(Color.sjMuted)
            .padding(.horizontal, 7).padding(.vertical, 3)
            .background(Color.sjMuted.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private func scoreLabel(_ s: Double) -> String {
        s.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(s)) : String(format: "%.1f", s)
    }
}
