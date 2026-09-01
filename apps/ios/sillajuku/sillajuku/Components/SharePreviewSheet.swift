import SwiftUI
import PhotosUI
import AVFoundation

/// Everything the share card needs, already resolved (cover(s) downloaded,
/// username fetched) — built once by the caller, then handed to the preview
/// sheet so it never has to do async work before the user can see something.
/// `coverImages` is 1 image for an album/song rating, up to 4 for a mix
/// collage. `score` is nil when sharing a bare album/mix rather than a
/// rating of one -- the card simply omits the score badge.
struct PendingShare: Identifiable {
    let username: String
    let coverImages: [UIImage?]
    let title: String
    let subtitle: String
    let score: Double?
    let reviewText: String?

    let id = UUID()
}

/// The background style picker's options.
enum ShareBackgroundStyle: Int, CaseIterable, Identifiable {
    case solid, gradient, cover, photo
    var id: Int { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .solid: "Solid Color"
        case .gradient: "Gradient"
        case .cover: "Blurred Cover"
        case .photo: "Photo & Video"
        }
    }
}

/// The dedicated share screen: shows exactly what will be exported, then lets
/// the user pick where it goes — Instagram Stories, Photos, or the system
/// share sheet.
///
/// The story background is always one of four styles: solid color, gradient
/// (both color-customizable, handed to Instagram as its native
/// background-color keys), the album cover blurred, or a photo/video from
/// camera or gallery. Photos ride along everywhere (Instagram + composited
/// into Save/More); videos only through the Instagram Stories handoff (see
/// `InstagramShare.composite` for why).
///
/// Background-style switching lives in its own tap-driven row below the
/// canvas (`styleSelectorRow`), not as a swipe on the canvas itself — the
/// canvas's only job is showing the composited preview and hosting the
/// sticker's own drag/pinch/tap gestures. Splitting one physical region
/// between "swipe changes background" and "drag moves the sticker" (the
/// previous design) meant every touch's meaning depended on exactly where it
/// started; separating them removes that ambiguity structurally instead of
/// arbitrating it with gesture priority.
struct SharePreviewSheet: View {
    let pending: PendingShare

    @Environment(\.dismiss) private var dismiss
    @State private var renderedImage: UIImage?
    @State private var showSystemShareSheet = false
    @State private var savedConfirmation = false

    // Background style state
    @State private var backgroundStyle: ShareBackgroundStyle = .solid
    @State private var solidColor = SharePreviewSheet.creamColor
    @State private var gradientTop = SharePreviewSheet.creamColor
    @State private var gradientBottom = Color.sjBlue
    @State private var blurredCover: UIImage?
    @State private var pickedMedia: PickedShareMedia?
    @State private var galleryPickerItem: PhotosPickerItem?
    @State private var showGalleryPicker = false
    @State private var showCameraCapture = false
    @State private var isLoadingMedia = false
    @State private var mediaLoadFailed = false

    /// The card's own light/dark look, independent of the phone's appearance —
    /// toggled by tapping the card in the preview, baked into the export.
    @State private var cardScheme: ColorScheme = .light

    // Sticker placement -- drag to move, pinch to resize, double-tap to
    // reset, mirroring how Instagram's own Story editor handles a sticker.
    // Committed values (post-gesture); the live in-flight gesture deltas
    // below are combined with these only for on-screen rendering, so the
    // exported image (which reads these committed values directly) is never
    // mid-gesture-stale.
    @State private var stickerOffset: CGSize = .zero
    @State private var stickerScale: CGFloat = 1.0
    @GestureState private var stickerDragTranslation: CGSize = .zero
    @GestureState private var stickerPinchDelta: CGFloat = 1.0
    /// The card's own laid-out size at rest (before `.scaleEffect`, which
    /// doesn't change a view's reported layout size) -- measured once via a
    /// `GeometryReader` background, since `ShareCardView`'s height is
    /// dynamic (review text, single cover vs. collage) and not knowable
    /// ahead of time the way its fixed 320pt width is. Used to keep the
    /// whole card contained inside the canvas regardless of scale, instead
    /// of only constraining its center point.
    @State private var stickerNaturalSize: CGSize = .zero
    /// Whether the sticker is currently magnet-snapped to canvas-center on
    /// that axis -- drives the alignment guide lines and a snap haptic, each
    /// axis independently.
    @State private var snappedX = false
    @State private var snappedY = false

    /// The brand cream (#F8F8F5) the pre-carousel share flow always used —
    /// a fixed value, not the adaptive `Color.sjCream`, because the exported
    /// story must not depend on the phone's light/dark mode.
    private static let creamColor = Color(red: 0.973, green: 0.973, blue: 0.961)

    // Brand accent colors, matching `QuestBadgeColor`'s exact palette
    // (`Components/QuestBadge.swift`) -- the app's own deliberately-designed
    // accent set, rather than inventing a separate one here.
    private static let goldAccent   = Color(red: 0.776, green: 0.565, blue: 0.161)  // #C6902A
    private static let coralAccent  = Color(red: 0.918, green: 0.416, blue: 0.365)  // #EA6A5D
    private static let violetAccent = Color(red: 0.522, green: 0.361, blue: 0.816)  // #855CD0
    private static let mintAccent   = Color(red: 0.208, green: 0.710, blue: 0.588)  // #35B596
    private static let roseAccent   = Color(red: 0.878, green: 0.376, blue: 0.573)  // #E06092

    /// Deliberately small curated palettes instead of the system ColorPicker —
    /// its full spectrum/slider/eyedropper sheet is way more control than a
    /// story backdrop needs (user call). Built entirely from this app's own
    /// brand tokens (cream/ink/blue) plus the quest-badge accent palette
    /// above, rather than generic story-gradient colors unrelated to
    /// sillajuku's actual palette.
    private static let solidPresets: [Color] = [
        creamColor,
        Color(red: 0.10, green: 0.10, blue: 0.10),   // ink
        Color.sjBlue,
        goldAccent,
        coralAccent,
        violetAccent,
        mintAccent,
        roseAccent,
    ]
    private static let gradientPresets: [(top: Color, bottom: Color)] = [
        (creamColor, Color.sjBlue),
        (Color(red: 0.10, green: 0.10, blue: 0.10), Color.sjBlue),   // ink → brand blue
        (Color.sjBlue, violetAccent),                                 // brand blue → violet
        (goldAccent, roseAccent),                                     // gold → rose
        (mintAccent, Color.sjBlue),                                   // mint → brand blue
        (roseAccent, violetAccent),                                   // rose → violet
    ]

    private var canShareToInstagram: Bool { InstagramShare.canShareToInstagramStories() }

    private var isVideoSelected: Bool {
        if backgroundStyle == .photo, case .video = pickedMedia { return true }
        return false
    }

    /// The carousel state resolved to what actually ships behind the sticker.
    private var storyBackground: StoryBackground {
        switch backgroundStyle {
        case .solid:
            return .colors(top: UIColor(solidColor), bottom: UIColor(solidColor))
        case .gradient:
            return .colors(top: UIColor(gradientTop), bottom: UIColor(gradientBottom))
        case .cover:
            if let blurredCover { return .image(blurredCover) }
            if let cover = pending.coverImages.first ?? nil { return .image(InstagramShare.blurredCoverBackdrop(from: cover)) }
            return .colors(top: UIColor(Self.creamColor), bottom: UIColor(Self.creamColor))
        case .photo:
            switch pickedMedia {
            case .photo(let image, _): return .image(image)
            case .video(_, let data): return .video(data)
            case nil: return .colors(top: UIColor(Self.creamColor), bottom: UIColor(Self.creamColor))
            }
        }
    }

    /// Fraction-of-canvas sticker offset for `composite`, derived from the
    /// committed (post-gesture) on-screen drag -- not the live in-flight
    /// gesture state, since export only ever happens via a button tap, when
    /// no gesture is active anyway. Valid at any canvas size since it's a
    /// fraction, not points.
    private var stickerOffsetFraction: CGSize {
        CGSize(width: stickerOffset.width / previewWidth, height: stickerOffset.height / previewHeight)
    }

    /// What Save/More actually export: the full story composite for every
    /// background except video (which can't be flattened here — card only).
    private var exportImage: UIImage? {
        guard let renderedImage else { return nil }
        switch storyBackground {
        case .colors(let top, let bottom):
            return InstagramShare.composite(
                sticker: renderedImage, over: InstagramShare.gradientImage(top: top, bottom: bottom),
                stickerScale: stickerScale, stickerOffsetFraction: stickerOffsetFraction
            )
        case .image(let image):
            return InstagramShare.composite(
                sticker: renderedImage, over: image,
                stickerScale: stickerScale, stickerOffsetFraction: stickerOffsetFraction
            )
        case .video:
            return renderedImage
        }
    }

    /// The 4:5 render handed to the feed composer — 9:16 would just get
    /// force-cropped there. Nil for video (feed posts are photo-only).
    private var postExportImage: UIImage? {
        guard let renderedImage else { return nil }
        switch storyBackground {
        case .colors(let top, let bottom):
            return InstagramShare.composite(
                sticker: renderedImage,
                over: InstagramShare.gradientImage(top: top, bottom: bottom, canvas: InstagramShare.postCanvas),
                canvas: InstagramShare.postCanvas,
                stickerScale: stickerScale, stickerOffsetFraction: stickerOffsetFraction
            )
        case .image(let image):
            return InstagramShare.composite(
                sticker: renderedImage, over: image, canvas: InstagramShare.postCanvas,
                stickerScale: stickerScale, stickerOffsetFraction: stickerOffsetFraction
            )
        case .video:
            return nil
        }
    }

    var body: some View {
        NavigationStack {
            // A ScrollView, not a fixed VStack -- the content's total height
            // (canvas + the four rows below it + the button stack) is close
            // enough to the `.large` sheet detent's available height that it
            // doesn't reliably fit on every device/Dynamic Type setting.
            // Previously a plain VStack, which meant content that didn't fit
            // was just clipped with no way to reach it (confirmed live: the
            // button row cut off at the bottom, unreachable). Scrolling is
            // the safety net; on a screen tall enough for everything to fit,
            // there's simply nothing to scroll.
            ScrollView {
                VStack(spacing: 12) {
                    canvasView

                    statusRow

                    styleSelectorRow

                    styleControlsRow

                    VStack(spacing: 10) {
                        if canShareToInstagram {
                            Button {
                                guard let renderedImage else { return }
                                InstagramShare.shareToInstagramStories(stickerImage: renderedImage, background: storyBackground)
                                dismiss()
                            } label: {
                                shareOptionLabel(icon: "icon-camera", title: String(localized: "Share to Instagram Story"), tint: .white, background: Color.sjBlue)
                            }
                            .buttonStyle(.plain)

                            // Reels are video-only by API design; feed posts are
                            // photo-only. So the second Instagram destination
                            // swaps with the background type instead of stacking.
                            if isVideoSelected {
                                if InstagramShare.canShareToInstagramReels() {
                                    Button {
                                        guard let renderedImage,
                                              case .video(_, let data) = pickedMedia else { return }
                                        InstagramShare.shareToInstagramReels(stickerImage: renderedImage, videoData: data)
                                        dismiss()
                                    } label: {
                                        shareOptionLabel(icon: "icon-video", title: String(localized: "Share to Instagram Reels"), tint: Color.sjInk, background: Color.sjSurface, bordered: true)
                                    }
                                    .buttonStyle(.plain)
                                }
                            } else if InstagramFeedShare.isAvailable() {
                                Button {
                                    guard let postExportImage else { return }
                                    InstagramFeedShare.share(image: postExportImage)
                                } label: {
                                    shareOptionLabel(icon: "icon-image", title: String(localized: "Share as Instagram Post"), tint: Color.sjInk, background: Color.sjSurface, bordered: true)
                                }
                                .buttonStyle(.plain)
                                .disabled(renderedImage == nil)
                            }
                        } else {
                            VStack(spacing: 4) {
                                shareOptionLabel(icon: "icon-camera", title: String(localized: "Share to Instagram Story"), tint: Color.sjMuted, background: Color.sjBorder)
                                Text("Needs a one-time setup on our end — try Save or More for now.")
                                    .font(.jakarta(11))
                                    .foregroundStyle(Color.sjMuted)
                            }
                        }

                        HStack(spacing: 10) {
                            Button {
                                guard let exportImage else { return }
                                InstagramShare.saveToPhotos(exportImage)
                                withAnimation { savedConfirmation = true }
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) {
                                    withAnimation { savedConfirmation = false }
                                }
                            } label: {
                                shareOptionLabel(
                                    icon: savedConfirmation ? "checkmark.circle.fill" : "square.and.arrow.down",
                                    title: savedConfirmation ? String(localized: "Saved") : String(localized: "Save to Photos"),
                                    tint: Color.sjInk, background: Color.sjSurface, bordered: true
                                )
                            }
                            .buttonStyle(.plain)
                            .disabled(renderedImage == nil)

                            Button { showSystemShareSheet = true } label: {
                                shareOptionLabel(icon: "icon-share", title: String(localized: "More Options"), tint: Color.sjInk, background: Color.sjSurface, bordered: true)
                            }
                            .buttonStyle(.plain)
                            .disabled(renderedImage == nil)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 20)
                }
            }
            .padding(.top, 12)
            .navigationTitle("Share")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .task { renderSticker() }
        .onChange(of: cardScheme) { _, _ in renderSticker() }
        .task {
            // The export-resolution blur is a one-time ~100ms of CoreImage
            // work — precompute off the main actor so neither a style switch
            // nor the share tap hitches.
            guard let cover = pending.coverImages.first ?? nil else { return }
            blurredCover = await Task.detached(priority: .userInitiated) {
                InstagramShare.blurredCoverBackdrop(from: cover)
            }.value
        }
        .onChange(of: galleryPickerItem) { _, item in
            Task { await loadGalleryPick(item) }
        }
        .photosPicker(isPresented: $showGalleryPicker, selection: $galleryPickerItem, matching: .any(of: [.images, .videos]))
        .fullScreenCover(isPresented: $showCameraCapture) {
            CameraCaptureView { image in
                guard let jpeg = image.jpegData(compressionQuality: 0.9) else { return }
                pickedMedia = .photo(image, jpegData: jpeg)
                mediaLoadFailed = false
            }
            .ignoresSafeArea()
        }
        .sheet(isPresented: $showSystemShareSheet) {
            if let exportImage {
                ImageActivityShareSheet(image: exportImage)
            }
        }
    }

    private var shareCard: some View {
        ShareCardView(
            username: pending.username,
            coverImages: pending.coverImages,
            title: pending.title,
            subtitle: pending.subtitle,
            score: pending.score,
            reviewText: pending.reviewText
        )
        .environment(\.colorScheme, cardScheme)
    }

    private func renderSticker() {
        renderedImage = InstagramShare.renderStickerImage(
            username: pending.username,
            coverImages: pending.coverImages,
            title: pending.title,
            subtitle: pending.subtitle,
            score: pending.score,
            reviewText: pending.reviewText,
            colorScheme: cardScheme
        )
    }

    // MARK: - Canvas

    // Capped rather than filling the full screen width so the sheet still
    // fits one screen with no scrolling once the style-selector and
    // style-controls rows below it are accounted for (those didn't exist in
    // the previous carousel-based layout, which could afford a wider 320pt
    // cap). 290pt keeps the same "big, close to Instagram's own near-full-bleed
    // editor" feel while leaving room for the new rows underneath.
    private var previewWidth: CGFloat { min(UIScreen.main.bounds.width - 60, 290) }
    private var previewHeight: CGFloat { previewWidth * 16 / 9 }

    /// Fit-to-canvas factor (card's fixed 320pt design width → 78% of the
    /// canvas) times the user's committed pinch -- excludes the live
    /// in-flight `stickerPinchDelta`, which is applied separately only where
    /// rendering needs the up-to-the-frame value.
    private var effectiveScale: CGFloat { previewWidth * 0.78 / 320 * stickerScale }

    /// The preview canvas: background content + the draggable/pinchable
    /// sticker, and nothing else — no floating controls, no page dots. Every
    /// touch that starts here unambiguously belongs to the sticker; changing
    /// the background is a tap on `styleSelectorRow` below, not a gesture on
    /// this view at all.
    private var canvasView: some View {
        ZStack {
            canvasBackground

            // Center alignment guides -- appear only while the sticker is
            // magnet-snapped to that axis (see `resolveStickerOffset`), same
            // idea as Keynote/Canva's alignment guides.
            Rectangle()
                .fill(Color.sjBlue)
                .frame(width: 1.5, height: previewHeight)
                .shadow(color: .black.opacity(0.25), radius: 1)
                .opacity(snappedX ? 0.9 : 0)
            Rectangle()
                .fill(Color.sjBlue)
                .frame(width: previewWidth, height: 1.5)
                .shadow(color: .black.opacity(0.25), radius: 1)
                .opacity(snappedY ? 0.9 : 0)
        }
        .frame(width: previewWidth, height: previewHeight)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.sjBorder, lineWidth: 1)
        )
        .overlay {
            // Drag to reposition, pinch to resize -- unrivaled by any other
            // gesture on this view now, so a plain `.gesture` (not
            // `.highPriorityGesture`) is enough. Single tap flips the card's
            // light/dark look; double tap resets position and size, since
            // there's no other undo for a bad drag. The corner handle is a
            // permanent "this is draggable" cue, replacing the old one-time
            // text hint that used to float over the canvas.
            shareCard
                .background(
                    GeometryReader { geo in
                        Color.clear
                            .onAppear { stickerNaturalSize = geo.size }
                            .onChange(of: geo.size) { _, newSize in stickerNaturalSize = newSize }
                    }
                )
                .overlay(alignment: .bottomTrailing) { dragHandle }
                .scaleEffect(effectiveScale * stickerPinchDelta)
                .offset(
                    x: stickerOffset.width + stickerDragTranslation.width,
                    y: stickerOffset.height + stickerDragTranslation.height
                )
                .gesture(SimultaneousGesture(stickerDragGesture, stickerPinchGesture))
                .onTapGesture(count: 2) {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
                        stickerOffset = .zero
                        stickerScale = 1.0
                    }
                }
                .onTapGesture {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        cardScheme = cardScheme == .light ? .dark : .light
                    }
                }
        }
        .animation(.easeInOut(duration: 0.2), value: backgroundStyle)
        .animation(.easeOut(duration: 0.12), value: snappedX)
        .animation(.easeOut(duration: 0.12), value: snappedY)
        .sensoryFeedback(.selection, trigger: snappedX)
        .sensoryFeedback(.selection, trigger: snappedY)
    }

    @ViewBuilder
    private var canvasBackground: some View {
        switch backgroundStyle {
        case .solid:
            solidColor
        case .gradient:
            LinearGradient(colors: [gradientTop, gradientBottom], startPoint: .top, endPoint: .bottom)
        case .cover:
            if let cover = pending.coverImages.first ?? nil {
                // SwiftUI-blur stand-in for the CoreImage export blur:
                // sigma 60 at 1080px ≈ radius 12 at this preview width;
                // the 1.15 upscale pushes the blur's faded edges outside
                // the clip instead of showing them.
                Image(uiImage: cover)
                    .resizable()
                    .scaledToFill()
                    .frame(width: previewWidth, height: previewHeight)
                    .scaleEffect(1.15)
                    .blur(radius: 12)
            } else {
                Self.creamColor
            }
        case .photo:
            switch pickedMedia {
            case .photo(let image, _):
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            case .video(let previewURL, _):
                LoopingVideoView(url: previewURL)
            case nil:
                ZStack {
                    Color(uiColor: .systemGray5)
                    Image("icon-image")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 34, height: 34)
                        .foregroundStyle(Color(uiColor: .systemGray2))
                }
            }
        }
    }

    /// Small permanent "this is draggable" cue on the sticker's corner --
    /// scales/moves with the card since it's applied before the card's own
    /// `.scaleEffect`/`.offset`, so it always sits at the visible corner
    /// regardless of how the user has resized/repositioned the sticker.
    private var dragHandle: some View {
        Image(systemName: "arrow.up.and.down.and.arrow.left.and.right")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(Color.sjMuted)
            .padding(6)
            .background(Color.sjSurface, in: Circle())
            .overlay(Circle().stroke(Color.sjBorder, lineWidth: 1))
            .offset(x: 8, y: 8)
    }

    /// Clamps a proposed offset so the whole (scaled) card stays inside the
    /// canvas -- previously only the card's *center* was bounded, so at the
    /// clamp limit up to half the card sat outside the canvas and was cut
    /// off by its clip shape. Also magnet-snaps either axis independently to
    /// exact center once the proposed position is within `snapThreshold` of
    /// it, mirroring Instagram's own Story editor.
    private func resolveStickerOffset(_ proposed: CGSize, scale: CGFloat) -> (offset: CGSize, snappedX: Bool, snappedY: Bool) {
        let snapThreshold: CGFloat = 14
        let isSnappedX = abs(proposed.width) < snapThreshold
        let isSnappedY = abs(proposed.height) < snapThreshold

        let cardWidth = stickerNaturalSize.width * scale
        let cardHeight = stickerNaturalSize.height * scale
        let maxX = max(0, (previewWidth - cardWidth) / 2)
        let maxY = max(0, (previewHeight - cardHeight) / 2)

        let x = min(max(isSnappedX ? 0 : proposed.width, -maxX), maxX)
        let y = min(max(isSnappedY ? 0 : proposed.height, -maxY), maxY)
        return (CGSize(width: x, height: y), isSnappedX, isSnappedY)
    }

    /// Drag to reposition the sticker; the live translation is added on top
    /// of the committed offset only for rendering (`.updating`), then folded
    /// into `stickerOffset` on release. `.onChanged` runs the same
    /// resolution purely to drive the `snappedX`/`snappedY` guide-line state
    /// (position itself is handled by `.updating`).
    private var stickerDragGesture: some Gesture {
        DragGesture()
            .updating($stickerDragTranslation) { value, state, _ in
                let proposed = CGSize(
                    width: stickerOffset.width + value.translation.width,
                    height: stickerOffset.height + value.translation.height
                )
                let resolved = resolveStickerOffset(proposed, scale: effectiveScale).offset
                state = CGSize(
                    width: resolved.width - stickerOffset.width,
                    height: resolved.height - stickerOffset.height
                )
            }
            .onChanged { value in
                let proposed = CGSize(
                    width: stickerOffset.width + value.translation.width,
                    height: stickerOffset.height + value.translation.height
                )
                let resolved = resolveStickerOffset(proposed, scale: effectiveScale)
                snappedX = resolved.snappedX
                snappedY = resolved.snappedY
            }
            .onEnded { value in
                let proposed = CGSize(
                    width: stickerOffset.width + value.translation.width,
                    height: stickerOffset.height + value.translation.height
                )
                stickerOffset = resolveStickerOffset(proposed, scale: effectiveScale).offset
                snappedX = false
                snappedY = false
            }
    }

    /// Pinch to resize, same 0.5–2.2× range `composite` and the preview both
    /// respect, so what's on screen always matches what gets exported.
    /// Re-resolves the offset against the new scale on release -- a resize
    /// alone (no drag) can otherwise push a card that was sitting near an
    /// edge outside the canvas.
    private var stickerPinchGesture: some Gesture {
        MagnificationGesture()
            .updating($stickerPinchDelta) { value, state, _ in state = value }
            .onEnded { value in
                let newScale = min(max(stickerScale * value, 0.5), 2.2)
                stickerScale = newScale
                let newEffectiveScale = previewWidth * 0.78 / 320 * newScale
                stickerOffset = resolveStickerOffset(stickerOffset, scale: newEffectiveScale).offset
            }
    }

    // MARK: - Status row

    /// Fixed-height slot below the canvas for the two conditions that used
    /// to float as a black-pill note over the image content -- now sitting
    /// on the sheet's own light chrome instead, so plain muted text reads
    /// fine without a legibility backing. Reserves its height even when
    /// empty so the button stack below never shifts.
    private var statusRow: some View {
        Group {
            if mediaLoadFailed {
                statusNote(String(localized: "Couldn't load that background — try a different photo or video."))
            } else if isVideoSelected {
                statusNote(String(localized: "The video background applies to the Instagram share — Save and More export the card only."))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 18)
        .padding(.horizontal, 20)
    }

    private func statusNote(_ text: String) -> some View {
        Text(text)
            .font(.jakarta(11, weight: .medium))
            .foregroundStyle(Color.sjMuted)
            .multilineTextAlignment(.center)
    }

    // MARK: - Style selector

    /// Replaces swiping the canvas -- four text pills, same idiom this app
    /// already uses for filter chips elsewhere (see `RankingsView.filterChip`).
    private var styleSelectorRow: some View {
        HStack(spacing: 8) {
            ForEach(ShareBackgroundStyle.allCases) { style in
                let selected = backgroundStyle == style
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { backgroundStyle = style }
                } label: {
                    Text(style.title)
                        .font(.jakarta(12, weight: .medium))
                        .foregroundStyle(selected ? .white : Color.sjMuted)
                        .padding(.horizontal, 12).padding(.vertical, 5)
                        .background(selected ? Color.sjAmber : Color.sjCream)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .overlay(!selected ? RoundedRectangle(cornerRadius: 14).stroke(Color.sjBorder, lineWidth: 0.5) : nil)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Style controls

    /// Per-style customization (color swatches, or the photo/video picker) --
    /// moved off the canvas into its own row, one fixed height across all
    /// four styles (Cover renders blank at that same height) so switching
    /// styles never shifts anything below it.
    private var styleControlsRow: some View {
        Group {
            switch backgroundStyle {
            case .solid:
                swatchRow(count: Self.solidPresets.count) { index in
                    Circle().fill(Self.solidPresets[index])
                } isSelected: { index in
                    solidColor == Self.solidPresets[index]
                } select: { index in
                    solidColor = Self.solidPresets[index]
                }
            case .gradient:
                swatchRow(count: Self.gradientPresets.count) { index in
                    Circle().fill(LinearGradient(
                        colors: [Self.gradientPresets[index].top, Self.gradientPresets[index].bottom],
                        startPoint: .top, endPoint: .bottom
                    ))
                } isSelected: { index in
                    gradientTop == Self.gradientPresets[index].top && gradientBottom == Self.gradientPresets[index].bottom
                } select: { index in
                    gradientTop = Self.gradientPresets[index].top
                    gradientBottom = Self.gradientPresets[index].bottom
                }
            case .cover:
                EmptyView()
            case .photo:
                photoControls
            }
        }
        .frame(minHeight: 34)
    }

    private func swatchRow(
        count: Int,
        @ViewBuilder fill: @escaping (Int) -> some View,
        isSelected: @escaping (Int) -> Bool,
        select: @escaping (Int) -> Void
    ) -> some View {
        HStack(spacing: 10) {
            ForEach(0..<count, id: \.self) { index in
                Button {
                    select(index)
                } label: {
                    fill(index)
                        .frame(width: 24, height: 24)
                        .overlay(Circle().stroke(Color.sjBorder, lineWidth: 0.5))
                        .overlay {
                            if isSelected(index) {
                                Circle().stroke(Color.sjInk, lineWidth: 2).padding(-2)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var photoControls: some View {
        if isLoadingMedia {
            ProgressView()
        } else {
            Menu {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button { showCameraCapture = true } label: {
                        Label("Take a Photo", image: "icon-camera")
                    }
                }
                Button { showGalleryPicker = true } label: {
                    Label("Choose from Gallery", image: "icon-images")
                }
            } label: {
                HStack(spacing: 5) {
                    Image(pickedMedia == nil ? "icon-plus" : "icon-image")
                        .renderingMode(.template)
                        .resizable().scaledToFit()
                        .frame(width: 11, height: 11)
                    Text(pickedMedia == nil ? String(localized: "Add Photo or Video") : String(localized: "Change"))
                        .font(.jakarta(12, weight: .semibold))
                }
                .foregroundStyle(Color.sjInk)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.sjSurface)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Color.sjBorder, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Gallery pick loading

    private func loadGalleryPick(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        isLoadingMedia = true
        mediaLoadFailed = false
        defer { isLoadingMedia = false }

        let movieType = item.supportedContentTypes.first { $0.conforms(to: .movie) }
        guard let data = try? await item.loadTransferable(type: Data.self) else {
            mediaLoadFailed = true
            return
        }

        if let movieType {
            // Whole video rides the pasteboard as Data, so keep a sane cap —
            // a Story is ≤60s anyway; a multi-hundred-MB 4K pick would just
            // stall or crash the handoff.
            guard data.count <= 100 * 1024 * 1024 else {
                mediaLoadFailed = true
                return
            }
            let ext = movieType.preferredFilenameExtension ?? "mp4"
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("share-background-\(UUID().uuidString).\(ext)")
            do {
                try data.write(to: url)
            } catch {
                mediaLoadFailed = true
                return
            }
            pickedMedia = .video(previewURL: url, data: data)
        } else {
            // Re-encode to JPEG so Instagram never sees HEIC.
            guard let image = UIImage(data: data),
                  let jpeg = image.jpegData(compressionQuality: 0.9) else {
                mediaLoadFailed = true
                return
            }
            pickedMedia = .photo(image, jpegData: jpeg)
        }
    }

    @ViewBuilder
    private func shareOptionLabel(icon: String, title: String, tint: Color, background: Color, bordered: Bool = false) -> some View {
        HStack(spacing: 10) {
            Image(icon)
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 17, height: 17)
            Text(title).font(.jakarta(15, weight: .semibold))
        }
        .foregroundStyle(tint)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 13)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay {
            if bordered {
                RoundedRectangle(cornerRadius: 12).stroke(Color.sjBorder, lineWidth: 1)
            }
        }
    }
}

/// Camera capture for the photo background — bare `UIImagePickerController`
/// (photo only; video capture would blow past the pasteboard budget anyway).
private struct CameraCaptureView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraCaptureView
        init(_ parent: CameraCaptureView) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage {
                parent.onCapture(image)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}

/// Muted, looping, aspect-fill video preview for the story mock. Plain
/// `VideoPlayer` letterboxes and shows controls, so this drops down to an
/// `AVPlayerLayer` with `.resizeAspectFill`.
private struct LoopingVideoView: UIViewRepresentable {
    let url: URL

    func makeUIView(context: Context) -> LoopingPlayerUIView {
        LoopingPlayerUIView(url: url)
    }

    func updateUIView(_ uiView: LoopingPlayerUIView, context: Context) {}
}

final class LoopingPlayerUIView: UIView {
    private let player: AVQueuePlayer
    private let looper: AVPlayerLooper
    private let playerLayer: AVPlayerLayer

    init(url: URL) {
        let item = AVPlayerItem(url: url)
        player = AVQueuePlayer()
        looper = AVPlayerLooper(player: player, templateItem: item)
        playerLayer = AVPlayerLayer(player: player)
        super.init(frame: .zero)

        player.isMuted = true
        playerLayer.videoGravity = .resizeAspectFill
        layer.addSublayer(playerLayer)
        player.play()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
