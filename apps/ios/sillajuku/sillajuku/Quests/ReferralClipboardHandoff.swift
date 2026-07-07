import UIKit
import Supabase

/// Extracts an invite code from a sillajuku.com/i/<code> URL -- shared by both
/// the clipboard handoff below and the Universal Link handler in
/// sillajukuApp.swift, since both ultimately parse the same URL shape.
enum InviteLink {
    static func code(from url: URL) -> String? {
        guard url.pathComponents.count >= 3, url.pathComponents[1] == "i" else { return nil }
        return url.pathComponents[2]
    }
}

/// Checks the clipboard once per device for the invite link written by the web
/// landing page (app/i/[code]/page.tsx) right before it redirects to the App
/// Store -- this is what lets a referral code survive the install gap for
/// someone who doesn't have the app yet (the common case for an invite).
///
/// Uses UIPasteboard's pattern-detection API rather than reading `.string`
/// directly, specifically because a direct read triggers the system "Pasted
/// from X" banner on iOS 14+ -- pattern detection exists precisely so an app
/// can check for an EXPECTED format without that prompt. IMPORTANT: unlike a
/// vendored Swift package, this calls into a system framework I can't `grep`
/// the Swift source of -- an earlier version of this file guessed at a
/// custom-regex-pattern API that doesn't exist. This version is written
/// against the REAL Objective-C header (UIPasteboard.h in the iOS SDK) plus a
/// real working reference implementation (found via GitHub search, since
/// Apple's own docs site is a JS app that doesn't render through a simple
/// fetch) -- there is no custom-pattern support at all, only a fixed set
/// (.probableWebURL, .number, etc.), so the web page writes a plain
/// https://sillajuku.com/i/<code> URL (not a custom-prefixed string) and this
/// detects it via the built-in `.probableWebURL` pattern.
enum ReferralClipboardHandoff {
    private static let checkedKey = "hasCheckedReferralClipboard"

    static func checkAndRedeemOnce() async {
        guard !UserDefaults.standard.bool(forKey: checkedKey) else { return }
        UserDefaults.standard.set(true, forKey: checkedKey)
        guard supabase.auth.currentUser != nil else { return }

        guard let code = await detectInviteCode() else { return }

        struct Params: Encodable { let p_code: String }
        _ = try? await supabase
            .rpc("redeem_referral_code", params: Params(p_code: code))
            .execute()
    }

    private static func detectInviteCode() async -> String? {
        let values = await withCheckedContinuation { (continuation: CheckedContinuation<[UIPasteboard.DetectionPattern: Any], Never>) in
            UIPasteboard.general.detectValues(for: [.probableWebURL]) { result in
                switch result {
                case .success(let values): continuation.resume(returning: values)
                case .failure: continuation.resume(returning: [:])
                }
            }
        }

        guard let raw = values[.probableWebURL] else { return nil }
        let url: URL?
        if let u = raw as? URL { url = u }
        else if let s = raw as? String { url = URL(string: s) }
        else { url = nil }

        guard let url else { return nil }
        return InviteLink.code(from: url)
    }
}
