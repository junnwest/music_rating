import Foundation

struct CountryCallingCode: Identifiable, Hashable {
    let name: String
    let isoCode: String   // ISO 3166-1 alpha-2, matches Locale.current.region?.identifier
    let dialCode: String  // no leading "+"
    let flag: String
    var id: String { isoCode }
}

enum CountryCallingCodes {
    // Deliberately not exhaustive (~all ISO territories) -- covers Korea/Japan/
    // Greater China/pan-Asia (this app's stated expansion path, per VISION.md)
    // plus the rest of the world's most-populous/common countries. Calling
    // codes are stable ITU-assigned values, not something that needs runtime
    // verification the way an SDK API would.
    static let all: [CountryCallingCode] = [
        .init(name: "South Korea", isoCode: "KR", dialCode: "82", flag: "🇰🇷"),
        .init(name: "Japan", isoCode: "JP", dialCode: "81", flag: "🇯🇵"),
        .init(name: "China", isoCode: "CN", dialCode: "86", flag: "🇨🇳"),
        .init(name: "Taiwan", isoCode: "TW", dialCode: "886", flag: "🇹🇼"),
        .init(name: "Hong Kong", isoCode: "HK", dialCode: "852", flag: "🇭🇰"),
        .init(name: "United States", isoCode: "US", dialCode: "1", flag: "🇺🇸"),
        .init(name: "Canada", isoCode: "CA", dialCode: "1", flag: "🇨🇦"),
        .init(name: "United Kingdom", isoCode: "GB", dialCode: "44", flag: "🇬🇧"),
        .init(name: "Ireland", isoCode: "IE", dialCode: "353", flag: "🇮🇪"),
        .init(name: "Germany", isoCode: "DE", dialCode: "49", flag: "🇩🇪"),
        .init(name: "France", isoCode: "FR", dialCode: "33", flag: "🇫🇷"),
        .init(name: "Spain", isoCode: "ES", dialCode: "34", flag: "🇪🇸"),
        .init(name: "Italy", isoCode: "IT", dialCode: "39", flag: "🇮🇹"),
        .init(name: "Netherlands", isoCode: "NL", dialCode: "31", flag: "🇳🇱"),
        .init(name: "Sweden", isoCode: "SE", dialCode: "46", flag: "🇸🇪"),
        .init(name: "Norway", isoCode: "NO", dialCode: "47", flag: "🇳🇴"),
        .init(name: "Denmark", isoCode: "DK", dialCode: "45", flag: "🇩🇰"),
        .init(name: "Finland", isoCode: "FI", dialCode: "358", flag: "🇫🇮"),
        .init(name: "Poland", isoCode: "PL", dialCode: "48", flag: "🇵🇱"),
        .init(name: "Portugal", isoCode: "PT", dialCode: "351", flag: "🇵🇹"),
        .init(name: "Switzerland", isoCode: "CH", dialCode: "41", flag: "🇨🇭"),
        .init(name: "Austria", isoCode: "AT", dialCode: "43", flag: "🇦🇹"),
        .init(name: "Belgium", isoCode: "BE", dialCode: "32", flag: "🇧🇪"),
        .init(name: "Russia", isoCode: "RU", dialCode: "7", flag: "🇷🇺"),
        .init(name: "Turkey", isoCode: "TR", dialCode: "90", flag: "🇹🇷"),
        .init(name: "Vietnam", isoCode: "VN", dialCode: "84", flag: "🇻🇳"),
        .init(name: "Thailand", isoCode: "TH", dialCode: "66", flag: "🇹🇭"),
        .init(name: "Indonesia", isoCode: "ID", dialCode: "62", flag: "🇮🇩"),
        .init(name: "Philippines", isoCode: "PH", dialCode: "63", flag: "🇵🇭"),
        .init(name: "Malaysia", isoCode: "MY", dialCode: "60", flag: "🇲🇾"),
        .init(name: "Singapore", isoCode: "SG", dialCode: "65", flag: "🇸🇬"),
        .init(name: "India", isoCode: "IN", dialCode: "91", flag: "🇮🇳"),
        .init(name: "Pakistan", isoCode: "PK", dialCode: "92", flag: "🇵🇰"),
        .init(name: "Bangladesh", isoCode: "BD", dialCode: "880", flag: "🇧🇩"),
        .init(name: "Australia", isoCode: "AU", dialCode: "61", flag: "🇦🇺"),
        .init(name: "New Zealand", isoCode: "NZ", dialCode: "64", flag: "🇳🇿"),
        .init(name: "Mexico", isoCode: "MX", dialCode: "52", flag: "🇲🇽"),
        .init(name: "Brazil", isoCode: "BR", dialCode: "55", flag: "🇧🇷"),
        .init(name: "Argentina", isoCode: "AR", dialCode: "54", flag: "🇦🇷"),
        .init(name: "Chile", isoCode: "CL", dialCode: "56", flag: "🇨🇱"),
        .init(name: "Colombia", isoCode: "CO", dialCode: "57", flag: "🇨🇴"),
        .init(name: "South Africa", isoCode: "ZA", dialCode: "27", flag: "🇿🇦"),
        .init(name: "Nigeria", isoCode: "NG", dialCode: "234", flag: "🇳🇬"),
        .init(name: "Egypt", isoCode: "EG", dialCode: "20", flag: "🇪🇬"),
        .init(name: "United Arab Emirates", isoCode: "AE", dialCode: "971", flag: "🇦🇪"),
        .init(name: "Saudi Arabia", isoCode: "SA", dialCode: "966", flag: "🇸🇦"),
        .init(name: "Israel", isoCode: "IL", dialCode: "972", flag: "🇮🇱"),
    ]

    /// Best-effort default from the device's own Region setting -- NOT
    /// profiles.country (confirmed nearly always null for real users; the
    /// country dropdown was removed from onboarding per WEB_PARITY.md).
    /// Falls back to South Korea, this app's home market, if the device
    /// region isn't in our list or unavailable.
    static var deviceDefault: CountryCallingCode {
        if let regionID = Locale.current.region?.identifier,
           let match = all.first(where: { $0.isoCode == regionID }) {
            return match
        }
        return all[0] // South Korea
    }
}
