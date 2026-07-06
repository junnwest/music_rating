import SwiftUI

/// Everything the share card needs, already resolved (cover downloaded,
/// username fetched) — built once by the caller, then handed to the preview
/// sheet so it never has to do async work before the user can see something.
struct PendingShare: Identifiable {
    let username: String
    let coverImage: UIImage?
    let title: String
    let typeAndArtist: String
    let score: Double
    let reviewText: String?

    let id = UUID()
}

/// The dedicated share screen: shows exactly what will be exported, then lets
/// the user pick where it goes — Instagram Stories, Photos, or the system
/// share sheet. Replaces the old behavior of jumping straight to Instagram
/// with no preview or choice.
struct SharePreviewSheet: View {
    let pending: PendingShare

    @Environment(\.dismiss) private var dismiss
    @State private var renderedImage: UIImage?
    @State private var showSystemShareSheet = false
    @State private var savedConfirmation = false

    private var canShareToInstagram: Bool { InstagramShare.canShareToInstagramStories() }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(spacing: 24) {
                        Text("This is what gets exported — Instagram lets you resize and reposition it once it's in your Story.")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.sjMuted)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                            .padding(.top, 8)

                        ShareCardView(
                            username: pending.username,
                            coverImage: pending.coverImage,
                            title: pending.title,
                            typeAndArtist: pending.typeAndArtist,
                            score: pending.score,
                            reviewText: pending.reviewText
                        )
                    }
                    .padding(.bottom, 12)
                }

                VStack(spacing: 10) {
                    if canShareToInstagram {
                        Button {
                            guard let renderedImage else { return }
                            InstagramShare.shareToInstagramStories(stickerImage: renderedImage)
                            dismiss()
                        } label: {
                            shareOptionLabel(icon: "camera.circle.fill", title: String(localized: "Share to Instagram Story"), tint: .white, background: Color.sjBlue)
                        }
                        .buttonStyle(.plain)
                    } else {
                        VStack(spacing: 4) {
                            shareOptionLabel(icon: "camera.circle.fill", title: String(localized: "Share to Instagram Story"), tint: Color.sjMuted, background: Color.sjBorder)
                            Text("Needs a one-time setup on our end — try Save or More for now.")
                                .font(.system(size: 11))
                                .foregroundStyle(Color.sjMuted)
                        }
                    }

                    Button {
                        guard let renderedImage else { return }
                        InstagramShare.saveToPhotos(renderedImage)
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
                        shareOptionLabel(icon: "square.and.arrow.up", title: String(localized: "More Options"), tint: Color.sjInk, background: Color.sjSurface, bordered: true)
                    }
                    .buttonStyle(.plain)
                    .disabled(renderedImage == nil)
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
        .task {
            renderedImage = InstagramShare.renderStickerImage(
                username: pending.username,
                coverImage: pending.coverImage,
                title: pending.title,
                typeAndArtist: pending.typeAndArtist,
                score: pending.score,
                reviewText: pending.reviewText
            )
        }
        .sheet(isPresented: $showSystemShareSheet) {
            if let renderedImage {
                ImageActivityShareSheet(image: renderedImage)
            }
        }
    }

    @ViewBuilder
    private func shareOptionLabel(icon: String, title: String, tint: Color, background: Color, bordered: Bool = false) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 17, weight: .medium))
            Text(title).font(.system(size: 15, weight: .semibold))
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
