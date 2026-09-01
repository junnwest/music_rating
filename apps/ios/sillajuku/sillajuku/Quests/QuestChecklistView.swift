import SwiftUI

/// The persistent "Getting Started" entry point (Profile's nav-bar icon and
/// tab badge both open this same view/view model, so they can never drift
/// out of sync). `vm` is injected from MainTabView (hoisted, not owned here)
/// so the badge/dot and this sheet's content always reflect the same
/// completion state -- not auto-presented on launch; discovery is via the
/// dot badge, which persists until every quest is actually complete.
struct QuestChecklistView: View {
    var vm: QuestChecklistViewModel
    // Matches TasteView's own onGoToAdd convention -- threaded down from
    // MainTabView via ProfileView.
    var onGoToAdd: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var showEditProfile = false
    @State private var showInvite = false
    @State private var showPhoneVerification = false
    @State private var showUserSearch = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sjCream.ignoresSafeArea()
                if vm.isLoading {
                    ProgressView().tint(Color.sjAmber)
                } else {
                    content
                }
            }
            .navigationTitle("Getting Started")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .sheet(isPresented: $showEditProfile, onDismiss: { Task { await vm.load() } }) {
                EditProfileView(profile: vm.profile)
            }
            .sheet(isPresented: $showInvite, onDismiss: { Task { await vm.load() } }) {
                InviteView()
            }
            .sheet(isPresented: $showPhoneVerification, onDismiss: { Task { await vm.load() } }) {
                PhoneVerificationView()
            }
            .sheet(isPresented: $showUserSearch, onDismiss: { Task { await vm.load() } }) {
                UserSearchSheet()
            }
        }
        .task { await vm.load() }
    }

    private var content: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 28) {
                Text("Quests")
                    .font(.jakarta(22, weight: .bold))
                    .foregroundStyle(Color.sjInk)

                QuestTimeline(items: timelineItems)

                communityBlock
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 40)
        }
    }

    // Every item carries a (current, target) progress pair uniformly -- binary
    // quests (follow, first rating, etc.) are just target=1, so "0/1"/"1/1"
    // renders the same way a countable quest's progress does. Rewards are
    // deliberately NOT text on the row anymore -- they're carried as a
    // separate `reward` (icon + description shown in a tappable popover),
    // kept visually distinct from progress rather than mixed into it. Every
    // row now has an action -- each one navigates somewhere concrete (rating
    // quests dismiss this sheet and switch to Add; "Follow a person" opens
    // the same UserSearchSheet the Profile nav bar's search icon uses).
    private var timelineItems: [QuestTimelineItem] {
        var items: [QuestTimelineItem] = [
            .init(title: "Set a profile picture", progress: (vm.hasAvatar ? 1 : 0, 1), action: openEditProfile),
            .init(title: "Write a short bio", progress: (vm.hasBio ? 1 : 0, 1), action: openEditProfile),
            .init(title: "Rate your first release", progress: (vm.hasFirstRating ? 1 : 0, 1), action: goToAdd),
        ]
        items.append(.init(
            title: "Rate 25 releases",
            progress: (min(vm.combinedRatingCount, TasteViewModel.unlockThreshold), TasteViewModel.unlockThreshold),
            reward: QuestReward(icon: "icon-sparkles", description: "Unlocks Taste"),
            action: goToAdd
        ))
        items.append(contentsOf: [
            .init(title: "Follow a person", progress: (vm.hasFollow ? 1 : 0, 1), action: { showUserSearch = true }),
            .init(
                title: "Connect your phone number",
                progress: (vm.hasVerifiedPhone ? 1 : 0, 1),
                action: { showPhoneVerification = true },
                note: (vm.wasInvited && !vm.hasVerifiedPhone)
                    ? "Verifying gives whoever invited you credit"
                    : nil
            ),
            // Gated on hasVerifiedPhone -- tapping either of these opens PhoneVerificationView
            // instead of InviteView until the account's own phone is connected, per the "inviting
            // shouldn't work until you're phone-connected" rule (InviteView enforces this too, as
            // the backstop -- this is just so tapping the row itself routes somewhere useful
            // rather than opening a screen that would immediately turn around and ask for the
            // same thing).
            .init(
                title: "Invite a friend",
                progress: (vm.hasFirstInvite ? 1 : 0, 1),
                action: vm.hasVerifiedPhone ? { showInvite = true } : { showPhoneVerification = true }
            ),
            .init(
                title: "Invite 5 friends",
                progress: (vm.verifiedInviteCount, 5),
                reward: QuestReward(icon: "icon-palette", description: "Unlocks a custom app icon"),
                action: vm.hasVerifiedPhone ? { showInvite = true } : { showPhoneVerification = true }
            ),
        ])
        return items
    }

    // Visually distinct from the timeline above — this is collective
    // progress, not something completing depends on this user alone.
    private var communityBlock: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image("icon-users")
                    .renderingMode(.template)
                    .resizable().scaledToFit()
                    .frame(width: 11, height: 11)
                Text("Community goals")
                    .font(.jakarta(12, weight: .semibold))
                    .textCase(.uppercase)
                    .kerning(0.4)
            }
            .foregroundStyle(Color.sjBlue)

            VStack(spacing: 12) {
                communityRow(
                    title: "Charts (Albums)",
                    subtitle: "The whole community is rating toward this",
                    current: vm.rankingsUnlock?.albumEvents ?? 0,
                    target: vm.rankingsUnlock?.albumEventsTarget ?? 10_000,
                    isDone: vm.albumsChartsUnlocked
                )
                Divider()
                communityRow(
                    title: "Charts (Songs)",
                    subtitle: "The whole community is rating toward this",
                    current: vm.rankingsUnlock?.songEvents ?? 0,
                    target: vm.rankingsUnlock?.songEventsTarget ?? 2_500,
                    isDone: vm.songsChartsUnlocked
                )
            }
            .padding(14)
            .background(Color.sjBlue.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sjBlue.opacity(0.2), lineWidth: 0.5))
        }
    }

    private func communityRow(title: LocalizedStringKey, subtitle: LocalizedStringKey, current: Int, target: Int, isDone: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.jakarta(14, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
                Spacer()
                if isDone {
                    Image("icon-check-circle")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 16, height: 16)
                        .foregroundStyle(Color.sjBlue)
                }
            }
            Text(subtitle)
                .font(.jakarta(11))
                .foregroundStyle(Color.sjMuted)

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.sjBorder)
                    Capsule().fill(Color.sjBlue)
                        .frame(width: geo.size.width * min(1, Double(current) / Double(max(target, 1))))
                }
            }
            .frame(height: 6)
        }
    }

    private func openEditProfile() {
        showEditProfile = true
    }

    // Dismiss this sheet first, then switch tabs -- switching tabs underneath
    // an active sheet without dismissing it first would leave Quests open on
    // top of the newly-selected tab instead of actually taking the user there.
    private func goToAdd() {
        dismiss()
        onGoToAdd()
    }
}

// MARK: - Timeline

struct QuestReward {
    let icon: String
    let description: LocalizedStringKey
}

struct QuestTimelineItem: Identifiable {
    let title: LocalizedStringKey
    let progress: (current: Int, target: Int)
    var reward: QuestReward? = nil
    var action: (() -> Void)? = nil
    // Replaces the current/target subtitle when set -- for context a plain
    // progress count can't convey (e.g. "verifying credits whoever invited
    // you"), since that's otherwise completely invisible to the user
    // (redemption happens silently on first launch).
    var note: LocalizedStringKey? = nil
    var isDone: Bool { progress.current >= progress.target }
    var id: String { "\(title)" }
}

/// A vertical stepper: one dot per quest, connected by a line whose traveled
/// segment (below a completed dot) is colored differently from the segment
/// still ahead -- replaces the old boxed-section/checkmark-row layout for
/// the personal quests specifically (Community goals below keeps its own
/// progress-bar treatment, deliberately different since that's collective
/// progress, not a personal step).
private struct QuestTimeline: View {
    let items: [QuestTimelineItem]

    var body: some View {
        // chainDone[i] is true only when every item from 0...i is done -- an unbroken completed
        // streak reaching back to the very first item, not just "this one item happens to be
        // done". The line BELOW item i connects it to item i+1, so it needs the chain to still
        // be unbroken THROUGH i+1, not just through i -- otherwise the last completed item's
        // own line reads as connected even when the very next (incomplete) item breaks the
        // chain right there (confirmed live: all of Set Profile Picture...Connect Phone Number
        // done colored every line blue including the one leading into the not-yet-done Invite a
        // Friend, since that line only checked Connect Phone Number's own chain state).
        var runningDone = true
        let chainDone: [Bool] = items.map { item in
            runningDone = runningDone && item.isDone
            return runningDone
        }
        return VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                let lineDone = index + 1 < chainDone.count ? chainDone[index + 1] : chainDone[index]
                QuestTimelineRow(item: item, isLast: index == items.count - 1, isChainDone: lineDone)
            }
        }
    }
}

private struct QuestTimelineRow: View {
    let item: QuestTimelineItem
    let isLast: Bool
    let isChainDone: Bool

    @State private var showRewardInfo = false
    private let dotSize: CGFloat = 22

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                ZStack {
                    Circle()
                        .fill(item.isDone ? Color.sjBlue : Color.sjSurface)
                        .overlay(Circle().stroke(item.isDone ? Color.clear : Color.sjBorder, lineWidth: 1.5))
                    if item.isDone {
                        Image("icon-check")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 10, height: 10)
                            .foregroundStyle(Color.sjCream)
                    }
                }
                .frame(width: dotSize, height: dotSize)

                if !isLast {
                    Rectangle()
                        .fill(isChainDone ? Color.sjBlue : Color.sjBorder)
                        .frame(width: 2)
                        .frame(maxHeight: .infinity)
                }
            }

            // The chevron (when shown) lives INSIDE this same button, not as a
            // separate sibling -- previously it was a static image next to the
            // button rather than part of it, so tapping directly on the
            // chevron did nothing. The reward icon (when present) stays a
            // separate, sibling tap target so it doesn't nest inside this one.
            Group {
                if let action = item.action {
                    Button(action: action) {
                        HStack(alignment: .top, spacing: 8) {
                            titleContent
                            Spacer(minLength: 0)
                            if item.reward == nil {
                                Image("icon-chevron-right")
                                    .renderingMode(.template)
                                    .resizable().scaledToFit()
                                    .frame(width: 12, height: 12)
                                    .foregroundStyle(Color.sjBorder)
                                    .padding(.top, 2)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                } else {
                    titleContent
                }
            }
            .padding(.bottom, 22)

            if let reward = item.reward {
                Button { showRewardInfo = true } label: {
                    Image(reward.icon)
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 15, height: 15)
                        .foregroundStyle(Color.sjBlue)
                        .frame(width: 30, height: 30)
                        .background(Color.sjBlue.opacity(0.1))
                        .clipShape(Circle())
                }
                .buttonStyle(.plain)
                .popover(isPresented: $showRewardInfo) {
                    Text(reward.description)
                        .font(.jakarta(13, weight: .medium))
                        .foregroundStyle(Color.sjInk)
                        .padding(14)
                        .presentationCompactAdaptation(.popover)
                }
            }
        }
    }

    private var titleContent: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(item.title)
                .font(.jakarta(14, weight: .semibold))
                .foregroundStyle(Color.sjInk)
                .strikethrough(item.isDone, color: Color.sjMuted)
            if !item.isDone {
                if let note = item.note {
                    Text(note)
                        .font(.jakarta(11, weight: .semibold))
                        .foregroundStyle(Color.sjBlue)
                } else {
                    Text("\(item.progress.current)/\(item.progress.target)")
                        .font(.jakarta(11, weight: .semibold))
                        .foregroundStyle(Color.sjMuted)
                        .monospacedDigit()
                }
            }
        }
    }
}
