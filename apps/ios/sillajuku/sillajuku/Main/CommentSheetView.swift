import SwiftUI
import Supabase

// MARK: - Model

struct RatingComment: Codable, Identifiable {
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
        var initial: String { String((username ?? displayName ?? "?").prefix(1)).uppercased() }
    }

    enum CodingKeys: String, CodingKey {
        case id, content, profiles
        case userId    = "user_id"
        case createdAt = "created_at"
    }
}

// MARK: - Sheet

struct CommentSheetView: View {
    let ratingId: UUID

    @State private var comments: [RatingComment]
    @State private var isLoading: Bool
    @State private var newComment = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    init(ratingId: UUID, preloaded: [RatingComment]? = nil) {
        self.ratingId = ratingId
        if let pre = preloaded {
            _comments  = State(initialValue: pre)
            _isLoading = State(initialValue: false)
        } else {
            _comments  = State(initialValue: [])
            _isLoading = State(initialValue: true)
        }
    }

    private var currentUserId: UUID? { supabase.auth.currentUser?.id }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                commentList
                if let err = errorMessage {
                    // error banner sits above the input bar
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 12)).foregroundStyle(.red)
                        Text(err)
                            .font(.system(size: 12)).foregroundStyle(.red)
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

    // MARK: List

    @ViewBuilder
    private var commentList: some View {
        if isLoading {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if comments.isEmpty {
            VStack(spacing: 12) {
                Image(systemName: "bubble.right")
                    .font(.system(size: 36))
                    .foregroundStyle(Color.sjBorder)
                Text("No comments yet.\nBe the first!")
                    .font(.system(size: 15))
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
                            CommentRow(comment: comment)
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

    // MARK: Input

    private var inputBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 30))
                .foregroundStyle(Color(uiColor: .systemGray3))

            TextField("Add a comment…", text: $newComment, axis: .vertical)
                .font(.system(size: 14))
                .lineLimit(1...4)
                .submitLabel(.send)
                .onSubmit { Task { await sendComment() } }

            if !newComment.trimmingCharacters(in: .whitespaces).isEmpty {
                Button {
                    Task { await sendComment() }
                } label: {
                    if isSending {
                        ProgressView().scaleEffect(0.75)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(Color.sjAmber)
                    }
                }
                .disabled(isSending)
                .accessibilityLabel(String(localized: "Send comment"))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.sjSurface)
    }

    // MARK: Data

    private func loadComments() async {
        let fetched = (try? await supabase
            .from("rating_comments")
            .select("id, user_id, content, created_at, profiles!rating_comments_user_id_fkey(username, display_name)")
            .eq("rating_id", value: ratingId)
            .order("created_at", ascending: true)
            .execute()
            .value) ?? [RatingComment]()
        comments  = fetched
        isLoading = false
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
            let userId: UUID; let ratingId: UUID; let content: String
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case ratingId = "rating_id"; case content
            }
        }
        do {
            try await supabase
                .from("rating_comments")
                .insert(Payload(userId: userId, ratingId: ratingId, content: text))
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

// MARK: - Song rating comment sheet

// 1:1 mirror of CommentSheetView, targeting track_rating_comments/track_rating_id instead of
// rating_comments/rating_id -- song ratings have their own comment table (migration
// 20260713000001) since track_ratings isn't the same row space as ratings.
struct SongCommentSheetView: View {
    let trackRatingId: UUID

    @State private var comments: [RatingComment] = []
    @State private var isLoading = true
    @State private var newComment = ""
    @State private var isSending = false
    @State private var errorMessage: String?

    private var currentUserId: UUID? { supabase.auth.currentUser?.id }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                commentList
                if let err = errorMessage {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 12)).foregroundStyle(.red)
                        Text(err)
                            .font(.system(size: 12)).foregroundStyle(.red)
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
                Image(systemName: "bubble.right")
                    .font(.system(size: 36))
                    .foregroundStyle(Color.sjBorder)
                Text("No comments yet.\nBe the first!")
                    .font(.system(size: 15))
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
                            CommentRow(comment: comment)
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

    private var inputBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 30))
                .foregroundStyle(Color(uiColor: .systemGray3))

            TextField("Add a comment…", text: $newComment, axis: .vertical)
                .font(.system(size: 14))
                .lineLimit(1...4)
                .submitLabel(.send)
                .onSubmit { Task { await sendComment() } }

            if !newComment.trimmingCharacters(in: .whitespaces).isEmpty {
                Button {
                    Task { await sendComment() }
                } label: {
                    if isSending {
                        ProgressView().scaleEffect(0.75)
                    } else {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(Color.sjAmber)
                    }
                }
                .disabled(isSending)
                .accessibilityLabel(String(localized: "Send comment"))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.sjSurface)
    }

    private func loadComments() async {
        let fetched = (try? await supabase
            .from("track_rating_comments")
            .select("id, user_id, content, created_at, profiles!track_rating_comments_user_id_fkey(username, display_name)")
            .eq("track_rating_id", value: trackRatingId)
            .order("created_at", ascending: true)
            .execute()
            .value) ?? [RatingComment]()
        comments  = fetched
        isLoading = false
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
            let userId: UUID; let trackRatingId: UUID; let content: String
            enum CodingKeys: String, CodingKey {
                case userId = "user_id"; case trackRatingId = "track_rating_id"; case content
            }
        }
        do {
            try await supabase
                .from("track_rating_comments")
                .insert(Payload(userId: userId, trackRatingId: trackRatingId, content: text))
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

private struct CommentRow: View {
    let comment: RatingComment

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "person.circle.fill")
                .font(.system(size: 34))
                .foregroundStyle(Color(uiColor: .systemGray3))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text("@" + (comment.profiles?.handle ?? String(localized: "someone")))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.sjInk)
                        .lineLimit(1)
                    Text(comment.createdAt.relativeTimeString)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                }
                Text(comment.content)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}
