import Foundation

/// Debug-build-only overrides for previewing gated UI on the developer's own
/// account. Everything here is compiled out of Release (TestFlight/App Store)
/// builds, and nothing is written to the database.
enum DebugOverrides {
    /// junnwest -- treated as having 5 verified invites so the Quests tab reads
    /// fully complete and Settings shows the custom app icon picker
    /// (2026-09-28 user ask: preview the icon picker).
    private static let allQuestsUserIds: Set<UUID> = [
        UUID(uuidString: "01c9330b-0c15-4d85-8eb3-3dd1c2e78dba")!
    ]

    /// The real verified-invite count, raised to 5 for the accounts above in
    /// Debug builds only.
    static func verifiedInviteCount(_ real: Int, userId: UUID) -> Int {
        #if DEBUG
        if allQuestsUserIds.contains(userId) { return max(real, 5) }
        #endif
        return real
    }
}
