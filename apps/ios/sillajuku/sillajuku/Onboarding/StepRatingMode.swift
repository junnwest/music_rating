import SwiftUI

struct StepRatingMode: View {
    @Binding var data: OnboardingData
    let onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer().frame(height: 110)

            VStack(alignment: .leading, spacing: 8) {
                Text("Select a rating style.")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                Text("You can change this later.")
                    .font(.system(size: 16))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)

            VStack(spacing: 12) {
                RatingModeCard(
                    title: "Normal",
                    description: "Assign a star rating to each album you listen to.",
                    icon: "star.fill",
                    isSelected: data.ratingMode == "manual"
                ) { data.ratingMode = "manual" }

                RatingModeCard(
                    title: "Instinct",
                    description: "Pick between two albums. Your rankings build themselves.",
                    icon: "arrow.left.arrow.right",
                    isSelected: data.ratingMode == "instinct"
                ) { data.ratingMode = "instinct" }
            }
            .padding(.horizontal, 24)

            Spacer()

            Button(action: onNext) {
                Text("Continue")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(Color.sjInk)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
        }
    }
}

private struct RatingModeCard: View {
    let title: String
    let description: String
    let icon: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(isSelected ? .white : Color.sjMuted)
                    .frame(width: 36)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(isSelected ? .white : Color.sjInk)
                    Text(description)
                        .font(.system(size: 13))
                        .foregroundStyle(isSelected ? .white.opacity(0.75) : Color.sjMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20))
                    .foregroundStyle(isSelected ? .white : Color.sjBorder)
            }
            .padding(18)
            .frame(maxWidth: .infinity)
            .background(isSelected ? Color.sjInk : Color.sjSurface)
            .clipShape(RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(isSelected ? Color.clear : Color.sjBorder, lineWidth: 1.5)
            )
        }
    }
}
