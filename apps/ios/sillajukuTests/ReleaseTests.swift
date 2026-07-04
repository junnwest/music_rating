import XCTest
@testable import sillajuku

final class ReleaseTests: XCTestCase {

    // MARK: - isPredominantlyHangul

    func testPureHangulIsPredominantlyHangul() {
        XCTAssertTrue("엔하이픈".isPredominantlyHangul)
    }

    func testPureLatinIsNotPredominantlyHangul() {
        XCTAssertFalse("ENHYPEN".isPredominantlyHangul)
    }

    func testJapaneseKatakanaIsNotPredominantlyHangul() {
        // Real production case this exact check exists to guard against:
        // Drake's name_native is stored in Japanese katakana, not Korean.
        XCTAssertFalse("ドレイク".isPredominantlyHangul)
    }

    func testMostlyHangulWithMinorLatinIsPredominantlyHangul() {
        // "엔시티 드림" is 5 Hangul syllable letters and 0 Latin letters — solidly
        // over the 50% threshold. ("NCT 드림" is NOT a valid case for this: 3 Latin
        // letters (N/C/T) vs. only 2 Hangul letters is a Latin majority.)
        XCTAssertTrue("엔시티 드림".isPredominantlyHangul)
    }

    func testExactlyHalfHangulIsNotPredominantlyHangul() {
        // isPredominantlyHangul requires a STRICT majority (> 0.5), so an even
        // split of Hangul vs. Latin letters must not count as predominant.
        XCTAssertFalse("AB가나".isPredominantlyHangul)
    }

    func testEmptyStringIsNotPredominantlyHangul() {
        XCTAssertFalse("".isPredominantlyHangul)
    }

    func testPunctuationOnlyIsNotPredominantlyHangul() {
        XCTAssertFalse("· 4.5 · 2026".isPredominantlyHangul)
    }

    // MARK: - displayTitle / displayArtist

    private func makeRelease(title: String, artist: String, titleNative: String?, artistNative: String?) -> Release {
        Release(id: UUID(), title: title, artist: artist, coverUrl: nil,
                 releaseType: "album", releaseDate: nil,
                 titleNative: titleNative, artistNative: artistNative,
                 tracklist: nil, totalTracks: nil)
    }

    func testDisplayTitleUsesNativeWhenItIsHangul() {
        let release = makeRelease(title: "GOLDEN HOUR : Part.5", artist: "ATEEZ",
                                    titleNative: nil, artistNative: "에이티즈")
        XCTAssertEqual(release.displayArtist, "에이티즈")
    }

    func testDisplayArtistTrustsAnyHangulValueRegardlessOfScriptOnly() {
        // isPredominantlyHangul is a SCRIPT check only — it guards against a
        // non-Korean value leaking in (Japanese/Chinese/Latin), not against a
        // Hangul value being the *wrong* Korean identity (e.g. a birth name
        // instead of a stage name). That correctness lives in the data itself:
        // this session's fix-bad-native-names.ts corrected E SENS's artistNative
        // to null in the DB precisely because there was no way to distinguish a
        // real stage-name transliteration from a birth name at the display layer
        // — both are equally "predominantly Hangul." So this function has to
        // trust whatever Hangul value it's given; it cannot re-derive correctness.
        let release = makeRelease(title: "The Anecdote", artist: "E SENS",
                                    titleNative: nil, artistNative: "강민호")
        XCTAssertEqual(release.displayArtist, "강민호")
    }

    func testDisplayArtistFallsBackToLatinWhenNativeIsNotHangulScript() {
        let release = makeRelease(title: "ICEMAN", artist: "Drake",
                                    titleNative: nil, artistNative: "ドレイク")
        XCTAssertEqual(release.displayArtist, "Drake")
    }

    func testDisplayArtistFallsBackWhenNativeIsNil() {
        let release = makeRelease(title: "ICEMAN", artist: "Drake",
                                    titleNative: nil, artistNative: nil)
        XCTAssertEqual(release.displayArtist, "Drake")
    }

    func testDisplayTitleFallsBackWhenNativeIsJapanese() {
        let release = makeRelease(title: "Take Care", artist: "Drake",
                                    titleNative: "テイク・ケア", artistNative: nil)
        XCTAssertEqual(release.displayTitle, "Take Care")
    }

    // MARK: - typeLabel

    private func makeReleaseWithType(_ releaseType: String?) -> Release {
        Release(id: UUID(), title: "t", artist: "a", coverUrl: nil,
                 releaseType: releaseType, releaseDate: nil,
                 titleNative: nil, artistNative: nil, tracklist: nil, totalTracks: nil)
    }

    func testTypeLabelUnknownTypePassesThroughCapitalized() {
        // "soundtrack"/"compilation" aren't special-cased — they fall through to a
        // plain capitalized pass-through rather than a localization lookup.
        XCTAssertEqual(makeReleaseWithType("soundtrack").typeLabel, "Soundtrack")
        XCTAssertEqual(makeReleaseWithType("compilation").typeLabel, "Compilation")
    }

    func testTypeLabelIsCaseInsensitive() {
        XCTAssertEqual(makeReleaseWithType("ALBUM").typeLabel, makeReleaseWithType("album").typeLabel)
    }

    func testTypeLabelNilFallsBackToGenericRelease() {
        XCTAssertFalse(makeReleaseWithType(nil).typeLabel.isEmpty)
    }
}
