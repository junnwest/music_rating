import SwiftUI
import Supabase

// Structural mirror of CommentSheetView.swift, over mix_share_comments
// instead of rating_comments -- duplicated rather than made generic,
// consistent with this codebase's existing per-entity convention
// (rating_likes/rating_comments vs. the older comment_likes).

// MARK: - Model

struct MixShareComment: Codable, Identifiable {
    let id: UUID
    let userId: UUID
    let content: String
    let createdAt: Date
    let profiles: CommentProfile?

    struct CommentProfile: Codable {
        let username: String?
        let displayName: String?
        enum CodingKeys: String, CodingKey {
            case username
            case displayName = "display_name"
        }
        var handle: String { username ?? displayName ?? String(localized: "someone") }
    }

    enum CodingKeys: String, CodingKey {
        case id, content, profiles
        case userId    = "user_id"
        case createdAt = "created_at"
    }
}

// MARK: - Sheet

struct MixShareCommentSheetView: View {
    let mixShareId: UUID

    @State private var comments: [MixShareComment] = []
    @State private var isLoading = true
    @State private var newComment = ""
    @State private var isSending = false
    @State private var errorMessage: String?
    @State private var editingComment: MixShareComment?
    @FocusState private var isInputFocused: Bool

    private var currentUserId: UUID? { supabase.auth.currentUser?.id }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                commentList
                if let err = errorMessage {
                    HStack(spacing: 6) {
                        Image("icon-alert-circle")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 12, height: 12)
                            .foregroundStyle(.red)
                        Text(err)
                            .font(.jakarta(12)).foregroundStyle(.red)
                        Spacer()
                    }
                    .padding(.horizontal, 16).padding(.vertical, 6)
                    .background(Color.red.opacity(0.06))
                }
                Divider()
                inputBar
            }
            .background(Color.sjCream.ignoresSafeArea())
            .navigationTitle(isLoading ? String(localized: "Comments") : (comments.count == 1 ? String(localized: "1 Comment") : String(format: String(localized: "%d Comments"), comments.count)))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
        }
        .task { await loadComments() }
    }

    @ViewBuilder
    private var commentList: some View {
        if isLoading {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if comments.isEmpty {
            VStack(spacing: 12) {
                Image("icon-message-square")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 36, height: 36)
                    .foregroundStyle(Color.sjBorder)
                Text("No comments yet.\nBe the first!")
                    .font(.jakarta(15))
                    .foregroundStyle(Color.sjMuted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView(showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(comments) { comment in
                        NavigationLink(value: UserProfileDestination(
                            userId: comment.userId,
                            handle: comment.profiles?.handle ?? String(localized: "someone")
                        )) {
                            MixShareCommentRow(
                                comment: comment,
                                isOwn: comment.userId == currentUserId,
                                onRequestEdit: {
                                    editingComment = comment
                                    newComment = comment.content
                                    isInputFocused = true
                                },
                                onDelete: { Task { await deleteComment(comment) } }
                            )
                        }
                        .buttonStyle(.plain)
                        if comment.id != comments.last?.id {
                            Divider().padding(.leading, 54)
                        }
                    }
                }
            }
        }
    }

    /// See `CommentSheetView.inputBar`'s own comment for why editing
    /// happens in this bar (Instagram-style) rather than inline in the row.
    private var inputBar: some View {
        VStack(alignment: .leading, spacing: 0) {
            if editingComment != nil {
                HStack {
                    Text("Editing comment")
                        .font(.jakarta(12, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                    Spacer()
                    Button {
                        editingComment = nil
                        newComment = ""
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.sjMuted)
                    }
                    .accessibilityLabel(String(localized: "Cancel editing"))
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 2)
            }
            HStack(spacing: 10) {
                DefaultAvatarView(size: 30)

                TextField("Add a comment…", text: $newComment, axis: .vertical)
                    .font(.jakarta(14))
                    .lineLimit(1...4)
                    .focused($isInputFocused)
                    .submitLabel(.send)
                    .onSubmit { Task { await submitInput() } }

                if !newComment.trimmingCharacters(in: .whitespaces).isEmpty {
                    Button {
                        Task { await submitInput() }
                    } label: {
                        if isSending {
                            ProgressView().scaleEffect(0.75)
                        } else {
                            Image("icon-arrow-up-circle")
                                .renderingMode(.template)
                                .resizable().scaledToFit()
                                .frame(width: 28, height: 28)
                                .foregroundStyle(Color.sjAmber)
                        }
                    }
                    .disabled(isSending)
                    .accessibilityLabel(String(localized: "Send comment"))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color.sjSurface)
    }

    private func loadComments() async {
        let fetched = (try? await supabase
            .from("mix_share_comments")
            .select("id, user_id, content, created_at, profiles!mix_share_comments_user_id_fkey(username, display_name)")
            .eq("mix_share_id", value: mixShareId)
            .order("created_at", ascending: true)
            .execute()
            .value) ?? [MixShareComment]()
        comments  = fetched
        isLoading = false
    }

    private func submitInput() async {
        if editingComment != nil {
            await saveEditedComment()
        } else {
            await sendComment()
        }
    }

    private func saveEditedComment() async {
        guard let editing = editingComment else { return }
        let text = newComment.trimmingCharacters(in: .whitespaces)
        editingComment = nil
        newComment = ""
        guard !text.isEmpty, text != editing.content else { return }
        await editComment(editing, newContent: text)
    }

    private func editComment(_ comment: MixShareComment, newContent: String) async {
        struct Payload: Encodable { let content: String }
        do {
            try await supabase
                .from("mix_share_comments")
                .update(Payload(content: newContent))
                .eq("id", value: comment.id)
                .execute()
            errorMessage = nil
            await loadComments()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteComment(_ comment: MixShareComment) async {
        do {
            try await supabase
                .from("mix_share_comments")
                .delete()
                .eq("id", value: comment.id)
                .execute()
            errorMessage = nil
            await loadComments()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func sendComment() async {
        guard let userId = currentUserId else {
            errorMessage = String(localized: "You must be signed in to comment")
            return
        }
        let text = newComment.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }

        isSending = true
        struct Payload: Encodable {
            let userId: UUID; let mixShareId: UUID; let content: String
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case mixShareId = "mix_share_id"; case content
            }
        }
        do {
            try await supabase
                .from("mix_share_comments")
                .insert(Payload(userId: userId, mixShareId: mixShareId, content: text))
                .execute()
            newComment = ""
            errorMessage = nil
            await loadComments()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSending = false
    }
}

// MARK: - Comment row

// See CommentSheetView.swift's own CommentRow for why edit/delete are plain
// text links under the comment (Instagram-style) and editing happens in the
// compose bar rather than inline in this row.
private struct MixShareCommentRow: View {
    let comment: MixShareComment
    var isOwn: Bool = false
    var onRequestEdit: () -> Void = {}
    var onDelete: () -> Void = {}

    @State private var showDeleteConfirm = false

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            DefaultAvatarView(size: 34)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("@" + (comment.profiles?.handle ?? String(localized: "someone")))
                        .font(.jakarta(13, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    Text(comment.createdAt.relativeTimeString)
                        .font(.jakarta(12))
                        .foregroundStyle(Color.sjMuted)
                }
                Text(comment.content)
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                if isOwn {
                    HStack(spacing: 14) {
                        Button(action: onRequestEdit) {
                            Text("Edit")
                                .font(.jakarta(12, weight: .semibold))
                                .foregroundStyle(Color.sjMuted)
                        }
                        Button {
                            showDeleteConfirm = true
                        } label: {
                            Text("Delete")
                                .font(.jakarta(12, weight: .semibold))
                                .foregroundStyle(Color.sjMuted)
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 3)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .confirmationDialog(
            String(localized: "Delete this comment?"),
            isPresented: $showDeleteConfirm,
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete"), role: .destructive) { onDelete() }
        }
    }
}
