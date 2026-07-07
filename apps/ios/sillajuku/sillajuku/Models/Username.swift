import Foundation

// Single source of truth for username format on iOS, mirrored by the DB
// CHECK constraint (20260706000014_username_format_constraint.sql) and the
// web app (lib/username.ts). Keep all three in sync if this changes.
enum Username {
    static let minLength = 3
    static let maxLength = 20

    static func isValid(_ value: String) -> Bool {
        guard value.count >= minLength, value.count <= maxLength else { return false }
        return value.range(of: "^[a-z0-9_]+$", options: .regularExpression) != nil
    }

    private static let allowedCharacters = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789_")

    /// Live-typing sanitizer: lowercases, strips disallowed characters, caps length.
    static func normalize(_ raw: String) -> String {
        let lowered = raw.lowercased()
        let filtered = lowered.unicodeScalars.filter { allowedCharacters.contains($0) }
        return String(String.UnicodeScalarView(filtered).prefix(maxLength))
    }
}
