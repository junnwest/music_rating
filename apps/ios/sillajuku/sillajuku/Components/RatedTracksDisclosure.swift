import SwiftUI

/// "♪ Rated N tracks ⌄" under an album post: the tracks its author rated on
/// that album, expanding in place. Song ratings don't post on their own (since
/// 2026-10-06) -- this and the album tracklist are the only places they show.
/// Renders nothing until it knows the author rated at least one track.
///
/// A track row opens the album scrolled to that track. On the album page
/// itself, pass `onSelectTrack` to scroll the page instead of pushing it again.
struct RatedTracksDisclosure: View {
    let userId: UUID
    let release: Release
    var onSelectTrack: ((UUID) -> Void)? = nil

    @State private var tracks: [RatedTrack] = []
    @State private var isOpen = false

    var body: some View {
        // A VStack, not a Group: `.task` on a Group attaches to its children, and
        // with no tracks yet there are none -- so the load never ran and the list
        // could never appear. An empty VStack is still a view, so the task fires.
        VStack(alignment: .leading, spacing: 0) {
            if !tracks.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { isOpen.toggle() }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "music.note")
                                .font(.system(size: 11, weight: .semibold))
                            Text(tracks.count == 1
                                 ? String(localized: "Rated 1 track")
                                 : String(format: String(localized: "Rated %d tracks"), tracks.count))
                                .font(.jakarta(12.5, weight: .semibold))
                            Image(systemName: "chevron.down")
                                .font(.system(size: 10, weight: .semibold))
                                .rotationEffect(.degrees(isOpen ? 180 : 0))
                        }
                        .foregroundStyle(Color.sjMuted)
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .background(Capsule().fill(Color.sjCream))
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(isOpen ? String(localized: "Collapse") : String(localized: "Expand"))

                    if isOpen {
                        VStack(spacing: 0) {
                            ForEach(Array(tracks.enumerated()), id: \.element.id) { i, track in
                                row(track)
                                if i < tracks.count - 1 { Divider().padding(.leading, 40) }
                            }
                        }
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder, lineWidth: 0.5))
                        .transition(.opacity)
                    }
                }
            }
        }
        .task(id: "\(userId)-\(release.id)") {
            tracks = await PostRatedTracks.shared.tracks(userId: userId, releaseGroupId: release.id)
        }
    }

    private var isMultiDisc: Bool { Set(tracks.map(\.discNumber)).count > 1 }

    @ViewBuilder
    private func row(_ track: RatedTrack) -> some View {
        if let onSelectTrack {
            Button { onSelectTrack(track.recordingId) } label: { rowContent(track) }
                .buttonStyle(.plain)
        } else {
            NavigationLink {
                AlbumDetailView(release: release, focusRecordingId: track.recordingId)
            } label: { rowContent(track) }
                .buttonStyle(.plain)
        }
    }

    private func rowContent(_ track: RatedTrack) -> some View {
        HStack(spacing: 10) {
            Text(isMultiDisc ? "\(track.discNumber)-\(track.position)" : "\(track.position)")
                .font(.jakarta(12)).foregroundStyle(Color.sjMuted)
                .frame(width: 26, alignment: .trailing)
            Text(track.title)
                .font(.jakarta(13)).foregroundStyle(Color.sjInk).lineLimit(1)
            Spacer(minLength: 0)
            ScoreBadge(score: track.score, badgeSize: 22, ringStroke: 1.5, ringGap: 1)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .contentShape(Rectangle())
    }
}
