import SwiftUI
import Observation
import Supabase

extension Notification.Name {
    static let ratingChanged     = Notification.Name("com.sillajuku.ratingChanged")
    static let followChanged     = Notification.Name("com.sillajuku.followChanged")
    static let mixLibraryChanged = Notification.Name("com.sillajuku.mixLibraryChanged")
    static let mixShared         = Notification.Name("com.sillajuku.mixShared")
}

// MARK: - Shared hero background

/// Full-bleed blurred cover art, used behind both `AlbumDetailView` and
/// `SongDetailView`'s hero sections. Blur technique mirrors
/// `SharePreviewSheet`'s `.cover` background page: scale up before blurring
/// so the blur's faded edges land outside the visible frame instead of
/// showing a soft border, then fade to the page background at the bottom so
/// the hero blends into the rest of the scroll content instead of
/// hard-cutting.
///
/// Callers pass `height` as their own base height plus the page's top safe
/// area inset (see `AlbumDetailView.body`'s `GeometryReader`) so this bleeds
/// up behind the status bar / nav bar instead of leaving a plain cream strip
/// there -- a `ScrollView` clips its content to its own bounds, so a child
/// declaring `.ignoresSafeArea()` on its own can't escape upward on its
/// own; the `ScrollView` itself has to ignore the safe area (done by the
/// caller), with this view's height grown to match and the foreground
/// content in the hero padded down by the same inset so it doesn't shift
/// up behind the chrome too.
private struct HeroBlurredBackground: View {
    let coverUrl: String?
    var height: CGFloat = 260

    var body: some View {
        GeometryReader { geo in
            CachedImage(url: URL(string: coverUrl?.thumbnailUrl ?? "")) { Color.sjBorder }
                .aspectRatio(contentMode: .fill)
                .frame(width: geo.size.width, height: geo.size.height)
                .scaleEffect(1.2)
                .blur(radius: 30)
                .clipped()
                .overlay(
                    LinearGradient(colors: [.clear, Color.sjCream], startPoint: .top, endPoint: .bottom)
                )
        }
        .frame(height: height)
        .accessibilityHidden(true)
    }
}

// MARK: - Models

struct AlbumPublicMix: Identifiable {
    let id: UUID
    let name: String
    let authorHandle: String
    let authorId: UUID?
    let isDefault: Bool
    let createdAt: Date
    let description: String?
}

// MARK: - Track entry (loaded via release_tracks → recordings)

struct TrackEntry: Codable, Identifiable, Hashable {
    let trackId: UUID?        // recordings.id
    let position: Int
    let title: String
    let durationMs: Int?
    let artists: String?      // recordings.artist_display

    var id: String { trackId?.uuidString ?? "\(position)" }

    enum CodingKeys: String, CodingKey {
        case trackId = "id"
        case position, title, artists
        case durationMs = "duration_ms"
    }
}

// Intermediate type for decoding release_tracks + embedded recordings
private struct ReleaseTrackRow: Decodable {
    let position: Int
    let discNumber: Int?
    let recordings: RecordingRef

    struct RecordingRef: Decodable {
        let id: UUID
        let title: String
        let durationMs: Int?
        let artistDisplay: String?

        enum CodingKeys: String, CodingKey {
            case id, title
            case durationMs   = "duration_ms"
            case artistDisplay = "artist_display"
        }
    }

    enum CodingKeys: String, CodingKey {
        case position
        case discNumber = "disc_number"
        case recordings
    }
}

// MARK: - ViewModel

@Observable
class AlbumDetailViewModel {
    var tracklist: [TrackItem] = []
    var tracks: [TrackEntry] = []
    var trackRatings: [UUID: Double] = [:]      // keyed by recordings.id
    var communityAvg: Double?
    var communityCount: Int = 0
    var communitySD: Double?
    var userScore: Double?
    var reviewText: String?
    var currentRatingId: UUID?
    var ratingStep: Double = 0.5
    var posts: [FeedItem] = []
    // The signed-in user's own rating on this album, in feed-post shape --
    // loadPosts deliberately excludes it from `posts`, but the rated state
    // renders it as a regular FeedCard under "Your Rating".
    var myPost: FeedItem? = nil
    var likedPostIds: Set<UUID> = []
    var savedReleaseIds: Set<UUID> = []
    var likeCounts: [UUID: Int] = [:]
    var commentCounts: [UUID: Int] = [:]
    var publicMixes: [AlbumPublicMix] = []
    var isLoading = true
    var isSaving = false
    private(set) var releaseGroupId: UUID?

    var currentUserId: UUID? { supabase.auth.currentUser?.id }

    var isRated: Bool { userScore != nil }

    var displayScore: Double? { userScore }

    func load(releaseGroupId: UUID) async {
        self.releaseGroupId = releaseGroupId
        isLoading = true

        // These can run immediately in parallel while tracks loads sequentially first
        async let ratingsTask: Void = loadRatings(releaseGroupId: releaseGroupId)
        async let stepTask: Void    = loadRatingStep()
        async let postsTask: Void   = loadPosts(releaseGroupId: releaseGroupId)
        async let mixesTask: Void   = loadPublicMixes(releaseGroupId: releaseGroupId)

        // Track ratings need recording IDs, so tracks must finish first
        await loadTracks(releaseGroupId: releaseGroupId)
        await loadTrackRatings(recordingIds: tracks.compactMap(\.trackId))

        _ = await (ratingsTask, stepTask, postsTask, mixesTask)
        isLoading = false
    }

    private func loadTracks(releaseGroupId: UUID) async {
        // Step 1: find the canonical release edition for this release group
        struct CanonicalRelease: Decodable { let id: UUID }
        let canonicals: [CanonicalRelease] = (try? await supabase
            .from("releases")
            .select("id")
            .eq("release_group_id", value: releaseGroupId)
            .eq("is_canonical", value: true)
            .limit(1)
            .execute()
            .value) ?? []
        guard let canonical = canonicals.first else { return }

        // Step 2: load release_tracks with embedded recording info
        let rows: [ReleaseTrackRow] = (try? await supabase
            .from("release_tracks")
            .select("position, disc_number, recordings(id, title, duration_ms, artist_display)")
            .eq("release_id", value: canonical.id)
            .order("position")
            .execute()
            .value) ?? []

        tracks = rows.map { row in
            TrackEntry(
                trackId:   row.recordings.id,
                position:  row.position,
                title:     row.recordings.title,
                durationMs: row.recordings.durationMs,
                artists:   row.recordings.artistDisplay
            )
        }
    }

    private func loadTrackRatings(recordingIds: [UUID]) async {
        guard let userId = supabase.auth.currentUser?.id,
              !recordingIds.isEmpty else { return }
        struct TR: Decodable {
            let recordingId: UUID
            let score: Double?
            enum CodingKeys: String, CodingKey {
                case recordingId = "recording_id"; case score
            }
        }
        let rows: [TR] = (try? await supabase
            .from("track_ratings")
            .select("recording_id, score")
            .eq("user_id", value: userId)
            .in("recording_id", values: recordingIds.map(\.uuidString))
            .execute()
            .value) ?? []
        trackRatings = Dictionary(uniqueKeysWithValues: rows.compactMap { r in
            guard let s = r.score else { return nil }
            return (r.recordingId, s)
        })
    }

    func rateTrack(recordingId: UUID, score: Double?) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        if let score {
            struct Row: Encodable {
                let userId: UUID; let recordingId: UUID; let score: Double
                enum CodingKeys: String, CodingKey {
                    case userId = "user_id"; case recordingId = "recording_id"; case score
                }
            }
            try? await supabase.from("track_ratings")
                .upsert(Row(userId: userId, recordingId: recordingId, score: score),
                        onConflict: "user_id,recording_id")
                .execute()
            trackRatings[recordingId] = score
        } else {
            try? await supabase.from("track_ratings")
                .delete()
                .eq("user_id", value: userId)
                .eq("recording_id", value: recordingId)
                .execute()
            trackRatings.removeValue(forKey: recordingId)
        }
    }

    func loadRatings(releaseGroupId: UUID) async {
        struct Row: Decodable {
            let id: UUID
            let score: Double?
            let userId: UUID
            let reviewText: String?
            enum CodingKeys: String, CodingKey {
                case id, score; case userId = "user_id"; case reviewText = "review_text"
            }
        }
        let rows: [Row] = (try? await supabase
            .from("ratings").select("id, score, user_id, review_text")
            .eq("release_group_id", value: releaseGroupId).execute().value) ?? []

        communityCount = rows.count
        let scored = rows.compactMap(\.score)
        communityAvg = scored.isEmpty ? nil : scored.reduce(0, +) / Double(scored.count)
        communitySD = Self.spread(of: scored)

        if let userId = supabase.auth.currentUser?.id {
            let mine = rows.first(where: { $0.userId == userId })
            userScore       = mine?.score
            currentRatingId = mine?.id
            reviewText      = mine?.reviewText
        }
    }

    /// Population standard deviation of the community's scores -- surfaced in
    /// the UI as "Split"/편차 (how divided listeners are). Nil below 3 scores,
    /// where a deviation is statistically meaningless.
    static func spread(of scores: [Double]) -> Double? {
        guard scores.count >= 3 else { return nil }
        let mean = scores.reduce(0, +) / Double(scores.count)
        let variance = scores.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(scores.count)
        return (variance).squareRoot()
    }

    /// Updates only the review text of the user's existing rating -- used by
    /// the unified "Edit" action, which never touches
    /// the score itself. Uses an explicit encode so an empty edit correctly
    /// writes SQL NULL rather than Codable's default of omitting nil keys.
    func updateReviewText(_ text: String?) async {
        guard let rid = currentRatingId else { return }
        reviewText = text
        struct Update: Encodable {
            let reviewText: String?
            enum CodingKeys: String, CodingKey { case reviewText = "review_text" }
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                if let reviewText { try container.encode(reviewText, forKey: .reviewText) }
                else { try container.encodeNil(forKey: .reviewText) }
            }
        }
        try? await supabase.from("ratings")
            .update(Update(reviewText: text))
            .eq("id", value: rid)
            .execute()
        await loadMyPost()
    }

    private func loadRatingStep() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct P: Decodable {
            let ratingStep: Double?
            enum CodingKeys: String, CodingKey {
                case ratingStep = "manual_rating_step"
            }
        }
        if let p: P = try? await supabase
            .from("profiles").select("manual_rating_step")
            .eq("id", value: userId).single().execute().value {
            ratingStep = p.ratingStep ?? 0.5
        }
    }

    func setRating(releaseGroupId: UUID, score: Double?) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        isSaving = true
        defer { isSaving = false }

        let old = userScore
        userScore = score

        do {
            if let score {
                struct Upsert: Encodable {
                    let userId: UUID; let releaseGroupId: UUID; let score: Double
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case releaseGroupId = "release_group_id"; case score
                    }
                }
                try await supabase.from("ratings")
                    .upsert(Upsert(userId: userId, releaseGroupId: releaseGroupId, score: score),
                            onConflict: "user_id,release_group_id")
                    .execute()
            } else {
                try await supabase.from("ratings")
                    .delete().eq("user_id", value: userId).eq("release_group_id", value: releaseGroupId)
                    .execute()
            }
            await reloadCommunityStats(releaseGroupId: releaseGroupId, currentUserId: userId)
            await loadMyPost()
            NotificationCenter.default.post(name: .ratingChanged, object: nil)
        } catch {
            userScore = old
        }
    }

    private func reloadCommunityStats(releaseGroupId: UUID, currentUserId: UUID) async {
        struct Row: Decodable {
            let id: UUID; let score: Double?; let userId: UUID; let reviewText: String?
            enum CodingKeys: String, CodingKey {
                case id, score; case userId = "user_id"; case reviewText = "review_text"
            }
        }
        let rows: [Row] = (try? await supabase
            .from("ratings").select("id, score, user_id, review_text")
            .eq("release_group_id", value: releaseGroupId).execute().value) ?? []
        communityCount = rows.count
        let scored = rows.compactMap(\.score)
        communityAvg = scored.isEmpty ? nil : scored.reduce(0, +) / Double(scored.count)
        communitySD = Self.spread(of: scored)
        let mine = rows.first(where: { $0.userId == currentUserId })
        userScore       = mine?.score
        currentRatingId = mine?.id
        reviewText      = mine?.reviewText
    }

    // Not private -- reused by AlbumAllRatingsListViewModel for the "View All" screen.
    static let postsSelect =
        "id, user_id, score, review_text, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native)), profiles!ratings_user_id_fkey(username, display_name, is_bot)"

    private func loadPosts(releaseGroupId: UUID) async {
        let myId = supabase.auth.currentUser?.id
        var query = supabase
            .from("ratings")
            .select(Self.postsSelect)
            .eq("release_group_id", value: releaseGroupId)
        if let myId { query = query.neq("user_id", value: myId) }
        posts = (try? await query
            .order("created_at", ascending: false)
            .limit(20)
            .execute()
            .value) ?? []
        await loadMyPost()
        await loadPostSocialData()
    }

    /// Refreshes the user's own rating in feed-post shape. Called from the
    /// initial load and again after any action that changes what the card
    /// shows (re-rate, comment edit, delete).
    func loadMyPost() async {
        guard let myId = currentUserId, let rgId = releaseGroupId else { return }
        let mine: [FeedItem] = (try? await supabase
            .from("ratings")
            .select(Self.postsSelect)
            .eq("release_group_id", value: rgId)
            .eq("user_id", value: myId)
            .limit(1)
            .execute()
            .value) ?? []
        myPost = mine.first
    }

    private func loadPostSocialData() async {
        let all = posts + (myPost.map { [$0] } ?? [])
        guard !all.isEmpty else { return }
        async let countsTask = AlbumSocial.loadCounts(for: all)
        async let mineTask: AlbumSocial.MyState? = {
            guard let userId = currentUserId else { return nil }
            return await AlbumSocial.loadMyLikesAndSaves(posts: all, userId: userId)
        }()
        let counts = await countsTask
        for (k, v) in counts.likeCounts { likeCounts[k] = v }
        for (k, v) in counts.commentCounts { commentCounts[k] = v }
        if let mine = await mineTask {
            likedPostIds.formUnion(mine.likedPostIds)
            savedReleaseIds.formUnion(mine.savedReleaseIds)
        }
    }

    func toggleLike(for item: FeedItem) async {
        let result = await AlbumSocial.toggleLike(item: item, likedPostIds: likedPostIds, likeCounts: likeCounts)
        likedPostIds = result.likedPostIds
        likeCounts = result.likeCounts
    }

    func toggleSave(for item: FeedItem) async {
        let result = await AlbumSocial.toggleSave(item: item, savedReleaseIds: savedReleaseIds)
        savedReleaseIds = result.savedReleaseIds
    }

    func blockUser(userId: UUID) async {
        await AlbumSocial.blockUser(userId: userId)
        posts.removeAll { $0.userId == userId }
    }

    private func loadPublicMixes(releaseGroupId: UUID) async {
        struct MixItemRef: Codable {
            let mixId: UUID
            enum CodingKeys: String, CodingKey { case mixId = "mix_id" }
        }
        let refs: [MixItemRef] = (try? await supabase
            .from("mix_items")
            .select("mix_id")
            .eq("release_group_id", value: releaseGroupId)
            .limit(50)
            .execute()
            .value) ?? []

        let mixIds = Array(Set(refs.map(\.mixId.uuidString)))
        guard !mixIds.isEmpty else { return }

        struct MixRow: Codable, Identifiable {
            let id: UUID
            let name: String
            let isDefault: Bool
            let createdAt: Date
            let description: String?
            let profiles: MixProfile?
            enum CodingKeys: String, CodingKey {
                case id, name, profiles, description
                case isDefault = "is_default"
                case createdAt = "created_at"
            }
            struct MixProfile: Codable {
                let id: UUID
                let username: String?
                let displayName: String?
                enum CodingKeys: String, CodingKey {
                    case id, username; case displayName = "display_name"
                }
            }
        }
        let rows: [MixRow] = (try? await supabase
            .from("mixes")
            .select("id, name, is_default, created_at, description, profiles(id, username, display_name)")
            .in("id", values: mixIds)
            .eq("is_public", value: true)
            .limit(30)
            .execute()
            .value) ?? []
        guard !rows.isEmpty else { return }

        // Popularity = mix likes (direct engagement with this mix) plus the
        // owner's follower count (general reach), likes weighted higher since
        // they're a more direct signal of the mix's own quality.
        let rowMixIds = rows.map(\.id.uuidString)
        struct MixLikeRow: Decodable {
            let mixId: UUID
            enum CodingKeys: String, CodingKey { case mixId = "mix_id" }
        }
        let likeRows: [MixLikeRow] = (try? await supabase
            .from("mix_likes").select("mix_id")
            .in("mix_id", values: rowMixIds).execute().value) ?? []
        var likeCounts: [UUID: Int] = [:]
        for r in likeRows { likeCounts[r.mixId, default: 0] += 1 }

        let ownerIds = Array(Set(rows.compactMap { $0.profiles?.id.uuidString }))
        struct FollowRow: Decodable {
            let followingId: UUID
            enum CodingKeys: String, CodingKey { case followingId = "following_id" }
        }
        let followRows: [FollowRow] = ownerIds.isEmpty ? [] : ((try? await supabase
            .from("follows").select("following_id")
            .in("following_id", values: ownerIds).execute().value) ?? [])
        var followerCounts: [UUID: Int] = [:]
        for r in followRows { followerCounts[r.followingId, default: 0] += 1 }

        func popularity(_ row: MixRow) -> Int {
            let likes = likeCounts[row.id] ?? 0
            let followers = row.profiles.flatMap { followerCounts[$0.id] } ?? 0
            return likes * 3 + followers
        }

        publicMixes = rows
            .sorted { popularity($0) > popularity($1) }
            .map { row in
                let handle = row.profiles.flatMap { $0.username.map { "@\($0)" } ?? $0.displayName } ?? String(localized: "someone")
                return AlbumPublicMix(id: row.id, name: row.name, authorHandle: handle, authorId: row.profiles?.id, isDefault: row.isDefault, createdAt: row.createdAt, description: row.description)
            }
    }
}

// MARK: - Shared social helpers (likes/saves/block) for FeedItem-based posts
// Used by both AlbumDetailViewModel (the album page's horizontal preview) and
// AlbumAllRatingsListViewModel (its "View All" screen) -- same tables/logic
// against a differently-scoped post array, so it's factored out once instead
// of duplicated twice.
// Return-based rather than inout -- an @Observable class's stored properties
// are actor-isolated, and an inout binding to one can't be held across an
// `await` suspension, so callers merge these results back in themselves.
enum AlbumSocial {
    struct Counts { var likeCounts: [UUID: Int] = [:]; var commentCounts: [UUID: Int] = [:] }
    struct MyState { var likedPostIds: Set<UUID> = []; var savedReleaseIds: Set<UUID> = [] }
    struct LikeResult { var likedPostIds: Set<UUID>; var likeCounts: [UUID: Int] }
    struct SaveResult { var savedReleaseIds: Set<UUID> }

    static func loadCounts(for posts: [FeedItem]) async -> Counts {
        let ratingIds = posts.map(\.id.uuidString)
        struct RatingIdRow: Codable {
            let ratingId: UUID
            enum CodingKeys: String, CodingKey { case ratingId = "rating_id" }
        }
        async let likesTask: [RatingIdRow]? = try? await supabase
            .from("rating_likes").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value
        async let commentsTask: [RatingIdRow]? = try? await supabase
            .from("rating_comments").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value
        var result = Counts()
        if let rows = await likesTask {
            for r in rows { result.likeCounts[r.ratingId, default: 0] += 1 }
        }
        if let rows = await commentsTask {
            for r in rows { result.commentCounts[r.ratingId, default: 0] += 1 }
        }
        return result
    }

    static func loadMyLikesAndSaves(posts: [FeedItem], userId: UUID) async -> MyState {
        let ratingIds = posts.map(\.id.uuidString)
        let releaseIds = Array(Set(posts.map(\.releases.id.uuidString)))
        struct RatingIdRow: Codable {
            let ratingId: UUID
            enum CodingKeys: String, CodingKey { case ratingId = "rating_id" }
        }
        struct ReleaseIdRow: Codable {
            let releaseId: UUID
            enum CodingKeys: String, CodingKey { case releaseId = "release_id" }
        }
        async let likedTask: [RatingIdRow]? = try? await supabase
            .from("rating_likes").select("rating_id")
            .eq("user_id", value: userId)
            .in("rating_id", values: ratingIds).execute().value
        async let savedTask: [ReleaseIdRow]? = try? await supabase
            .from("saved_releases").select("release_id")
            .eq("user_id", value: userId)
            .in("release_id", values: releaseIds).execute().value
        var result = MyState()
        if let rows = await likedTask {
            for r in rows { result.likedPostIds.insert(r.ratingId) }
        }
        if let rows = await savedTask {
            for r in rows { result.savedReleaseIds.insert(r.releaseId) }
        }
        return result
    }

    static func toggleLike(item: FeedItem, likedPostIds: Set<UUID>, likeCounts: [UUID: Int]) async -> LikeResult {
        var likedPostIds = likedPostIds
        var likeCounts = likeCounts
        guard let userId = supabase.auth.currentUser?.id else {
            return LikeResult(likedPostIds: likedPostIds, likeCounts: likeCounts)
        }
        let wasLiked = likedPostIds.contains(item.id)
        if wasLiked {
            likedPostIds.remove(item.id)
            likeCounts[item.id] = max(0, (likeCounts[item.id] ?? 1) - 1)
        } else {
            likedPostIds.insert(item.id)
            likeCounts[item.id] = (likeCounts[item.id] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("rating_likes").delete()
                    .eq("user_id", value: userId).eq("rating_id", value: item.id).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let ratingId: UUID
                    enum CodingKeys: String, CodingKey { case userId = "user_id"; case ratingId = "rating_id" }
                }
                try await supabase.from("rating_likes")
                    .insert(Payload(userId: userId, ratingId: item.id)).execute()
            }
        } catch {
            if wasLiked { likedPostIds.insert(item.id); likeCounts[item.id] = (likeCounts[item.id] ?? 0) + 1 }
            else { likedPostIds.remove(item.id); likeCounts[item.id] = max(0, (likeCounts[item.id] ?? 1) - 1) }
        }
        return LikeResult(likedPostIds: likedPostIds, likeCounts: likeCounts)
    }

    static func toggleSave(item: FeedItem, savedReleaseIds: Set<UUID>) async -> SaveResult {
        var savedReleaseIds = savedReleaseIds
        guard let userId = supabase.auth.currentUser?.id else {
            return SaveResult(savedReleaseIds: savedReleaseIds)
        }
        let releaseId = item.releases.id
        let wasSaved = savedReleaseIds.contains(releaseId)
        if wasSaved { savedReleaseIds.remove(releaseId) } else { savedReleaseIds.insert(releaseId) }
        do {
            if wasSaved {
                try await supabase.from("saved_releases").delete()
                    .eq("user_id", value: userId).eq("release_id", value: releaseId).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let releaseId: UUID
                    enum CodingKeys: String, CodingKey { case userId = "user_id"; case releaseId = "release_id" }
                }
                try await supabase.from("saved_releases")
                    .insert(Payload(userId: userId, releaseId: releaseId)).execute()
            }
        } catch {
            if wasSaved { savedReleaseIds.insert(releaseId) } else { savedReleaseIds.remove(releaseId) }
        }
        return SaveResult(savedReleaseIds: savedReleaseIds)
    }

    static func blockUser(userId: UUID) async {
        guard let me = supabase.auth.currentUser?.id, userId != me else { return }
        struct Payload: Encodable {
            let blockerId: UUID; let blockedId: UUID
            enum CodingKeys: String, CodingKey { case blockerId = "blocker_id"; case blockedId = "blocked_id" }
        }
        _ = try? await supabase.from("blocked_users")
            .insert(Payload(blockerId: me, blockedId: userId)).execute()
    }
}

// MARK: - Manual Rating Sheet

struct ManualRatingSheet: View {
    let release: Release
    @Binding var existingScore: Double?
    var ratingStep: Double = 0.5
    let onSave: (Double?) -> Void

    private enum Phase { case rating, postRating }
    @State private var phase: Phase = .rating
    // nil until the user actually drags -- shows the neutral flower glyph
    // rather than defaulting to a misleading pre-filled 2.5.
    @State private var draftScore: Double?
    @State private var ratingId: UUID? = nil
    @State private var sheetDetent: PresentationDetent = .fraction(0.33)
    // Measured live from PostRatingOptionsView's real content height (via
    // onHeightChange) so the sheet grows when the comment TextEditor expands,
    // instead of staying pinned to a fixed .medium that clips the content.
    @State private var postRatingHeight: CGFloat = 420
    @Environment(\.dismiss) private var dismiss

    init(release: Release, existingScore: Binding<Double?>, ratingStep: Double = 0.5, onSave: @escaping (Double?) -> Void) {
        self.release        = release
        self._existingScore = existingScore
        self.ratingStep     = ratingStep
        self.onSave         = onSave
        self._draftScore    = State(initialValue: existingScore.wrappedValue)
    }

    var body: some View {
        Group {
            if phase == .rating {
                ratingView
            } else {
                PostRatingOptionsView(
                    release: release,
                    continueLabel: "Done",
                    onBack: { withAnimation { phase = .rating; sheetDetent = .fraction(0.33) } },
                    onHeightChange: { height in
                        postRatingHeight = height
                        if phase == .postRating {
                            withAnimation(.easeInOut(duration: 0.2)) { sheetDetent = .height(height) }
                        }
                    },
                    onContinue: { text in Task { await saveReviewAndDismiss(text: text) } }
                )
            }
        }
        .presentationBackground(Color.sjCream)
        .presentationDetents(
            phase == .rating ? [.fraction(0.33)] : [.height(postRatingHeight)],
            selection: $sheetDetent
        )
        .presentationDragIndicator(phase == .postRating ? .visible : .hidden)
    }

    // Deliberately minimal -- just the drag-to-rate flower, no cover/title/
    // artist recap (the user already knows what they tapped "Rate" on) and no
    // separate score readout (the flower shows its own live/resting number).
    private var ratingView: some View {
        VStack(spacing: 20) {
            Spacer(minLength: 0)

            FlowerRateControl(
                onRate: { draftScore = $0 },
                size: 90,
                currentScore: draftScore,
                accessibilityLabelText: "Rate \(release.displayTitle)",
                ratingStep: ratingStep,
                onDelete: existingScore != nil ? { onSave(nil); dismiss() } : nil
            )

            VStack(spacing: 8) {
                Button {
                    guard let score = draftScore else { return }
                    onSave(score)
                    Task { await transitionToPostRating() }
                } label: {
                    Text("Save Rating")
                        .font(.jakarta(16, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(Color.sjBlue).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(draftScore == nil)
                .opacity(draftScore == nil ? 0.4 : 1)
                if existingScore != nil {
                    Button("Remove Rating") { onSave(nil); dismiss() }
                        .font(.jakarta(13)).foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.horizontal, 20)

            Spacer(minLength: 0)
        }
        .padding(.vertical, 24)
    }

    private func transitionToPostRating() async {
        if let userId = supabase.auth.currentUser?.id {
            struct IdRow: Decodable { let id: UUID }
            ratingId = (try? await supabase.from("ratings")
                .select("id")
                .eq("user_id", value: userId)
                .eq("release_group_id", value: release.id)
                .single()
                .execute()
                .value as IdRow)?.id
        }
        withAnimation { sheetDetent = .height(postRatingHeight) }
        phase = .postRating
    }

    private func saveReviewAndDismiss(text: String?) async {
        if let text, let rid = ratingId {
            struct Update: Encodable {
                let reviewText: String
                enum CodingKeys: String, CodingKey { case reviewText = "review_text" }
            }
            try? await supabase.from("ratings")
                .update(Update(reviewText: text))
                .eq("id", value: rid)
                .execute()
        }
        dismiss()
    }
}

// MARK: - Album Detail View

struct AlbumDetailView: View {
    let release: Release
    var onRated: ((UUID) -> Void)? = nil

    @State private var viewModel = AlbumDetailViewModel()
    @State private var showManualSheet = false
    // Drives the inline post-rating (comment/add-to-mix/Done) step appended
    // below the real rated post once a fresh MorphingRateButton drag commits
    // a score -- see ratingBody. Reset to false once "Done" is tapped, which
    // just collapses the appended step; the post itself (ratedBody) stays.
    @State private var showPostRatingStep = false
    // A synchronous, view-local stand-in for viewModel.displayScore, set the
    // instant a drag commits (before viewModel.setRating's network round
    // trip resolves) so ratingBody can switch to the draft card -- and the
    // flower->badge matchedGeometryEffect morph -- in the same animated
    // transaction as the commit itself, not one beat later. Deliberately
    // NOT written through viewModel.userScore directly: setRating captures
    // its own "old" value for rollback-on-failure, and pre-setting userScore
    // here would corrupt that (the rollback would restore to the new score,
    // not the real previous one). Cleared once the Task settles, at which
    // point viewModel.displayScore reflects the true outcome either way.
    @State private var optimisticScore: Double? = nil
    // Shared between MorphingRateButton's flower and the ScoreBadge inside
    // ratedBody's FeedCard so the flower morphs into that exact badge, at
    // its exact position, at the moment a fresh drag commits -- see
    // ratingBody and ratedBody.
    @Namespace private var ratingNamespace
    @State private var showMixPicker = false
    @State private var showEditCommentSheet = false
    @State private var showDeleteConfirm = false
    @State private var trackRatingTarget: TrackEntry? = nil
    @State private var selectedSong: TrackEntry? = nil
    @State private var credits: [Credit] = []
    @State private var isPreparingShare = false
    @State private var pendingShare: PendingShare? = nil

    private struct Credit: Codable, Identifiable {
        let artistId: UUID
        let creditedAs: String
        let joinPhrase: String
        let position: Int
        var id: Int { position }
        enum CodingKeys: String, CodingKey {
            case artistId = "artist_id"; case creditedAs = "credited_as"
            case joinPhrase = "join_phrase"; case position
        }
    }

    private var releaseYear: String {
        guard let d = release.releaseDate, d.count >= 4 else { return "" }
        return String(d.prefix(4))
    }

    /// Resolves the real data the share card needs (cover image downloaded,
    /// username fetched) and opens the preview sheet — never hands off to
    /// Instagram directly. The user picks a destination there.
    private func prepareShare(score: Double) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        isPreparingShare = true
        defer { isPreparingShare = false }

        struct ProfileRow: Decodable { let username: String? }
        let profile: ProfileRow? = try? await supabase
            .from("profiles").select("username")
            .eq("id", value: userId).single().execute().value

        let coverImage: UIImage? = await {
            guard let coverUrl = release.coverUrl, let url = URL(string: coverUrl) else { return nil }
            return try? await InstagramShare.downloadImage(from: url)
        }()

        pendingShare = PendingShare(
            username: profile?.username ?? "someone",
            coverImages: [coverImage],
            title: release.displayTitle,
            subtitle: release.typeLabel + " · " + release.displayArtist,
            score: score,
            reviewText: nil
        )
    }

    var body: some View {
        // GeometryReader supplies the real top safe-area inset (status bar +
        // nav bar) so heroSection can pad its foreground content down by
        // exactly that much once the ScrollView below ignores it -- without
        // this, the hero's blurred background bleeding up behind the nav bar
        // would also push the cover/title up behind the chrome instead of
        // just extending the backdrop.
        GeometryReader { proxy in
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 0) {
                    heroSection(topInset: proxy.safeAreaInsets.top)
                    Divider().padding(.horizontal, 20)
                    myReviewSection
                    if !viewModel.tracks.isEmpty {
                        Divider().padding(.horizontal, 20)
                        tracklistSection
                    }
                    if !commentedPosts.isEmpty {
                        Divider().padding(.horizontal, 20)
                        otherRatingsSection
                    }
                    if !viewModel.publicMixes.isEmpty {
                        Divider().padding(.horizontal, 20)
                        mixesSection
                    }
                }
            }
            .ignoresSafeArea(edges: .top)
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(release.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
        // Lets the hero's blurred cover (which itself ignores the top safe
        // area) show through behind the status bar / nav bar instead of the
        // system bar painting its own material over it -- the hero's fade
        // gradient still reads correctly once scrolled past, since the bar
        // is then transparent over the plain cream page background too.
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: URL(string: "https://sillajuku.com/album/\(release.id)")!) {
                    Image(systemName: "square.and.arrow.up")
                }
            }
        }
        .task { await viewModel.load(releaseGroupId: release.id) }
        .task {
            credits = (try? await supabase
                .rpc("get_release_group_credits", params: ["p_release_group_id": release.id.uuidString])
                .execute()
                .value) ?? []
        }
        .sheet(isPresented: $showManualSheet) {
            ManualRatingSheet(
                release: release,
                existingScore: $viewModel.userScore,
                ratingStep: viewModel.ratingStep
            ) { score in
                Task {
                    await viewModel.setRating(releaseGroupId: release.id, score: score)
                    if score != nil { onRated?(release.id) }
                }
            }
        }
        .sheet(isPresented: $showMixPicker) {
            MixPickerView(releaseId: release.id, releaseTitle: release.displayTitle)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showEditCommentSheet) {
            // Comment-only edit; never touches the score (that's the Edit action).
            CommentEditSheet(
                release: release,
                initialComment: viewModel.reviewText ?? ""
            ) { text in
                Task {
                    await viewModel.updateReviewText(text)
                    showEditCommentSheet = false
                }
            }
            .presentationBackground(Color.sjCream)
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .confirmationDialog(
            "Delete Rating?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                Task { await viewModel.setRating(releaseGroupId: release.id, score: nil) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will permanently remove this rating.")
        }
        .sheet(item: $pendingShare) { pending in
            SharePreviewSheet(pending: pending)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $trackRatingTarget) { track in
            TrackRatingSheet(
                track: track,
                release: release,
                existingScore: track.trackId.flatMap { viewModel.trackRatings[$0] }
            ) { t, score in
                Task {
                    if let recordingId = t.trackId {
                        await viewModel.rateTrack(recordingId: recordingId, score: score)
                    }
                }
            }
        }
        // Reset on disappear -- a stale non-nil item binding can get spuriously re-presented
        // on top of a later push made from within its own destination (e.g. tapping the artist
        // name inside SongDetailView re-showing this album on top of the artist page).
        .navigationDestination(item: $selectedSong) { track in
            SongDetailView(track: track, release: release)
                .onDisappear { if selectedSong == track { selectedSong = nil } }
        }
        // No Release/ArtistDestination navigationDestination here -- every stack that hosts
        // this view (Home/Rankings/Profile/Search) declares both at its own root. A second
        // declaration for the same type within one NavigationStack causes SwiftUI to
        // double-push (confirmed live: tapping the artist name re-showed the album page).
        .navigationDestination(for: UserProfileDestination.self) { dest in
            UserProfileView(userId: dest.userId, initialHandle: dest.handle)
        }
    }

    // MARK: Hero

    /// Full-bleed blurred cover behind cover art + title/artist/type-year --
    /// replaces the old side-by-side compact header. No drag-to-rate overlay
    /// on the cover here -- the "My Review" section below is the single
    /// rating surface for this page (a full FeedCard once rated, a
    /// "Rate this Album"/"Add to Rankings" button otherwise), so a second
    /// flower on the hero cover would be a redundant affordance.
    private func heroSection(topInset: CGFloat) -> some View {
        ZStack(alignment: .top) {
            HeroBlurredBackground(coverUrl: release.coverUrl, height: 260 + topInset)

            VStack(spacing: 10) {
                CoverImage(url: release.coverUrl, cornerRadius: 12)
                    .frame(width: 128, height: 128)
                    .shadow(color: .black.opacity(0.25), radius: 16, y: 8)
                    .accessibilityHidden(true) // title/artist text below already describes it

                VStack(spacing: 6) {
                    Text(release.displayTitle)
                        .font(.jakarta(20, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)

                    if credits.isEmpty {
                        NavigationLink(value: ArtistDestination(artistId: nil, name: release.displayArtist)) {
                            Text(release.displayArtist)
                                .font(.jakarta(14))
                                .foregroundStyle(Color.sjMuted)
                                .lineLimit(1)
                        }
                        .buttonStyle(.plain)
                    } else {
                        HStack(spacing: 0) {
                            ForEach(credits) { credit in
                                NavigationLink(value: ArtistDestination(artistId: credit.artistId, name: credit.creditedAs)) {
                                    Text(credit.creditedAs)
                                        .font(.jakarta(14))
                                        .foregroundStyle(Color.sjAmber)
                                        .lineLimit(1)
                                }
                                .buttonStyle(.plain)
                                if !credit.joinPhrase.isEmpty {
                                    Text(credit.joinPhrase)
                                        .font(.jakarta(14))
                                        .foregroundStyle(Color.sjMuted)
                                }
                            }
                        }
                    }

                    HStack(spacing: 6) {
                        if let type = release.releaseType {
                            Text(type.lowercased() == "ep" ? "EP" : type.capitalized)
                                .font(.jakarta(11, weight: .semibold))
                                .foregroundStyle(Color.sjBlue)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Color.sjBlue.opacity(0.1)).clipShape(Capsule())
                        }
                        if !releaseYear.isEmpty {
                            Text(releaseYear)
                                .font(.jakarta(11, weight: .semibold))
                                .foregroundStyle(Color.sjMuted)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Color.sjMuted.opacity(0.1)).clipShape(Capsule())
                        }
                    }
                    .padding(.top, 2)

                    if viewModel.communityCount > 0 {
                        HStack(spacing: 6) {
                            Image("icon-flower")
                                .renderingMode(.template).resizable().scaledToFit()
                                .frame(width: 11, height: 11).foregroundStyle(Color.sjBlue)
                            Text(viewModel.communityAvg.map { String(format: "%.1f", $0) } ?? "—")
                                .font(.jakarta(13, weight: .bold)).foregroundStyle(Color.sjInk)
                            Text("·").font(.jakarta(12)).foregroundStyle(Color.sjBorder)
                            Text(viewModel.communityCount == 1 ? "1 rating" : "\(viewModel.communityCount) ratings")
                                .font(.jakarta(13)).foregroundStyle(Color.sjMuted)
                            Text("·").font(.jakarta(12)).foregroundStyle(Color.sjBorder)
                            Text(viewModel.communitySD.map { String(format: "±%.1f split", $0) } ?? "— split")
                                .font(.jakarta(13)).foregroundStyle(Color.sjMuted)
                        }
                        .padding(.top, 6)
                    }
                }
            }
            .padding(.top, 20 + topInset)
            .padding(.bottom, 16)
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity)
        .overlay(alignment: .topTrailing) {
            Button { showMixPicker = true } label: {
                Image(systemName: "bookmark")
                    .font(.jakarta(16, weight: .medium))
                    .foregroundStyle(Color.sjInk)
                    .padding(10)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .padding(.top, 12 + topInset)
            .padding(.trailing, 16)
            .accessibilityLabel(String(localized: "Add to Mix"))
        }
    }

    private func openRatingSheet() {
        showManualSheet = true
    }

    private var myReviewSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your Rating")
                .font(.jakarta(11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .tracking(0.6)

            ratingBody
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
    }

    private var ratingBody: some View {
        Group {
            if let score = viewModel.displayScore ?? optimisticScore, showPostRatingStep {
                // Mid-flow: the rating exists but isn't finalized until
                // "Done" -- render the post preview (isDraft: true, so no
                // like/comment actions on something not yet complete) and
                // the comment/mix/Done step in ONE shared card, not two
                // separate ones, so it visually reads as an in-progress
                // draft flowing into its own next step rather than a
                // finished, standalone post.
                VStack(alignment: .leading, spacing: 0) {
                    ratedBody(score: score, isDraft: true)
                    Divider().padding(.horizontal, 14)
                    PostRatingOptionsView(
                        release: release,
                        continueLabel: "Done",
                        showHeader: false,
                        onContinue: { text in
                            Task {
                                await saveReviewText(text)
                                withAnimation(.bouncy) { showPostRatingStep = false }
                            }
                        }
                    )
                }
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 1)
                // Grows in from the top-trailing corner -- roughly where the
                // flower/badge morph is happening at the same instant -- so
                // the card reads as unfolding from that point rather than
                // just fading in wherever it happens to land.
                .transition(.scale(scale: 0.94, anchor: .topTrailing).combined(with: .opacity))
            } else if let score = viewModel.displayScore {
                // Finalized: the normal, complete, standalone post card,
                // with its own like/comment actions.
                ratedBody(score: score)
            } else {
                MorphingRateButton(
                    idleLabel: {
                        Label("Rate this Album", systemImage: "plus")
                            .font(.jakarta(15, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                    },
                    idleShape: AnyShape(RoundedRectangle(cornerRadius: 12)),
                    ratingStep: viewModel.ratingStep,
                    accessibilityLabelText: "Rate \(release.displayTitle)",
                    matchedGeometryNamespace: ratingNamespace
                ) { score in
                    // Set optimisticScore AND flip showPostRatingStep
                    // together, synchronously, in the same animated
                    // transaction -- that's what drives the flower->badge
                    // matchedGeometryEffect morph and the card's scale-in
                    // together, at the instant of release, rather than one
                    // beat later once the Task below gets scheduled.
                    withAnimation(.bouncy) {
                        showPostRatingStep = true
                        optimisticScore = score
                    }
                    Task {
                        await viewModel.setRating(releaseGroupId: release.id, score: score)
                        optimisticScore = nil
                        onRated?(release.id)
                    }
                }
            }
        }
    }

    // Same review_text patch ManualRatingSheet.saveReviewAndDismiss does for
    // the sheet-based edit path -- duplicated rather than shared since that
    // struct is intentionally untouched by this change.
    private func saveReviewText(_ text: String?) async {
        guard let text, let userId = supabase.auth.currentUser?.id else { return }
        struct Update: Encodable {
            let reviewText: String
            enum CodingKeys: String, CodingKey { case reviewText = "review_text" }
        }
        try? await supabase
            .from("ratings")
            .update(Update(reviewText: text))
            .eq("user_id", value: userId)
            .eq("release_group_id", value: release.id)
            .execute()
    }

    /// The user's own rating rendered as a regular feed post card, with an
    /// ellipsis menu carrying all the rated-state actions (share / edit /
    /// add to mix / edit comment / delete).
    @ViewBuilder
    private func ratedBody(score: Double, isDraft: Bool = false) -> some View {
        // Animates the badge-only fallback -> full FeedCard swap once
        // myPost loads (a plain state mutation elsewhere, not itself wrapped
        // in withAnimation) so that arrival fades/grows in too instead of
        // popping in wherever the network happens to land.
        Group {
            if let myPost = viewModel.myPost {
                FeedCard(
                    item: myPost,
                    currentUserId: viewModel.currentUserId,
                    isLiked: viewModel.likedPostIds.contains(myPost.id),
                    isSaved: viewModel.savedReleaseIds.contains(myPost.releases.id),
                    likesCount: viewModel.likeCounts[myPost.id] ?? 0,
                    commentsCount: viewModel.commentCounts[myPost.id] ?? 0,
                    onLike: { await viewModel.toggleLike(for: myPost) },
                    onSave: { await viewModel.toggleSave(for: myPost) },
                    onBlock: {},
                    onNotInterested: {},
                    onOwnProfileTap: {},
                    ownRatingActions: OwnRatingMenuActions(
                        onShare: { Task { await prepareShare(score: score) } },
                        onEdit: { openRatingSheet() },
                        onAddToMix: { showMixPicker = true },
                        onEditComment: { showEditCommentSheet = true },
                        onDelete: { showDeleteConfirm = true }
                    ),
                    myScore: viewModel.userScore,
                    onMyScoreChange: { newScore in
                        viewModel.userScore = newScore
                        Task { await viewModel.loadRatings(releaseGroupId: release.id) }
                    },
                    isDraft: isDraft,
                    matchedGeometryNamespace: isDraft ? ratingNamespace : nil
                )
            } else if isDraft {
                // Mid-flow, before the post-shaped row (myPost) has loaded --
                // show just the badge, from the already-known local `score`
                // rather than waiting on that network round trip, so the
                // flower's matchedGeometryEffect morph target exists the
                // instant the drag commits. Once myPost arrives, this swaps
                // for the real FeedCard above, whose own badge carries the
                // same id/namespace, so nothing visibly jumps -- it's a
                // continuation, not a new view.
                HStack {
                    Spacer()
                    ScoreBadge(score: score)
                        .matchedGeometryEffect(id: "scoreBadge", in: ratingNamespace)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 14)
            } else {
                // Rated (score is known from the lightweight ratings fetch)
                // but the post-shaped row hasn't arrived yet.
                HStack {
                    ProgressView().scaleEffect(0.9)
                    Spacer()
                }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: viewModel.myPost?.id)
    }

    // MARK: Tracklist

    private var tracklistSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionLabel("Tracklist")

            ForEach(Array(viewModel.tracks.enumerated()), id: \.element.id) { i, track in
                TrackRow(
                    track: track,
                    existingScore: track.trackId.flatMap { viewModel.trackRatings[$0] },
                    onTap: track.trackId != nil ? { selectedSong = track } : nil,
                    onAdd: track.trackId.map { recordingId in
                        { (score: Double) in
                            Task { await viewModel.rateTrack(recordingId: recordingId, score: score) }
                        }
                    }
                )
                if i < viewModel.tracks.count - 1 {
                    Divider().padding(.leading, 56)
                }
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: Posts

    /// The preview (unlike "View All") only has room for a handful of rows,
    /// so it prioritizes rows with an actual written review -- a comment-less
    /// score-only row is the least useful thing to spend that space on.
    private var commentedPosts: [FeedItem] {
        viewModel.posts.filter { !($0.reviewText?.isEmpty ?? true) }
    }

    private var otherRatingsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("Ratings & Reviews") {
                AlbumAllRatingsView(release: release)
            }

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(commentedPosts.prefix(5).enumerated()), id: \.element.id) { i, item in
                    RatingCommentRow(
                        item: item,
                        isLiked: viewModel.likedPostIds.contains(item.id),
                        likesCount: viewModel.likeCounts[item.id] ?? 0,
                        commentsCount: viewModel.commentCounts[item.id] ?? 0,
                        onLike: { await viewModel.toggleLike(for: item) }
                    )
                    if i < min(5, commentedPosts.count) - 1 {
                        Divider().padding(.leading, 58)
                    }
                }
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: Public Mixes

    private var mixesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("In Public Mixes") {
                AlbumAllMixesView(mixes: viewModel.publicMixes)
            }

            ForEach(Array(viewModel.publicMixes.prefix(5).enumerated()), id: \.element.id) { i, mix in
                MixListRow(mix: mix)
                if i < min(5, viewModel.publicMixes.count) - 1 {
                    Divider().padding(.leading, 52)
                }
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: Helpers

    /// A section label with a trailing "View All" link, shown only when
    /// there's a dedicated destination to see more in.
    @ViewBuilder
    private func sectionHeader<Destination: View>(_ text: LocalizedStringKey, @ViewBuilder destination: () -> Destination) -> some View {
        HStack {
            Text(text)
                .font(.jakarta(11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .tracking(0.6)
            Spacer()
            NavigationLink(destination: destination()) {
                Text("View All")
                    .font(.jakarta(12, weight: .semibold))
                    .foregroundStyle(Color.sjBlue)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 12)
    }

    private func sectionLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.jakarta(11, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .textCase(.uppercase)
            .tracking(0.6)
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)
    }
}

// MARK: - Mix row (shared by the album page's preview list and its "View All")

private struct MixRowContent: View {
    let mix: AlbumPublicMix

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "music.note.list")
                .font(.jakarta(16))
                .foregroundStyle(Color.sjBlue)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(mix.name)
                    .font(.jakarta(14, weight: .medium))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(mix.authorHandle)
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.jakarta(12))
                .foregroundStyle(Color.sjMuted)
        }
        .padding(.vertical, 11)
        .padding(.horizontal, 20)
    }
}

private struct MixListRow: View {
    let mix: AlbumPublicMix

    var body: some View {
        Group {
            if let authorId = mix.authorId {
                // Direct destination, not NavigationLink(value:) -- this view is
                // pushed from several different NavigationStacks, so a registered
                // navigationDestination(for: Mix.self) can't be relied on here.
                NavigationLink(destination: MixDetailView(mix: Mix(
                    id: mix.id,
                    userId: authorId,
                    name: mix.name,
                    isPublic: true,
                    isDefault: mix.isDefault,
                    createdAt: mix.createdAt,
                    description: mix.description
                ))) {
                    MixRowContent(mix: mix)
                }
                .buttonStyle(.plain)
            } else {
                MixRowContent(mix: mix)
            }
        }
    }
}

// MARK: - Rating comment row

/// A flat, comment-style row for "Ratings & Reviews" -- avatar/handle/time,
/// score, review text, like + reply affordances -- used in place of the
/// full `FeedCard` on the album page and its "View All" screen, where
/// repeating the album's own cover/title/artist on every row would be pure
/// redundant chrome. Self-contained like `FeedCard`: owns its own comment
/// sheet presentation rather than the parent managing it.
struct RatingCommentRow: View {
    let item: FeedItem
    let isLiked: Bool
    let likesCount: Int
    let commentsCount: Int
    let onLike: () async -> Void

    @State private var showComments = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.circle.fill")
                .font(.jakarta(28))
                .foregroundStyle(Color(uiColor: .systemGray3))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("@" + (item.profiles?.handle ?? String(localized: "someone")))
                        .font(.jakarta(13, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    if item.profiles?.isVerified == true {
                        VerifiedBadgeView()
                            .frame(width: 12, height: 12)
                    }
                    Text("·")
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjBorder)
                    Text(item.createdAt.relativeTimeString)
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjMuted)
                    Spacer(minLength: 0)
                    if let score = item.score {
                        ScoreBadge(score: score, badgeSize: 24, ringStroke: 1.5, ringGap: 1)
                    }
                }

                if let text = item.reviewText, !text.isEmpty {
                    Text(text)
                        .font(.jakarta(14))
                        .foregroundStyle(Color.sjInk)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 16) {
                    Button {
                        Task { await onLike() }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: isLiked ? "heart.fill" : "heart")
                                .foregroundStyle(isLiked ? .red : Color.sjMuted)
                            if likesCount > 0 {
                                Text("\(likesCount)").foregroundStyle(Color.sjMuted)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.jakarta(13, weight: .medium))
                    .animation(.easeInOut(duration: 0.15), value: isLiked)
                    .accessibilityLabel(isLiked ? String(localized: "Unlike") : String(localized: "Like"))

                    Button {
                        showComments = true
                    } label: {
                        Text(commentsCount > 0 ? "\(commentsCount) repl\(commentsCount == 1 ? "y" : "ies")" : "Reply")
                            .foregroundStyle(Color.sjMuted)
                    }
                    .buttonStyle(.plain)
                    .font(.jakarta(13, weight: .medium))
                }
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .sheet(isPresented: $showComments) {
            CommentSheetView(ratingId: item.id)
        }
    }
}

// MARK: - View All: public mixes

struct AlbumAllMixesView: View {
    let mixes: [AlbumPublicMix]

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(Array(mixes.enumerated()), id: \.element.id) { i, mix in
                    MixListRow(mix: mix)
                    if i < mixes.count - 1 {
                        Divider().padding(.leading, 52)
                    }
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Public Mixes")
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - View All: other users' ratings

@Observable
private class AlbumRatingsListViewModel {
    var posts: [FeedItem] = []
    var likedPostIds: Set<UUID> = []
    var savedReleaseIds: Set<UUID> = []
    var likeCounts: [UUID: Int] = [:]
    var commentCounts: [UUID: Int] = [:]
    var isLoading = true
    // The viewer's own rating of this release -- every post here is about the
    // same release_group_id, so unlike Home's feed this is a single value, not
    // a per-item map. Without it every post's cover button showed the unrated
    // flower even when the viewer had already rated this exact album.
    var myScore: Double? = nil

    var currentUserId: UUID? { supabase.auth.currentUser?.id }

    func load(releaseGroupId: UUID) async {
        let myId = currentUserId
        var query = supabase
            .from("ratings")
            .select(AlbumDetailViewModel.postsSelect)
            .eq("release_group_id", value: releaseGroupId)
        if let myId { query = query.neq("user_id", value: myId) }
        async let postsTask: [FeedItem] = (try? await query
            .order("created_at", ascending: false)
            .limit(200)
            .execute()
            .value) ?? []
        async let myScoreTask: Double? = {
            guard let myId else { return nil }
            struct R: Decodable { let score: Double? }
            let r: R? = try? await supabase
                .from("ratings").select("score")
                .eq("user_id", value: myId)
                .eq("release_group_id", value: releaseGroupId)
                .single().execute().value
            return r?.score
        }()
        (posts, myScore) = await (postsTask, myScoreTask)

        if !posts.isEmpty {
            async let countsTask = AlbumSocial.loadCounts(for: posts)
            async let mineTask: AlbumSocial.MyState? = {
                guard let myId else { return nil }
                return await AlbumSocial.loadMyLikesAndSaves(posts: posts, userId: myId)
            }()
            let counts = await countsTask
            for (k, v) in counts.likeCounts { likeCounts[k] = v }
            for (k, v) in counts.commentCounts { commentCounts[k] = v }
            if let mine = await mineTask {
                likedPostIds.formUnion(mine.likedPostIds)
                savedReleaseIds.formUnion(mine.savedReleaseIds)
            }
        }
        isLoading = false
    }

    func toggleLike(for item: FeedItem) async {
        let result = await AlbumSocial.toggleLike(item: item, likedPostIds: likedPostIds, likeCounts: likeCounts)
        likedPostIds = result.likedPostIds
        likeCounts = result.likeCounts
    }

    func toggleSave(for item: FeedItem) async {
        let result = await AlbumSocial.toggleSave(item: item, savedReleaseIds: savedReleaseIds)
        savedReleaseIds = result.savedReleaseIds
    }

    func blockUser(userId: UUID) async {
        await AlbumSocial.blockUser(userId: userId)
        posts.removeAll { $0.userId == userId }
    }
}

struct AlbumAllRatingsView: View {
    let release: Release
    @State private var vm = AlbumRatingsListViewModel()

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if vm.posts.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.jakarta(44)).foregroundStyle(Color.sjBorder)
                    Text("No ratings from other users yet.")
                        .font(.jakarta(15)).foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(vm.posts.enumerated()), id: \.element.id) { i, item in
                            RatingCommentRow(
                                item: item,
                                isLiked: vm.likedPostIds.contains(item.id),
                                likesCount: vm.likeCounts[item.id] ?? 0,
                                commentsCount: vm.commentCounts[item.id] ?? 0,
                                onLike: { await vm.toggleLike(for: item) }
                            )
                            if i < vm.posts.count - 1 {
                                Divider().padding(.leading, 58)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Ratings & Reviews")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load(releaseGroupId: release.id) }
    }
}

// MARK: - Track Row

private struct TrackRow: View {
    let track: TrackEntry
    var existingScore: Double? = nil
    var onTap: (() -> Void)? = nil
    // Takes the drag-committed score directly -- MorphingRateButton, not a
    // plain tap-to-open-sheet button (see body).
    var onAdd: ((Double) -> Void)? = nil

    @State private var didMarkNotInterested = false

    private var formattedDuration: String {
        guard let ms = track.durationMs, ms > 0 else { return "" }
        let s = ms / 1000
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private func scoreLabel(_ s: Double) -> String {
        s.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(s))" : String(format: "%.1f", s)
    }

    var body: some View {
        HStack(spacing: 10) {
            Text("\(track.position)")
                .font(.jakarta(13)).foregroundStyle(Color.sjMuted)
                .frame(width: 24, alignment: .trailing)

            if let onTap {
                Button(action: onTap) {
                    Text(track.title)
                        .font(.jakarta(14)).foregroundStyle(Color.sjInk).lineLimit(1)
                }
                .buttonStyle(.plain)
            } else {
                Text(track.title)
                    .font(.jakarta(14)).foregroundStyle(Color.sjInk).lineLimit(1)
            }

            Spacer()
            if !formattedDuration.isEmpty {
                Text(formattedDuration)
                    .font(.jakarta(12)).foregroundStyle(Color.sjMuted)
            }
            if let score = existingScore {
                Text(scoreLabel(score))
                    .font(.jakarta(11, weight: .bold)).foregroundStyle(Color.sjBlue)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.sjBlue.opacity(0.1)).clipShape(RoundedRectangle(cornerRadius: 4))
            } else if let onAdd {
                MorphingRateButton(
                    idleLabel: {
                        Image(systemName: "plus")
                            .font(.jakarta(11, weight: .bold)).foregroundStyle(Color.sjBlue)
                            .frame(width: 26, height: 26)
                    },
                    idleShape: AnyShape(Circle()),
                    idleTintOpacity: 0.35,
                    accessibilityLabelText: String(format: String(localized: "Rate %@"), track.title),
                    onRate: onAdd
                )
            }
        }
        .padding(.vertical, 11).padding(.horizontal, 20)
        .contextMenu {
            if let recordingId = track.trackId {
                Button {
                    Task {
                        if await NotInterested.markSong(recordingId: recordingId) {
                            didMarkNotInterested.toggle()
                        }
                    }
                } label: {
                    Label("Not Interested", systemImage: "hand.thumbsdown")
                }
            }
        }
        .sensoryFeedback(.success, trigger: didMarkNotInterested)
    }
}

// MARK: - Track Rating Sheet

struct TrackRatingSheet: View {
    let track: TrackEntry
    let release: Release
    let existingScore: Double?
    let onSave: (TrackEntry, Double?) -> Void

    // nil until the user actually drags -- shows the neutral flower glyph
    // rather than defaulting to a misleading pre-filled 2.5.
    @State private var draftScore: Double?
    @Environment(\.dismiss) private var dismiss

    init(track: TrackEntry, release: Release, existingScore: Double?,
         onSave: @escaping (TrackEntry, Double?) -> Void) {
        self.track = track
        self.release = release
        self.existingScore = existingScore
        self.onSave = onSave
        self._draftScore = State(initialValue: existingScore)
    }

    // Deliberately minimal -- just the drag-to-rate flower, no cover/title/
    // artist recap and no separate score readout (the flower shows its own
    // live/resting number).
    var body: some View {
        VStack(spacing: 20) {
            Spacer(minLength: 0)

            // NOTE: hardcoded to 0.5 -- unlike ManualRatingSheet, this sheet has
            // never threaded the user's manual_rating_step precision setting
            // through (pre-existing gap, not introduced by this change).
            FlowerRateControl(
                onRate: { draftScore = $0 },
                size: 90,
                currentScore: draftScore,
                accessibilityLabelText: "Rate \(track.title)",
                ratingStep: 0.5,
                onDelete: existingScore != nil ? { onSave(track, nil); dismiss() } : nil
            )

            VStack(spacing: 8) {
                Button {
                    guard let score = draftScore else { return }
                    onSave(track, score)
                    dismiss()
                } label: {
                    Text("Save Rating")
                        .font(.jakarta(16, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(Color.sjBlue).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .disabled(draftScore == nil)
                .opacity(draftScore == nil ? 0.4 : 1)
                if existingScore != nil {
                    Button("Remove Rating") { onSave(track, nil); dismiss() }
                        .font(.jakarta(13)).foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.horizontal, 20)

            Spacer(minLength: 0)
        }
        .padding(.vertical, 24)
        .presentationBackground(Color.sjCream)
        .presentationDetents([.fraction(0.33)])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Song rating post (other users' track ratings)

/// Mirrors `FeedItem`'s shape but for `track_ratings` -- one other user's
/// rating/review of a specific track, joined to their profile. Kept
/// separate from `SongRatingRow` (which is used for the *viewer's own*
/// track rating and has no userId/profile fields) the same way the album
/// side keeps `FeedItem` separate from the plain rating row types.
struct SongRatingPost: Identifiable {
    let id: UUID
    let userId: UUID
    let score: Double?
    let reviewText: String?
    let createdAt: Date
    // Filled in by a separate `profiles` lookup after the initial fetch --
    // `track_ratings.user_id` references `auth.users`, not `profiles`
    // directly (unlike `track_rating_likes`/`track_rating_comments`, which
    // do), so there's no FK for PostgREST to embed a `profiles!...fkey(...)`
    // join through in one query.
    var profiles: FeedProfile?
}

/// Flat comment-style row for a `SongRatingPost` -- the song-page analog of
/// `RatingCommentRow`, targeting `track_rating_likes`/`track_rating_comments`
/// and opening `SongCommentSheetView` instead of `CommentSheetView`. Built as
/// a literal parallel type rather than a shared generic, matching this
/// codebase's existing convention for album/song pairs (`CommentSheetView`/
/// `SongCommentSheetView`, `ProfilePostCard`/`ProfileSongPostCard`, etc.).
struct SongRatingCommentRow: View {
    let item: SongRatingPost
    let isLiked: Bool
    let likesCount: Int
    let commentsCount: Int
    let onLike: () async -> Void

    @State private var showComments = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.circle.fill")
                .font(.jakarta(28))
                .foregroundStyle(Color(uiColor: .systemGray3))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("@" + (item.profiles?.handle ?? String(localized: "someone")))
                        .font(.jakarta(13, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    if item.profiles?.isVerified == true {
                        VerifiedBadgeView()
                            .frame(width: 12, height: 12)
                    }
                    Text("·")
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjBorder)
                    Text(item.createdAt.relativeTimeString)
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjMuted)
                    Spacer(minLength: 0)
                    if let score = item.score {
                        ScoreBadge(score: score, badgeSize: 24, ringStroke: 1.5, ringGap: 1)
                    }
                }

                if let text = item.reviewText, !text.isEmpty {
                    Text(text)
                        .font(.jakarta(14))
                        .foregroundStyle(Color.sjInk)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 16) {
                    Button {
                        Task { await onLike() }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: isLiked ? "heart.fill" : "heart")
                                .foregroundStyle(isLiked ? .red : Color.sjMuted)
                            if likesCount > 0 {
                                Text("\(likesCount)").foregroundStyle(Color.sjMuted)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.jakarta(13, weight: .medium))
                    .animation(.easeInOut(duration: 0.15), value: isLiked)
                    .accessibilityLabel(isLiked ? String(localized: "Unlike") : String(localized: "Like"))

                    Button {
                        showComments = true
                    } label: {
                        Text(commentsCount > 0 ? "\(commentsCount) repl\(commentsCount == 1 ? "y" : "ies")" : "Reply")
                            .foregroundStyle(Color.sjMuted)
                    }
                    .buttonStyle(.plain)
                    .font(.jakarta(13, weight: .medium))
                }
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .sheet(isPresented: $showComments) {
            SongCommentSheetView(trackRatingId: item.id)
        }
    }
}

// MARK: - Song Detail View

struct SongDetailView: View {
    let track: TrackEntry
    let release: Release

    @State private var communityAvg: Double? = nil
    @State private var communityCount: Int = 0
    @State private var userScore: Double? = nil
    @State private var isLoaded = false
    @State private var showRatingSheet = false
    // Own rating in post-card shape (same card the profile's Songs tab uses),
    // plus the social state that card renders.
    @State private var myRow: SongRatingRow? = nil
    @State private var myRowLikes = 0
    @State private var myRowComments = 0
    @State private var myRowLiked = false
    @State private var myHandle: String? = nil
    @State private var myVerified = false
    @State private var showEditCommentSheet = false
    @State private var showDeleteConfirm = false
    @State private var showMixPicker = false
    @State private var isPreparingShare = false
    @State private var pendingShare: PendingShare? = nil

    // Other users' ratings for this track ("Ratings & Reviews"), same shape
    // of state AlbumDetailViewModel keeps for its own `posts`.
    @State private var otherPosts: [SongRatingPost] = []
    @State private var otherLikedIds: Set<UUID> = []
    @State private var otherLikeCounts: [UUID: Int] = [:]
    @State private var otherCommentCounts: [UUID: Int] = [:]

    private var durationString: String {
        guard let ms = track.durationMs, ms > 0 else { return "" }
        let s = ms / 1000
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private var shareScore: Double? { myRow?.score }

    /// Mirrors AlbumDetailView's own `prepareShare` -- resolves the real data
    /// the share card needs, then opens the same preview sheet.
    private func prepareShare() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        isPreparingShare = true
        defer { isPreparingShare = false }

        struct ProfileRow: Decodable { let username: String? }
        let profile: ProfileRow? = try? await supabase
            .from("profiles").select("username")
            .eq("id", value: userId).single().execute().value

        let coverImage: UIImage? = await {
            guard let coverUrl = release.coverUrl, let url = URL(string: coverUrl) else { return nil }
            return try? await InstagramShare.downloadImage(from: url)
        }()

        pendingShare = PendingShare(
            username: profile?.username ?? "someone",
            coverImages: [coverImage],
            title: track.title,
            subtitle: "Song · " + release.displayArtist,
            score: shareScore,
            reviewText: nil
        )
    }

    var body: some View {
        // See AlbumDetailView.body -- same reasoning for the GeometryReader.
        GeometryReader { proxy in
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                songHero(topInset: proxy.safeAreaInsets.top)
                Divider().padding(.horizontal, 20)
                ratingSection
                if !commentedSongPosts.isEmpty {
                    Divider().padding(.horizontal, 20)
                    otherSongRatingsSection
                }
                Divider().padding(.horizontal, 20)
                appearsOnSection
            }
            .padding(.bottom, 40)
        }
        .ignoresSafeArea(edges: .top)
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(track.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            if let trackId = track.trackId {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: URL(string: "https://sillajuku.com/song/\(trackId)")!) {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }
        }
        .sheet(isPresented: $showMixPicker) {
            if let trackId = track.trackId {
                SongMixPickerView(recordingId: trackId, releaseGroupId: release.id, songTitle: track.title)
            }
        }
        .sheet(item: $pendingShare) { pending in
            SharePreviewSheet(pending: pending)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .task {
            guard !isLoaded else { return }
            isLoaded = true
            await loadStats()
            await loadOtherRatings()
        }
        .sheet(isPresented: $showRatingSheet) {
            TrackRatingSheet(track: track, release: release, existingScore: userScore) { _, score in
                userScore = score
                Task { await loadMyRow() }
            }
        }
        .sheet(isPresented: $showEditCommentSheet) {
            // Comment-only edit; the header names the track being commented on.
            CommentEditSheet(
                release: release,
                trackTitle: track.title,
                initialComment: myRow?.reviewText ?? ""
            ) { text in
                Task {
                    await updateTrackReviewText(text)
                    showEditCommentSheet = false
                }
            }
            .presentationBackground(Color.sjCream)
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .confirmationDialog(
            "Delete Rating?",
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) { Task { await deleteTrackRating() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Your rating for this track will be removed.")
        }
    }

    private func songHero(topInset: CGFloat) -> some View {
        ZStack(alignment: .top) {
            HeroBlurredBackground(coverUrl: release.coverUrl, height: 260 + topInset)

            VStack(spacing: 10) {
                ZStack(alignment: .bottomTrailing) {
                    CoverImage(url: release.coverUrl, cornerRadius: 12)
                        .frame(width: 128, height: 128)
                        .shadow(color: .black.opacity(0.25), radius: 16, y: 8)
                        .accessibilityHidden(true) // track title text below already describes it

                    if supabase.auth.currentUser?.id != nil {
                        SongRateButton(
                            track: track,
                            release: release,
                            externalScore: $userScore,
                            onScoreChange: { _ in Task { await loadStats() } },
                            size: 32
                        )
                        .offset(x: 5, y: 5)
                    }
                }

                VStack(spacing: 6) {
                    Text(String(format: String(localized: "Track %d"), track.position))
                        .font(.jakarta(11, weight: .semibold))
                        .foregroundStyle(Color.sjMuted)
                        .textCase(.uppercase)
                        .tracking(0.5)
                    Text(track.title)
                        .font(.jakarta(20, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    NavigationLink(value: ArtistDestination(artistId: nil, name: release.displayArtist)) {
                        Text(release.displayArtist)
                            .font(.jakarta(14))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)

                    HStack(spacing: 6) {
                        Text("Song")
                            .font(.jakarta(11, weight: .semibold))
                            .foregroundStyle(Color.sjAmber)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.sjAmber.opacity(0.12)).clipShape(Capsule())
                        if !durationString.isEmpty {
                            Text(durationString)
                                .font(.jakarta(11, weight: .semibold))
                                .foregroundStyle(Color.sjMuted)
                                .padding(.horizontal, 8).padding(.vertical, 3)
                                .background(Color.sjMuted.opacity(0.1)).clipShape(Capsule())
                        }
                    }
                    .padding(.top, 2)

                    if communityCount > 0 {
                        HStack(spacing: 6) {
                            Image("icon-flower")
                                .renderingMode(.template).resizable().scaledToFit()
                                .frame(width: 11, height: 11).foregroundStyle(Color.sjBlue)
                            Text(communityAvg.map {
                                $0.truncatingRemainder(dividingBy: 1) == 0
                                    ? "\(Int($0))" : String(format: "%.2f", $0)
                            } ?? "—")
                                .font(.jakarta(13, weight: .bold)).foregroundStyle(Color.sjInk)
                            Text("·").font(.jakarta(12)).foregroundStyle(Color.sjBorder)
                            Text(communityCount == 1 ? "1 rating" : "\(communityCount) ratings")
                                .font(.jakarta(13)).foregroundStyle(Color.sjMuted)
                        }
                        .padding(.top, 6)
                    }
                }
            }
            .padding(.top, 20 + topInset)
            .padding(.bottom, 16)
            .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity)
        .overlay(alignment: .topTrailing) {
            if track.trackId != nil {
                Button { showMixPicker = true } label: {
                    Image(systemName: "bookmark")
                        .font(.jakarta(16, weight: .medium))
                        .foregroundStyle(Color.sjInk)
                        .padding(10)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(.plain)
                .padding(.top, 12 + topInset)
                .padding(.trailing, 16)
                .accessibilityLabel(String(localized: "Add to Mix"))
            }
        }
    }

    private var ratingSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("YOUR RATING")
                .font(.jakarta(11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(0.8)
            if let myRow {
                // Own rating as the regular song post card (same one the profile's
                // Songs tab renders), with the rated-state actions in its ⋯ menu.
                ProfileSongPostCard(
                    song: myRow,
                    likesCount: myRowLikes,
                    commentsCount: myRowComments,
                    isLiked: myRowLiked,
                    onLike: { await toggleMyRowLike() },
                    ownActions: SongOwnRatingMenuActions(
                        onShare: { Task { await prepareShare() } },
                        onEdit: { showRatingSheet = true },
                        onEditComment: { showEditCommentSheet = true },
                        onDelete: { showDeleteConfirm = true }
                    ),
                    headerHandle: myHandle,
                    headerVerified: myVerified
                )
            } else {
                Button {
                    showRatingSheet = true
                } label: {
                    Text("Rate this track")
                        .font(.jakarta(14, weight: .semibold))
                        .foregroundStyle(Color.sjCream)
                        .frame(maxWidth: .infinity).frame(height: 42)
                        .background(Color.sjBlue)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }

    /// The song-page analog of `AlbumDetailView.otherRatingsSection` -- net
    /// new, since the song page previously had no way to see other users'
    /// track reviews at all (only the aggregate community stats above).
    /// Same reasoning as AlbumDetailView.commentedPosts -- the preview only
    /// has room for a handful of rows, so it prioritizes actual written
    /// reviews over comment-less score-only rows.
    private var commentedSongPosts: [SongRatingPost] {
        otherPosts.filter { !($0.reviewText?.isEmpty ?? true) }
    }

    private var otherSongRatingsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("RATINGS & REVIEWS")
                    .font(.jakarta(11, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
                    .tracking(0.8)
                Spacer()
                if otherPosts.count > 5, let recordingId = track.trackId {
                    NavigationLink(destination: SongAllRatingsView(recordingId: recordingId, release: release)) {
                        Text("View All")
                            .font(.jakarta(12, weight: .semibold))
                            .foregroundStyle(Color.sjBlue)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)

            ForEach(Array(commentedSongPosts.prefix(5).enumerated()), id: \.element.id) { i, item in
                SongRatingCommentRow(
                    item: item,
                    isLiked: otherLikedIds.contains(item.id),
                    likesCount: otherLikeCounts[item.id] ?? 0,
                    commentsCount: otherCommentCounts[item.id] ?? 0,
                    onLike: { await toggleOtherLike(item) }
                )
                if i < min(5, commentedSongPosts.count) - 1 {
                    Divider().padding(.leading, 58)
                }
            }
        }
        .padding(.vertical, 20)
    }

    private var appearsOnSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("APPEARS ON")
                .font(.jakarta(11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(0.8)
            NavigationLink(value: release) {
                HStack(spacing: 12) {
                    CoverImage(url: release.coverUrl, cornerRadius: 6)
                        .frame(width: 44, height: 44)
                        .accessibilityHidden(true) // title/artist text alongside already describes it

                    VStack(alignment: .leading, spacing: 2) {
                        Text(release.displayTitle)
                            .font(.jakarta(14, weight: .semibold))
                            .foregroundStyle(Color.sjInk).lineLimit(1)
                        Text(release.artist)
                            .font(.jakarta(12))
                            .foregroundStyle(Color.sjMuted).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.jakarta(12)).foregroundStyle(Color.sjMuted)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }

    private func loadStats() async {
        guard let recordingId = track.trackId else { return }
        struct ScoreRow: Decodable { let score: Double? }
        let allRows: [ScoreRow] = (try? await supabase
            .from("track_ratings").select("score")
            .eq("recording_id", value: recordingId)
            .execute().value) ?? []
        let scores = allRows.compactMap(\.score)
        communityCount = scores.count
        communityAvg = scores.isEmpty ? nil : scores.reduce(0, +) / Double(scores.count)

        await loadMyRow()
    }

    /// Fetches the user's own track_ratings row in full and rebuilds the
    /// post-card state from it. Also called after rating/comment/delete
    /// actions so the card always reflects what's stored.
    private func loadMyRow() async {
        guard let recordingId = track.trackId,
              let userId = supabase.auth.currentUser?.id else { return }
        struct OwnRow: Decodable {
            let id: UUID
            let score: Double?
            let reviewText: String?
            let createdAt: Date
            enum CodingKeys: String, CodingKey {
                case id, score
                case reviewText = "review_text"
                case createdAt = "created_at"
            }
        }
        let rows: [OwnRow] = (try? await supabase
            .from("track_ratings")
            .select("id, score, review_text, created_at")
            .eq("user_id", value: userId)
            .eq("recording_id", value: recordingId)
            .limit(1)
            .execute()
            .value) ?? []
        guard let own = rows.first else {
            myRow = nil
            userScore = nil
            return
        }
        userScore = own.score
        myRow = SongRatingRow(
            ratingId: own.id,
            recordingId: recordingId,
            score: own.score,
            reviewText: own.reviewText,
            trackTitle: track.title,
            release: ReleaseRef(
                id: release.id, title: release.title, artist: release.artist,
                coverUrl: release.coverUrl, releaseType: release.releaseType,
                titleNative: release.titleNative,
                primaryArtist: NativeArtistRef(nameNative: release.artistNative)
            ),
            createdAt: own.createdAt
        )

        // Social state for the card.
        struct CountRow: Decodable {
            let userId: UUID?
            enum CodingKeys: String, CodingKey { case userId = "user_id" }
        }
        let likeRows: [CountRow] = (try? await supabase
            .from("track_rating_likes").select("user_id")
            .eq("track_rating_id", value: own.id)
            .execute().value) ?? []
        myRowLikes = likeRows.count
        myRowLiked = likeRows.contains { $0.userId == userId }
        let commentResp = try? await supabase
            .from("track_rating_comments").select("id", head: true, count: .exact)
            .eq("track_rating_id", value: own.id)
            .execute()
        myRowComments = commentResp?.count ?? 0

        // Header identity for the post card (fetch once).
        if myHandle == nil {
            struct MyProfile: Decodable {
                let username: String?
                let isVerified: Bool?
                enum CodingKeys: String, CodingKey { case username; case isVerified = "is_verified" }
            }
            if let p: MyProfile = try? await supabase.from("profiles")
                .select("username, is_verified").eq("id", value: userId)
                .single().execute().value {
                myHandle = p.username
                myVerified = p.isVerified == true
            }
        }
    }

    private func toggleMyRowLike() async {
        guard let myRow, let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = myRowLiked
        myRowLiked.toggle()
        myRowLikes += wasLiked ? -1 : 1
        do {
            if wasLiked {
                try await supabase.from("track_rating_likes").delete()
                    .eq("user_id", value: userId).eq("track_rating_id", value: myRow.ratingId).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let trackRatingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case trackRatingId = "track_rating_id"
                    }
                }
                try await supabase.from("track_rating_likes")
                    .insert(Payload(userId: userId, trackRatingId: myRow.ratingId)).execute()
            }
        } catch {
            myRowLiked = wasLiked
            myRowLikes += wasLiked ? 1 : -1
        }
    }

    // MARK: Other users' ratings ("Ratings & Reviews")

    private func loadOtherRatings() async {
        guard let recordingId = track.trackId else { return }
        let myId = supabase.auth.currentUser?.id
        struct Row: Decodable {
            let id: UUID; let userId: UUID; let score: Double?; let reviewText: String?; let createdAt: Date
            enum CodingKeys: String, CodingKey {
                case id, score
                case userId = "user_id"; case reviewText = "review_text"; case createdAt = "created_at"
            }
        }
        var query = supabase
            .from("track_ratings")
            .select("id, user_id, score, review_text, created_at")
            .eq("recording_id", value: recordingId)
        if let myId { query = query.neq("user_id", value: myId) }
        let rows: [Row] = (try? await query
            .order("created_at", ascending: false)
            .limit(20)
            .execute()
            .value) ?? []

        var posts = rows.map {
            SongRatingPost(id: $0.id, userId: $0.userId, score: $0.score,
                            reviewText: $0.reviewText, createdAt: $0.createdAt, profiles: nil)
        }

        let userIds = Array(Set(rows.map(\.userId).map(\.uuidString)))
        if !userIds.isEmpty {
            struct ProfileRow: Decodable {
                let id: UUID; let username: String?; let displayName: String?
                let isBot: Bool?; let isVerified: Bool?
                enum CodingKeys: String, CodingKey {
                    case id, username
                    case displayName = "display_name"; case isBot = "is_bot"; case isVerified = "is_verified"
                }
            }
            let profileRows: [ProfileRow] = (try? await supabase
                .from("profiles")
                .select("id, username, display_name, is_bot, is_verified")
                .in("id", values: userIds)
                .execute().value) ?? []
            let byId = Dictionary(uniqueKeysWithValues: profileRows.map {
                ($0.id, FeedProfile(username: $0.username, displayName: $0.displayName, isBot: $0.isBot, isVerified: $0.isVerified))
            })
            for i in posts.indices { posts[i].profiles = byId[posts[i].userId] }
        }
        otherPosts = posts
        await loadOtherSocialData()
    }

    private func loadOtherSocialData() async {
        let ratingIds = otherPosts.map(\.id.uuidString)
        guard !ratingIds.isEmpty else { return }
        struct IdRow: Decodable {
            let trackRatingId: UUID
            enum CodingKeys: String, CodingKey { case trackRatingId = "track_rating_id" }
        }
        async let likesTask: [IdRow]? = try? await supabase
            .from("track_rating_likes").select("track_rating_id")
            .in("track_rating_id", values: ratingIds).execute().value
        async let commentsTask: [IdRow]? = try? await supabase
            .from("track_rating_comments").select("track_rating_id")
            .in("track_rating_id", values: ratingIds).execute().value
        if let rows = await likesTask {
            for r in rows { otherLikeCounts[r.trackRatingId, default: 0] += 1 }
        }
        if let rows = await commentsTask {
            for r in rows { otherCommentCounts[r.trackRatingId, default: 0] += 1 }
        }
        if let userId = supabase.auth.currentUser?.id {
            let mineRows: [IdRow] = (try? await supabase
                .from("track_rating_likes").select("track_rating_id")
                .eq("user_id", value: userId)
                .in("track_rating_id", values: ratingIds).execute().value) ?? []
            otherLikedIds = Set(mineRows.map(\.trackRatingId))
        }
    }

    private func toggleOtherLike(_ item: SongRatingPost) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = otherLikedIds.contains(item.id)
        if wasLiked {
            otherLikedIds.remove(item.id)
            otherLikeCounts[item.id] = max(0, (otherLikeCounts[item.id] ?? 1) - 1)
        } else {
            otherLikedIds.insert(item.id)
            otherLikeCounts[item.id] = (otherLikeCounts[item.id] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("track_rating_likes").delete()
                    .eq("user_id", value: userId).eq("track_rating_id", value: item.id).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let trackRatingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case trackRatingId = "track_rating_id"
                    }
                }
                try await supabase.from("track_rating_likes")
                    .insert(Payload(userId: userId, trackRatingId: item.id)).execute()
            }
        } catch {
            if wasLiked {
                otherLikedIds.insert(item.id)
                otherLikeCounts[item.id] = (otherLikeCounts[item.id] ?? 0) + 1
            } else {
                otherLikedIds.remove(item.id)
                otherLikeCounts[item.id] = max(0, (otherLikeCounts[item.id] ?? 1) - 1)
            }
        }
    }

    /// Same explicit-null encode as AlbumDetailViewModel.updateReviewText, so
    /// clearing the comment writes SQL NULL instead of silently omitting the key.
    private func updateTrackReviewText(_ text: String?) async {
        guard let myRow else { return }
        struct Update: Encodable {
            let reviewText: String?
            enum CodingKeys: String, CodingKey { case reviewText = "review_text" }
            func encode(to encoder: Encoder) throws {
                var container = encoder.container(keyedBy: CodingKeys.self)
                if let reviewText { try container.encode(reviewText, forKey: .reviewText) }
                else { try container.encodeNil(forKey: .reviewText) }
            }
        }
        try? await supabase.from("track_ratings")
            .update(Update(reviewText: text))
            .eq("id", value: myRow.ratingId)
            .execute()
        await loadMyRow()
    }

    private func deleteTrackRating() async {
        guard let myRow else { return }
        _ = try? await supabase.from("track_ratings")
            .delete()
            .eq("id", value: myRow.ratingId)
            .execute()
        self.myRow = nil
        userScore = nil
        NotificationCenter.default.post(name: .ratingChanged, object: nil)
        await loadStats()
    }
}

// MARK: - View All: song ratings

/// Song-page analog of `AlbumAllRatingsView` -- the full list of other
/// users' ratings for one track, scoped by `recordingId`.
@Observable
private class SongRatingsListViewModel {
    var isLoading = true
    var posts: [SongRatingPost] = []
    var likedIds: Set<UUID> = []
    var likeCounts: [UUID: Int] = [:]
    var commentCounts: [UUID: Int] = [:]

    func load(recordingId: UUID) async {
        let myId = supabase.auth.currentUser?.id
        struct Row: Decodable {
            let id: UUID; let userId: UUID; let score: Double?; let reviewText: String?; let createdAt: Date
            enum CodingKeys: String, CodingKey {
                case id, score
                case userId = "user_id"; case reviewText = "review_text"; case createdAt = "created_at"
            }
        }
        var query = supabase
            .from("track_ratings")
            .select("id, user_id, score, review_text, created_at")
            .eq("recording_id", value: recordingId)
        if let myId { query = query.neq("user_id", value: myId) }
        let rows: [Row] = (try? await query
            .order("created_at", ascending: false)
            .limit(200)
            .execute().value) ?? []

        var loaded = rows.map {
            SongRatingPost(id: $0.id, userId: $0.userId, score: $0.score,
                            reviewText: $0.reviewText, createdAt: $0.createdAt, profiles: nil)
        }

        let userIds = Array(Set(rows.map(\.userId).map(\.uuidString)))
        if !userIds.isEmpty {
            struct ProfileRow: Decodable {
                let id: UUID; let username: String?; let displayName: String?
                let isBot: Bool?; let isVerified: Bool?
                enum CodingKeys: String, CodingKey {
                    case id, username
                    case displayName = "display_name"; case isBot = "is_bot"; case isVerified = "is_verified"
                }
            }
            let profileRows: [ProfileRow] = (try? await supabase
                .from("profiles")
                .select("id, username, display_name, is_bot, is_verified")
                .in("id", values: userIds)
                .execute().value) ?? []
            let byId = Dictionary(uniqueKeysWithValues: profileRows.map {
                ($0.id, FeedProfile(username: $0.username, displayName: $0.displayName, isBot: $0.isBot, isVerified: $0.isVerified))
            })
            for i in loaded.indices { loaded[i].profiles = byId[loaded[i].userId] }
        }
        posts = loaded
        isLoading = false

        let ratingIds = posts.map(\.id.uuidString)
        guard !ratingIds.isEmpty else { return }
        struct IdRow: Decodable {
            let trackRatingId: UUID
            enum CodingKeys: String, CodingKey { case trackRatingId = "track_rating_id" }
        }
        async let likesTask: [IdRow]? = try? await supabase
            .from("track_rating_likes").select("track_rating_id")
            .in("track_rating_id", values: ratingIds).execute().value
        async let commentsTask: [IdRow]? = try? await supabase
            .from("track_rating_comments").select("track_rating_id")
            .in("track_rating_id", values: ratingIds).execute().value
        if let rows = await likesTask {
            for r in rows { likeCounts[r.trackRatingId, default: 0] += 1 }
        }
        if let rows = await commentsTask {
            for r in rows { commentCounts[r.trackRatingId, default: 0] += 1 }
        }
        if let userId = myId {
            let mineRows: [IdRow] = (try? await supabase
                .from("track_rating_likes").select("track_rating_id")
                .eq("user_id", value: userId)
                .in("track_rating_id", values: ratingIds).execute().value) ?? []
            likedIds = Set(mineRows.map(\.trackRatingId))
        }
    }

    func toggleLike(item: SongRatingPost) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = likedIds.contains(item.id)
        if wasLiked {
            likedIds.remove(item.id)
            likeCounts[item.id] = max(0, (likeCounts[item.id] ?? 1) - 1)
        } else {
            likedIds.insert(item.id)
            likeCounts[item.id] = (likeCounts[item.id] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("track_rating_likes").delete()
                    .eq("user_id", value: userId).eq("track_rating_id", value: item.id).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let trackRatingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case trackRatingId = "track_rating_id"
                    }
                }
                try await supabase.from("track_rating_likes")
                    .insert(Payload(userId: userId, trackRatingId: item.id)).execute()
            }
        } catch {
            if wasLiked {
                likedIds.insert(item.id)
                likeCounts[item.id] = (likeCounts[item.id] ?? 0) + 1
            } else {
                likedIds.remove(item.id)
                likeCounts[item.id] = max(0, (likeCounts[item.id] ?? 1) - 1)
            }
        }
    }
}

struct SongAllRatingsView: View {
    let recordingId: UUID
    let release: Release
    @State private var vm = SongRatingsListViewModel()

    var body: some View {
        Group {
            if vm.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if vm.posts.isEmpty {
                VStack(spacing: 14) {
                    Image(systemName: "bubble.left.and.bubble.right")
                        .font(.jakarta(44)).foregroundStyle(Color.sjBorder)
                    Text("No ratings from other users yet.")
                        .font(.jakarta(15)).foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(vm.posts.enumerated()), id: \.element.id) { i, item in
                            SongRatingCommentRow(
                                item: item,
                                isLiked: vm.likedIds.contains(item.id),
                                likesCount: vm.likeCounts[item.id] ?? 0,
                                commentsCount: vm.commentCounts[item.id] ?? 0,
                                onLike: { await vm.toggleLike(item: item) }
                            )
                            if i < vm.posts.count - 1 {
                                Divider().padding(.leading, 58)
                            }
                        }
                    }
                    .padding(.vertical, 8)
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle("Ratings & Reviews")
        .navigationBarTitleDisplayMode(.inline)
        .task { await vm.load(recordingId: recordingId) }
    }
}

#Preview {
    NavigationStack {
        AlbumDetailView(release: .preview)
    }
}
