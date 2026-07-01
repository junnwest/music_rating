import SwiftUI
import Supabase

struct PostRatingOptionsView: View {
    let release: Release
    var ratingId: UUID?
    let onDone: () -> Void

    @State private var isAddingComment = false
    @State private var commentText = ""
    @State private var isSavingComment = false
    @State private var commentSaved = false
    @State private var showMixPicker = false

    var body: some View {
        VStack(spacing: 0) {
            albumHeader

            Divider().padding(.vertical, 14)

            commentRow

            Divider().padding(.horizontal, 20)

            listRow

            Divider().padding(.horizontal, 20)

            Button("Skip") { onDone() }
                .font(.system(size: 14))
                .foregroundStyle(Color.sjMuted)
                .padding(.top, 16)
                .padding(.bottom, 28)
        }
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
                .frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(release.displayTitle)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                Text(release.displayArtist)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.sjMuted)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 20)
    }

    // MARK: Comment row

    private var commentRow: some View {
        VStack(spacing: 0) {
            Button {
                guard !commentSaved else { return }
                withAnimation(.easeInOut(duration: 0.2)) { isAddingComment.toggle() }
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: commentSaved ? "checkmark.bubble.fill" : "bubble.right")
                        .font(.system(size: 18))
                        .foregroundStyle(commentSaved ? Color.sjBlue : Color.sjInk)
                        .frame(width: 24)
                    Text(commentSaved ? "Comment saved" : "Add a comment")
                        .font(.system(size: 15))
                        .foregroundStyle(commentSaved ? Color.sjBlue : Color.sjInk)
                    Spacer()
                    if !commentSaved {
                        Image(systemName: isAddingComment ? "chevron.up" : "chevron.down")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.sjMuted)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isAddingComment && !commentSaved {
                VStack(spacing: 10) {
                    ZStack(alignment: .topLeading) {
                        if commentText.isEmpty {
                            Text("What did you think?")
                                .font(.system(size: 14))
                                .foregroundStyle(Color.sjMuted)
                                .padding(.horizontal, 14)
                                .padding(.top, 12)
                        }
                        TextEditor(text: $commentText)
                            .font(.system(size: 14))
                            .foregroundStyle(Color.sjInk)
                            .scrollContentBackground(.hidden)
                            .frame(minHeight: 80, maxHeight: 120)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                    }
                    .background(Color.sjSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
                    .padding(.horizontal, 20)

                    Button {
                        Task { await saveComment() }
                    } label: {
                        Group {
                            if isSavingComment {
                                ProgressView().scaleEffect(0.8).tint(.white)
                            } else {
                                Text("Save Comment")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(.white)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(
                            commentText.trimmingCharacters(in: .whitespaces).isEmpty
                                ? Color.sjBorder : Color.sjBlue
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(commentText.trimmingCharacters(in: .whitespaces).isEmpty || isSavingComment)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 12)
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: List row

    private var listRow: some View {
        Button { showMixPicker = true } label: {
            HStack(spacing: 14) {
                Image(systemName: "plus.square")
                    .font(.system(size: 18))
                    .foregroundStyle(Color.sjInk)
                    .frame(width: 24)
                Text("Add to a list")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjInk)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Save

    private func saveComment() async {
        guard let rid = ratingId else { return }
        let text = commentText.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }

        isSavingComment = true
        struct Update: Encodable {
            let reviewText: String
            enum CodingKeys: String, CodingKey { case reviewText = "review_text" }
        }
        try? await supabase.from("ratings")
            .update(Update(reviewText: text))
            .eq("id", value: rid)
            .execute()
        isSavingComment = false
        withAnimation(.easeInOut(duration: 0.2)) {
            commentSaved = true
            isAddingComment = false
        }
    }
}
