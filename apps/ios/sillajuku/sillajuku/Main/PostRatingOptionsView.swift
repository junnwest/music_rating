import SwiftUI
import Supabase

struct PostRatingOptionsView: View {
    let release: Release
    var continueLabel: LocalizedStringKey = "Continue"
    var onBack: (() -> Void)? = nil
    let onContinue: (String?) -> Void

    @State private var isAddingComment = false
    @State private var commentText = ""
    @State private var showMixPicker = false

    var body: some View {
        VStack(spacing: 0) {
            albumHeader
            Divider().padding(.vertical, 10)
            commentRow
            Divider().padding(.horizontal, 20)
            listRow
            Divider().padding(.horizontal, 20)
            bottomButtons
        }
        .sheet(isPresented: $showMixPicker) {
            MixPickerView(releaseId: release.id, releaseTitle: release.displayTitle)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: Album header

    private var albumHeader: some View {
        HStack(spacing: 12) {
            CoverImage(url: release.coverUrl, cornerRadius: 8)
                .frame(width: 44, height: 44)
                .accessibilityHidden(true) // title text alongside already describes it
            VStack(alignment: .leading, spacing: 2) {
                Text(release.displayTitle)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text(release.typeLabel)
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(Color.sjBlue)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Color.sjBlue.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                    Text(release.displayArtist)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.sjMuted)
                        .lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
    }

    // MARK: Comment row

    private var commentRow: some View {
        VStack(spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isAddingComment.toggle() }
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: "bubble.right")
                        .font(.system(size: 17))
                        .foregroundStyle(Color.sjInk)
                        .frame(width: 24)
                    Text("Add a comment")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.sjInk)
                    Spacer()
                    Image(systemName: isAddingComment ? "chevron.up" : "chevron.down")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.sjMuted)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if isAddingComment {
                ZStack(alignment: .topLeading) {
                    if commentText.isEmpty {
                        Text("What did you think?")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.sjMuted)
                            .padding(.horizontal, 14)
                            .padding(.top, 10)
                    }
                    TextEditor(text: $commentText)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.sjInk)
                        .scrollContentBackground(.hidden)
                        .frame(height: 68)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                }
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
                .padding(.horizontal, 20)
                .padding(.bottom, 10)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    // MARK: List row

    private var listRow: some View {
        Button { showMixPicker = true } label: {
            HStack(spacing: 14) {
                Image(systemName: "plus.square")
                    .font(.system(size: 17))
                    .foregroundStyle(Color.sjInk)
                    .frame(width: 24)
                Text("Add to a list")
                    .font(.system(size: 15))
                    .foregroundStyle(Color.sjInk)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Bottom buttons

    private var bottomButtons: some View {
        VStack(spacing: 8) {
            Button {
                let text = commentText.trimmingCharacters(in: .whitespaces)
                onContinue(text.isEmpty ? nil : text)
            } label: {
                Text(continueLabel)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Color.sjBlue)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)

            if let onBack {
                Button {
                    onBack()
                } label: {
                    Text("← Back")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.sjMuted)
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 22)
    }
}
