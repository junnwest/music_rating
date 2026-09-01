import SwiftUI
import Observation
import Supabase

// MARK: - Models

struct UserRating: Codable, Identifiable {
    let id: UUID
    let score: Double?
    let reviewText: String?
    let createdAt: Date
    let releases: ReleaseRef

    enum CodingKeys: String, CodingKey {
        case id, score
        case releases   = "release_groups"
        case reviewText = "review_text"
        case createdAt  = "created_at"
    }
}

struct SongRatingRow: Identifiable {
    // The track_ratings row's own uuid -- distinct from `id` (String, keyed on recordingId,
    // used throughout for view identity/diffing). This is what track_rating_likes/
    // track_rating_comments/notifications.track_rating_id actually reference.
    let ratingId: UUID
    let recordingId: UUID
    let score: Double?
    let reviewText: String?
    let trackTitle: String?
    let release: ReleaseRef
    let createdAt: Date

    var id: String { recordingId.uuidString }
}

struct ScoreBucket: Identifiable {
    let score: Double
    let count: Int
    var id: Double { score }
}

struct ArtistCount: Identifiable {
    let artist: String
    let count: Int
    var id: String { artist }
}

// Extracted from ProfileViewModel's own computed properties (copied
// verbatim, not reimplemented) so UserProfileViewModel's Stats tab can
// compute the exact same numbers for someone else's ratings without
// duplicating the math. ProfileViewModel's own properties below now just
// delegate here -- output-identical, zero behavior change for the owner's
// own Stats tab.
struct RatingStatsSnapshot {
    let albumCount: Int
    let songCount: Int
    let totalRatings: Int
    let avgScore: Double
    let scoreDistribution: [ScoreBucket]
    let topArtists: [ArtistCount]

    static func compute(ratings: [UserRating], songRatings: [SongRatingRow]) -> RatingStatsSnapshot {
        let albumScores: [Double] = ratings.compactMap(\.score)
        let songScores: [Double] = songRatings.compactMap(\.score)
        let allScores = albumScores + songScores

        let avgScore: Double = allScores.isEmpty ? 0 : allScores.reduce(0, +) / Double(allScores.count)

        var bucketCounts: [Double: Int] = [:]
        for s in allScores {
            let bucket = max(0.5, min(5.0, (s * 2).rounded() / 2))
            bucketCounts[bucket, default: 0] += 1
        }
        let scoreDistribution = stride(from: 0.5, through: 5.0, by: 0.5).map { b in
            ScoreBucket(score: b, count: bucketCounts[b] ?? 0)
        }

        var artistCounts: [String: Int] = [:]
        for r in ratings { artistCounts[r.releases.artist, default: 0] += 1 }
        // Dictionary iteration order is non-deterministic, so ties on count
        // alone re-sort randomly on every recompute (visible as the list
        // "scrambling" between renders) -- artist name is a stable secondary
        // key purely to make repeat calls deterministic, not a meaningful
        // ranking signal on its own.
        let topArtists = artistCounts
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(5)
            .map { ArtistCount(artist: $0.key, count: $0.value) }

        return RatingStatsSnapshot(
            albumCount: ratings.count,
            songCount: songRatings.count,
            totalRatings: ratings.count + songRatings.count,
            avgScore: avgScore,
            scoreDistribution: scoreDistribution,
            topArtists: topArtists
        )
    }
}

struct ReleaseRef: Codable, Identifiable {
    let id: UUID
    let title: String
    let artist: String
    let coverUrl: String?
    let releaseType: String?
    let titleNative: String?
    let primaryArtist: NativeArtistRef?

    enum CodingKeys: String, CodingKey {
        case id, title
        case artist        = "artist_display"
        case coverUrl      = "cover_url"
        case releaseType   = "release_group_type"
        case titleNative   = "native_title"
        case primaryArtist = "artists"
    }

    var artistNative: String? { primaryArtist?.nameNative }
    var displayTitle: String { titleNative?.isPredominantlyHangul == true ? titleNative! : title }
    var displayArtist: String { artistNative?.isPredominantlyHangul == true ? artistNative! : artist }

    var typeLabel: String {
        switch releaseType?.lowercased() {
        case "album":  return String(localized: "Album")
        case "single": return String(localized: "Single")
        case "ep":     return String(localized: "EP")
        default:       return String(localized: "Release")
        }
    }

    var asRelease: Release {
        Release(id: id, title: title, artist: artist, coverUrl: coverUrl,
                releaseType: releaseType, releaseDate: nil, titleNative: titleNative, artistNative: artistNative,
                tracklist: nil, totalTracks: nil)
    }
}

// MARK: - Tab

enum ProfileTab: CaseIterable {
    case rated, lists, stats

    // No separate active/inactive glyph -- Lucide has no filled-icon family the
    // way SF Symbols did, and the tab bar already signals the active tab via
    // color (sjInk vs sjMuted) plus an underline, so a second signal here was
    // redundant once the glyph itself couldn't change weight.
    var icon: String {
        switch self {
        case .rated: return "icon-layout-grid"
        case .lists: return "icon-list-music"
        case .stats: return "icon-bar-chart"
        }
    }

    var label: String {
        switch self {
        case .rated: return String(localized: "Rated")
        case .lists: return String(localized: "Lists")
        case .stats: return String(localized: "Stats")
        }
    }
}

// MARK: - Follow model

struct FollowProfile: Codable, Identifiable {
    let id: UUID
    let username: String?
    let displayName: String?
    let avatarUrl: String?

    enum CodingKeys: String, CodingKey {
        case id, username
        case displayName = "display_name"
        case avatarUrl   = "avatar_url"
    }
}

// MARK: - ViewModel

@Observable
class ProfileViewModel {
    var profile: Profile?
    var ratings: [UserRating] = []
    var songRatings: [SongRatingRow] = []
    var isLoading = true
    private var hasLoaded = false

    // Delegates to RatingStatsSnapshot (shared with UserProfileViewModel's
    // Stats tab) -- output-identical to the previous inline implementation.
    private var statsSnapshot: RatingStatsSnapshot {
        RatingStatsSnapshot.compute(ratings: ratings, songRatings: songRatings)
    }
    // NOT the header's "Rated" count -- `ratings`/`songRatings` are capped at
    // 60 each (see fetchAlbumRatings/fetchSongRatings) to keep the tab fast to
    // open, so this undercounts anyone with more than that. Fine for the Stats
    // tab's distribution/top-artists visuals, which only ever needed a recent
    // sample -- see `ratedTotal` below for the real total.
    var totalRatings: Int { statsSnapshot.totalRatings }
    var avgScore: Double { statsSnapshot.avgScore }
    var scoreDistribution: [ScoreBucket] { statsSnapshot.scoreDistribution }
    var topArtists: [ArtistCount] { statsSnapshot.topArtists }

    // The header stat cell's actual "Rated" number -- a live exact count,
    // not the size of the (60-capped) loaded arrays above. Someone with more
    // than 60 album or song ratings would barely see this move after a
    // delete under the old totalRatings-based display, since the next load
    // just re-fetches the next 60 most-recent rows.
    // nil (not 0) until the fetch resolves -- 0 read as "no ratings yet"
    // during the brief load, which is wrong and confusing for anyone who
    // actually has some. Same reasoning for followingCount/followerCount below.
    var ratedTotal: Int? = nil

    var likeCounts:    [UUID: Int] = [:]
    var commentCounts: [UUID: Int] = [:]
    var likedRatingIds: Set<UUID> = []
    var mixShares: [MixSharePost] = []
    var likedMixShareIds: Set<UUID> = []
    var likedSongRatingIds: Set<UUID> = []

    var followingCount: Int? = nil
    var followerCount:  Int? = nil

    func toggleLike(ratingId: UUID) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = likedRatingIds.contains(ratingId)
        if wasLiked {
            likedRatingIds.remove(ratingId)
            likeCounts[ratingId] = max(0, (likeCounts[ratingId] ?? 1) - 1)
        } else {
            likedRatingIds.insert(ratingId)
            likeCounts[ratingId] = (likeCounts[ratingId] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("rating_likes").delete()
                    .eq("user_id", value: userId).eq("rating_id", value: ratingId).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let ratingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case ratingId = "rating_id"
                    }
                }
                try await supabase.from("rating_likes")
                    .insert(Payload(userId: userId, ratingId: ratingId)).execute()
            }
        } catch {
            if wasLiked { likedRatingIds.insert(ratingId); likeCounts[ratingId] = (likeCounts[ratingId] ?? 0) + 1 }
            else { likedRatingIds.remove(ratingId); likeCounts[ratingId] = max(0, (likeCounts[ratingId] ?? 1) - 1) }
        }
    }

    func deleteRating(_ item: ProfileRatedItem) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        ratedTotal = ratedTotal.map { max(0, $0 - 1) }
        switch item {
        case .album(let r):
            ratings.removeAll { $0.id == r.id }
            _ = try? await supabase.from("ratings").delete().eq("id", value: r.id).execute()
        case .song(let r):
            songRatings.removeAll { $0.recordingId == r.recordingId }
            _ = try? await supabase.from("track_ratings")
                .delete()
                .eq("user_id", value: userId)
                .eq("recording_id", value: r.recordingId)
                .execute()
        }
    }

    func load() async {
        guard !hasLoaded else { return }
        guard let user = supabase.auth.currentUser else { isLoading = false; return }
        hasLoaded = true
        isLoading = true

        // These chains are independent of each other and used to run strictly
        // serially -- a dozen network round-trips before the first pixel,
        // which is why the tab took seconds to open cold. They all start
        // concurrently now, and the page renders as soon as profile + album
        // ratings (the primary content) are in; songs, follows, mix shares
        // and social counts stream in behind it.
        async let profileFetch  = fetchProfile(userId: user.id)
        async let ratingsFetch  = fetchAlbumRatings(userId: user.id)
        async let songsFetch    = fetchSongRatings(userId: user.id)
        async let followsFetch  = fetchFollowCounts(userId: user.id)
        async let sharesFetch   = fetchMixShares(userId: user.id)
        async let ratedTotalFetch = fetchRatedTotal(userId: user.id)

        profile = await profileFetch
        ratings = await ratingsFetch
        isLoading = false
        ImageCache.prefetch(ratings.compactMap { URL(string: $0.releases.coverUrl?.thumbnailUrl ?? "") })

        await loadAlbumRatingSocialData(userId: user.id)

        songRatings = await songsFetch
        ImageCache.prefetch(songRatings.compactMap { URL(string: $0.release.coverUrl?.thumbnailUrl ?? "") })
        if !songRatings.isEmpty { await loadSongRatingSocialData() }

        let follows = await followsFetch
        followingCount = follows.following
        followerCount  = follows.followers
        ratedTotal = await ratedTotalFetch

        mixShares = await HomeViewModel.hydrateCovers(await sharesFetch)
        await loadMixShareSocialData()
    }

    private func fetchProfile(userId: UUID) async -> Profile? {
        try? await supabase
            .from("profiles")
            .select("id, display_name, username, rating_mode, manual_rating_step, bio, avatar_url, notify_likes, notify_replies, notify_followers, notify_rankings, notify_capsule, profile_visibility, catalog_visibility, library_visibility, stats_visibility, referral_code, badge_color, is_verified, is_beta_tester")
            .eq("id", value: userId)
            .single()
            .execute()
            .value
    }

    private func fetchAlbumRatings(userId: UUID) async -> [UserRating] {
        (try? await supabase
            .from("ratings")
            .select("id, score, review_text, created_at, release_groups(id, title, artist_display, cover_url, release_group_type, native_title, artists!release_groups_primary_artist_id_fkey(name_native))")
            .eq("user_id", value: userId)
            .order("created_at", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []
    }

    // Like + comment counts for the posts display mode (three independent
    // lookups, run concurrently).
    private func loadAlbumRatingSocialData(userId: UUID) async {
        let ratingIds = ratings.map(\.id.uuidString)
        guard !ratingIds.isEmpty else { return }
        struct RatingIdRow: Codable {
            let ratingId: UUID
            enum CodingKeys: String, CodingKey { case ratingId = "rating_id" }
        }
        async let likesFetch: [RatingIdRow]? = try? await supabase
            .from("rating_likes").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value
        async let commentsFetch: [RatingIdRow]? = try? await supabase
            .from("rating_comments").select("rating_id")
            .in("rating_id", values: ratingIds).execute().value
        async let myLikesFetch: [RatingIdRow]? = try? await supabase
            .from("rating_likes").select("rating_id")
            .eq("user_id", value: userId)
            .in("rating_id", values: ratingIds).execute().value

        if let rows = await likesFetch {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.ratingId, default: 0] += 1 }
            likeCounts = counts
        }
        if let rows = await commentsFetch {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.ratingId, default: 0] += 1 }
            commentCounts = counts
        }
        if let rows = await myLikesFetch {
            likedRatingIds = Set(rows.map(\.ratingId))
        }
    }

    // Same exact-count pattern as fetchFollowCounts, for the same reason:
    // ratings/songRatings (used by statsSnapshot.totalRatings) are capped at
    // 60 rows each to keep the tab fast to open, so their size undercounts
    // anyone above that -- this is a real live total instead.
    private func fetchRatedTotal(userId: UUID) async -> Int {
        // `head: true` -- without it this is a normal GET that downloads every
        // matching row's full columns (review_text included) just to read the
        // count off the response header. Fine for follows' tiny rows, but for
        // a rating history that's real payload weight, and is almost
        // certainly why this (and fetchFollowCounts below, same bug) turned
        // multi-second for anyone with a substantial history. `head: true`
        // makes it a HEAD request -- count-only, no body.
        async let albumsFetch = try? await supabase.from("ratings")
            .select("*", head: true, count: .exact)
            .eq("user_id", value: userId).execute()
        async let songsFetch = try? await supabase.from("track_ratings")
            .select("*", head: true, count: .exact)
            .eq("user_id", value: userId).execute()
        let (albums, songs) = await (albumsFetch, songsFetch)
        return (albums?.count ?? 0) + (songs?.count ?? 0)
    }

    private func fetchFollowCounts(userId: UUID) async -> (following: Int, followers: Int) {
        async let followingFetch = try? await supabase.from("follows")
            .select("*", head: true, count: .exact)
            .eq("follower_id", value: userId).execute()
        async let followersFetch = try? await supabase.from("follows")
            .select("*", head: true, count: .exact)
            .eq("following_id", value: userId).execute()
        let (following, followers) = await (followingFetch, followersFetch)
        return (following?.count ?? 0, followers?.count ?? 0)
    }

    // Own mix shares -- merged into the posts feed so a just-shared mix shows
    // up alongside rating posts instead of only in the Home feed.
    private func fetchMixShares(userId: UUID) async -> [HomeViewModel.MixShareRow] {
        (try? await supabase
            .from("mix_shares").select(HomeViewModel.mixShareSelect)
            .eq("user_id", value: userId)
            .order("created_at", ascending: false)
            .limit(30)
            .execute()
            .value) ?? []
    }

    private func fetchSongRatings(userId: UUID) async -> [SongRatingRow] {
        struct TrackRatingNew: Codable {
            let id: UUID
            let recordingId: UUID
            let score: Double?
            let reviewText: String?
            let createdAt: Date
            let recordings: RecordingInfo
            struct RecordingInfo: Codable {
                let id: UUID; let title: String; let artistDisplay: String?
                enum CodingKeys: String, CodingKey {
                    case id, title; case artistDisplay = "artist_display"
                }
            }
            enum CodingKeys: String, CodingKey {
                case id, recordingId = "recording_id"; case score
                case reviewText = "review_text"
                case createdAt = "created_at"; case recordings
            }
        }
        let rawSongs: [TrackRatingNew] = (try? await supabase
            .from("track_ratings")
            .select("id, recording_id, score, review_text, created_at, recordings(id, title, artist_display)")
            .eq("user_id", value: userId)
            .order("created_at", ascending: false)
            .limit(60)
            .execute()
            .value) ?? []

        guard !rawSongs.isEmpty else { return [] }

        // Step 2: get release group cover art via release_tracks
        struct RTCoverRow: Codable {
                let recordingId: UUID
                let releases: CoverRelRow?
                struct CoverRelRow: Codable {
                    let isCanonical: Bool?
                    let releaseGroups: RGCover?
                    struct RGCover: Codable {
                        let id: UUID; let title: String; let artistDisplay: String?; let coverUrl: String?
                        let titleNative: String?; let primaryArtist: NativeArtistRef?
                        enum CodingKeys: String, CodingKey {
                            case id, title; case artistDisplay = "artist_display"; case coverUrl = "cover_url"
                            case titleNative = "native_title"; case primaryArtist = "artists"
                        }
                    }
                    enum CodingKeys: String, CodingKey {
                        case isCanonical = "is_canonical"; case releaseGroups = "release_groups"
                    }
                }
                enum CodingKeys: String, CodingKey {
                    case recordingId = "recording_id"; case releases
                }
            }
        let coverRows: [RTCoverRow] = (try? await supabase
            .from("release_tracks")
            .select("recording_id, releases(is_canonical, release_groups(id, title, artist_display, cover_url, native_title, artists!release_groups_primary_artist_id_fkey(name_native)))")
            .in("recording_id", values: rawSongs.map(\.recordingId.uuidString))
            .execute()
            .value) ?? []

        var rgMap: [UUID: RTCoverRow.CoverRelRow.RGCover] = [:]
        for row in coverRows {
            guard let rel = row.releases, let rg = rel.releaseGroups else { continue }
            if rel.isCanonical == true || rgMap[row.recordingId] == nil { rgMap[row.recordingId] = rg }
        }

        return rawSongs.map { r in
            let rg = rgMap[r.recordingId]
            let ref = ReleaseRef(
                id:            rg?.id ?? UUID(),
                title:         rg?.title ?? "",
                artist:        rg?.artistDisplay ?? r.recordings.artistDisplay ?? "",
                coverUrl:      rg?.coverUrl,
                releaseType:   nil,
                titleNative:   rg?.titleNative,
                primaryArtist: rg?.primaryArtist
            )
            return SongRatingRow(
                ratingId:    r.id,
                recordingId: r.recordingId,
                score:       r.score,
                reviewText:  r.reviewText,
                trackTitle:  r.recordings.title,
                release:     ref,
                createdAt:   r.createdAt
            )
        }
    }

    private func loadMixShareSocialData() async {
        guard !mixShares.isEmpty, let userId = supabase.auth.currentUser?.id else { return }
        let shareIds = mixShares.map(\.id.uuidString)
        struct IdRow: Codable {
            let mixShareId: UUID
            enum CodingKeys: String, CodingKey { case mixShareId = "mix_share_id" }
        }
        async let likesTask: [IdRow]? = try? await supabase
            .from("mix_share_likes").select("mix_share_id")
            .in("mix_share_id", values: shareIds).execute().value
        async let commentsTask: [IdRow]? = try? await supabase
            .from("mix_share_comments").select("mix_share_id")
            .in("mix_share_id", values: shareIds).execute().value
        async let myLikesTask: [IdRow]? = try? await supabase
            .from("mix_share_likes").select("mix_share_id")
            .eq("user_id", value: userId)
            .in("mix_share_id", values: shareIds).execute().value

        if let rows = await likesTask {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.mixShareId, default: 0] += 1 }
            for (k, v) in counts { likeCounts[k] = v }
        }
        if let rows = await commentsTask {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.mixShareId, default: 0] += 1 }
            for (k, v) in counts { commentCounts[k] = v }
        }
        if let rows = await myLikesTask {
            likedMixShareIds = Set(rows.map(\.mixShareId))
        }
    }

    func toggleMixShareLike(for post: MixSharePost) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = likedMixShareIds.contains(post.id)
        if wasLiked {
            likedMixShareIds.remove(post.id)
            likeCounts[post.id] = max(0, (likeCounts[post.id] ?? 1) - 1)
        } else {
            likedMixShareIds.insert(post.id)
            likeCounts[post.id] = (likeCounts[post.id] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("mix_share_likes").delete()
                    .eq("user_id", value: userId).eq("mix_share_id", value: post.id).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let mixShareId: UUID
                    enum CodingKeys: String, CodingKey { case userId = "user_id"; case mixShareId = "mix_share_id" }
                }
                try await supabase.from("mix_share_likes")
                    .insert(Payload(userId: userId, mixShareId: post.id)).execute()
            }
        } catch {
            if wasLiked { likedMixShareIds.insert(post.id); likeCounts[post.id] = (likeCounts[post.id] ?? 0) + 1 }
            else { likedMixShareIds.remove(post.id); likeCounts[post.id] = max(0, (likeCounts[post.id] ?? 1) - 1) }
        }
    }

    // Song-rating counterpart to loadMixShareSocialData -- same shape, keyed on
    // SongRatingRow.ratingId (the track_ratings row's own id, what track_rating_likes/
    // track_rating_comments actually reference) rather than recordingId.
    private func loadSongRatingSocialData() async {
        guard !songRatings.isEmpty, let userId = supabase.auth.currentUser?.id else { return }
        let songRatingIds = songRatings.map(\.ratingId.uuidString)
        struct IdRow: Codable {
            let trackRatingId: UUID
            enum CodingKeys: String, CodingKey { case trackRatingId = "track_rating_id" }
        }
        async let likesTask: [IdRow]? = try? await supabase
            .from("track_rating_likes").select("track_rating_id")
            .in("track_rating_id", values: songRatingIds).execute().value
        async let commentsTask: [IdRow]? = try? await supabase
            .from("track_rating_comments").select("track_rating_id")
            .in("track_rating_id", values: songRatingIds).execute().value
        async let myLikesTask: [IdRow]? = try? await supabase
            .from("track_rating_likes").select("track_rating_id")
            .eq("user_id", value: userId)
            .in("track_rating_id", values: songRatingIds).execute().value

        if let rows = await likesTask {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.trackRatingId, default: 0] += 1 }
            for (k, v) in counts { likeCounts[k] = v }
        }
        if let rows = await commentsTask {
            var counts: [UUID: Int] = [:]
            for r in rows { counts[r.trackRatingId, default: 0] += 1 }
            for (k, v) in counts { commentCounts[k] = v }
        }
        if let rows = await myLikesTask {
            likedSongRatingIds = Set(rows.map(\.trackRatingId))
        }
    }

    func toggleSongLike(ratingId: UUID) async {
        guard let userId = supabase.auth.currentUser?.id else { return }
        let wasLiked = likedSongRatingIds.contains(ratingId)
        if wasLiked {
            likedSongRatingIds.remove(ratingId)
            likeCounts[ratingId] = max(0, (likeCounts[ratingId] ?? 1) - 1)
        } else {
            likedSongRatingIds.insert(ratingId)
            likeCounts[ratingId] = (likeCounts[ratingId] ?? 0) + 1
        }
        do {
            if wasLiked {
                try await supabase.from("track_rating_likes").delete()
                    .eq("user_id", value: userId).eq("track_rating_id", value: ratingId).execute()
            } else {
                struct Payload: Encodable {
                    let userId: UUID; let trackRatingId: UUID
                    enum CodingKeys: String, CodingKey {
                        case userId = "user_id"; case trackRatingId = "track_rating_id"
                    }
                }
                try await supabase.from("track_rating_likes")
                    .insert(Payload(userId: userId, trackRatingId: ratingId)).execute()
            }
        } catch {
            if wasLiked { likedSongRatingIds.insert(ratingId); likeCounts[ratingId] = (likeCounts[ratingId] ?? 0) + 1 }
            else { likedSongRatingIds.remove(ratingId); likeCounts[ratingId] = max(0, (likeCounts[ratingId] ?? 1) - 1) }
        }
    }

    func reload() async {
        hasLoaded = false
        await load()
    }

    func signOut() async {
        SpotifyService.clearCache()
        try? await supabase.auth.signOut()
    }
}

// MARK: - View

enum RatingSortOrder: String, CaseIterable {
    case recent       = "Recent"
    case topRated     = "Top Rated"
    case bottomRated  = "Bottom Rated"
    case alphabetical = "A–Z"
}

enum RatingTypeFilter: String, CaseIterable {
    case all    = "All"
    case albums = "Albums"
    case songs  = "Songs"
}

enum RatingDisplayMode {
    case list, posts
}

// Unified item type for the rated list (albums + songs together)
enum ProfileRatedItem: Identifiable {
    case album(UserRating)
    case song(SongRatingRow)

    var id: String {
        switch self {
        case .album(let r): return "a-\(r.id)"
        case .song(let r):  return "s-\(r.id)"
        }
    }
    var score: Double? {
        switch self { case .album(let r): return r.score; case .song(let r): return r.score }
    }
    var reviewText: String? {
        switch self { case .album(let r): return r.reviewText; case .song(let r): return r.reviewText }
    }
    var createdAt: Date {
        switch self { case .album(let r): return r.createdAt; case .song(let r): return r.createdAt }
    }
    var displayTitle: String {
        switch self {
        case .album(let r): return r.releases.title
        case .song(let r):  return r.trackTitle ?? "Unknown Track"
        }
    }
    var artistLine: String {
        switch self {
        case .album(let r): return r.releases.artist
        case .song(let r):  return "\(r.release.title) · \(r.release.artist)"
        }
    }
    var coverUrl: String? {
        switch self {
        case .album(let r): return r.releases.coverUrl
        case .song(let r):  return r.release.coverUrl
        }
    }
    var asRelease: Release {
        switch self {
        case .album(let r): return r.releases.asRelease
        case .song(let r):  return r.release.asRelease
        }
    }
    var isSong: Bool { if case .song = self { return true }; return false }
    var releaseType: String? {
        switch self {
        case .album(let r): return r.releases.releaseType
        case .song: return nil
        }
    }
}

// Posts display mode merges album-rating posts with mix-share posts into one
// chronological feed (mirrors HomeView's FeedPost) so a just-shared mix shows
// up here too instead of only in the Home feed.
enum ProfilePost: Identifiable {
    case rating(UserRating)
    case song(SongRatingRow)
    case mixShare(MixSharePost)

    var id: String {
        switch self {
        case .rating(let r):   return "rating-\(r.id.uuidString)"
        case .song(let s):     return "song-\(s.id)"
        case .mixShare(let s): return "mixshare-\(s.id.uuidString)"
        }
    }
    var createdAt: Date {
        switch self {
        case .rating(let r):   return r.createdAt
        case .song(let s):     return s.createdAt
        case .mixShare(let s): return s.createdAt
        }
    }
}

struct ProfileView: View {
    var viewModel: ProfileViewModel
    // Hoisted in MainTabView, not owned here -- the same instance backs the
    // Profile tab's badge, this view's nav-bar dot, and the checklist sheet's
    // content, so all three always agree on actual completion state.
    var questVM: QuestChecklistViewModel
    // Matches TasteView's own onGoToAdd convention -- lets a quest row switch
    // to the Add tab (to rate/find something to rate) after dismissing this
    // sheet, owned by MainTabView where `selectedTab` actually lives.
    var onGoToAdd: () -> Void
    // Set true by SearchView's Quick Add mode-gate popup ("Go to Settings"), owned by
    // MainTabView where the tab switch to .profile also happens. Watched below to
    // auto-open the existing showSettings sheet, then reset to false.
    @Binding var openSettingsTrigger: Bool
    @State private var activeTab: ProfileTab = .rated
    // Lists/Stats tabs are often shorter than the screen (e.g. 2 mixes) --
    // without a height floor, tabContent's hit-test area (contentShape +
    // gesture) only covers its actual short content, so swiping over the
    // blank space below it does nothing. tabMinHeight (outer viewport height
    // minus the hero's actual height, recomputed via onAppear/onChange --
    // NOT PreferenceKey, which measured 0 here for reasons not fully
    // understood, bubbling cross-view through the VStack/ScrollView instead
    // of resolving to a real GeometryReader size) lets tabContent claim the
    // rest of the visible screen even when its own content doesn't fill it.
    @State private var heroHeight: CGFloat = 0
    @State private var tabMinHeight: CGFloat = 0
    @State private var showSettings       = false
    @State private var showEditProfile    = false
    @State private var showShareSheet     = false
    @State private var showFollowModal    = false
    @State private var showUserSearch     = false
    @State private var showQuestChecklist = false
    @State private var followModalInitTab: FollowMode = .following
    @State private var mixLibVM           = MixLibraryViewModel()
    @State private var ratingSortOrder:    RatingSortOrder = .recent
    @State private var ratingTypeFilter:   RatingTypeFilter = .all
    @State private var ratingDisplayMode:  RatingDisplayMode = .posts
    @State private var pendingDeleteItem:  ProfileRatedItem? = nil
    // Explicit path (rather than a plain NavigationStack {}) so a mix share
    // posted from deep in this stack (e.g. Lists tab -> MixDetailView) can be
    // popped back to the profile root once the share succeeds.
    @State private var navPath = NavigationPath()

    var body: some View {
        NavigationStack(path: $navPath) {
            Group {
                if viewModel.isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    profileContent
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationBarHidden(true)
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
            .navigationDestination(for: ArtistDestination.self) { ArtistPageView(artist: $0) }
            .navigationDestination(for: Mix.self) { MixDetailView(mix: $0) }
            .sheet(isPresented: $showSettings) {
                SettingsView(viewModel: viewModel)
            }
            .onChange(of: openSettingsTrigger) { _, newVal in
                if newVal {
                    showSettings = true
                    openSettingsTrigger = false
                }
            }
            // onChange alone misses the case where this is the tab's first-ever mount this
            // session (e.g. jumping here directly from Quick Add's mode-gate popup on a launch
            // that never visited Profile before) -- the trigger is already true by the time this
            // view starts observing it, so no false→true transition ever fires. onAppear catches
            // that initial-already-true case; onChange above covers every later trigger while
            // already mounted.
            .onAppear {
                if openSettingsTrigger {
                    showSettings = true
                    openSettingsTrigger = false
                }
            }
            .sheet(isPresented: $showEditProfile, onDismiss: {
                Task { await viewModel.reload() }
            }) {
                EditProfileView(profile: viewModel.profile)
            }
            .sheet(isPresented: $showShareSheet) {
                ShareSheet(url: profileURL, username: viewModel.profile?.username ?? "sillajuku")
            }
            .sheet(isPresented: $showFollowModal) {
                if let id = viewModel.profile?.id {
                    FollowListModal(userId: id, initialTab: followModalInitTab)
                }
            }
            .sheet(isPresented: $showUserSearch) {
                UserSearchSheet()
            }
            .sheet(isPresented: $showQuestChecklist) {
                QuestChecklistView(vm: questVM, onGoToAdd: onGoToAdd)
            }
        }
        .task { await viewModel.load() }
        .onReceive(NotificationCenter.default.publisher(for: .ratingChanged)) { _ in
            Task { await viewModel.reload() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .followChanged)) { _ in
            Task { await viewModel.reload() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .sjProfileUpdated)) { _ in
            Task { await viewModel.reload() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .mixShared)) { _ in
            navPath = NavigationPath()
            activeTab = .rated
            ratingDisplayMode = .posts
            ratingSortOrder = .recent
            Task { await viewModel.reload() }
        }
    }

    private var profileURL: URL {
        let username = viewModel.profile?.username ?? ""
        let path = username.isEmpty ? "" : "/profile/\(username)"
        return URL(string: "https://sillajuku.com\(path)") ?? URL(string: "https://sillajuku.com")!
    }

    // MARK: - Content

    // One ScrollView, hero + whichever tab is active, both scrolling as a
    // single unit. Only one tab's content ever exists in the tree at a time
    // (a plain switch, not 3 pages laid out side by side) -- so there's no
    // shared-height/alignment gotcha to fight: each tab is simply its own
    // natural size. The swipe gesture is attached only to `tabContent`, not
    // the hero, so dragging over the avatar/stats/bio/buttons area does
    // nothing; dragging over the grid/list/stats area below switches tabs.
    private var profileContent: some View {
        GeometryReader { outerGeo in
            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    heroContent
                        .background(
                            GeometryReader { heroGeo in
                                Color.clear
                                    .onAppear { heroHeight = heroGeo.size.height }
                                    .onChange(of: heroGeo.size.height) { _, newValue in
                                        heroHeight = newValue
                                    }
                            }
                        )
                    tabContent
                        .padding(.bottom, 32)
                }
            }
            .onAppear { tabMinHeight = max(0, outerGeo.size.height - heroHeight) }
            .onChange(of: outerGeo.size.height) { _, newValue in
                tabMinHeight = max(0, newValue - heroHeight)
            }
            .onChange(of: heroHeight) { _, newValue in
                tabMinHeight = max(0, outerGeo.size.height - newValue)
            }
        }
    }

    @ViewBuilder
    private func tabPage(_ tab: ProfileTab) -> some View {
        switch tab {
        case .rated: ratedGrid
        case .lists: listsPlaceholder
        case .stats: statsContent
        }
    }

    // Floor, not a cap -- short tabs (e.g. Lists with 2 mixes) still claim the rest of the
    // visible screen so the swipe gesture works there too; tabs taller than the viewport are
    // unaffected. See SwipeableTabPager for the swipe/sensitivity/anti-navigation behavior.
    private var tabContent: some View {
        SwipeableTabPager(selection: $activeTab, minHeight: tabMinHeight, content: tabPage)
    }

    private var heroContent: some View {
        VStack(spacing: 0) {
            customNavBar
            headerRow
            nameRow
            actionButtons
            tabBar
        }
    }

    private var customNavBar: some View {
        ZStack {
            // Badges sit next to the @handle (the account's actual identity),
            // not the display name -- the whole group centers together so
            // adding badges doesn't throw off the title's centering.
            HStack(spacing: 4) {
                Text(viewModel.profile.flatMap { $0.username }.map { "@\($0)" } ?? "Profile")
                    .font(.jakarta(16, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                if let raw = viewModel.profile?.badgeColor, let badge = QuestBadgeColor(rawValue: raw) {
                    QuestBadgeView(color: badge.color)
                        .frame(width: 14, height: 14)
                        .accessibilityLabel(String(localized: "Quests complete"))
                }
                if viewModel.profile?.isVerified == true {
                    VerifiedBadgeView()
                        .frame(width: 14, height: 14)
                        .accessibilityLabel(String(localized: "Verified"))
                }
                if viewModel.profile?.isBetaTester == true {
                    BetaBadgeView()
                        .frame(width: 14, height: 14)
                        .accessibilityLabel(String(localized: "Beta tester"))
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)

            HStack {
                Button { showUserSearch = true } label: {
                    Image("icon-user-plus")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 16, height: 16)
                        .foregroundStyle(Color.sjInk)
                }
                .accessibilityLabel(String(localized: "Find people"))
                Spacer()
                Button {
                    showQuestChecklist = true
                } label: {
                    Image("icon-list-checks")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 16, height: 16)
                        .foregroundStyle(Color.sjInk)
                        .overlay(alignment: .topTrailing) {
                            if !questVM.personalQuestsComplete {
                                Circle()
                                    .fill(Color.red)
                                    .frame(width: 4, height: 4)
                                    .offset(x: 3, y: -1)
                            }
                        }
                }
                .accessibilityLabel(String(localized: "Getting Started"))
                Button { showSettings = true } label: {
                    Image("icon-settings")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 16, height: 16)
                        .foregroundStyle(Color.sjInk)
                }
                .accessibilityLabel(String(localized: "Settings"))
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 4)
    }

    // MARK: - Header row

    private var headerRow: some View {
        HStack(spacing: 16) {
            avatarCircle
                .frame(width: 76, height: 76)

            HStack(spacing: 0) {
                ProfileStatCell(value: viewModel.ratedTotal, label: "Rated")
                Button {
                    followModalInitTab = .following
                    showFollowModal = true
                } label: {
                    ProfileStatCell(value: viewModel.followingCount, label: "Following")
                }
                .buttonStyle(.plain)
                Button {
                    followModalInitTab = .followers
                    showFollowModal = true
                } label: {
                    ProfileStatCell(value: viewModel.followerCount, label: "Followers")
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 12)
    }

    private var avatarCircle: some View {
        Group {
            if let urlStr = viewModel.profile?.avatarUrl, let url = URL(string: urlStr) {
                CachedImage(url: url) { DefaultAvatarView(size: 76) }
                    .scaledToFill()
                    .clipShape(Circle())
            } else {
                DefaultAvatarView(size: 76)
            }
        }
        .accessibilityLabel(String(localized: "Your profile photo"))
    }

    // MARK: - Display name + bio

    private var nameRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let name = viewModel.profile?.displayName, !name.isEmpty {
                Text(name)
                    .font(.jakarta(13, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
            }
            if let bio = viewModel.profile?.bio, !bio.isEmpty {
                Text(bio)
                    .font(.jakarta(13))
                    .foregroundStyle(Color.sjMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.top, 10)
    }

    // MARK: - Action buttons

    private var actionButtons: some View {
        HStack(spacing: 8) {
            Button("Edit profile") { showEditProfile = true }
                .buttonStyle(ProfileActionButtonStyle())
            Button("Share profile") { showShareSheet = true }
                .buttonStyle(ProfileActionButtonStyle())
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
    }

    // MARK: - Icon tab bar

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(ProfileTab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.15)) { activeTab = tab }
                } label: {
                    VStack(spacing: 0) {
                        Image(tab.icon)
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 20, height: 20)
                            .foregroundStyle(activeTab == tab ? Color.sjInk : Color.sjMuted)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)

                        // Amber underline on the active tab only
                        Rectangle()
                            .fill(activeTab == tab ? Color.sjAmber : Color.clear)
                            .frame(height: 1.5)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.label)
            }
        }
        .padding(.top, 14)
    }

    // MARK: - Tab content

    private var filteredItems: [ProfileRatedItem] {
        let albums = viewModel.ratings.map { ProfileRatedItem.album($0) }
        let songs  = viewModel.songRatings.map { ProfileRatedItem.song($0) }
        let base: [ProfileRatedItem]
        switch ratingTypeFilter {
        case .all:    base = albums + songs
        case .albums: base = albums
        case .songs:  base = songs
        }
        switch ratingSortOrder {
        case .recent:       return base
        case .topRated:     return base.sorted { itemScore($0) > itemScore($1) }
        case .bottomRated:  return base.sorted { itemScore($0) < itemScore($1) }
        case .alphabetical: return base.sorted { $0.displayTitle < $1.displayTitle }
        }
    }

    // Album + song ratings, in whatever order/filter the user picked, plus own mix shares merged
    // in by recency -- only under the default "Recent" sort, since "top/bottom rated" and "A-Z"
    // don't have a sensible place for a score-less mix share to slot into. Previously this
    // compactMap only ever matched the .album case, so filtering to Songs in Posts view showed
    // nothing but mix shares -- filteredItems already has exactly two cases, so a plain map
    // covering both is exhaustive.
    private var postsFeed: [ProfilePost] {
        let ratingPosts: [ProfilePost] = filteredItems.map {
            switch $0 {
            case .album(let r): return .rating(r)
            case .song(let s):  return .song(s)
            }
        }
        // Mix shares are neither an album nor a song rating -- only belong in the unfiltered
        // "All" view. This guard previously only checked sort order, so a mix share kept showing
        // up even while filtered to Albums or Songs specifically.
        guard ratingSortOrder == .recent, ratingTypeFilter == .all else { return ratingPosts }
        let sharePosts: [ProfilePost] = viewModel.mixShares.map { .mixShare($0) }
        return (ratingPosts + sharePosts).sorted { $0.createdAt > $1.createdAt }
    }

    private func itemScore(_ item: ProfileRatedItem) -> Double {
        item.score ?? 0
    }

    @ViewBuilder
    private var ratedGrid: some View {
        let items = filteredItems
        let hasAny = !viewModel.ratings.isEmpty || !viewModel.songRatings.isEmpty

        if !hasAny {
            VStack(spacing: 12) {
                Image("icon-layout-grid")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 36, height: 36)
                    .foregroundStyle(Color.sjMuted)
                Text("No ratings yet")
                    .font(.jakarta(15))
                    .foregroundStyle(Color.sjMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 60)
        } else {
            LazyVStack(spacing: 0) {
                // Type filter tabs + display mode toggle
                HStack(spacing: 4) {
                    ForEach(RatingTypeFilter.allCases, id: \.self) { filter in
                        Button {
                            ratingTypeFilter = filter
                        } label: {
                            Text(LocalizedStringKey(filter.rawValue))
                                .font(.jakarta(12, weight: ratingTypeFilter == filter ? .semibold : .regular))
                                .foregroundStyle(ratingTypeFilter == filter ? Color.sjBlue : Color.sjMuted)
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .background(ratingTypeFilter == filter ? Color.sjBlue.opacity(0.1) : Color.clear)
                                .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                        .buttonStyle(.plain)
                    }

                    Spacer()

                    HStack(spacing: 2) {
                        ForEach([RatingDisplayMode.list, .posts], id: \.self) { mode in
                            Button { ratingDisplayMode = mode } label: {
                                Image(mode == .list ? "icon-list" : "icon-newspaper")
                                    .renderingMode(.template)
                                    .resizable().scaledToFit()
                                    .frame(width: 14, height: 14)
                                    .foregroundStyle(ratingDisplayMode == mode ? Color.sjBlue : Color.sjMuted)
                                    .frame(width: 32, height: 28)
                                    .background(ratingDisplayMode == mode ? Color.sjBlue.opacity(0.1) : Color.clear)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(mode == .list ? String(localized: "List view") : String(localized: "Post view"))
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)

                // Count + sort
                HStack {
                    // For "All", prefer the exact ratedTotal over items.count -- the
                    // latter is the size of the loaded (60-capped per type) arrays,
                    // same undercount as the header stat used to have, just showing
                    // up here too. Falls back to items.count until ratedTotal's fetch
                    // resolves. Per-type filters (Albums/Songs) still use items.count --
                    // there's no exact per-type total fetched, only the combined one.
                    Text(String(format: String(localized: "%d %@"), ratingTypeFilter == .all ? (viewModel.ratedTotal ?? items.count) : items.count, ratingTypeFilter == .all ? String(localized: "ratings") : String(localized: String.LocalizationValue(ratingTypeFilter.rawValue)).lowercased()))
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjMuted)
                    Spacer()
                    Menu {
                        ForEach(RatingSortOrder.allCases, id: \.self) { order in
                            Button {
                                ratingSortOrder = order
                            } label: {
                                if ratingSortOrder == order {
                                    Label(LocalizedStringKey(order.rawValue), image: "icon-check")
                                } else {
                                    Text(LocalizedStringKey(order.rawValue))
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image("icon-sliders-horizontal")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 14, height: 14)
                            Text(LocalizedStringKey(ratingSortOrder.rawValue))
                        }
                        .font(.jakarta(12, weight: .medium))
                        .foregroundStyle(Color.sjAmber)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)

                if items.isEmpty {
                    VStack(spacing: 10) {
                        Image(ratingTypeFilter == .songs ? "icon-music" : "icon-layout-grid")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 28, height: 28)
                            .foregroundStyle(Color.sjMuted)
                        Text(String(format: String(localized: "No %@ rated yet"), String(localized: String.LocalizationValue(ratingTypeFilter.rawValue)).lowercased()))
                            .font(.jakarta(14))
                            .foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 40)
                } else if ratingDisplayMode == .list {
                    ForEach(items) { item in
                        ExpandableRatingListRow(
                            release: item.asRelease,
                            coverUrl: item.coverUrl,
                            title: item.displayTitle,
                            artistLine: item.artistLine,
                            score: item.score,
                            isSong: item.isSong,
                            releaseType: item.releaseType,
                            reviewText: item.reviewText,
                            createdAt: item.createdAt
                        )
                        .albumContextMenu(item.asRelease) {
                            Divider()
                            Button(role: .destructive) {
                                pendingDeleteItem = item
                            } label: {
                                Label("Delete Rating", image: "icon-trash")
                            }
                        }
                    }
                } else {
                    // Posts display — album ratings + own mix shares, merged by recency
                    let posts = postsFeed
                    if posts.isEmpty {
                        VStack(spacing: 10) {
                            Image("icon-newspaper")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 28, height: 28)
                                .foregroundStyle(Color.sjMuted)
                            Text("No posts yet")
                                .font(.jakarta(14)).foregroundStyle(Color.sjMuted)
                        }
                        .frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        ForEach(posts) { post in
                            postCard(post)
                        }
                        .padding(.bottom, 8)
                    }
                }
            }
            .padding(.top, 4)
            .confirmationDialog(
                "Delete Rating?",
                isPresented: Binding(
                    get: { pendingDeleteItem != nil },
                    set: { if !$0 { pendingDeleteItem = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    if let item = pendingDeleteItem {
                        Task { await viewModel.deleteRating(item) }
                    }
                    pendingDeleteItem = nil
                }
                Button("Cancel", role: .cancel) { pendingDeleteItem = nil }
            } message: {
                Text("This will permanently remove this rating.")
            }
        }
    }

    // Extracted out of the posts-mode ForEach -- a switch with two multi-arg
    // view initializers written inline inside a ForEach/LazyVStack closure is
    // a known Swift type-checker explosion trigger (caused a 133GB Xcode RAM
    // blowup in HomeView's equivalent feed once). Named function bodies
    // type-check independently instead.
    @ViewBuilder
    private func postCard(_ post: ProfilePost) -> some View {
        switch post {
        case .rating(let rating):     ratingCard(rating)
        case .song(let song):         songCard(song)
        case .mixShare(let share):    mixShareCard(share)
        }
    }

    private func songCard(_ song: SongRatingRow) -> some View {
        ProfileSongPostCard(
            song: song,
            likesCount: viewModel.likeCounts[song.ratingId] ?? 0,
            commentsCount: viewModel.commentCounts[song.ratingId] ?? 0,
            isLiked: viewModel.likedSongRatingIds.contains(song.ratingId),
            onLike: { await viewModel.toggleSongLike(ratingId: song.ratingId) },
            headerHandle: viewModel.profile?.username ?? "me",
            headerVerified: viewModel.profile?.isVerified == true,
            headerBadgeColor: viewModel.profile?.badgeColor,
            headerBetaTester: viewModel.profile?.isBetaTester == true
        )
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .contextMenu {
            Button(role: .destructive) {
                pendingDeleteItem = .song(song)
            } label: {
                Label("Delete Rating", image: "icon-trash")
            }
        }
    }

    private func ratingCard(_ rating: UserRating) -> some View {
        ProfilePostCard(
            rating: rating,
            likesCount: viewModel.likeCounts[rating.id] ?? 0,
            commentsCount: viewModel.commentCounts[rating.id] ?? 0,
            isLiked: viewModel.likedRatingIds.contains(rating.id),
            onLike: { await viewModel.toggleLike(ratingId: rating.id) },
            headerHandle: viewModel.profile?.username ?? "me",
            headerVerified: viewModel.profile?.isVerified == true,
            headerBadgeColor: viewModel.profile?.badgeColor,
            headerBetaTester: viewModel.profile?.isBetaTester == true
        )
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .contextMenu {
            Button(role: .destructive) {
                pendingDeleteItem = .album(rating)
            } label: {
                Label("Delete Rating", image: "icon-trash")
            }
        }
    }

    private func mixShareCard(_ share: MixSharePost) -> some View {
        MixShareCard(
            post: share,
            currentUserId: supabase.auth.currentUser?.id,
            isLiked: viewModel.likedMixShareIds.contains(share.id),
            likesCount: viewModel.likeCounts[share.id] ?? 0,
            commentsCount: viewModel.commentCounts[share.id] ?? 0,
            onLike: { await viewModel.toggleMixShareLike(for: share) },
            onBlock: {},
            onOwnProfileTap: {}
        )
        .padding(.horizontal, 12)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var listsPlaceholder: some View {
        if let profile = viewModel.profile {
            MixLibraryView(userId: profile.id, viewModel: mixLibVM)
        }
    }

    private var statsContent: some View {
        RatingStatsView(snapshot: RatingStatsSnapshot.compute(ratings: viewModel.ratings, songRatings: viewModel.songRatings))
    }
}

// MARK: - Rating stats view

// Not private, not owner-specific -- shared verbatim between ProfileView's
// own Stats tab and UserProfileView's Stats tab (fed by a
// RatingStatsSnapshot computed from someone else's ratings instead).
struct RatingStatsView: View {
    let snapshot: RatingStatsSnapshot

    var body: some View {
        Group {
            if snapshot.totalRatings == 0 {
                VStack(spacing: 12) {
                    Image("icon-bar-chart")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 36, height: 36)
                        .foregroundStyle(Color.sjMuted)
                    Text("Rate some albums to see your stats")
                        .font(.jakarta(15))
                        .foregroundStyle(Color.sjMuted)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 60)
            } else {
                VStack(alignment: .leading, spacing: 24) {
                    statsNumbersRow
                    scoreHistogramSection
                    if !snapshot.topArtists.isEmpty {
                        topArtistsSection
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 20)
            }
        }
    }

    private var statsNumbersRow: some View {
        HStack(spacing: 0) {
            statsCell(value: "\(snapshot.albumCount)", label: "Albums")
            Divider().frame(height: 30)
            statsCell(value: "\(snapshot.songCount)", label: "Songs")
            Divider().frame(height: 30)
            statsCell(value: String(format: "%.2f", snapshot.avgScore), label: "Avg Score")
        }
        .padding(.vertical, 14)
        .background(Color.sjInk.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func statsCell(value: String, label: LocalizedStringKey) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.jakarta(20, weight: .bold))
                .foregroundStyle(Color.sjInk)
            Text(label)
                .font(.jakarta(11))
                .foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity)
    }

    private var scoreHistogramSection: some View {
        let buckets = snapshot.scoreDistribution
        let maxCount = max(1, buckets.map(\.count).max() ?? 1)
        return VStack(alignment: .leading, spacing: 10) {
            statSectionHeader("Score Distribution")
            VStack(spacing: 2) {
                // Count labels + bars — separated so bar bottoms are truly aligned
                HStack(alignment: .bottom, spacing: 3) {
                    ForEach(buckets) { bucket in
                        VStack(spacing: 2) {
                            // Space character keeps this row the same height for every column
                            Text(bucket.count > 0 ? "\(bucket.count)" : " ")
                                .font(.jakarta(8))
                                .foregroundStyle(Color.sjMuted)
                            RoundedRectangle(cornerRadius: 3)
                                .fill(bucket.count > 0
                                      ? Color.sjBlue.opacity(0.75)
                                      : Color.sjInk.opacity(0.07))
                                .frame(height: max(4, CGFloat(bucket.count) / CGFloat(maxCount) * 72))
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
                // Flat axis line
                Rectangle()
                    .fill(Color.sjBorder.opacity(0.6))
                    .frame(height: 1)
                // X-axis labels in their own row — always flat
                HStack(spacing: 3) {
                    ForEach(buckets) { bucket in
                        Text(bucket.score.truncatingRemainder(dividingBy: 1) == 0
                             ? "\(Int(bucket.score))" : "")
                            .font(.jakarta(9))
                            .foregroundStyle(Color.sjMuted)
                            .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private var topArtistsSection: some View {
        let artists = snapshot.topArtists
        let maxCount = CGFloat(artists.first?.count ?? 1)
        return VStack(alignment: .leading, spacing: 10) {
            statSectionHeader("Top Artists")
            VStack(spacing: 0) {
                ForEach(artists) { item in
                    HStack(spacing: 10) {
                        Text(item.artist)
                            .font(.jakarta(13))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        GeometryReader { geo in
                            let w = geo.size.width * CGFloat(item.count) / maxCount
                            RoundedRectangle(cornerRadius: 3)
                                .fill(Color.sjBlue.opacity(0.3))
                                .frame(width: max(6, w), height: 8)
                                .frame(maxHeight: .infinity)
                        }
                        .frame(width: 80, height: 16)
                        Text("\(item.count)")
                            .font(.jakarta(12, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                            .frame(width: 24, alignment: .trailing)
                    }
                    .padding(.vertical, 7)
                    if item.id != artists.last?.id { Divider() }
                }
            }
        }
    }

    private func statSectionHeader(_ title: LocalizedStringKey) -> some View {
        Text(title)
            .font(.jakarta(12, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .textCase(.uppercase)
            .tracking(0.5)
    }
}

// MARK: - Share sheet wrapper

import LinkPresentation

private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    let username: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let item = ProfileShareItem(url: url, username: username)
        let vc = UIActivityViewController(activityItems: [item], applicationActivities: nil)
        vc.excludedActivityTypes = [
            .addToReadingList,
            .assignToContact,
            .markupAsPDF,
            .openInIBooks,
            .print,
            .saveToCameraRoll,
        ]
        return vc
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

private class ProfileShareItem: NSObject, UIActivityItemSource {
    let url: URL
    let username: String

    init(url: URL, username: String) {
        self.url = url
        self.username = username
        super.init()
    }

    func activityViewControllerPlaceholderItem(_ ac: UIActivityViewController) -> Any { url }

    func activityViewController(_ ac: UIActivityViewController,
                                 itemForActivityType type: UIActivity.ActivityType?) -> Any? { url }

    func activityViewControllerLinkMetadata(_ ac: UIActivityViewController) -> LPLinkMetadata? {
        let meta = LPLinkMetadata()
        meta.originalURL = url
        meta.url = url
        meta.title = "@\(username) on sillajuku"
        if let image = UIImage(named: "logo-flower") {
            meta.imageProvider = NSItemProvider(object: image)
        }
        return meta
    }
}

// MARK: - Sub-views

private struct ProfileStatCell: View {
    /// nil while the count is still loading -- shown as a dash rather than
    /// "0", which read as "no ratings/followers yet" during the brief window
    /// before the real number arrives.
    let value: Int?
    let label: LocalizedStringKey

    var body: some View {
        VStack(spacing: 2) {
            Text(value.map { "\($0)" } ?? "–")
                .font(.jakarta(18, weight: .bold))
                .foregroundStyle(value == nil ? Color.sjMuted : Color.sjInk)
            Text(label)
                .font(.jakarta(10.5))
                .foregroundStyle(Color.sjMuted)
        }
        .frame(maxWidth: .infinity)
    }
}

struct ProfileActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.jakarta(13, weight: .semibold))
            .foregroundStyle(Color.sjInk)
            .frame(maxWidth: .infinity)
            .frame(height: 32)
            .background(Color.sjInk.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}


struct RatingListRow: View {
    let coverUrl: String?
    let title: String
    let artistLine: String
    let score: Double?
    var isSong: Bool = false
    var releaseType: String? = nil

    private var displayScore: Double? { score }

    private var scoreText: String {
        guard let v = displayScore else { return "" }
        return v.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(v))" : String(format: "%.1f", v)
    }

    var body: some View {
        HStack(spacing: 14) {
            CoverImage(url: coverUrl, cornerRadius: 8)
                .frame(width: 58, height: 58)
                .accessibilityHidden(true) // title text alongside already describes it

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(title)
                        .font(.jakarta(13, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    if isSong {
                        Text("Song")
                            .font(.jakarta(10, weight: .medium))
                            .foregroundStyle(Color.sjAmber)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjAmber.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    } else if let rt = releaseType {
                        Text(LocalizedStringKey(rt.lowercased() == "ep" ? "EP" : rt.capitalized))
                            .font(.jakarta(10, weight: .medium))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjBlue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
                Text(artistLine)
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if let _ = displayScore {
                HStack(spacing: 4) {
                    Image("icon-flower")
                        .renderingMode(.template).resizable().scaledToFit()
                        .frame(width: 11, height: 11).foregroundStyle(Color.sjBlue)
                    Text(scoreText)
                        .font(.jakarta(13, weight: .bold))
                        .foregroundStyle(Color.sjBlue)
                }
                .padding(.horizontal, 8).padding(.vertical, 4)
                .background(Color.sjBlue.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            } else {
                Image("icon-flower")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 11, height: 11).foregroundStyle(Color.sjMuted)
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

/// Wraps `RatingListRow` with a trailing chevron that expands the row's
/// written comment inline, without disturbing the row's own tap-to-navigate
/// behavior. The chevron lives as a sibling to the `NavigationLink` (not
/// nested inside its label) since this codebase has no precedent for a plain
/// `Button` nested inside a `NavigationLink` label reliably intercepting its
/// own taps.
struct ExpandableRatingListRow: View {
    let release: Release
    let coverUrl: String?
    let title: String
    let artistLine: String
    let score: Double?
    var isSong: Bool = false
    var releaseType: String? = nil
    let reviewText: String?
    let createdAt: Date?

    @State private var isExpanded = false

    private var hasComment: Bool { !(reviewText?.isEmpty ?? true) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 0) {
                NavigationLink(value: release) {
                    RatingListRow(coverUrl: coverUrl, title: title, artistLine: artistLine,
                                  score: score, isSong: isSong, releaseType: releaseType)
                }
                .buttonStyle(.plain)

                if hasComment {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
                    } label: {
                        Image("icon-chevron-down")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 12, height: 12)
                            .foregroundStyle(Color.sjMuted)
                            .rotationEffect(.degrees(isExpanded ? 180 : 0))
                            .frame(width: 32, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 12)
                    .accessibilityLabel(isExpanded ? String(localized: "Hide comment") : String(localized: "Show comment"))
                }
            }
            if isExpanded, let reviewText, !reviewText.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text(reviewText)
                        .font(.jakarta(13))
                        .foregroundStyle(Color.sjInk)
                        .fixedSize(horizontal: false, vertical: true)
                    if let createdAt {
                        Text(createdAt.relativeTimeString)
                            .font(.jakarta(11))
                            .foregroundStyle(Color.sjMuted)
                    }
                }
                .padding(.leading, 88)
                .padding(.trailing, 16)
                .padding(.bottom, 12)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}

// MARK: - Follow list sheet (combined with swipeable tabs)

enum FollowMode { case following, followers }

struct FollowListModal: View {
    let userId: UUID
    let initialTab: FollowMode

    @State private var activeTab: FollowMode
    @State private var following: [FollowProfile] = []
    @State private var followers: [FollowProfile] = []
    @State private var isLoading  = true
    @State private var searchText = ""

    init(userId: UUID, initialTab: FollowMode) {
        self.userId = userId
        self.initialTab = initialTab
        _activeTab = State(initialValue: initialTab)
    }

    private var filteredFollowing: [FollowProfile] { filter(following) }
    private var filteredFollowers: [FollowProfile] { filter(followers) }

    private func filter(_ profiles: [FollowProfile]) -> [FollowProfile] {
        guard !searchText.isEmpty else { return profiles }
        let q = searchText.lowercased()
        return profiles.filter {
            ($0.username?.lowercased().contains(q) ?? false) ||
            ($0.displayName?.lowercased().contains(q) ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: 8) {
                    Image("icon-search")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 14, height: 14)
                        .foregroundStyle(Color.sjMuted)
                    TextField("Search", text: $searchText)
                        .font(.jakarta(14))
                        .foregroundStyle(Color.sjInk)
                    if !searchText.isEmpty {
                        Button { searchText = "" } label: {
                            Image("icon-x-circle")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 14, height: 14)
                                .foregroundStyle(Color.sjMuted)
                        }
                        .accessibilityLabel(String(localized: "Clear search"))
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.sjBorder.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 8)

                // Tab bar with counts
                HStack(spacing: 0) {
                    tabBtn("Following", count: following.count, tab: .following)
                    tabBtn("Followers", count: followers.count, tab: .followers)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 4)

                Divider()

                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    TabView(selection: $activeTab) {
                        profileList(filteredFollowing, empty: "Not following anyone yet")
                            .tag(FollowMode.following)
                        profileList(filteredFollowers, empty: "No followers yet")
                            .tag(FollowMode.followers)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    .animation(.easeInOut(duration: 0.2), value: activeTab)
                }
            }
            .safeAreaInset(edge: .bottom) {
                VStack(spacing: 0) {
                    Divider()
                    FindPeopleLinkButton()
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                }
                .background(Color.sjCream)
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle(activeTab == .following ? "Following" : "Followers")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: FindPeopleDestination.self) { _ in FindPeopleView() }
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
        }
        .task { await loadBoth() }
    }

    @ViewBuilder
    private func profileList(_ profiles: [FollowProfile], empty: String) -> some View {
        if profiles.isEmpty {
            VStack(spacing: 12) {
                Image(searchText.isEmpty ? "icon-users" : "icon-search")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 36, height: 36)
                    .foregroundStyle(Color.sjMuted)
                Text(searchText.isEmpty ? empty : "No results for \"\(searchText)\"")
                    .font(.jakarta(15))
                    .foregroundStyle(Color.sjMuted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List(profiles) { profile in
                NavigationLink(value: UserProfileDestination(
                    userId: profile.id,
                    handle: profile.username ?? profile.displayName ?? String(localized: "user")
                )) {
                    FollowProfileRow(profile: profile)
                }
                .listRowBackground(Color.sjSurface)
                .listRowSeparatorTint(Color.sjBorder.opacity(0.5))
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
        }
    }

    private func tabBtn(_ label: LocalizedStringKey, count: Int, tab: FollowMode) -> some View {
        Button { withAnimation { activeTab = tab } } label: {
            VStack(spacing: 0) {
                HStack(spacing: 5) {
                    Text(label)
                        .font(.jakarta(14, weight: activeTab == tab ? .semibold : .regular))
                        .foregroundStyle(activeTab == tab ? Color.sjInk : Color.sjMuted)
                    if count > 0 {
                        Text("\(count)")
                            .font(.jakarta(11, weight: .semibold))
                            .foregroundStyle(activeTab == tab ? Color.sjBlue : Color.sjMuted)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(
                                (activeTab == tab ? Color.sjBlue : Color.sjMuted).opacity(0.12)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                Rectangle()
                    .fill(activeTab == tab ? Color.sjBlue : Color.clear)
                    .frame(height: 2)
            }
        }
        .buttonStyle(.plain)
    }

    private func loadBoth() async {
        isLoading = true
        async let f = loadList(mode: .following)
        async let r = loadList(mode: .followers)
        following = await f
        followers = await r
        isLoading = false
    }

    private func loadList(mode: FollowMode) async -> [FollowProfile] {
        struct FollowRow: Codable {
            let followingId: UUID?
            let followerId: UUID?
            enum CodingKeys: String, CodingKey {
                case followingId = "following_id"
                case followerId  = "follower_id"
            }
        }
        let col    = mode == .following ? "following_id" : "follower_id"
        let filter = mode == .following ? "follower_id"  : "following_id"
        let rows: [FollowRow] = (try? await supabase
            .from("follows").select(col).eq(filter, value: userId).execute().value) ?? []
        let ids = rows.compactMap { mode == .following ? $0.followingId : $0.followerId }
        guard !ids.isEmpty else { return [] }
        return (try? await supabase
            .from("profiles")
            .select("id, username, display_name, avatar_url")
            .in("id", values: ids.map(\.uuidString))
            .execute().value) ?? []
    }
}

private struct FollowProfileRow: View {
    let profile: FollowProfile

    var body: some View {
        HStack(spacing: 12) {
            Group {
                if let url = profile.avatarUrl.flatMap(URL.init) {
                    CachedImage(url: url) { Color.sjBorder }
                        .scaledToFill()
                } else {
                    DefaultAvatarView(size: 40)
                }
            }
            .frame(width: 40, height: 40)
            .clipShape(Circle())
            .accessibilityHidden(true) // name/username text alongside already describes it

            VStack(alignment: .leading, spacing: 2) {
                if let name = profile.displayName, !name.isEmpty {
                    Text(name)
                        .font(.jakarta(14, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                }
                if let username = profile.username {
                    Text("@" + username)
                        .font(.jakarta(13))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - User search sheet

struct UserSearchSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var query       = ""
    @State private var results:    [SearchProfile] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?

    struct SearchProfile: Codable, Identifiable, Hashable {
        let id: UUID
        let username: String?
        let displayName: String?
        let isVerified: Bool?
        enum CodingKeys: String, CodingKey {
            case id, username
            case displayName = "display_name"
            case isVerified  = "is_verified"
        }
        var handle: String  { username ?? displayName ?? String(localized: "someone") }
        var label: String   { displayName ?? username ?? String(localized: "someone") }
        var initial: String { String(handle.prefix(1)).uppercased() }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image("icon-search")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 16, height: 16)
                        .foregroundStyle(Color.sjMuted)
                    TextField("Search by username…", text: $query)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    if !query.isEmpty {
                        Button { query = "" } label: {
                            Image("icon-x-circle")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 16, height: 16)
                                .foregroundStyle(Color.sjMuted)
                        }
                        .accessibilityLabel(String(localized: "Clear search"))
                    }
                }
                .padding(10)
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .padding(.horizontal, 16)
                .padding(.vertical, 10)

                Divider()

                if isSearching {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if results.isEmpty && !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text("No users found.")
                        .font(.jakarta(14)).foregroundStyle(Color.sjMuted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(results) { profile in
                                NavigationLink(value: profile) {
                                    HStack(spacing: 12) {
                                        ZStack {
                                            Circle().fill(Color.sjAmber.opacity(0.15)).frame(width: 40, height: 40)
                                            Text(profile.initial)
                                                .font(.jakarta(16, weight: .bold)).foregroundStyle(Color.sjAmber)
                                        }
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(profile.label)
                                                .font(.jakarta(14, weight: .semibold)).foregroundStyle(Color.sjInk)
                                            HStack(spacing: 4) {
                                                Text("@" + profile.handle)
                                                    .font(.jakarta(12)).foregroundStyle(Color.sjMuted)
                                                if profile.isVerified == true {
                                                    VerifiedBadgeView()
                                                        .frame(width: 12, height: 12)
                                                        .accessibilityLabel(String(localized: "Verified"))
                                                }
                                            }
                                        }
                                        Spacer()
                                        Image("icon-chevron-right")
                                            .renderingMode(.template)
                                            .resizable().scaledToFit()
                                            .frame(width: 12, height: 12)
                                            .foregroundStyle(Color.sjBorder)
                                    }
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 12)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                if profile.id != results.last?.id {
                                    Divider().padding(.leading, 68)
                                }
                            }
                        }
                    }
                }
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle("Find People")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            // Destinations for UserProfileView and its inner navigation
            .navigationDestination(for: SearchProfile.self) { profile in
                UserProfileView(userId: profile.id, initialHandle: profile.handle)
            }
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
            .navigationDestination(for: Release.self) { AlbumDetailView(release: $0) }
            .navigationDestination(for: ArtistDestination.self) { ArtistPageView(artist: $0) }
        }
        .onChange(of: query) { _, new in
            searchTask?.cancel()
            let trimmed = new.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { results = []; return }
            searchTask = Task {
                try? await Task.sleep(nanoseconds: 300_000_000)
                guard !Task.isCancelled else { return }
                isSearching = true
                results = (try? await supabase
                    .from("profiles")
                    .select("id, username, display_name, is_verified")
                    .ilike("username", value: "%\(trimmed)%")
                    .limit(25)
                    .execute()
                    .value) ?? []
                isSearching = false
            }
        }
    }
}

// MARK: - Profile Post Card (posts display mode)

// Not private -- reused by UserProfileView's posts-mode Rated tab.
/// The header row posts carry everywhere else (FeedCard's cardHeader):
/// avatar + @handle (+ verified badge) + · + relative time, with an optional
/// trailing view (e.g. the song card's ⋯ menu). Non-navigating -- on profile
/// surfaces you're already looking at the author.
struct PostCardHeader<Trailing: View>: View {
    let handle: String
    let isVerified: Bool
    let badgeColor: String?
    let isBetaTester: Bool
    let createdAt: Date
    @ViewBuilder var trailing: () -> Trailing

    init(handle: String, isVerified: Bool, badgeColor: String? = nil, isBetaTester: Bool = false,
         createdAt: Date, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.handle = handle
        self.isVerified = isVerified
        self.badgeColor = badgeColor
        self.isBetaTester = isBetaTester
        self.createdAt = createdAt
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: 9) {
            DefaultAvatarView(size: 30)
            HStack(spacing: 4) {
                Text("@" + handle)
                    .font(.jakarta(13.5, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                if let raw = badgeColor, let badge = QuestBadgeColor(rawValue: raw) {
                    QuestBadgeView(color: badge.color)
                        .frame(width: 13, height: 13)
                        .accessibilityLabel(String(localized: "Quests complete"))
                }
                if isVerified {
                    VerifiedBadgeView()
                        .frame(width: 13, height: 13)
                        .accessibilityLabel(String(localized: "Verified"))
                }
                if isBetaTester {
                    BetaBadgeView()
                        .frame(width: 13, height: 13)
                        .accessibilityLabel(String(localized: "Beta tester"))
                }
            }
            Text("·").font(.jakarta(13)).foregroundStyle(Color.sjBorder)
            Text(createdAt.relativeTimeString)
                .font(.jakarta(12)).foregroundStyle(Color.sjMuted)
            Spacer(minLength: 0)
            trailing()
        }
        .padding(.leading, 14).padding(.trailing, 4)
        .padding(.top, 10).padding(.bottom, 6)
    }
}

struct ProfilePostCard: View {
    let rating: UserRating
    let likesCount: Int
    let commentsCount: Int
    let isLiked: Bool
    let onLike: () async -> Void
    // FeedCard-style header row (avatar + @handle + · + time). When set, the
    // timestamp moves up here from the action bar so the card reads exactly
    // like posts everywhere else (feed, album page).
    var headerHandle: String? = nil
    var headerVerified: Bool = false
    var headerBadgeColor: String? = nil
    var headerBetaTester: Bool = false
    // Only offered on someone else's post (UserProfileView) -- redundant on your
    // own ratings, which are already excluded from Quick Add via the ratings table.
    var onNotInterested: (() -> Void)? = nil

    @State private var showComments = false
    @State private var showLikers = false
    @State private var didMarkNotInterested = false

    private var displayScore: Double? { rating.score }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let handle = headerHandle {
                PostCardHeader(handle: handle, isVerified: headerVerified,
                               badgeColor: headerBadgeColor, isBetaTester: headerBetaTester,
                               createdAt: rating.createdAt) {
                    if let onNotInterested {
                        Menu {
                            Button {
                                onNotInterested()
                                didMarkNotInterested.toggle()
                            } label: {
                                Label("Not Interested", image: "icon-thumbs-down")
                            }
                        } label: {
                            Image("icon-more-horizontal")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 14, height: 14)
                                .foregroundStyle(Color.sjMuted)
                                .frame(width: 30, height: 30)
                        }
                    }
                }
            }

            // Album row — tappable, scoped to just this row (not the whole
            // card) so the action-bar buttons below aren't nested inside a
            // NavigationLink, matching FeedCard's albumSection pattern.
            NavigationLink(value: rating.releases.asRelease) {
                HStack(spacing: 13) {
                    CoverImage(url: rating.releases.coverUrl)
                        .frame(width: 66, height: 66)
                        .accessibilityHidden(true) // title/artist text alongside already describes it

                    VStack(alignment: .leading, spacing: 4) {
                        Text(rating.releases.displayTitle)
                            .font(.jakarta(14, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                            .lineLimit(2)
                        Text(rating.releases.typeLabel + " · " + rating.releases.displayArtist)
                            .font(.jakarta(11.5))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if let score = displayScore {
                        ScoreBadge(score: score)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 14)
            // With a header above, the header's own bottom padding provides the gap
            // (same as FeedCard's albumSection, which has no top padding).
            .padding(.top, headerHandle == nil ? 14 : 0)
            .padding(.bottom, 10)

            // Review text
            if let text = rating.reviewText, !text.isEmpty {
                Text(text)
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }

            // Action bar: likes · comments · date
            HStack(spacing: 16) {
                HStack(spacing: 5) {
                    Button { Task { await onLike() } } label: {
                        Image(isLiked ? "icon-heart-filled" : "icon-heart")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 19, height: 19)
                            .foregroundStyle(isLiked ? .red : Color.sjInk)
                    }
                    .buttonStyle(.plain)
                    .animation(.easeInOut(duration: 0.15), value: isLiked)
                    .accessibilityLabel(isLiked ? String(localized: "Unlike") : String(localized: "Like"))
                    .sensoryFeedback(.impact(weight: .light), trigger: isLiked)

                    if likesCount > 0 {
                        Button { showLikers = true } label: {
                            Text("\(likesCount)")
                                .font(.jakarta(14, weight: .medium))
                                .foregroundStyle(isLiked ? .red : Color.sjMuted)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack(spacing: 5) {
                    Button { showComments = true } label: {
                        Image("icon-message-circle")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 19, height: 19).foregroundStyle(Color.sjInk)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(String(localized: "View comments"))

                    if commentsCount > 0 {
                        Text("\(commentsCount)")
                            .font(.jakarta(14, weight: .medium)).foregroundStyle(Color.sjMuted)
                    }
                }
                Spacer()
                if headerHandle == nil {
                    Text(rating.createdAt.relativeTimeString)
                        .font(.jakarta(12)).foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 1)
        .sheet(isPresented: $showComments) {
            CommentSheetView(ratingId: rating.id)
                .presentationDetents([.fraction(0.67), .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showLikers) {
            LikersSheetView(ratingId: rating.id)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
        .sensoryFeedback(.success, trigger: didMarkNotInterested)
    }
}

// Song-rating counterpart to ProfilePostCard -- full parity now (migration 20260713000001 added
// track_ratings.review_text + the track_rating_likes/track_rating_comments tables song ratings
// were previously missing entirely).
/// Menu actions for rendering the current user's own song rating as a card on
/// the song detail page. Songs have no share URL or mix membership anywhere in
/// the app, so unlike the album card's menu this carries only edit/comment/delete.
struct SongOwnRatingMenuActions {
    let onShare: () -> Void
    let onEdit: () -> Void
    let onEditComment: () -> Void
    let onDelete: () -> Void
}

struct ProfileSongPostCard: View {
    let song: SongRatingRow
    let likesCount: Int
    let commentsCount: Int
    let isLiked: Bool
    let onLike: () async -> Void
    var ownActions: SongOwnRatingMenuActions? = nil
    // FeedCard-style header row; when set, the ⋯ menu (if any) renders inside
    // it instead of as a corner overlay, and the action-bar timestamp moves up.
    var headerHandle: String? = nil
    var headerVerified: Bool = false
    var headerBadgeColor: String? = nil
    var headerBetaTester: Bool = false

    @State private var showComments = false
    @State private var showLikers = false

    private var displayScore: Double? { song.score }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let handle = headerHandle {
                PostCardHeader(handle: handle, isVerified: headerVerified,
                               badgeColor: headerBadgeColor, isBetaTester: headerBetaTester,
                               createdAt: song.createdAt) {
                    if let own = ownActions { ownMenu(own) }
                }
            }

            NavigationLink(value: song.release.asRelease) {
                HStack(spacing: 13) {
                    CoverImage(url: song.release.coverUrl)
                        .frame(width: 66, height: 66)
                        .accessibilityHidden(true) // title/artist text alongside already describes it

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(song.trackTitle ?? "Unknown Track")
                                .font(.jakarta(14, weight: .bold))
                                .foregroundStyle(Color.sjInk)
                                .lineLimit(2)
                            Text("Song")
                                .font(.jakarta(10, weight: .medium))
                                .foregroundStyle(Color.sjAmber)
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(Color.sjAmber.opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        Text("\(song.release.displayTitle) · \(song.release.displayArtist)")
                            .font(.jakarta(11.5))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    if let score = displayScore {
                        ScoreBadge(score: score)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 14)
            // Extra trailing room when the own-rating ellipsis menu overlays the
            // top-right corner (headerless variant only), so the score badge
            // doesn't sit underneath it.
            .padding(.trailing, ownActions != nil && headerHandle == nil ? 44 : 14)
            .padding(.top, headerHandle == nil ? 14 : 0)
            .padding(.bottom, 10)

            if let text = song.reviewText, !text.isEmpty {
                Text(text)
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }

            HStack(spacing: 16) {
                HStack(spacing: 5) {
                    Button { Task { await onLike() } } label: {
                        Image(isLiked ? "icon-heart-filled" : "icon-heart")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 19, height: 19)
                            .foregroundStyle(isLiked ? .red : Color.sjInk)
                    }
                    .buttonStyle(.plain)
                    .animation(.easeInOut(duration: 0.15), value: isLiked)
                    .accessibilityLabel(isLiked ? String(localized: "Unlike") : String(localized: "Like"))
                    .sensoryFeedback(.impact(weight: .light), trigger: isLiked)

                    if likesCount > 0 {
                        Button { showLikers = true } label: {
                            Text("\(likesCount)")
                                .font(.jakarta(14, weight: .medium))
                                .foregroundStyle(isLiked ? .red : Color.sjMuted)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack(spacing: 5) {
                    Button { showComments = true } label: {
                        Image("icon-message-circle")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 19, height: 19).foregroundStyle(Color.sjInk)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(String(localized: "View comments"))

                    if commentsCount > 0 {
                        Text("\(commentsCount)")
                            .font(.jakarta(14, weight: .medium)).foregroundStyle(Color.sjMuted)
                    }
                }
                Spacer()
                if headerHandle == nil {
                    Text(song.createdAt.relativeTimeString)
                        .font(.jakarta(12)).foregroundStyle(Color.sjMuted)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
        }
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 1)
        .overlay(alignment: .topTrailing) {
            // Headerless variant only -- with a header, the menu lives inside it.
            if let own = ownActions, headerHandle == nil {
                ownMenu(own)
                    .padding(.top, 4)
                    .padding(.trailing, 4)
            }
        }
        .sheet(isPresented: $showComments) {
            SongCommentSheetView(trackRatingId: song.ratingId)
                .presentationDetents([.fraction(0.67), .large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showLikers) {
            SongLikersSheetView(trackRatingId: song.ratingId)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    private func ownMenu(_ own: SongOwnRatingMenuActions) -> some View {
        Menu {
            Button { own.onShare() } label: { Label("Share", image: "icon-share") }
            Button { own.onEdit() } label: { Label("Edit", image: "icon-square-pen") }
            Button { own.onEditComment() } label: { Label("Edit Comment", image: "icon-message-square") }
            Divider()
            Button(role: .destructive) { own.onDelete() } label: { Label("Delete", image: "icon-trash") }
        } label: {
            Image("icon-more-horizontal")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 14, height: 14)
                .foregroundStyle(Color.sjMuted)
                .frame(width: 34, height: 34)
                .contentShape(Rectangle())
        }
        .accessibilityLabel(String(localized: "More options"))
    }
}

#Preview {
    ProfileView(viewModel: ProfileViewModel(), questVM: QuestChecklistViewModel(), onGoToAdd: {}, openSettingsTrigger: .constant(false))
}
