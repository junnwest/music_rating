import CoreHaptics
import SwiftUI

/// Full-screen founding-badge claim: hold the button while the frosted ???
/// tile cracks under a building rumble; when the gauge fills the glass
/// shatters, the rocket bursts out, and the real number (from
/// claim_founding_badge) rolls in and lands. Chosen from the claim-effects
/// lab (A+E "Hold to break", 2026-09-26). Haptics run at full strength.
struct FoundingClaimCeremony: View {
    var vm: QuestChecklistViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private enum Phase { case idle, holding, launched, done, failed }
    @State private var phase = Phase.idle
    @State private var holdStart: Date?
    @State private var progress: CGFloat = 0
    @State private var cracks: CGFloat = 0
    @State private var shattered = false
    @State private var rocketUp = false
    @State private var revealed = false
    @State private var landed = false
    @State private var launchStart: Date?
    @State private var number: Int?
    /// When the digits start locking (number known, and not before 0.95s
    /// after the break so the sequence keeps its rhythm).
    @State private var lockStart: Date?
    @State private var errorText: String?
    @State private var holdTask: Task<Void, Never>?

    private let holdDuration: TimeInterval = 1.2
    private let tile: CGFloat = 150
    private let shards: [(dx: CGFloat, dy: CGFloat, spin: Double)] =
        (0..<9).map { _ in (CGFloat.random(in: -320...320), CGFloat.random(in: -420...300), Double.random(in: -260...260)) }

    var body: some View {
        ZStack {
            Color.sjCream.ignoresSafeArea()
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Close") { FXHaptics.shared.stop(); dismiss() }
                        .font(.jakarta(15, weight: .semibold))
                        .disabled(phase == .holding || phase == .launched)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)

                Spacer()

                Text(title)
                    .font(.jakarta(22, weight: .bold))
                    .foregroundStyle(Color.sjInk)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .animation(.easeInOut(duration: 0.2), value: phase)
                Text(subtitle)
                    .font(.jakarta(14))
                    .foregroundStyle(errorText == nil ? Color.sjMuted : .red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                    .padding(.top, 8)

                stage
                    .frame(height: 260)
                    .padding(.vertical, 24)

                Group {
                    if phase == .idle || phase == .holding {
                        holdButton
                    } else if phase == .done || phase == .failed {
                        Button { dismiss() } label: {
                            Text(phase == .done ? "Done" : "Close")
                                .font(.jakarta(16, weight: .semibold))
                                .frame(maxWidth: .infinity).padding(.vertical, 15)
                                .background(Color.sjInk).foregroundStyle(Color.sjCream)
                                .clipShape(RoundedRectangle(cornerRadius: 14))
                        }
                        .buttonStyle(.plain)
                    } else {
                        Color.clear
                    }
                }
                .frame(height: 54)
                .padding(.horizontal, 40)

                Spacer()
            }
        }
        .interactiveDismissDisabled(phase == .holding || phase == .launched)
    }

    private var title: String {
        switch phase {
        case .done:
            number.map { String(format: String(localized: "Founding member #%@"), $0.foundingDigits) }
                ?? String(localized: "Founding badge")
        case .failed: String(localized: "Couldn't claim the badge")
        default: String(localized: "Claim your founding number")
        }
    }

    private var subtitle: String {
        if let errorText { return errorText }
        switch phase {
        case .done: return String(localized: "One of the first 500 members of sillajuku.")
        default:
            let left = vm.foundingStatus?.remaining
            return left.map { String(format: String(localized: "Hold the button to claim. %d of 500 left."), $0) }
                ?? String(localized: "Hold the button to claim.")
        }
    }

    // MARK: Stage

    private var stage: some View {
        TimelineView(.animation) { ctx in
            let amp: CGFloat = {
                guard !reduceMotion, let holdStart else { return 0 }
                return CGFloat(pow(min(1, ctx.date.timeIntervalSince(holdStart) / holdDuration), 1.5)) * 7
            }()
            ZStack {
                if revealed {
                    ClaimTile(size: tile, filled: true) {
                        ClaimDigits(number: number, lockStart: lockStart)
                    }
                    .scaleEffect(landed ? 1 : 0.88)
                    .transition(.scale(scale: 0.5).combined(with: .opacity))
                }
                ForEach(0..<9, id: \.self) { i in glassPiece(i) }
                    .offset(phase == .holding ? claimShake(ctx.date, amplitude: amp) : .zero)
                if !reduceMotion {
                    if let launchStart {
                        ClaimSparkBurst(start: launchStart, count: 46, speed: 340, duration: 0.8).frame(width: 420, height: 420)
                    }
                    if let lockStart, phase == .done {
                        ClaimSparkBurst(start: lockStart.addingTimeInterval(0.65), count: 40).frame(width: 420, height: 420)
                    }
                    if launchStart != nil {
                        VStack(spacing: 0) {
                            Image("icon-rocket-filled").renderingMode(.template).resizable().scaledToFit()
                                .frame(width: 58).rotationEffect(.degrees(-45)).foregroundStyle(Color.sjLaunchOrange)
                            LinearGradient(colors: [.orange, .yellow.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom)
                                .frame(width: 16, height: rocketUp ? 260 : 0)
                                .clipShape(Capsule())
                        }
                        .offset(y: rocketUp ? -1000 : -10)
                        .opacity(rocketUp || phase == .launched ? 1 : 0)
                    }
                }
            }
        }
    }

    /// One ninth of the frosted ??? tile. Frosted look is drawn with plain
    /// shapes: the system .glassEffect crashes (NaN layer position) when it's
    /// offset every frame, which the shake does.
    private func glassPiece(_ i: Int) -> some View {
        let col = CGFloat(i % 3), row = CGFloat(i / 3), piece = tile / 3
        let fly = shattered && !reduceMotion
        return ClaimTile(size: tile, filled: false) { Text("???") }
            .overlay(RoundedRectangle(cornerRadius: tile * 0.16)
                .fill(LinearGradient(colors: [.white.opacity(0.55), .white.opacity(0.08)],
                                     startPoint: .topLeading, endPoint: .bottomTrailing)))
            .overlay(RoundedRectangle(cornerRadius: tile * 0.16).strokeBorder(Color.white.opacity(0.9), lineWidth: 1.5))
            .overlay(ClaimCrackLines().trim(from: 0, to: cracks).stroke(Color.white, lineWidth: 2))
            .overlay(ClaimCrackLines().trim(from: 0, to: cracks).stroke(Color.black.opacity(0.4), lineWidth: 1))
            .mask(Rectangle().frame(width: piece, height: piece).offset(x: (col - 1) * piece, y: (row - 1) * piece))
            .offset(x: fly ? shards[i].dx : 0, y: fly ? shards[i].dy : 0)
            .rotationEffect(.degrees(fly ? shards[i].spin : 0))
            .opacity(shattered ? 0 : 1)
    }

    private var holdButton: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: 14).fill(Color.sjLaunchOrange.opacity(0.18))
            GeometryReader { geo in
                RoundedRectangle(cornerRadius: 14).fill(Color.sjLaunchOrange).frame(width: geo.size.width * progress)
            }
            Text(phase == .holding ? "Keep holding…" : "Hold to claim")
                .font(.jakarta(16, weight: .bold)).foregroundStyle(.white)
                .frame(maxWidth: .infinity)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14))
        .contentShape(Rectangle())
        .gesture(DragGesture(minimumDistance: 0)
            .onChanged { _ in if phase == .idle { beginHold() } }
            .onEnded { _ in if phase == .holding { cancelHold() } })
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(String(localized: "Claim founding badge"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { launch() }
    }

    // MARK: Sequence

    private func beginHold() {
        phase = .holding
        holdStart = Date()
        errorText = nil
        var events = [FXHaptics.rumble(0, holdDuration, 1.0, 0.5)]
        events += [0.18, 0.36, 0.52, 0.66, 0.78, 0.88, 0.96, 1.03, 1.09, 1.14, 1.18]
            .enumerated().map { i, t in FXHaptics.hit(t, min(1, 0.7 + Float(i) * 0.04), 1.0) }
        FXHaptics.shared.play(events, curves: [
            FXHaptics.curve(.hapticIntensityControl, [(0, 0.35), (0.7, 0.85), (1.0, 1.0), (holdDuration, 1.0)]),
            FXHaptics.curve(.hapticSharpnessControl, [(0, -0.4), (0.6, -0.1), (holdDuration, 0.5)]),
        ])
        withAnimation(.linear(duration: holdDuration)) { progress = 1; cracks = 1 }
        holdTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(holdDuration))
            if !Task.isCancelled && phase == .holding { launch() }
        }
    }

    private func cancelHold() {
        holdTask?.cancel()
        FXHaptics.shared.stop()
        phase = .idle
        holdStart = nil
        withAnimation(.easeOut(duration: 0.25)) { progress = 0; cracks = 0 }
    }

    private func launch() {
        guard phase == .idle || phase == .holding else { return }
        phase = .launched
        holdStart = nil
        let start = Date()
        launchStart = start

        // The break: crisp + deep max hits, full thrust rumble, shatter crunch.
        var events: [CHHapticEvent] = [
            FXHaptics.hit(0, 1.0, 1.0), FXHaptics.hit(0, 1.0, 0.0),
            FXHaptics.rumble(0, 0.7, 1.0, 0.2),
        ]
        events += (0..<14).map { FXHaptics.hit(0.02 + Double($0) * 0.025, 1.0, Float.random(in: 0.6...1.0)) }
        FXHaptics.shared.play(events, curves: [
            FXHaptics.curve(.hapticIntensityControl, [(0, 1), (0.5, 1), (0.7, 0.35)]),
        ])
        withAnimation(.easeOut(duration: 0.6)) { shattered = true; cracks = 1; progress = 1 }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.05))
            withAnimation(.easeIn(duration: 0.9)) { rocketUp = true }
            try? await Task.sleep(for: .seconds(0.5))
            withAnimation(.spring(duration: 0.35)) { revealed = true }
        }

        // The claim itself, in parallel with the break.
        Task { @MainActor in
            let result = await vm.claimFoundingBadge()
            // Keep the rhythm: digits never start locking before 0.95s.
            let wait = 0.95 - Date().timeIntervalSince(start)
            if wait > 0 { try? await Task.sleep(for: .seconds(wait)) }
            switch result {
            case .success(let claimed):
                number = claimed
                land()
            case .failure(let error):
                fail(error.message)
            }
        }
    }

    /// Digits lock at +0 / +0.2 / +0.4, landing at +0.65.
    private func land() {
        lockStart = Date()
        var events = [0.0, 0.2, 0.4].flatMap { [FXHaptics.hit($0, 1.0, 0.9), FXHaptics.rumble($0, 0.06, 1.0, 0.5)] }
        events += [FXHaptics.hit(0.65, 1.0, 0.0), FXHaptics.hit(0.65, 1.0, 1.0), FXHaptics.rumble(0.65, 0.45, 1.0, 0.0)]
        FXHaptics.shared.play(events, curves: [
            FXHaptics.curve(.hapticIntensityControl, [(0, 1), (0.65, 1), (1.1, 0)]),
        ])
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(0.65))
            withAnimation(.spring(response: 0.25, dampingFraction: 0.4)) { landed = true; phase = .done }
        }
    }

    private func fail(_ message: String) {
        FXHaptics.shared.play([FXHaptics.hit(0, 0.8, 0.3), FXHaptics.hit(0.15, 0.8, 0.3)])
        errorText = message
        withAnimation(.easeInOut(duration: 0.35)) {
            revealed = false
            shattered = false
            cracks = 0
            progress = 0
            phase = .failed
        }
        launchStart = nil
        rocketUp = false
    }
}

// MARK: - Pieces

/// The founding tile at ceremony size, with a custom middle line.
private struct ClaimTile<Middle: View>: View {
    let size: CGFloat
    let filled: Bool
    @ViewBuilder var middle: () -> Middle
    var body: some View {
        VStack(spacing: size * 0.03) {
            Image("icon-rocket-filled").renderingMode(.template).resizable().scaledToFit()
                .frame(height: size * 0.36)
            middle().font(.jakarta(size * 0.26, weight: .heavy)).monospacedDigit()
            Text("FIRST 500").font(.jakarta(size * 0.07, weight: .bold)).tracking(size * 0.012).opacity(0.85)
        }
        .foregroundStyle(filled ? .white : Color.sjMuted)
        .frame(width: size, height: size)
        .background(RoundedRectangle(cornerRadius: size * 0.16)
            .fill(filled ? Color.sjLaunchOrange : Color.sjBorder.opacity(0.5)))
    }
}

/// Spins until the number is known, then locks each digit 0.2s apart.
private struct ClaimDigits: View {
    let number: Int?
    let lockStart: Date?
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { ctx in
            let now = ctx.date.timeIntervalSinceReferenceDate
            let digits = Array(number?.foundingDigits ?? "000")
            HStack(spacing: 0) {
                ForEach(0..<3, id: \.self) { i in
                    let lockAt = lockStart?.addingTimeInterval(Double(i) * 0.2)
                    let locked = lockAt.map { ctx.date >= $0 } ?? false
                    Text(locked ? String(digits[i]) : String(Int(now * 24 + Double(i * 7)) % 10))
                        .scaleEffect(locked && ctx.date.timeIntervalSince(lockAt!) < 0.12 ? 1.25 : 1)
                }
            }
        }
    }
}

/// Sparks flying out from the centre, with a little gravity.
private struct ClaimSparkBurst: View {
    let start: Date
    private let count: Int
    private let speed: CGFloat
    private let duration: TimeInterval
    private let colors: [Color] = [.sjLaunchOrange, .yellow, .white, .orange]
    private let seeds: [(angle: Double, speed: Double, size: CGFloat, color: Int)]

    init(start: Date, count: Int = 34, speed: CGFloat = 260, duration: TimeInterval = 1.0) {
        self.start = start; self.count = count; self.speed = speed; self.duration = duration
        seeds = (0..<count).map { _ in (Double.random(in: 0..<(2 * .pi)), Double.random(in: 0.35...1),
                                        CGFloat.random(in: 3...7), Int.random(in: 0..<4)) }
    }

    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSince(start)
            Canvas { g, size in
                guard t >= 0, t < duration else { return }
                let c = CGPoint(x: size.width / 2, y: size.height / 2)
                g.opacity = 1 - t / duration
                for s in seeds {
                    let d = speed * CGFloat(s.speed * t)
                    let p = CGPoint(x: c.x + cos(s.angle) * d, y: c.y + sin(s.angle) * d + 300 * CGFloat(t * t))
                    g.fill(Path(ellipseIn: CGRect(x: p.x - s.size / 2, y: p.y - s.size / 2, width: s.size, height: s.size)),
                           with: .color(colors[s.color]))
                }
            }
        }
        .allowsHitTesting(false)
    }
}

private struct ClaimCrackLines: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        let c = CGPoint(x: r.midX + 8, y: r.midY - 6)
        for (a, len) in [(-100.0, 0.55), (-20.0, 0.6), (40.0, 0.5), (130.0, 0.65), (200.0, 0.5)] {
            let rad = a * .pi / 180
            p.move(to: c)
            p.addLine(to: CGPoint(x: c.x + cos(rad) * r.width * len * 0.5 + 6, y: c.y + sin(rad) * r.height * len * 0.5))
            p.addLine(to: CGPoint(x: c.x + cos(rad + 0.2) * r.width * len, y: c.y + sin(rad + 0.2) * r.height * len))
        }
        return p
    }
}

private func claimShake(_ date: Date, amplitude: CGFloat) -> CGSize {
    let t = date.timeIntervalSinceReferenceDate
    return CGSize(width: sin(t * 90) * amplitude, height: cos(t * 77) * amplitude * 0.6)
}
