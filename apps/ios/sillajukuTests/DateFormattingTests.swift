import XCTest
@testable import sillajuku

final class DateFormattingTests: XCTestCase {

    func testJustNowForVeryRecentDate() {
        let date = Date().addingTimeInterval(-5)
        XCTAssertEqual(date.relativeTimeString, String(localized: "just now"))
    }

    func testMinutesAgo() {
        let date = Date().addingTimeInterval(-5 * 60)
        XCTAssertEqual(date.relativeTimeString, String(format: String(localized: "%dm"), 5))
    }

    func testHoursAgo() {
        let date = Date().addingTimeInterval(-3 * 3600)
        XCTAssertEqual(date.relativeTimeString, String(format: String(localized: "%dh"), 3))
    }

    func testDaysAgo() {
        let date = Date().addingTimeInterval(-2 * 86400)
        XCTAssertEqual(date.relativeTimeString, String(format: String(localized: "%dd"), 2))
    }

    func testWeeksAgo() {
        let date = Date().addingTimeInterval(-3 * 604800)
        XCTAssertEqual(date.relativeTimeString, String(format: String(localized: "%dw"), 3))
    }

    func testBoundaryJustUnderOneMinuteIsJustNow() {
        let date = Date().addingTimeInterval(-59)
        XCTAssertEqual(date.relativeTimeString, String(localized: "just now"))
    }

    func testBoundaryAtOneMinuteIsMinutesFormat() {
        let date = Date().addingTimeInterval(-61)
        XCTAssertEqual(date.relativeTimeString, String(format: String(localized: "%dm"), 1))
    }
}
