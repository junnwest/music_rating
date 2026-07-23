import SwiftUI
import Supabase

// Shared long-press quick actions for bare album cover art (grids, carousels,
// chart rows) -- surfaces that today require navigating all the way into
// AlbumDetailView just to rate or save something. Not used on full post
// cards (FeedCard, ProfilePostCard, MixShareCard), which already have their
// own ellipsis menu with an overlapping action set.
enum AlbumQuickRate {
    static func currentUserRatingMode() async -> String {
        guard let userId = supabase.auth.currentUser?.id else { return "manual" }
        struct P: Decodable {
            let ratingMode: String?
            enum CodingKeys: String, CodingKey { case ratingMode = "rating_mode" }
        }
        let p: P? = try? await supabase
            .from("profiles").select("rating_mode")
            .eq("id", value: userId).single().execute().value
        return p?.ratingMode ?? "manual"
    }

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

private struct AlbumMenuPreview: View {
    let release: Release

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CoverImage(url: release.coverUrl, cornerRadius: 12)
                .frame(width: 220, height: 220)
            Text(release.displayTitle)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(Color.sjInk)
                .lineLimit(2)
            Text(release.displayArtist)
                .font(.system(size: 13))
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
    @State private var showInstinctSheet = false
    @State private var showMixPicker = false
    @State private var quickScore: Double? = nil
    @State private var artistDestination: ArtistDestination? = nil

    private var shareURL: URL { URL(string: "https://sillajuku.com/album/\(release.id.uuidString)")! }

    func body(content: Content) -> some View {
        content
            .contextMenu {
                Button {
                    Task { await openRateSheet() }
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
                    artistDestination = ArtistDestination(artistId: nil, name: release.displayArtist)
                } label: {
                    Label("View Artist", systemImage: "music.mic")
                }
                extraItems()
            } preview: {
                AlbumMenuPreview(release: release)
            }
            .sheet(isPresented: $showManualSheet) {
                ManualRatingSheet(release: release, existingScore: $quickScore) { score in
                    guard let score else { return }
                    Task { await AlbumQuickRate.saveManualScore(releaseGroupId: release.id, score: score) }
                }
            }
            .sheet(isPresented: $showInstinctSheet) {
                InstinctRatingView(release: release)
            }
            .sheet(isPresented: $showMixPicker) {
                MixPickerView(releaseId: release.id, releaseTitle: release.displayTitle)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            .navigationDestination(item: $artistDestination) { ArtistPageView(artist: $0) }
    }

    private func openRateSheet() async {
        let mode = await AlbumQuickRate.currentUserRatingMode()
        if mode == "instinct" {
            showInstinctSheet = true
        } else {
            quickScore = nil
            showManualSheet = true
        }
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
