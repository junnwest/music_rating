import Foundation

extension Date {
    var relativeTimeString: String {
        let s = -timeIntervalSinceNow
        if s < 60 { return String(localized: "just now") }
        if s < 3600 { return String(format: String(localized: "%dm"), Int(s / 60)) }
        if s < 86400 { return String(format: String(localized: "%dh"), Int(s / 3600)) }
        if s < 604800 { return String(format: String(localized: "%dd"), Int(s / 86400)) }
        return String(format: String(localized: "%dw"), Int(s / 604800))
    }
}
