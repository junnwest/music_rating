import SwiftUI
import Supabase

struct PostRatingOptionsView: View {
    let release: Release
    var continueLabel: LocalizedStringKey
    var onBack: (() -> Void)?
    let onContinue: (String?) -> Void
    // Optional -- lets a host sheet track this view's real content height (e.g. to
    // grow its presentationDetents when the comment TextEditor expands) without
    // every call site needing to opt in.
    var onHeightChange: ((CGFloat) -> Void)? = nil
    /// False when the host page already shows the album's cover/title/artist
    /// elsewhere (e.g. inline on the album page, right below a score badge
    /// that already identifies what was just rated) -- skips `albumHeader`
    /// and its divider so the view starts straight at the comment row instead
    /// of repeating info already on screen. Sheet-based hosts (no other album
    /// context visible) keep the default `true`.
    var showHeader: Bool = true

    @State private var isAddingComment: Bool
    @State private var commentText: String
    @State private var showMixPicker = false

    init(release: Release, continueLabel: LocalizedStringKey = "Continue", initialComment: String = "",
         onBack: (() -> Void)? = nil, onHeightChange: ((CGFloat) -> Void)? = nil,
         showHeader: Bool = true, onContinue: @escaping (String?) -> Void) {
        self.release = release
        self.continueLabel = continueLabel
        self.onBack = onBack
        self.onHeightChange = onHeightChange
        self.showHeader = showHeader
        self.onContinue = onContinue
        self._commentText = State(initialValue: initialComment)
        self._isAddingComment = State(initialValue: !initialComment.isEmpty)
    }

    var body: some View {
        VStack(spacing: 0) {
            if showHeader {
                albumHeader
                Divider().padding(.vertical, 10)
            }
            commentRow
            Divider().padding(.horizontal, 20)
            listRow
            Divider().padding(.horizontal, 20)
            bottomButtons
        }
        .background(
            GeometryReader { geo in
                Color.clear
                    .onAppear { onHeightChange?(geo.size.height) }
                    .onChange(of: geo.size.height) { _, newValue in onHeightChange?(newValue) }
            }
        )
        .sheet(isPresented: $showMixPicker) {
            MixPickerView(releaseId: release.id, releaseTitle: release.displayTitle)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: Album header

    private var albumHeader: some View {
        HStack(spacing: 12) {
            CoverImage(url: release.coverUrl, cornerRadius: 8)
                .frame(width: 44, height: 44)
                .accessibilityHidden(true) // title text alongside already describes it
            VStack(alignment: .leading, spacing: 2) {
                Text(release.displayTitle)
                    .font(.jakarta(14, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(release.typeLabel)
                        .font(.jakarta(10, weight: .medium))
                        .foregroundStyle(Color.sjBlue)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Color.sjBlue.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    Text(release.displayArtist)
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    // MARK: Comment row

    private var commentRow: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isAddingComment.toggle() }
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: "bubble.right")
                        .font(.jakarta(17))
                        .foregroundStyle(Color.sjInk)
                        .frame(width: 24)
                    Text("Add a comment")
                        .font(.jakarta(15))
                        .foregroundStyle(Color.sjInk)
                    Spacer()
                    // "chevron.down" rotating 180° open -- deliberately NOT
                    // the same "chevron.right" the Add to a Mix row below
                    // uses: that one opens a separate modal (navigation
                    // affordance), this one expands inline in place
                    // (disclosure affordance). Using the same glyph for both
                    // would look identical at rest despite meaning different
                    // things. A single glyph that rotates still reads as one
                    // continuous turn -- swapping between separate up/down
                    // glyphs (an earlier approach) didn't interpolate and
                    // read as a glitchy jump instead.
                    Image(systemName: "chevron.down")
                        .font(.jakarta(13, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                        .rotationEffect(.degrees(isAddingComment ? 180 : 0))
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isAddingComment {
                ZStack(alignment: .topLeading) {
                    if commentText.isEmpty {
                        Text("What did you think?")
                            .font(.jakarta(14))
                            .foregroundStyle(Color.sjMuted)
                            .padding(.horizontal, 14)
                            .padding(.top, 10)
                    }
                    TextEditor(text: $commentText)
                        .font(.jakarta(14))
                        .foregroundStyle(Color.sjInk)
                        .scrollContentBackground(.hidden)
                        .frame(height: 68)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                }
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
                .padding(.horizontal, 20)
                .padding(.bottom, 10)
                // Plain opacity, no .move -- `.move(edge: .top)` starts an
                // inserted view shifted UP by its own height (so it enters
                // by sliding down INTO place from above), which for a box
                // sitting directly below the "Add a comment" row meant it
                // started out overlapping that row on the way in. Fading in
                // at its actual (already-correct, growing-height) position
                // avoids the overlap entirely.
                .transition(.opacity)
            }
        }
    }

    // MARK: Mix row

    private var listRow: some View {
        Button { showMixPicker = true } label: {
            HStack(spacing: 14) {
                Image(systemName: "plus.square")
                    .font(.jakarta(17))
                    .foregroundStyle(Color.sjInk)
                    .frame(width: 24)
                Text("Add to a Mix")
                    .font(.jakarta(15))
                    .foregroundStyle(Color.sjInk)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.jakarta(13, weight: .medium))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Bottom buttons

    private var bottomButtons: some View {
        VStack(spacing: 8) {
            Button {
                let text = commentText.trimmingCharacters(in: .whitespaces)
                onContinue(text.isEmpty ? nil : text)
            } label: {
                Text(continueLabel)
                    .font(.jakarta(16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Color.sjBlue)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)

            if let onBack {
                Button {
                    onBack()
                } label: {
                    Text("← Back")
                        .font(.jakarta(14))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 22)
    }
}

// MARK: - Comment-only edit sheet

/// Dedicated modal for the album/song pages' "Edit Comment" action: header +
/// comment editor + Save, nothing else -- unlike PostRatingOptionsView it
/// deliberately has no "Add to a Mix" row (that action has its own menu entry
/// on those pages).
struct CommentEditSheet: View {
    let release: Release
    /// Song pages pass the track title so the header names what's being commented on.
    let trackTitle: String?
    let onSave: (String?) -> Void

    @State private var commentText: String

    init(release: Release, trackTitle: String? = nil, initialComment: String = "",
         onSave: @escaping (String?) -> Void) {
        self.release = release
        self.trackTitle = trackTitle
        self.onSave = onSave
        self._commentText = State(initialValue: initialComment)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                CoverImage(url: release.coverUrl, cornerRadius: 8)
                    .frame(width: 44, height: 44)
                    .accessibilityHidden(true) // title text alongside already describes it
                VStack(alignment: .leading, spacing: 2) {
                    Text(trackTitle ?? release.displayTitle)
                        .font(.jakarta(14, weight: .bold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(trackTitle != nil ? "Song" : release.typeLabel)
                            .font(.jakarta(10, weight: .medium))
                            .foregroundStyle(Color.sjBlue)
                            .padding(.horizontal, 5).padding(.vertical, 2)
                            .background(Color.sjBlue.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                        Text(release.displayArtist)
                            .font(.jakarta(12))
                            .foregroundStyle(Color.sjMuted)
                            .lineLimit(1)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 20)
            .padding(.top, 16)

            Divider().padding(.vertical, 12)

            ZStack(alignment: .topLeading) {
                if commentText.isEmpty {
                    Text("What did you think?")
                        .font(.jakarta(14))
                        .foregroundStyle(Color.sjMuted)
                        .padding(.horizontal, 14)
                        .padding(.top, 10)
                }
                TextEditor(text: $commentText)
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjInk)
                    .scrollContentBackground(.hidden)
                    .frame(height: 110)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
            }
            .background(Color.sjSurface)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
            .padding(.horizontal, 20)

            Button {
                let text = commentText.trimmingCharacters(in: .whitespaces)
                onSave(text.isEmpty ? nil : text)
            } label: {
                Text("Save")
                    .font(.jakarta(16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Color.sjBlue)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20)
            .padding(.top, 14)

            Spacer(minLength: 0)
        }
    }
}
