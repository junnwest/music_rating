import SwiftUI
import UIKit
import CoreImage
import Supabase

/// Media the user picked (gallery or camera) for the Photo background page.
/// Carries both a previewable form (UIImage / local file URL) and the raw
/// bytes Instagram's pasteboard contract wants — resolved once at pick time
/// so share is synchronous.
enum PickedShareMedia {
    case photo(UIImage, jpegData: Data)
    case video(previewURL: URL, data: Data)
}

/// What actually goes behind the sticker in the Story — the share sheet
/// resolves its carousel state (solid / gradient / blurred cover / photo)
/// down to one of these before handing off.
enum StoryBackground {
    case colors(top: UIColor, bottom: UIColor)  // Instagram renders these as a vertical gradient
    case image(UIImage)
    case video(Data)
}

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

    /// Reels shares go through their own scheme (`instagram-reels`, also
    /// declared in `LSApplicationQueriesSchemes`) but the same app-ID gate
    /// as Stories.
    static func canShareToInstagramReels() -> Bool {
        guard let url = URL(string: "instagram-reels://share") else { return false }
        return UIApplication.shared.canOpenURL(url) && Config.instagramFacebookAppID != nil
    }

    /// Renders `ShareCardView` (given already-resolved data — no async image
    /// loading inside the view being captured) to a flat, transparent image.
    /// `colorScheme` is forced explicitly — the card's colors are adaptive
    /// assets, and the exported sticker must follow the user's in-sheet
    /// light/dark pick, not whatever the renderer's default traits are.
    @MainActor
    static func renderStickerImage(
        username: String,
        coverImages: [UIImage?],
        title: String,
        subtitle: String,
        score: Double?,
        reviewText: String?,
        colorScheme: ColorScheme
    ) -> UIImage? {
        let card = ShareCardView(
            username: username,
            coverImages: coverImages,
            title: title,
            subtitle: subtitle,
            score: score,
            reviewText: reviewText
        )
        .environment(\.colorScheme, colorScheme)
        let renderer = ImageRenderer(content: card)
        renderer.isOpaque = false
        renderer.scale = UIScreen.main.scale
        return renderer.uiImage
    }

    static func downloadImage(from url: URL) async throws -> UIImage? {
        let (data, _) = try await URLSession.shared.data(from: url)
        return UIImage(data: data)
    }

    /// Parallel fetch for a mix's multiple cover URLs -- mirrors `downloadImage`
    /// above but for `ShareCardView`'s collage layout. Failed/nil downloads are
    /// simply dropped rather than leaving a gap, since the collage already
    /// tolerates fewer than 4 images gracefully.
    static func downloadImages(from urls: [URL]) async -> [UIImage] {
        await withTaskGroup(of: UIImage?.self) { group in
            for url in urls {
                group.addTask { try? await downloadImage(from: url) }
            }
            var images: [UIImage] = []
            for await image in group {
                if let image { images.append(image) }
            }
            return images
        }
    }

    /// Hands the image to Instagram's Stories composer via the documented
    /// pasteboard contract. Returns whether the handoff was attempted —
    /// Instagram itself doesn't report back whether the user actually posted.
    /// Callers should check `canShareToInstagramStories()` first and not
    /// offer this option at all otherwise, rather than let Instagram's own
    /// confusing native error be the first sign anything's wrong.
    ///
    /// Note: the pasteboard contract has no sticker-position key -- only a
    /// flat `stickerImage` and a background. Any drag/pinch repositioning
    /// the user did in our own preview is honored for Save/More/Post (see
    /// `composite`'s `stickerScale`/`stickerOffsetFraction`) but can't carry
    /// over here; Instagram always drops the sticker centered in its own
    /// editor, where the user can then reposition it again using Instagram's
    /// native gesture support. Not a bug -- a real platform limitation.
    @discardableResult
    static func shareToInstagramStories(stickerImage: UIImage, background: StoryBackground) -> Bool {
        guard canShareToInstagramStories(), let appId = Config.instagramFacebookAppID,
              let pngData = stickerImage.pngData() else { return false }

        var pasteboardItems: [String: Any] = [
            "com.instagram.sharedSticker.stickerImage": pngData,
            "com.instagram.sharedSticker.appID": appId,
        ]
        switch background {
        case .colors(let top, let bottom):
            pasteboardItems["com.instagram.sharedSticker.backgroundTopColor"] = hexString(top)
            pasteboardItems["com.instagram.sharedSticker.backgroundBottomColor"] = hexString(bottom)
        case .image(let image):
            pasteboardItems["com.instagram.sharedSticker.backgroundImage"] = image.jpegData(compressionQuality: 0.9)
        case .video(let data):
            pasteboardItems["com.instagram.sharedSticker.backgroundVideo"] = data
        }
        UIPasteboard.general.setItems([pasteboardItems], options: [
            .expirationDate: Date().addingTimeInterval(60 * 5)
        ])

        guard let url = URL(string: "instagram-stories://share?source_application=\(appId)") else { return false }
        UIApplication.shared.open(url)
        return true
    }

    /// Hands a video + sticker overlay to Instagram's Reels composer — same
    /// pasteboard contract as Stories on a different scheme. Reels are
    /// video-only by API design (no color/image background keys exist), so
    /// this is only offered when the user picked a video background.
    /// Instagram's requirements: 3–60s, H.264/H.265, ≤50MB recommended —
    /// enforced by Instagram itself, not pre-validated here.
    @discardableResult
    static func shareToInstagramReels(stickerImage: UIImage, videoData: Data) -> Bool {
        guard canShareToInstagramReels(), let appId = Config.instagramFacebookAppID,
              let pngData = stickerImage.pngData() else { return false }

        let pasteboardItems: [String: Any] = [
            "com.instagram.sharedSticker.backgroundVideo": videoData,
            "com.instagram.sharedSticker.stickerImage": pngData,
            "com.instagram.sharedSticker.appID": appId,
        ]
        UIPasteboard.general.setItems([pasteboardItems], options: [
            .expirationDate: Date().addingTimeInterval(60 * 5)
        ])

        guard let url = URL(string: "instagram-reels://share?source_application=\(appId)") else { return false }
        UIApplication.shared.open(url)
        return true
    }

    /// "Add only" save — needs `NSPhotoLibraryAddUsageDescription` in
    /// Info.plist, not full library read/write access.
    static func saveToPhotos(_ image: UIImage) {
        UIImageWriteToSavedPhotosAlbum(image, nil, nil, nil)
    }

    /// Story-canvas size everything renders at.
    static let storyCanvas = CGSize(width: 1080, height: 1920)

    /// Feed posts render 4:5 (Instagram's tallest feed ratio) — handing the
    /// 9:16 story canvas to the feed composer would just get force-cropped.
    static let postCanvas = CGSize(width: 1080, height: 1350)

    /// "#RRGGBB" for Instagram's background-color pasteboard keys.
    static func hexString(_ color: UIColor) -> String {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        func byte(_ v: CGFloat) -> Int { Int((max(0, min(1, v)) * 255).rounded()) }
        return String(format: "#%02X%02X%02X", byte(r), byte(g), byte(b))
    }

    /// Vertical gradient — the Save/More stand-in for what Instagram itself
    /// draws from the two color keys. Solid backgrounds are just top == bottom.
    static func gradientImage(top: UIColor, bottom: UIColor, canvas: CGSize = storyCanvas) -> UIImage {
        UIGraphicsImageRenderer(size: canvas).image { ctx in
            let gradient = CGGradient(
                colorsSpace: CGColorSpaceCreateDeviceRGB(),
                colors: [top.cgColor, bottom.cgColor] as CFArray,
                locations: [0, 1]
            )!
            ctx.cgContext.drawLinearGradient(
                gradient,
                start: .zero,
                end: CGPoint(x: 0, y: canvas.height),
                options: []
            )
        }
    }

    /// The album cover aspect-filled to story size, then gaussian-blurred —
    /// the "Blurred Cover" background page. Clamped before blurring so the
    /// edges don't fade to transparent. `nonisolated` deliberately: pure CPU
    /// work (CoreImage + UIGraphicsImageRenderer are both off-main-safe),
    /// and the share sheet precomputes it on a detached task.
    nonisolated static func blurredCoverBackdrop(from cover: UIImage) -> UIImage {
        let base = UIGraphicsImageRenderer(size: storyCanvas).image { _ in
            let fillScale = max(storyCanvas.width / cover.size.width,
                                storyCanvas.height / cover.size.height)
            let size = CGSize(width: cover.size.width * fillScale,
                              height: cover.size.height * fillScale)
            cover.draw(in: CGRect(
                origin: CGPoint(x: (storyCanvas.width - size.width) / 2,
                                y: (storyCanvas.height - size.height) / 2),
                size: size
            ))
        }
        guard let ciImage = CIImage(image: base) else { return base }
        let blurred = ciImage
            .clampedToExtent()
            .applyingGaussianBlur(sigma: 60)
            .cropped(to: ciImage.extent)
        let context = CIContext()
        guard let cgImage = context.createCGImage(blurred, from: blurred.extent) else { return base }
        return UIImage(cgImage: cgImage)
    }

    /// Flattens the sticker over a backdrop (aspect-filled) so Save/More/
    /// feed-post exports match what the user actually arranged in the
    /// interactive preview. Photos only — a video backdrop would need an
    /// AVFoundation export session, so video stays Stories/Reels-only.
    ///
    /// `stickerScale` multiplies the sticker's default 78%-of-canvas-width
    /// footprint; `stickerOffsetFraction` shifts it from dead-center, both
    /// axes expressed as a fraction of the canvas's own width/height (not
    /// points), so the same values apply correctly whether `canvas` is the
    /// 1080×1920 story size or the 1080×1350 post size, independent of
    /// whatever point size the on-screen preview was measured at.
    static func composite(
        sticker: UIImage,
        over background: UIImage,
        canvas: CGSize = storyCanvas,
        stickerScale: CGFloat = 1.0,
        stickerOffsetFraction: CGSize = .zero
    ) -> UIImage {
        return UIGraphicsImageRenderer(size: canvas).image { _ in
            let fillScale = max(canvas.width / background.size.width,
                                canvas.height / background.size.height)
            let bgSize = CGSize(width: background.size.width * fillScale,
                                height: background.size.height * fillScale)
            background.draw(in: CGRect(
                origin: CGPoint(x: (canvas.width - bgSize.width) / 2,
                                y: (canvas.height - bgSize.height) / 2),
                size: bgSize
            ))

            let stickerWidth = canvas.width * 0.78 * stickerScale
            let stickerSize = CGSize(width: stickerWidth,
                                     height: sticker.size.height * stickerWidth / sticker.size.width)
            let origin = CGPoint(
                x: (canvas.width - stickerSize.width) / 2 + stickerOffsetFraction.width * canvas.width,
                y: (canvas.height - stickerSize.height) / 2 + stickerOffsetFraction.height * canvas.height
            )
            sticker.draw(in: CGRect(origin: origin, size: stickerSize))
        }
    }
}

/// Feed ("post") shares have no pasteboard API — the documented route is the
/// iOS Document Interaction API: a JPEG written with the `.igo` extension +
/// the `com.instagram.exclusivegram` UTI opens Instagram's feed composer
/// directly (the plain `.ig`/`com.instagram.photo` variant would offer every
/// Instagram-capable app instead). Photos only; video feed posts have no
/// app-to-app API at all.
final class InstagramFeedShare: NSObject, UIDocumentInteractionControllerDelegate {
    private static let shared = InstagramFeedShare()

    /// The controller must outlive the tap that created it or the menu
    /// vanishes immediately — held here for the duration of the interaction.
    private var activeController: UIDocumentInteractionController?

    static func isAvailable() -> Bool {
        guard let url = URL(string: "instagram://app") else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    @MainActor
    @discardableResult
    static func share(image: UIImage) -> Bool {
        guard isAvailable(), let jpeg = image.jpegData(compressionQuality: 0.95) else { return false }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("sillajuku-post.igo")
        do {
            try jpeg.write(to: url)
        } catch {
            return false
        }

        guard let hostView = UIApplication.shared.connectedScenes
            .compactMap({ ($0 as? UIWindowScene)?.keyWindow })
            .first?.rootViewController?.view else { return false }

        let controller = UIDocumentInteractionController(url: url)
        controller.uti = "com.instagram.exclusivegram"
        controller.delegate = shared
        shared.activeController = controller
        return controller.presentOpenInMenu(
            from: CGRect(x: hostView.bounds.midX, y: hostView.bounds.maxY, width: 1, height: 1),
            in: hostView,
            animated: true
        )
    }

    func documentInteractionControllerDidDismissOpenInMenu(_ controller: UIDocumentInteractionController) {
        Self.shared.activeController = nil
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
