import SwiftUI

struct InviteView: View {
    @State private var vm = InviteViewModel()
    @State private var codeInput = ""
    @State private var showPhoneVerification = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sjCream.ignoresSafeArea()
                if vm.isLoading {
                    ProgressView().tint(Color.sjAmber)
                } else {
                    content
                }
            }
            .navigationTitle("Invite friends")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
            .sheet(isPresented: $showPhoneVerification, onDismiss: { Task { await vm.load() } }) {
                PhoneVerificationView()
            }
        }
        .task { await vm.load() }
    }

    private var content: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 24) {
                // Sharing your own code is gated on your OWN phone being verified --
                // inviting shouldn't work until the account is phone-connected.
                // Redeeming someone ELSE's code stays open regardless (that's about
                // receiving an invite, not sending one).
                if vm.hasOwnPhoneVerified {
                    myCodeCard
                } else {
                    verifyPhonePrompt
                }

                if !vm.wasInvited {
                    redeemCard
                }

                Text("Invites only count toward the 5-invite reward once the person you invited verifies their phone number — this keeps one person from farming credit with throwaway accounts.")
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
            }
            .padding(20)
        }
    }

    private var myCodeCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Your invite code")
                .font(.jakarta(13, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .kerning(0.4)

            Text(vm.myReferralCode ?? "——————")
                .font(.system(size: 32, weight: .black, design: .monospaced))
                .foregroundStyle(Color.sjInk)
                .kerning(2)

            if let code = vm.myReferralCode {
                ShareLink(item: shareURL(code), subject: Text("Join me on sillajuku"), message: shareMessage(code)) {
                    HStack(spacing: 8) {
                        Image(systemName: "square.and.arrow.up")
                        Text("Share invite link")
                            .font(.jakarta(14, weight: .semibold))
                    }
                    .foregroundStyle(Color.sjCream)
                    .frame(maxWidth: .infinity)
                    .frame(height: 46)
                    .background(Color.sjBlue)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
            }
        }
        .padding(18)
        .background(Color.sjSurface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.sjBorder, lineWidth: 0.5))
    }

    private var redeemCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Have an invite code?")
                .font(.jakarta(13, weight: .semibold))
                .foregroundStyle(Color.sjMuted)
                .textCase(.uppercase)
                .kerning(0.4)

            HStack(spacing: 10) {
                TextField("Enter code", text: $codeInput)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.characters)
                    .padding(12)
                    .background(Color.sjSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))

                Button {
                    Task { _ = await vm.redeem(code: codeInput) }
                } label: {
                    if vm.isRedeeming {
                        ProgressView().tint(Color.sjCream)
                    } else {
                        Text("Apply")
                            .font(.jakarta(14, weight: .semibold))
                    }
                }
                .foregroundStyle(Color.sjCream)
                .padding(.horizontal, 18)
                .frame(height: 44)
                .background(Color.sjInk)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .disabled(vm.isRedeeming || codeInput.trimmingCharacters(in: .whitespaces).isEmpty)
            }

            if let message = vm.redeemMessage {
                Text(message)
                    .font(.jakarta(12))
                    .foregroundStyle(Color.sjMuted)
            }
        }
    }

    // Text(String) never does a catalog lookup — only String(localized:) does —
    // so each branch must resolve through String(localized:) itself rather than
    // passing a runtime ternary/interpolation straight to Text (same fix already
    // established in RankingsView.swift's RankingsLockedView).
    private var verifyPhoneBody: String {
        vm.wasInvited
            ? String(localized: "Verify your phone to start inviting friends — and to credit the person who invited you.")
            : String(localized: "Verify your phone number to start inviting friends.")
    }

    private var verifyPhonePrompt: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield")
                    .foregroundStyle(Color.sjBlue)
                Text("Verify your phone number")
                    .font(.jakarta(14, weight: .semibold))
                    .foregroundStyle(Color.sjInk)
            }
            Text(verifyPhoneBody)
                .font(.jakarta(13))
                .foregroundStyle(Color.sjMuted)

            Button { showPhoneVerification = true } label: {
                Text("Verify phone number")
                    .font(.jakarta(14, weight: .semibold))
                    .foregroundStyle(Color.sjCream)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
                    .background(Color.sjBlue)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(Color.sjBlue.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.sjBlue.opacity(0.2), lineWidth: 0.5))
    }

    private func shareURL(_ code: String) -> URL {
        URL(string: "https://sillajuku.com/i/\(code)") ?? URL(string: "https://sillajuku.com")!
    }

    private func shareMessage(_ code: String) -> Text {
        Text("Rate the music you love, see what your friends think. Join me on sillajuku:")
    }
}
