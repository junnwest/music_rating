import SwiftUI
import Supabase

/// Song counterpart to `AlbumRateButton` -- writes `track_ratings` instead of
/// `ratings`, opens `TrackRatingSheet` as the precise fallback. Same
/// self-contained/controlled-or-uncontrolled shape; see `AlbumRateButton`'s
/// doc comment for the pattern (including the Instinct-mode caveat -- callers
/// in Instinct mode should not render this).
struct SongRateButton: View {
    let track: TrackEntry
    let release: Release
    var initialScore: Double? = nil
    var externalScore: Binding<Double?>? = nil
    var onScoreChange: ((Double?) -> Void)? = nil
    var size: CGFloat = 30

    @State private var internalShown: Double?
    @State private var modalOpen = false

    private var shown: Double? { externalScore?.wrappedValue ?? internalShown }

    init(track: TrackEntry, release: Release, initialScore: Double? = nil,
         externalScore: Binding<Double?>? = nil, onScoreChange: ((Double?) -> Void)? = nil, size: CGFloat = 30) {
        self.track = track
        self.release = release
        self.initialScore = initialScore
        self.externalScore = externalScore
        self.onScoreChange = onScoreChange
        self.size = size
        self._internalShown = State(initialValue: initialScore)
    }

    var body: some View {
        if supabase.auth.currentUser?.id != nil {
            FlowerRateControl(
                onRate: { s in Task { await quickRate(s) } },
                onRequestPrecise: { modalOpen = true },
                size: size,
                currentScore: shown,
                accessibilityLabelText: String(format: String(localized: "Rate %@"), track.title)
            )
            .sheet(isPresented: $modalOpen) {
                TrackRatingSheet(track: track, release: release, existingScore: shown) { _, s in
                    Task { await saveModal(s) }
                }
            }
        }
    }

    private func setShown(_ s: Double?) {
        if externalScore != nil { externalScore!.wrappedValue = s } else { internalShown = s }
    }

    private func quickRate(_ s: Double) async {
        guard let recordingId = track.trackId else { return }
        setShown(s)
        guard let userId = supabase.auth.currentUser?.id else { return }
        struct Upsert: Encodable {
            let userId: UUID; let recordingId: UUID; let score: Double
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case recordingId = "recording_id"; case score
            }
        }
        try? await supabase.from("track_ratings")
            .upsert(Upsert(userId: userId, recordingId: recordingId, score: s),
                    onConflict: "user_id,recording_id")
            .execute()
        onScoreChange?(s)
    }

    private func saveModal(_ s: Double?) async {
        guard let recordingId = track.trackId else { return }
        setShown(s)
        guard let userId = supabase.auth.currentUser?.id else { return }
        if let s {
            struct Upsert: Encodable {
                let userId: UUID; let recordingId: UUID; let score: Double
                enum CodingKeys: String, CodingKey {
                    case userId = "user_id"; case recordingId = "recording_id"; case score
                }
            }
            try? await supabase.from("track_ratings")
                .upsert(Upsert(userId: userId, recordingId: recordingId, score: s),
                        onConflict: "user_id,recording_id")
                .execute()
        } else {
            try? await supabase.from("track_ratings")
                .delete()
                .eq("user_id", value: userId)
                .eq("recording_id", value: recordingId)
                .execute()
        }
        onScoreChange?(s)
    }
}
