import SwiftUI
import Supabase

// The Home feed card for a mix shared as a post -- structurally mirrors
// FeedCard's header/action-bar conventions, but the tappable body is a
// stacked-cover visual + mix name instead of a single album, and there's
// no Add/Save (no single release to act on). Report is deferred for v1
// (ReportSheet is private to HomeView.swift and hardcodes ratingId) --
// only Block is offered here.

private enum MixShareCardSheet: Identifiable {
    case comments, likers
    var id: Self { self }
}

struct MixShareCard: View {
    let post: MixSharePost
    let currentUserId: UUID?
    let isLiked: Bool
    let likesCount: Int
    let commentsCount: Int
    let onLike: () async -> Void
    let onBlock: () async -> Void
    let onOwnProfileTap: () -> Void

    @State private var activeSheet: MixShareCardSheet?
    @State private var showBlockConfirm = false

    private var isOwnPost: Bool {
        guard let cid = currentUserId else { return false }
        return post.userId == cid
    }

    private var mixDestination: Mix {
        Mix(id: post.mixId, userId: post.userId, name: post.mixName, isPublic: true,
            isDefault: false, createdAt: post.createdAt, description: post.mixDescription)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            cardHeader
            NavigationLink(destination: MixDetailView(mix: mixDestination)) {
                VStack(alignment: .leading, spacing: 8) {
                    StackedCoversView(coverUrls: post.coverUrls, size: 64, overlapFraction: 0.45)
                        .padding(.horizontal, 14)
                    HStack(spacing: 6) {
                        Image(systemName: "music.note.list")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.sjBlue)
                        Text(post.mixName)
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(Color.sjInk)
                    }
                    .padding(.horizontal, 14)
                }
                .padding(.bottom, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let caption = post.caption, !caption.isEmpty {
                Text(caption)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.sjInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.bottom, 10)
            }
            actionBar
        }
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.05), radius: 4, x: 0, y: 1)
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .comments:
                MixShareCommentSheetView(mixShareId: post.id)
                    .presentationDetents([.fraction(0.67), .large])
                    .presentationDragIndicator(.visible)
            case .likers:
                MixShareLikersSheetView(mixShareId: post.id)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
        .confirmationDialog(
            "Block this user?",
            isPresented: $showBlockConfirm,
            titleVisibility: .visible
        ) {
            Button("Block", role: .destructive) { Task { await onBlock() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Their posts won't appear in your feed.")
        }
    }

    // MARK: Header

    private var cardHeader: some View {
        HStack(spacing: 9) {
            avatarLink
            usernameLink

            Text("shared a mix")
                .font(.system(size: 13))
                .foregroundStyle(Color.sjMuted)

            Text("·").font(.system(size: 13)).foregroundStyle(Color.sjBorder)

            Text(post.createdAt.relativeTimeString)
                .font(.system(size: 12)).foregroundStyle(Color.sjMuted)

            Spacer(minLength: 0)

            if !isOwnPost {
                Menu {
                    Button(role: .destructive) { showBlockConfirm = true } label: {
                        Label("Block this user", systemImage: "hand.raised")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                        .frame(width: 34, height: 34)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(String(localized: "More options"))
            }
        }
        .padding(.leading, 14).padding(.trailing, 4)
        .padding(.top, 10).padding(.bottom, 6)
    }

    @ViewBuilder
    private var avatarLink: some View {
        let icon = Image(systemName: "person.circle.fill")
            .font(.system(size: 30))
            .foregroundStyle(Color(uiColor: .systemGray3))
        let handle = post.profile?.handle
        let label = handle.map { String(format: String(localized: "View @%@'s profile"), $0) }
            ?? String(localized: "View profile")

        if isOwnPost {
            Button { onOwnProfileTap() } label: { icon }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "Your profile"))
        } else if let profile = post.profile {
            NavigationLink(value: UserProfileDestination(userId: post.userId, handle: profile.handle)) {
                icon
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        } else {
            icon
        }
    }

    @ViewBuilder
    private var usernameLink: some View {
        let label = HStack(spacing: 4) {
            Text("@" + (post.profile?.handle ?? String(localized: "someone")))
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(Color.sjInk)
            if post.profile?.isVerified == true {
                VerifiedBadgeView()
                    .frame(width: 13, height: 13)
                    .accessibilityLabel(String(localized: "Verified"))
            }
        }

        if isOwnPost {
            Button { onOwnProfileTap() } label: { label }
                .buttonStyle(.plain)
        } else if let profile = post.profile {
            NavigationLink(value: UserProfileDestination(userId: post.userId, handle: profile.handle)) {
                label
            }
            .buttonStyle(.plain)
        } else {
            label
        }
    }

    // MARK: Action bar

    private var actionBar: some View {
        HStack(spacing: 16) {
            HStack(spacing: 5) {
                Button { Task { await onLike() } } label: {
                    Image(systemName: isLiked ? "heart.fill" : "heart")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(isLiked ? .red : Color.sjInk)
                }
                .buttonStyle(.plain)
                .animation(.easeInOut(duration: 0.15), value: isLiked)
                .accessibilityLabel(isLiked ? String(localized: "Unlike") : String(localized: "Like"))
                .sensoryFeedback(.impact(weight: .light), trigger: isLiked)

                if likesCount > 0 {
                    Button { activeSheet = .likers } label: {
                        Text("\(likesCount)")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(isLiked ? .red : Color.sjMuted)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 5) {
                Button { activeSheet = .comments } label: {
                    Image(systemName: "bubble.left")
                        .font(.system(size: 19, weight: .medium))
                        .foregroundStyle(Color.sjInk)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(localized: "View comments"))

                if commentsCount > 0 {
                    Text("\(commentsCount)")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.leading, 14)
        .padding(.vertical, 6)
    }
}

// MARK: - Likers sheet (mirrors LikersSheetView, over mix_share_likes)

struct MixShareLikersSheetView: View {
    let mixShareId: UUID

    private struct LikerRow: Codable {
        let userId: UUID
        let profiles: LikerProfile?
        struct LikerProfile: Codable {
            let id: UUID
            let username: String?
            let displayName: String?
            enum CodingKeys: String, CodingKey {
                case id, username
                case displayName = "display_name"
            }
            var handle: String { username ?? displayName ?? String(localized: "someone") }
        }
        enum CodingKeys: String, CodingKey {
            case userId = "user_id"; case profiles
        }
    }

    @State private var likers: [LikerRow] = []
    @State private var isLoading = true

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if likers.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "heart").font(.system(size: 36)).foregroundStyle(Color.sjBorder)
                        Text("No likes yet").font(.system(size: 15)).foregroundStyle(Color.sjMuted)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.sjCream.ignoresSafeArea())
                } else {
                    List(Array(likers.enumerated()), id: \.offset) { _, liker in
                        NavigationLink(value: UserProfileDestination(
                            userId: liker.profiles?.id ?? liker.userId,
                            handle: liker.profiles?.handle ?? String(localized: "someone")
                        )) {
                            HStack(spacing: 11) {
                                Image(systemName: "person.circle.fill")
                                    .font(.system(size: 32))
                                    .foregroundStyle(Color(uiColor: .systemGray3))
                                Text("@" + (liker.profiles?.handle ?? String(localized: "someone")))
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Color.sjInk)
                            }
                            .padding(.vertical, 4)
                        }
                        .listRowBackground(Color.sjSurface)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(Color.sjCream.ignoresSafeArea())
                }
            }
            .navigationTitle(likers.count == 1 ? String(localized: "1 Like") : String(format: String(localized: "%d Likes"), likers.count))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: UserProfileDestination.self) { dest in
                UserProfileView(userId: dest.userId, initialHandle: dest.handle)
            }
        }
        .task { await load() }
    }

    private func load() async {
        isLoading = true
        likers = (try? await supabase
            .from("mix_share_likes").select("user_id, profiles!mix_share_likes_user_id_fkey(id, username, display_name)")
            .eq("mix_share_id", value: mixShareId).execute().value) ?? []
        isLoading = false
    }
}
