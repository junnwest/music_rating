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

/// The background carousel's pages, in swipe order.
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
/// The story background is always one of four swipeable carousel pages (no
/// "no background" state): solid color, gradient (both color-customizable,
/// handed to Instagram as its native background-color keys), the album cover
/// blurred, or a photo/video from camera or gallery. Photos ride along
/// everywhere (Instagram + composited into Save/More); videos only through
/// the Instagram Stories handoff (see `InstagramShare.composite` for why).
struct SharePreviewSheet: View {
    let pending: PendingShare

    @Environment(\.dismiss) private var dismiss
    @State private var renderedImage: UIImage?
    @State private var showSystemShareSheet = false
    @State private var savedConfirmation = false

    // Background carousel state
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

    /// The brand cream (#F8F8F5) the pre-carousel share flow always used —
    /// a fixed value, not the adaptive `Color.sjCream`, because the exported
    /// story must not depend on the phone's light/dark mode.
    private static let creamColor = Color(red: 0.973, green: 0.973, blue: 0.961)

    /// Deliberately small curated palettes instead of the system ColorPicker —
    /// its full spectrum/slider/eyedropper sheet is way more control than a
    /// story backdrop needs (user call).
    private static let solidPresets: [Color] = [
        creamColor,
        Color(red: 0.10, green: 0.10, blue: 0.10),   // ink
        Color(red: 0.16, green: 0.47, blue: 0.72),   // brand blue
        Color(red: 0.96, green: 0.78, blue: 0.82),   // soft pink
        Color(red: 0.96, green: 0.89, blue: 0.63),   // butter
        Color(red: 0.85, green: 0.56, blue: 0.45),   // terracotta
        Color(red: 0.66, green: 0.75, blue: 0.63),   // sage
    ]
    private static let gradientPresets: [(top: Color, bottom: Color)] = [
        (creamColor, Color.sjBlue),
        (Color(red: 1.00, green: 0.83, blue: 0.65), Color(red: 0.99, green: 0.40, blue: 0.52)),  // peach → sunset pink
        (Color(red: 0.36, green: 0.40, blue: 0.79), Color(red: 0.29, green: 0.78, blue: 0.72)),  // indigo → teal
        (Color(red: 0.10, green: 0.10, blue: 0.10), Color(red: 0.29, green: 0.29, blue: 0.42)),  // night
        (Color(red: 0.66, green: 0.75, blue: 1.00), Color(red: 0.25, green: 0.17, blue: 0.59)),  // sky → deep blue
        (Color(red: 0.98, green: 0.76, blue: 0.92), Color(red: 0.65, green: 0.76, blue: 0.93)),  // pink → periwinkle
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
            VStack(spacing: 12) {
                Spacer(minLength: 0)

                backgroundCarousel

                Spacer(minLength: 0)

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
            // work — precompute off the main actor so neither the carousel
            // swipe nor the share tap hitches.
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

    // MARK: - Background carousel

    // Much bigger than the original small thumbnail (closer to Instagram's
    // own near-full-bleed Story editor), but capped rather than filling the
    // full screen width: at full bleed the 9:16 canvas alone is taller than
    // the `.large` sheet detent leaves room for once the nav bar, safe
    // areas, and the action-button section below it are accounted for,
    // which pushed those buttons off the bottom edge (confirmed live).
    // 320pt keeps the whole sheet on one screen with no scrolling.
    private var previewWidth: CGFloat { min(UIScreen.main.bounds.width - 60, 320) }
    private var previewHeight: CGFloat { previewWidth * 16 / 9 }

    private var backgroundCarousel: some View {
        TabView(selection: $backgroundStyle) {
            ForEach(ShareBackgroundStyle.allCases) { style in
                backgroundPage(style)
                    .tag(style)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .frame(width: previewWidth, height: previewHeight)
        .overlay(alignment: .top) {
            // Custom dots + page title, Instagram-chrome style (small
            // translucent pill floating over the canvas) -- the TabView's
            // own index dots would collide with the per-page control chips
            // docked at the bottom.
            VStack(spacing: 4) {
                HStack(spacing: 6) {
                    ForEach(ShareBackgroundStyle.allCases) { style in
                        Circle()
                            .fill(style == backgroundStyle ? Color.white : Color.white.opacity(0.4))
                            .frame(width: 6, height: 6)
                    }
                }
                Text(backgroundStyle.title)
                    .font(.jakarta(11, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(.black.opacity(0.35), in: Capsule())
            .padding(.top, 14)
            .allowsHitTesting(false)
        }
    }

    /// Drag to reposition the sticker; the live translation is added on top
    /// of the committed offset only for rendering (`.updating`), then folded
    /// into `stickerOffset` on release. Clamped so the sticker's center can
    /// never leave the canvas -- easy to lose track of otherwise, since
    /// there's no visible boundary once it's dragged near an edge.
    private var stickerDragGesture: some Gesture {
        DragGesture()
            .updating($stickerDragTranslation) { value, state, _ in state = value.translation }
            .onEnded { value in
                let proposed = CGSize(
                    width: stickerOffset.width + value.translation.width,
                    height: stickerOffset.height + value.translation.height
                )
                stickerOffset = CGSize(
                    width: min(max(proposed.width, -previewWidth * 0.5), previewWidth * 0.5),
                    height: min(max(proposed.height, -previewHeight * 0.5), previewHeight * 0.5)
                )
            }
    }

    /// Pinch to resize, same 0.5–2.2× range `composite` and the preview both
    /// respect, so what's on screen always matches what gets exported.
    private var stickerPinchGesture: some Gesture {
        MagnificationGesture()
            .updating($stickerPinchDelta) { value, state, _ in state = value }
            .onEnded { value in
                stickerScale = min(max(stickerScale * value, 0.5), 2.2)
            }
    }

    /// One 9:16 story mock — backdrop filling the frame, card centered at the
    /// same relative width `InstagramShare.composite` uses, per-page controls
    /// overlaid at the bottom.
    private func backgroundPage(_ style: ShareBackgroundStyle) -> some View {
        ZStack {
            switch style {
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
        .frame(width: previewWidth, height: previewHeight)
        .clipShape(RoundedRectangle(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.sjBorder, lineWidth: 1)
        )
        .overlay {
            // ShareCardView lays out at its fixed natural width; scale it to
            // the composite's 78%-of-canvas footprint, times whatever the
            // user has pinched it to. Drag to reposition (high-priority so it
            // wins over the TabView's own page-swipe when the touch starts
            // on the sticker itself -- swipes starting elsewhere on the
            // canvas still page through backgrounds normally). Single tap
            // flips the card's light/dark look; double tap resets position
            // and size, since there's no other undo for a bad drag.
            shareCard
                .scaleEffect(previewWidth * 0.78 / 320 * stickerScale * stickerPinchDelta)
                .offset(
                    x: stickerOffset.width + stickerDragTranslation.width,
                    y: stickerOffset.height + stickerDragTranslation.height
                )
                .highPriorityGesture(SimultaneousGesture(stickerDragGesture, stickerPinchGesture))
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
        .overlay(alignment: .bottom) {
            VStack(spacing: 8) {
                // Dragging/pinching a sticker isn't an obvious affordance in
                // a share sheet the way it is inside Instagram's own editor
                // (where users already expect it) -- a one-time hint until
                // the user actually touches the card, then it's gone for
                // good this session.
                if stickerOffset == .zero, stickerScale == 1.0 {
                    pageNote(String(localized: "Drag or pinch the card to adjust"))
                }
                pageControls(style)
            }
            .padding(.bottom, 12)
        }
        .overlay(alignment: .top) {
            // Photo-page-specific notes ride on the page itself — keeping
            // them out of the layout keeps every page the same fixed height.
            if style == .photo {
                if mediaLoadFailed {
                    pageNote(String(localized: "Couldn't load that background — try a different photo or video."))
                } else if isVideoSelected {
                    pageNote(String(localized: "The video background applies to the Instagram share — Save and More export the card only."))
                }
            }
        }
    }

    private func pageNote(_ text: String) -> some View {
        Text(text)
            .font(.jakarta(11, weight: .medium))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.black.opacity(0.45), in: RoundedRectangle(cornerRadius: 10))
            .padding(.horizontal, 14)
            .padding(.top, 12)
    }

    @ViewBuilder
    private func pageControls(_ style: ShareBackgroundStyle) -> some View {
        switch style {
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
            if isLoadingMedia {
                ProgressView()
                    .tint(.white)
                    .padding(10)
                    .background(.black.opacity(0.45), in: Capsule())
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
                    .foregroundStyle(.white)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .background(.black.opacity(0.45), in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func swatchRow(
        count: Int,
        @ViewBuilder fill: @escaping (Int) -> some View,
        isSelected: @escaping (Int) -> Bool,
        select: @escaping (Int) -> Void
    ) -> some View {
        HStack(spacing: 8) {
            ForEach(0..<count, id: \.self) { index in
                Button {
                    select(index)
                } label: {
                    fill(index)
                        .frame(width: 22, height: 22)
                        .overlay(Circle().stroke(.white.opacity(0.35), lineWidth: 0.5))
                        .overlay {
                            if isSelected(index) {
                                Circle().stroke(.white, lineWidth: 2)
                            }
                        }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .background(.black.opacity(0.45), in: Capsule())
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
