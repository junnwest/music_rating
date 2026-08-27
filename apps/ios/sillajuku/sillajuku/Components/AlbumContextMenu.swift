import SwiftUI
import Supabase

// Shared long-press quick actions for bare album cover art (grids, carousels,
// chart rows) -- surfaces that today require navigating all the way into
// AlbumDetailView just to rate or save something. Not used on full post
// cards (FeedCard, ProfilePostCard, MixShareCard), which already have their
// own ellipsis menu with an overlapping action set.
enum AlbumQuickRate {
    /// Returns whether the write actually landed. Previously `try?`, which swallowed any
    /// failure (network drop, RLS, etc.) while still posting `.ratingChanged` unconditionally
    /// -- callers held an optimistic "rated" score with no way to know it hadn't really saved,
    /// and every listener (e.g. Profile) got told to refresh for a write that never happened.
    @discardableResult
    static func saveManualScore(releaseGroupId: UUID, score: Double) async -> Bool {
        guard let userId = supabase.auth.currentUser?.id else { return false }
        struct Payload: Encodable {
            let userId: UUID; let releaseGroupId: UUID; let score: Double
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case releaseGroupId = "release_group_id"; case score
            }
        }
        do {
            try await supabase.from("ratings")
                .upsert(Payload(userId: userId, releaseGroupId: releaseGroupId, score: score),
                        onConflict: "user_id,release_group_id")
                .execute()
        } catch {
            print("AlbumQuickRate.saveManualScore(\(releaseGroupId)) failed: \(error)")
            return false
        }
        NotificationCenter.default.post(name: .ratingChanged, object: nil)
        return true
    }

    /// Standalone version of AlbumDetailView's `rateTrack(recordingId:score:)` -- same table,
    /// same upsert columns/onConflict target -- for surfaces (Quick Add) that need to write a
    /// song rating without a full AlbumDetailViewModel instance. Same success-reporting shape
    /// as saveManualScore above, for the same reason.
    @discardableResult
    static func saveManualTrackScore(recordingId: UUID, score: Double) async -> Bool {
        guard let userId = supabase.auth.currentUser?.id else { return false }
        struct Payload: Encodable {
            let userId: UUID; let recordingId: UUID; let score: Double
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case recordingId = "recording_id"; case score
            }
        }
        do {
            try await supabase.from("track_ratings")
                .upsert(Payload(userId: userId, recordingId: recordingId, score: score),
                        onConflict: "user_id,recording_id")
                .execute()
        } catch {
            print("AlbumQuickRate.saveManualTrackScore(\(recordingId)) failed: \(error)")
            return false
        }
        NotificationCenter.default.post(name: .ratingChanged, object: nil)
        return true
    }
}

/// File-scope, not nested in `prepareShare()` -- Swift disallows a locally-declared
/// type inside a closure/function body belonging to a generic type (`AlbumContextMenu`
/// is generic over `ExtraItems`), unlike the equivalent inline declarations in
/// AlbumDetailView/SongDetailView/MixDetailView's own non-generic `prepareShare`s.
private struct ShareProfileRow: Decodable { let username: String? }

private struct AlbumMenuPreview: View {
    let release: Release

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CoverImage(url: release.coverUrl, cornerRadius: 12)
                .frame(width: 220, height: 220)
            Text(release.displayTitle)
                .font(.jakarta(15, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .lineLimit(2)
            Text(release.displayArtist)
                .font(.jakarta(13))
                .foregroundStyle(Color.sjMuted)
                .lineLimit(1)
        }
        .padding(14)
        .background(Color.sjSurface)
    }
}

struct AlbumContextMenu<ExtraItems: View>: ViewModifier {
    let release: Release
    @ViewBuilder var extraItems: () -> ExtraItems

    @State private var showManualSheet = false
    @State private var showMixPicker = false
    @State private var quickScore: Double? = nil
    @State private var artistDestination: ArtistDestination? = nil
    @State private var didMarkNotInterested = false
    @State private var pendingShare: PendingShare? = nil

    private var shareURL: URL { URL(string: "https://sillajuku.com/album/\(release.id.uuidString)")! }

    func body(content: Content) -> some View {
        content
            .contextMenu {
                Button {
                    openRateSheet()
                } label: {
                    Label("Rate", systemImage: "star")
                }
                Button {
                    showMixPicker = true
                } label: {
                    Label("Add to Mix", systemImage: "text.badge.plus")
                }
                ShareLink(item: shareURL, subject: Text(release.displayTitle + " · " + release.displayArtist)) {
                    Label("Share", systemImage: "square.and.arrow.up")
                }
                Button {
                    Task { await prepareShare() }
                } label: {
                    Label("Share to Instagram", systemImage: "camera")
                }
                Button {
                    artistDestination = ArtistDestination(artistId: nil, name: release.displayArtist)
                } label: {
                    Label("View Artist", systemImage: "music.mic")
                }
                Button {
                    Task {
                        if await NotInterested.markAlbum(releaseGroupId: release.id) {
                            didMarkNotInterested.toggle()
                        }
                    }
                } label: {
                    Label("Not Interested", systemImage: "hand.thumbsdown")
                }
                extraItems()
            } preview: {
                AlbumMenuPreview(release: release)
            }
            .sensoryFeedback(.success, trigger: didMarkNotInterested)
            .sheet(isPresented: $showManualSheet) {
                ManualRatingSheet(release: release, existingScore: $quickScore) { score in
                    guard let score else { return }
                    Task { await AlbumQuickRate.saveManualScore(releaseGroupId: release.id, score: score) }
                }
            }
            .sheet(isPresented: $showMixPicker) {
                MixPickerView(releaseId: release.id, releaseTitle: release.displayTitle)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(item: $pendingShare) { pending in
                SharePreviewSheet(pending: pending)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .navigationDestination(item: $artistDestination) { ArtistPageView(artist: $0) }
    }

    private func openRateSheet() {
        quickScore = nil
        showManualSheet = true
    }

    /// Shares the album itself, not a rating of it -- this modifier has no
    /// per-user rating state for the release (adding it would mean a new fetch
    /// on every one of this modifier's 9+ call sites app-wide), so score is
    /// always nil here. Mirrors AlbumDetailView's own `prepareShare`.
    private func prepareShare() async {
        var username = "someone"
        if let userId = supabase.auth.currentUser?.id {
            let profile: ShareProfileRow? = try? await supabase
                .from("profiles").select("username")
                .eq("id", value: userId).single().execute().value
            username = profile?.username ?? "someone"
        }

        let coverImage: UIImage? = await {
            guard let coverUrl = release.coverUrl, let url = URL(string: coverUrl) else { return nil }
            return try? await InstagramShare.downloadImage(from: url)
        }()

        pendingShare = PendingShare(
            username: username,
            coverImages: [coverImage],
            title: release.displayTitle,
            subtitle: release.typeLabel + " · " + release.displayArtist,
            score: nil,
            reviewText: nil
        )
    }
}

extension View {
    /// Long-press quick actions (Rate / Add to Mix / Share / View Artist) for
    /// a bare album cover. `extraItems` lets a specific screen append its own
    /// menu rows (e.g. Profile's "Delete Rating") after the standard four.
    func albumContextMenu<Extra: View>(_ release: Release, @ViewBuilder extraItems: @escaping () -> Extra) -> some View {
        modifier(AlbumContextMenu(release: release, extraItems: extraItems))
    }

    func albumContextMenu(_ release: Release) -> some View {
        modifier(AlbumContextMenu(release: release, extraItems: { EmptyView() }))
    }
}
