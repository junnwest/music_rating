import SwiftUI
import Supabase

/// Attaches and verifies a phone number on the CURRENT (already-authenticated)
/// session -- this never becomes a login credential, it's purely a side-channel
/// so the person who invited this user can be credited. Confirmed via the
/// installed supabase-swift source (AuthClient.swift): `auth.update(user:)`
/// sends the OTP to a NEW phone number for an existing session, and
/// `auth.verifyOTP(phone:token:type:.phoneChange)` confirms it. Once Supabase
/// Auth confirms the OTP, `auth.users.phone_confirmed_at` is set, which is what
/// migration 20260706000006's trigger reacts to -- this screen never writes
/// the "verified" state itself, only Supabase's own OTP confirmation can.
struct PhoneVerificationView: View {
    @Environment(\.dismiss) private var dismiss

    // Defaults to the device's own Region setting (Locale.current.region), NOT
    // profiles.country -- confirmed nearly always null for real users, since
    // the country dropdown was removed from onboarding (see WEB_PARITY.md).
    @State private var selectedCountry = CountryCallingCodes.deviceDefault
    @State private var showCountryPicker = false
    @State private var localNumber = ""
    @State private var code = ""
    @State private var stage: Stage = .enterPhone
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    // Whether THIS account was itself redeemed via someone else's referral
    // code -- most people verifying here are doing so to unlock INVITING
    // others, not because anyone invited them, so the "your referrer got
    // credit" message must not show unconditionally. Same query
    // InviteViewModel.wasInvited already uses.
    @State private var wasInvited = false

    enum Stage { case enterPhone, enterCode, done }

    // E.164-ish: "+" + dial code + digits only (strips spaces/dashes/parens a
    // user might type in the local-number field).
    private var fullPhone: String {
        let digits = localNumber.filter(\.isNumber)
        return "+\(selectedCountry.dialCode)\(digits)"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.sjCream.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 20) {
                    switch stage {
                    case .enterPhone: phoneStage
                    case .enterCode:  codeStage
                    case .done:       doneStage
                    }
                }
                .padding(24)
            }
            .navigationTitle("Verify phone number")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
            .sheet(isPresented: $showCountryPicker) {
                CountryPickerView(selected: $selectedCountry)
            }
        }
    }

    private var phoneStage: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Enter your phone number. We'll text you a one-time code.")
                .font(.jakarta(14))
                .foregroundStyle(Color.sjMuted)

            HStack(spacing: 10) {
                Button { showCountryPicker = true } label: {
                    HStack(spacing: 6) {
                        Text(selectedCountry.flag)
                        Text("+\(selectedCountry.dialCode)")
                            .font(.jakarta(15, weight: .semibold))
                            .foregroundStyle(Color.sjInk)
                        Image("icon-chevron-down")
                            .renderingMode(.template)
                            .resizable().scaledToFit()
                            .frame(width: 10, height: 10)
                            .foregroundStyle(Color.sjMuted)
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 48)
                    .background(Color.sjSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)

                TextField("Phone number", text: $localNumber)
                    .keyboardType(.phonePad)
                    .padding(14)
                    .frame(height: 48)
                    .background(Color.sjSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))
            }

            if let errorMessage {
                Text(errorMessage).font(.jakarta(13)).foregroundStyle(.red)
            }

            submitButton(title: "Send code", disabled: localNumber.filter(\.isNumber).isEmpty) {
                await sendCode()
            }
        }
    }

    private var codeStage: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(String(format: String(localized: "Enter the code we sent to %@."), fullPhone))
                .font(.jakarta(14))
                .foregroundStyle(Color.sjMuted)

            TextField("123456", text: $code)
                .keyboardType(.numberPad)
                .padding(14)
                .background(Color.sjSurface)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.sjBorder, lineWidth: 1))

            if let errorMessage {
                Text(errorMessage).font(.jakarta(13)).foregroundStyle(.red)
            }

            submitButton(title: "Verify", disabled: code.trimmingCharacters(in: .whitespaces).isEmpty) {
                await confirmCode()
            }

            Button("Use a different number") { stage = .enterPhone; code = ""; errorMessage = nil }
                .font(.jakarta(13))
                .foregroundStyle(Color.sjMuted)
        }
    }

    private var doneStage: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image("icon-check-circle")
                .renderingMode(.template)
                .resizable().scaledToFit()
                .frame(width: 40, height: 40)
                .foregroundStyle(Color.sjBlue)
            Text("Phone verified")
                .font(.jakarta(20, weight: .bold))
                .foregroundStyle(Color.sjInk)
            if wasInvited {
                Text("Whoever invited you just got credit for it.")
                    .font(.jakarta(14))
                    .foregroundStyle(Color.sjMuted)
            }
            Button("Done") { dismiss() }
                .font(.jakarta(15, weight: .semibold))
                .foregroundStyle(Color.sjCream)
                .frame(maxWidth: .infinity)
                .frame(height: 46)
                .background(Color.sjBlue)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .padding(.top, 8)
        }
    }

    private func submitButton(title: LocalizedStringKey, disabled: Bool, action: @escaping () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Group {
                if isSubmitting {
                    ProgressView().tint(Color.sjCream)
                } else {
                    Text(title).font(.jakarta(15, weight: .semibold))
                }
            }
            .foregroundStyle(Color.sjCream)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Color.sjBlue)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(disabled || isSubmitting)
    }

    private func sendCode() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            _ = try await supabase.auth.update(user: UserAttributes(phone: fullPhone))
            stage = .enterCode
        } catch let AuthError.api(_, errorCode, _, _) where errorCode == .phoneExists {
            // Distinct from the generic case below -- this isn't "wrong number,"
            // it's "correct number, already verified on a DIFFERENT account."
            // No account-merge flow exists (deliberate call, given the scope of
            // actually combining two accounts' data) -- just tell the user
            // plainly rather than showing the generic "check it and try again."
            errorMessage = String(localized: "That number is already connected to another sillajuku account.")
        } catch {
            // Printed, not just swallowed -- the user-facing message is deliberately
            // generic (a wrong number is an expected case), but the real cause
            // (Supabase config vs. Twilio rejecting it) needs to be visible somewhere
            // during development.
            print("PhoneVerificationView.sendCode failed for \(fullPhone): \(error)")
            errorMessage = String(localized: "Couldn't send a code to that number. Check it and try again.")
        }
    }

    private func confirmCode() async {
        isSubmitting = true
        errorMessage = nil
        defer { isSubmitting = false }
        do {
            _ = try await supabase.auth.verifyOTP(phone: fullPhone, token: code, type: .phoneChange)
            wasInvited = await checkWasInvited()
            stage = .done
        } catch {
            print("PhoneVerificationView.confirmCode failed for \(fullPhone): \(error)")
            errorMessage = String(localized: "That code didn't match. Check it and try again.")
        }
    }

    private func checkWasInvited() async -> Bool {
        guard let userId = supabase.auth.currentUser?.id else { return false }
        struct Row: Codable { let id: UUID }
        let rows: [Row] = (try? await supabase
            .from("referrals").select("id")
            .eq("invited_user_id", value: userId)
            .execute().value) ?? []
        return !rows.isEmpty
    }
}

// MARK: - Country picker

private struct CountryPickerView: View {
    @Binding var selected: CountryCallingCode
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var filtered: [CountryCallingCode] {
        guard !query.isEmpty else { return CountryCallingCodes.all }
        return CountryCallingCodes.all.filter {
            $0.name.localizedCaseInsensitiveContains(query) || $0.dialCode.contains(query)
        }
    }

    var body: some View {
        NavigationStack {
            List(filtered) { country in
                Button {
                    selected = country
                    dismiss()
                } label: {
                    HStack {
                        Text(country.flag)
                        Text(country.name)
                            .foregroundStyle(Color.sjInk)
                        Spacer()
                        Text("+\(country.dialCode)")
                            .foregroundStyle(Color.sjMuted)
                            .monospacedDigit()
                    }
                }
            }
            .searchable(text: $query, prompt: Text("Search countries"))
            .navigationTitle("Country")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.fontWeight(.semibold)
                }
            }
        }
    }
}
