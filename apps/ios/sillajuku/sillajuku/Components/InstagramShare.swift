import SwiftUI
import UIKit
import Supabase

/// Renders a rating into a shareable image and hands it to Instagram Stories
/// (or the plain system share sheet / Photos, as alternatives).
///
/// Two fundamentally different mechanisms, not two versions of the same one:
/// Instagram Stories takes a flattened PNG via the pasteboard + a custom URL
/// scheme — there is no "live" backdrop to blur or animate once handed over,
/// this is a one-shot static handoff.
enum InstagramShare {

    /// `instagram-stories://` must be declared in Info.plist's
    /// `LSApplicationQueriesSchemes` or this always returns false, regardless
    /// of whether Instagram is actually installed.
    static func isInstagramAvailable() -> Bool {
        guard let url = URL(string: "instagram-stories://share") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    /// Instagram rejects a Stories share outright — "The app you shared from
    /// doesn't currently support sharing to Stories" — unless
    /// `source_application` is a real, registered Facebook App ID. This is
    /// not optional/best-effort like the background-color pasteboard keys;
    /// confirmed by testing without one. So this is the actual gate on
    /// whether the Instagram option should even be offered, not just whether
    /// the app is installed.
    static func canShareToInstagramStories() -> Bool {
        isInstagramAvailable() && Config.instagramFacebookAppID != nil
    }

    /// Renders `ShareCardView` (given already-resolved data — no async image
    /// loading inside the view being captured) to a flat, transparent image.
    @MainActor
    static func renderStickerImage(
        username: String,
        coverImage: UIImage?,
        title: String,
        typeAndArtist: String,
        score: Double,
        reviewText: String?
    ) -> UIImage? {
        let card = ShareCardView(
            username: username,
            coverImage: coverImage,
            title: title,
            typeAndArtist: typeAndArtist,
            score: score,
            reviewText: reviewText
        )
        let renderer = ImageRenderer(content: card)
        renderer.isOpaque = false
        renderer.scale = UIScreen.main.scale
        return renderer.uiImage
    }

    static func downloadImage(from url: URL) async throws -> UIImage? {
        let (data, _) = try await URLSession.shared.data(from: url)
        return UIImage(data: data)
    }

    /// Hands the image to Instagram's Stories composer via the documented
    /// pasteboard contract. Returns whether the handoff was attempted —
    /// Instagram itself doesn't report back whether the user actually posted.
    /// Callers should check `canShareToInstagramStories()` first and not
    /// offer this option at all otherwise, rather than let Instagram's own
    /// confusing native error be the first sign anything's wrong.
    @discardableResult
    static func shareToInstagramStories(stickerImage: UIImage) -> Bool {
        guard canShareToInstagramStories(), let appId = Config.instagramFacebookAppID,
              let pngData = stickerImage.pngData() else { return false }

        let pasteboardItems: [String: Any] = [
            "com.instagram.sharedSticker.stickerImage": pngData,
            "com.instagram.sharedSticker.backgroundTopColor": "#F8F8F5",
            "com.instagram.sharedSticker.backgroundBottomColor": "#F8F8F5",
            "com.instagram.sharedSticker.appID": appId,
        ]
        UIPasteboard.general.setItems([pasteboardItems], options: [
            .expirationDate: Date().addingTimeInterval(60 * 5)
        ])

        guard let url = URL(string: "instagram-stories://share?source_application=\(appId)") else { return false }
        UIApplication.shared.open(url)
        return true
    }

    /// "Add only" save — needs `NSPhotoLibraryAddUsageDescription` in
    /// Info.plist, not full library read/write access.
    static func saveToPhotos(_ image: UIImage) {
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
    }
}

/// System share-sheet fallback / "More options" — wraps the rendered image
/// the same way Instagram would have received it.
struct ImageActivityShareSheet: UIViewControllerRepresentable {
    let image: UIImage

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [image], applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
