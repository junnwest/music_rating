import SwiftUI
import Observation
import Supabase

extension Notification.Name {
    static let ratingChanged     = Notification.Name("com.sillajuku.ratingChanged")
    static let followChanged     = Notification.Name("com.sillajuku.followChanged")
    static let mixLibraryChanged = Notification.Name("com.sillajuku.mixLibraryChanged")
    static let mixShared         = Notification.Name("com.sillajuku.mixShared")
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
    var trackRatings: [UUID: Double] = [:]      // keyed by recordings.id (manual score)
    var eloRatedTrackIds: Set<UUID> = []        // tracks rated via instinct (may have no score yet)
    var communityAvg: Double?
    var communityCount: Int = 0
    var communitySD: Double?
    var userScore: Double?
    var userEloScore: Double?
    var reviewText: String?
    var currentRatingId: UUID?
    var ratingMode = "manual"
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
    var isLoadingInstinctScore = false
    private(set) var releaseGroupId: UUID?

    var currentUserId: UUID? { supabase.auth.currentUser?.id }

    var isRated: Bool { userScore != nil || userEloScore != nil || isLoadingInstinctScore }

    /// Unified display score for either rating mode -- manual stores a plain
    /// score, instinct stores only an Elo rating that must be converted.
    var displayScore: Double? {
        if let s = userScore { return s }
        if let e = userEloScore { return Elo.toScore(e) }
        return nil
    }

    func load(releaseGroupId: UUID) async {
        self.releaseGroupId = releaseGroupId
        isLoading = true

        // These can run immediately in parallel while tracks loads sequentially first
        async let ratingsTask: Void = loadRatings(releaseGroupId: releaseGroupId)
        async let modeTask: Void    = loadRatingMode()
        async let postsTask: Void   = loadPosts(releaseGroupId: releaseGroupId)
        async let mixesTask: Void   = loadPublicMixes(releaseGroupId: releaseGroupId)

        // Track ratings need recording IDs, so tracks must finish first
        await loadTracks(releaseGroupId: releaseGroupId)
        await loadTrackRatings(recordingIds: tracks.compactMap(\.trackId))

        _ = await (ratingsTask, modeTask, postsTask, mixesTask)
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

    func markTrackEloRated(recordingId: UUID) {
        eloRatedTrackIds.insert(recordingId)
    }

    func loadRatings(releaseGroupId: UUID) async {
        struct Row: Decodable {
            let id: UUID
            let score: Double?
            let eloScore: Double?
            let userId: UUID
            let reviewText: String?
            enum CodingKeys: String, CodingKey {
                case id, score; case eloScore = "elo_score"; case userId = "user_id"; case reviewText = "review_text"
            }
        }
        let rows: [Row] = (try? await supabase
            .from("ratings").select("id, score, elo_score, user_id, review_text")
            .eq("release_group_id", value: releaseGroupId).execute().value) ?? []

        communityCount = rows.count
        let scored = rows.compactMap { row -> Double? in
            if let s = row.score { return s }
            if let elo = row.eloScore { return Elo.toScore(elo) }
            return nil
        }
        communityAvg = scored.isEmpty ? nil : scored.reduce(0, +) / Double(scored.count)
        communitySD = Self.spread(of: scored)

        if let userId = supabase.auth.currentUser?.id {
            let mine = rows.first(where: { $0.userId == userId })
            userScore       = mine?.score
            userEloScore    = mine?.eloScore
            currentRatingId = mine?.id
            reviewText      = mine?.reviewText
        }
        isLoadingInstinctScore = false
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

    func deleteInstinctRating() async {
        guard let userId = supabase.auth.currentUser?.id,
              let rgId = releaseGroupId else { return }
        userEloScore = nil
        currentRatingId = nil
        reviewText = nil
        myPost = nil
        _ = try? await supabase.from("ratings")
            .delete()
            .eq("user_id", value: userId)
            .eq("release_group_id", value: rgId)
            .execute()
        NotificationCenter.default.post(name: .ratingChanged, object: nil)
    }

    /// Updates only the review text of the user's existing rating (manual or
    /// instinct) -- used by the unified "Edit" action, which never touches
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

    private func loadRatingMode() async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct P: Decodable {
            let ratingMode: String?
            let ratingStep: Double?
            enum CodingKeys: String, CodingKey {
                case ratingMode = "rating_mode"
                case ratingStep = "manual_rating_step"
            }
        }
        if let p: P = try? await supabase
            .from("profiles").select("rating_mode, manual_rating_step")
            .eq("id", value: userId).single().execute().value {
            ratingMode = p.ratingMode ?? "manual"
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
                userEloScore = nil
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
            let id: UUID; let score: Double?; let eloScore: Double?; let userId: UUID; let reviewText: String?
            enum CodingKeys: String, CodingKey {
                case id, score; case eloScore = "elo_score"; case userId = "user_id"; case reviewText = "review_text"
            }
        }
        let rows: [Row] = (try? await supabase
            .from("ratings").select("id, score, elo_score, user_id, review_text")
            .eq("release_group_id", value: releaseGroupId).execute().value) ?? []
        communityCount = rows.count
        let scored = rows.compactMap { row -> Double? in
            if let s = row.score { return s }
            if let elo = row.eloScore { return Elo.toScore(elo) }
            return nil
        }
        communityAvg = scored.isEmpty ? nil : scored.reduce(0, +) / Double(scored.count)
        communitySD = Self.spread(of: scored)
        let mine = rows.first(where: { $0.userId == currentUserId })
        userScore       = mine?.score
        currentRatingId = mine?.id
        reviewText      = mine?.reviewText
    }

    // Not private -- reused by AlbumAllRatingsListViewModel for the "View All" screen.
    static let postsSelect =
        "id, user_id, score, elo_score, review_text, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native)), profiles!ratings_user_id_fkey(username, display_name, is_bot)"

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
        let counts = await AlbumSocial.loadCounts(for: all)
        for (k, v) in counts.likeCounts { likeCounts[k] = v }
        for (k, v) in counts.commentCounts { commentCounts[k] = v }
        guard let userId = currentUserId else { return }
        let mine = await AlbumSocial.loadMyLikesAndSaves(posts: all, userId: userId)
        likedPostIds.formUnion(mine.likedPostIds)
        savedReleaseIds.formUnion(mine.savedReleaseIds)
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
        var result = Counts()
        if let rows: [RatingIdRow] = try? await supabase
            .from("rating_likes").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value {
            for r in rows { result.likeCounts[r.ratingId, default: 0] += 1 }
        }
        if let rows: [RatingIdRow] = try? await supabase
            .from("rating_comments").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value {
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
        var result = MyState()
        if let rows: [RatingIdRow] = try? await supabase
            .from("rating_likes").select("rating_id")
            .eq("user_id", value: userId)
            .in("rating_id", values: ratingIds).execute().value {
            for r in rows { result.likedPostIds.insert(r.ratingId) }
        }
        if let rows: [ReleaseIdRow] = try? await supabase
            .from("saved_releases").select("release_id")
            .eq("user_id", value: userId)
            .in("release_id", values: releaseIds).execute().value {
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
    @State private var draftScore: Double
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
        self._draftScore    = State(initialValue: existingScore.wrappedValue ?? 2.5)
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

    private var ratingView: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            HStack(spacing: 12) {
                CoverImage(url: release.coverUrl, cornerRadius: 8)
                    .frame(width: 52, height: 52)
                    .accessibilityHidden(true) // title/artist text alongside already describes it
                VStack(alignment: .leading, spacing: 2) {
                    Text(release.displayTitle)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.sjInk).lineLimit(1)
                    HStack(spacing: 6) {
                        Text(release.typeLabel)
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjBlue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        Text(release.displayArtist)
                            .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)

            Divider().padding(.vertical, 14)

            Text(scoreLabel)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(Color.sjBlue).monospacedDigit()

            // Drag/tap directly on the flowers (same control as Quick Add); the
            // numeric label above is the precise readout -- at 0.1 steps a tenth
            // of a flower isn't a readable difference.
            HalfStarRow(starSize: 38, spacing: 8, rating: draftScore, step: ratingStep,
                        onLiveChange: { draftScore = $0 }, onRate: { draftScore = $0 })
                .padding(.top, 10)
                .sensoryFeedback(.selection, trigger: draftScore)

            VStack(spacing: 8) {
                Button {
                    let score = draftScore
                    onSave(score)
                    Task { await transitionToPostRating() }
                } label: {
                    Text("Save Rating")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(Color.sjBlue).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                if existingScore != nil {
                    Button("Remove Rating") { onSave(nil); dismiss() }
                        .font(.system(size: 13)).foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.horizontal, 20).padding(.top, 14)

            Spacer(minLength: 0)
        }
        .padding(.vertical, 16)
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

    private var scoreLabel: String {
        draftScore.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(draftScore)) / 5"
            : String(format: "%.1f / 5", draftScore)
    }
}

// MARK: - Album Detail View

struct AlbumDetailView: View {
    let release: Release
    var onRated: ((UUID) -> Void)? = nil

    @State private var viewModel = AlbumDetailViewModel()
    @State private var showManualSheet = false
    @State private var showInstinctSheet = false
    @State private var showMixPicker = false
    @State private var showEditCommentSheet = false
    @State private var showDeleteConfirm = false
    @State private var trackRatingTarget: TrackEntry? = nil
    @State private var trackInstinctTarget: TrackEntry? = nil
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
            coverImage: coverImage,
            title: release.displayTitle,
            typeAndArtist: release.typeLabel + " · " + release.displayArtist,
            score: score,
            reviewText: nil
        )
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                compactHeader
                Divider().padding(.horizontal, 20)
                ratingSection
                if !viewModel.tracks.isEmpty {
                    Divider().padding(.horizontal, 20)
                    tracklistSection
                }
                if !viewModel.posts.isEmpty {
                    Divider().padding(.horizontal, 20)
                    otherRatingsSection
                }
                if !viewModel.publicMixes.isEmpty {
                    Divider().padding(.horizontal, 20)
                    mixesSection
                }
            }
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(release.displayTitle)
        .navigationBarTitleDisplayMode(.inline)
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
        .sheet(isPresented: $showInstinctSheet) {
            InstinctRatingView(release: release, onRated: { id in
                onRated?(id)
                viewModel.isLoadingInstinctScore = true
                Task { await viewModel.loadAfterInstinct(releaseGroupId: release.id) }
            }, onDone: { showInstinctSheet = false })
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
                Task {
                    if viewModel.ratingMode == "instinct" {
                        await viewModel.deleteInstinctRating()
                    } else {
                        await viewModel.setRating(releaseGroupId: release.id, score: nil)
                    }
                }
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
            SongDetailView(track: track, release: release, ratingMode: viewModel.ratingMode)
                .onDisappear { if selectedSong == track { selectedSong = nil } }
        }
        // No Release/ArtistDestination navigationDestination here -- every stack that hosts
        // this view (Home/Rankings/Profile/Search) declares both at its own root. A second
        // declaration for the same type within one NavigationStack causes SwiftUI to
        // double-push (confirmed live: tapping the artist name re-showed the album page).
        .navigationDestination(for: UserProfileDestination.self) { dest in
            UserProfileView(userId: dest.userId, initialHandle: dest.handle)
        }
        .sheet(item: $trackInstinctTarget) { track in
            InstinctTrackRatingView(track: track, release: release) {
                if let id = track.trackId { viewModel.markTrackEloRated(recordingId: id) }
            } onDone: {
                trackInstinctTarget = nil
            }
        }
    }

    // MARK: Compact header

    private var compactHeader: some View {
        HStack(alignment: .top, spacing: 14) {
            CoverImage(url: release.coverUrl, cornerRadius: 12)
                .frame(width: 88, height: 88)
                .accessibilityHidden(true) // title/artist text alongside already describes it

            VStack(alignment: .leading, spacing: 5) {
                Text(release.displayTitle)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                if credits.isEmpty {
                    NavigationLink(value: ArtistDestination(artistId: nil, name: release.displayArtist)) {
                        Text(release.displayArtist)
                            .font(.system(size: 14))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                } else {
                    HStack(spacing: 0) {
                        ForEach(credits) { credit in
                            NavigationLink(value: ArtistDestination(artistId: credit.artistId, name: credit.creditedAs)) {
                                Text(credit.creditedAs)
                                    .font(.system(size: 14))
                                    .foregroundStyle(Color.sjAmber)
                                    .lineLimit(1)
                            }
                            .buttonStyle(.plain)
                            if !credit.joinPhrase.isEmpty {
                                Text(credit.joinPhrase)
                                    .font(.system(size: 14))
                                    .foregroundStyle(Color.sjMuted)
                            }
                        }
                    }
                }
                HStack(spacing: 6) {
                    if let type = release.releaseType {
                        Text(type.lowercased() == "ep" ? "EP" : type.capitalized)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.sjBlue.opacity(0.1)).clipShape(Capsule())
                    }
                    if !releaseYear.isEmpty {
                        Text(releaseYear)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Color.sjMuted.opacity(0.1)).clipShape(Capsule())
                    }
                }
                .padding(.top, 2)
            }
            Spacer(minLength: 0)

            Button { showMixPicker = true } label: {
                Image(systemName: "bookmark")
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(Color.sjMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(localized: "Add to Mix"))
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
    }

    // MARK: Rating section (unified — manual and instinct share one UI, only
    // the "not yet rated" icon/label and which sheet gets opened differ)

    private func openRatingSheet() {
        if viewModel.ratingMode == "instinct" { showInstinctSheet = true }
        else { showManualSheet = true }
    }

    private var ratingSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Community summary at the top, integrated with the section
            // rather than tucked below the user's own rating controls.
            // Three equal columns: average, count, and "Split" (population SD,
            // surfaced as ±X.X -- how divided listeners are; "—" under 3 scores).
            if viewModel.communityCount > 0 {
                HStack(spacing: 10) {
                    communityStatBox(value: viewModel.communityAvg.map { String(format: "%.1f", $0) } ?? "—",
                                     label: "Community Avg", showIcon: true)
                    communityStatBox(value: "\(viewModel.communityCount)",
                                     label: viewModel.communityCount == 1 ? "Rating" : "Ratings", showIcon: false)
                    communityStatBox(value: viewModel.communitySD.map { String(format: "±%.1f", $0) } ?? "—",
                                     label: "Split", showIcon: false)
                }
            }

            Text("Your Rating")
                .font(.system(size: 11, weight: .semibold))
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
            if viewModel.isLoadingInstinctScore {
                HStack {
                    ProgressView().scaleEffect(0.9)
                    Text("Updating ranking…")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjMuted)
                    Spacer()
                }
            } else if let score = viewModel.displayScore {
                ratedBody(score: score)
            } else {
                Button { openRatingSheet() } label: {
                    Label(
                        viewModel.ratingMode == "instinct" ? "Add to Rankings" : "Rate this Album",
                        systemImage: viewModel.ratingMode == "instinct" ? "arrow.up.arrow.down" : "plus"
                    )
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Color.sjBlue)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// The user's own rating rendered as a regular feed post card, with an
    /// ellipsis menu carrying all the rated-state actions (share / edit /
    /// add to mix / edit comment / delete).
    @ViewBuilder
    private func ratedBody(score: Double) -> some View {
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
                onOwnProfileTap: {},
                ownRatingActions: OwnRatingMenuActions(
                    onShare: { Task { await prepareShare(score: score) } },
                    onEdit: { openRatingSheet() },
                    onAddToMix: { showMixPicker = true },
                    onEditComment: { showEditCommentSheet = true },
                    onDelete: { showDeleteConfirm = true }
                )
            )
        } else {
            // Rated (score is known from the lightweight ratings fetch) but the
            // post-shaped row hasn't arrived yet.
            HStack {
                ProgressView().scaleEffect(0.9)
                Spacer()
            }
        }
    }

    private func communityStatBox(value: String, label: LocalizedStringKey, showIcon: Bool) -> some View {
        HStack(spacing: 6) {
            if showIcon {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 12, height: 12).foregroundStyle(Color.sjBlue)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(Color.sjInk)
                Text(label)
                    .font(.system(size: 10)).foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
        // Equal thirds across the row (was intrinsic width when there were two).
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
    }

    // MARK: Tracklist

    private var tracklistSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionLabel("Tracklist")

            ForEach(Array(viewModel.tracks.enumerated()), id: \.element.id) { i, track in
                TrackRow(
                    track: track,
                    existingScore: track.trackId.flatMap { viewModel.trackRatings[$0] },
                    isEloRated: track.trackId.map { viewModel.eloRatedTrackIds.contains($0) } ?? false,
                    onTap: track.trackId != nil ? { selectedSong = track } : nil,
                    onAdd: track.trackId != nil ? {
                        if viewModel.ratingMode == "instinct" { trackInstinctTarget = track }
                        else { trackRatingTarget = track }
                    } : nil
                )
                if i < viewModel.tracks.count - 1 {
                    Divider().padding(.leading, 56)
                }
            }
        }
        .padding(.bottom, 20)
    }

    // MARK: Posts

    private var otherRatingsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("Ratings & Reviews") {
                AlbumAllRatingsView(release: release)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(viewModel.posts) { item in
                        FeedCard(
                            item: item,
                            currentUserId: viewModel.currentUserId,
                            isLiked: viewModel.likedPostIds.contains(item.id),
                            isSaved: viewModel.savedReleaseIds.contains(item.releases.id),
                            likesCount: viewModel.likeCounts[item.id] ?? 0,
                            commentsCount: viewModel.commentCounts[item.id] ?? 0,
                            onLike: { await viewModel.toggleLike(for: item) },
                            onSave: { await viewModel.toggleSave(for: item) },
                            onBlock: { await viewModel.blockUser(userId: item.userId) },
                            onOwnProfileTap: {}
                        )
                        .frame(width: 300)
                    }
                }
                .padding(.horizontal, 20)
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
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .tracking(0.6)
            Spacer()
            NavigationLink(destination: destination()) {
                Text("View All")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.sjBlue)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
        .padding(.bottom, 12)
    }

    private func sectionLabel(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .textCase(.uppercase)
            .tracking(0.6)
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 12)
    }
}

// MARK: - Reload after instinct rating

extension AlbumDetailViewModel {
    func loadAfterInstinct(releaseGroupId: UUID) async {
        await loadRatings(releaseGroupId: releaseGroupId)
        await loadMyPost()
    }
}

// MARK: - Mix row (shared by the album page's preview list and its "View All")

private struct MixRowContent: View {
    let mix: AlbumPublicMix

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "music.note.list")
                .font(.system(size: 16))
                .foregroundStyle(Color.sjBlue)
                .frame(width: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(mix.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(mix.authorHandle)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 12))
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

    var currentUserId: UUID? { supabase.auth.currentUser?.id }

    func load(releaseGroupId: UUID) async {
        let myId = currentUserId
        var query = supabase
            .from("ratings")
            .select(AlbumDetailViewModel.postsSelect)
            .eq("release_group_id", value: releaseGroupId)
        if let myId { query = query.neq("user_id", value: myId) }
        posts = (try? await query
            .order("created_at", ascending: false)
            .limit(200)
            .execute()
            .value) ?? []

        if !posts.isEmpty {
            let counts = await AlbumSocial.loadCounts(for: posts)
            for (k, v) in counts.likeCounts { likeCounts[k] = v }
            for (k, v) in counts.commentCounts { commentCounts[k] = v }
            if let myId {
                let mine = await AlbumSocial.loadMyLikesAndSaves(posts: posts, userId: myId)
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
                        .font(.system(size: 44)).foregroundStyle(Color.sjBorder)
                    Text("No ratings from other users yet.")
                        .font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(vm.posts) { item in
                            FeedCard(
                                item: item,
                                currentUserId: vm.currentUserId,
                                isLiked: vm.likedPostIds.contains(item.id),
                                isSaved: vm.savedReleaseIds.contains(item.releases.id),
                                likesCount: vm.likeCounts[item.id] ?? 0,
                                commentsCount: vm.commentCounts[item.id] ?? 0,
                                onLike: { await vm.toggleLike(for: item) },
                                onSave: { await vm.toggleSave(for: item) },
                                onBlock: { await vm.blockUser(userId: item.userId) },
                                onOwnProfileTap: {}
                            )
                        }
                    }
                    .padding(16)
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
    var isEloRated: Bool = false
    var onTap: (() -> Void)? = nil
    var onAdd: (() -> Void)? = nil

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
                .font(.system(size: 13)).foregroundStyle(Color.sjMuted)
                .frame(width: 24, alignment: .trailing)

            if let onTap {
                Button(action: onTap) {
                    Text(track.title)
                        .font(.system(size: 14)).foregroundStyle(Color.sjInk).lineLimit(1)
                }
                .buttonStyle(.plain)
            } else {
                Text(track.title)
                    .font(.system(size: 14)).foregroundStyle(Color.sjInk).lineLimit(1)
            }

            Spacer()
            if !formattedDuration.isEmpty {
                Text(formattedDuration)
                    .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
            }
            if let score = existingScore {
                Text(scoreLabel(score))
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.sjBlue)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(Color.sjBlue.opacity(0.1)).clipShape(RoundedRectangle(cornerRadius: 4))
            } else if isEloRated {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.sjBlue)
                    .frame(width: 26, height: 26)
                    .background(Color.sjBlue.opacity(0.1)).clipShape(Circle())
            } else if let onAdd {
                Button(action: onAdd) {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Color.sjBlue)
                        .frame(width: 26, height: 26)
                        .background(Color.sjBlue.opacity(0.1)).clipShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(format: String(localized: "Rate %@"), track.title))
            }
        }
        .padding(.vertical, 11).padding(.horizontal, 20)
    }
}

// MARK: - Track Rating Sheet

private struct TrackRatingSheet: View {
    let track: TrackEntry
    let release: Release
    let existingScore: Double?
    let onSave: (TrackEntry, Double?) -> Void

    @State private var draftScore: Double
    @Environment(\.dismiss) private var dismiss

    init(track: TrackEntry, release: Release, existingScore: Double?,
         onSave: @escaping (TrackEntry, Double?) -> Void) {
        self.track = track
        self.release = release
        self.existingScore = existingScore
        self.onSave = onSave
        self._draftScore = State(initialValue: existingScore ?? 2.5)
    }

    private var scoreLabel: String {
        draftScore.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(draftScore)) / 5"
            : String(format: "%.1f / 5", draftScore)
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)

            HStack(spacing: 12) {
                CoverImage(url: release.coverUrl, cornerRadius: 8)
                    .frame(width: 52, height: 52)
                    .accessibilityHidden(true) // track title text alongside already describes it
                VStack(alignment: .leading, spacing: 2) {
                    Text(track.title)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.sjInk).lineLimit(1)
                    HStack(spacing: 6) {
                        Text("Song")
                            .font(.system(size: 10, weight: .medium))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjBlue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        Text(release.displayArtist)
                            .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)

            Divider().padding(.vertical, 14)

            Text(scoreLabel)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(Color.sjBlue).monospacedDigit()

            // Same flower control as the album manual sheet / Quick Add.
            HalfStarRow(starSize: 38, spacing: 8, rating: draftScore,
                        onLiveChange: { draftScore = $0 }, onRate: { draftScore = $0 })
                .padding(.top, 10)
                .sensoryFeedback(.selection, trigger: draftScore)

            VStack(spacing: 8) {
                Button {
                    onSave(track, draftScore)
                    dismiss()
                } label: {
                    Text("Save Rating")
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(Color.sjBlue).clipShape(RoundedRectangle(cornerRadius: 12))
                }
                if existingScore != nil {
                    Button("Remove Rating") { onSave(track, nil); dismiss() }
                        .font(.system(size: 13)).foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.horizontal, 20).padding(.top, 14)

            Spacer(minLength: 0)
        }
        .padding(.vertical, 16)
        .presentationBackground(Color.sjCream)
        .presentationDetents([.fraction(0.33)])
        .presentationDragIndicator(.visible)
    }
}

// MARK: - Song Detail View

struct SongDetailView: View {
    let track: TrackEntry
    let release: Release
    var ratingMode: String = "manual"

    @State private var communityAvg: Double? = nil
    @State private var communityCount: Int = 0
    @State private var userScore: Double? = nil
    @State private var isLoaded = false
    @State private var showRatingSheet = false
    @State private var showInstinctSheet = false
    // Own rating in post-card shape (same card the profile's Songs tab uses),
    // plus the social state that card renders.
    @State private var myRow: SongRatingRow? = nil
    @State private var myRowLikes = 0
    @State private var myRowComments = 0
    @State private var myRowLiked = false
    @State private var totalSongRatingsCount = 0
    @State private var myHandle: String? = nil
    @State private var myVerified = false
    @State private var showEditCommentSheet = false
    @State private var showDeleteConfirm = false
    @State private var showMixPicker = false

    private var durationString: String {
        guard let ms = track.durationMs, ms > 0 else { return "" }
        let s = ms / 1000
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 0) {
                songHeader
                Divider().padding(.horizontal, 20)
                communitySection
                Divider().padding(.horizontal, 20)
                ratingSection
                Divider().padding(.horizontal, 20)
                appearsOnSection
            }
            .padding(.bottom, 40)
        }
        .background(Color.sjCream.ignoresSafeArea())
        .navigationTitle(track.title)
        .navigationBarTitleDisplayMode(.inline)
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
        .task {
            guard !isLoaded else { return }
            isLoaded = true
            await loadStats()
        }
        .sheet(isPresented: $showRatingSheet) {
            TrackRatingSheet(track: track, release: release, existingScore: userScore) { _, score in
                userScore = score
                Task { await loadMyRow() }
            }
        }
        .sheet(isPresented: $showInstinctSheet) {
            InstinctTrackRatingView(track: track, release: release, onDone: {
                showInstinctSheet = false
                Task { await loadMyRow() }
            })
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

    private var songHeader: some View {
        HStack(alignment: .top, spacing: 16) {
            CoverImage(url: release.coverUrl)
                .frame(width: 80, height: 80)
                .accessibilityHidden(true) // track title text alongside already describes it

            VStack(alignment: .leading, spacing: 5) {
                Text(String(format: String(localized: "Track %d"), track.position))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.sjMuted)
                    .textCase(.uppercase)
                    .tracking(0.5)
                Text(track.title)
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(2)
                NavigationLink(value: ArtistDestination(artistId: nil, name: release.displayArtist)) {
                    Text(release.displayArtist)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.sjMuted)
                }
                .buttonStyle(.plain)
                if !durationString.isEmpty {
                    Text(durationString)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                }
            }
            Spacer()

            if track.trackId != nil {
                Button { showMixPicker = true } label: {
                    Image(systemName: "bookmark")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "Add to Mix"))
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }

    private var communitySection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("COMMUNITY")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(0.8)
            HStack(spacing: 32) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(communityAvg.map {
                        $0.truncatingRemainder(dividingBy: 1) == 0
                            ? "\(Int($0))" : String(format: "%.2f", $0)
                    } ?? "—")
                    .font(.system(size: 28, weight: .bold)).foregroundStyle(Color.sjInk)
                    Text("avg score")
                        .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(communityCount)")
                        .font(.system(size: 28, weight: .bold)).foregroundStyle(Color.sjInk)
                    Text(communityCount == 1 ? "rating" : "ratings")
                        .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 20)
    }

    private var ratingSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("YOUR RATING")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(0.8)
            if let myRow {
                // Own rating as the regular song post card (same one the profile's
                // Songs tab renders), with the rated-state actions in its ⋯ menu.
                ProfileSongPostCard(
                    song: myRow,
                    totalSongRatingsCount: totalSongRatingsCount,
                    likesCount: myRowLikes,
                    commentsCount: myRowComments,
                    isLiked: myRowLiked,
                    onLike: { await toggleMyRowLike() },
                    ownActions: SongOwnRatingMenuActions(
                        onEdit: {
                            if ratingMode == "instinct" { showInstinctSheet = true }
                            else { showRatingSheet = true }
                        },
                        onEditComment: { showEditCommentSheet = true },
                        onDelete: { showDeleteConfirm = true }
                    ),
                    headerHandle: myHandle,
                    headerVerified: myVerified
                )
            } else {
                Button {
                    if ratingMode == "instinct" { showInstinctSheet = true }
                    else { showRatingSheet = true }
                } label: {
                    Text("Rate this track")
                        .font(.system(size: 14, weight: .semibold))
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

    private var appearsOnSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("APPEARS ON")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .tracking(0.8)
            NavigationLink(value: release) {
                HStack(spacing: 12) {
                    CoverImage(url: release.coverUrl, cornerRadius: 6)
                        .frame(width: 44, height: 44)
                        .accessibilityHidden(true) // title/artist text alongside already describes it

                    VStack(alignment: .leading, spacing: 2) {
                        Text(release.displayTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.sjInk).lineLimit(1)
                        Text(release.artist)
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjMuted).lineLimit(1)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12)).foregroundStyle(Color.sjMuted)
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
            let eloScore: Double?
            let reviewText: String?
            let createdAt: Date
            enum CodingKeys: String, CodingKey {
                case id, score
                case eloScore = "elo_score"
                case reviewText = "review_text"
                case createdAt = "created_at"
            }
        }
        let rows: [OwnRow] = (try? await supabase
            .from("track_ratings")
            .select("id, score, elo_score, review_text, created_at")
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
            eloScore: own.eloScore,
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

        // Social state for the card + the elo-reveal gate count (mirrors the
        // profile Songs tab's gating -- counts ALL of the user's song ratings).
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
        let totalResp = try? await supabase
            .from("track_ratings").select("id", head: true, count: .exact)
            .eq("user_id", value: userId)
            .execute()
        totalSongRatingsCount = totalResp?.count ?? 0

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

#Preview {
    NavigationStack {
        AlbumDetailView(release: .preview)
    }
}
