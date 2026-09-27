import CoreHaptics
import Foundation

/// Core Haptics patterns for big moments (the founding-badge claim):
/// shaped rumbles and timed hits, far stronger than `.sensoryFeedback`.
/// No-ops on hardware without haptics (simulator, iPad).
@MainActor
final class FXHaptics {
    static let shared = FXHaptics()

    private var engine: CHHapticEngine?
    private var player: CHHapticAdvancedPatternPlayer?

    private init() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        engine = try? CHHapticEngine()
        engine?.isAutoShutdownEnabled = true
        engine?.resetHandler = { [weak self] in try? self?.engine?.start() }
    }

    /// Plays a pattern, replacing whatever was playing.
    func play(_ events: [CHHapticEvent], curves: [CHHapticParameterCurve] = []) {
        guard let engine else { return }
        stop()
        do {
            try engine.start()
            let pattern = try CHHapticPattern(events: events, parameterCurves: curves)
            player = try engine.makeAdvancedPlayer(with: pattern)
            try player?.start(atTime: CHHapticTimeImmediate)
        } catch {
            print("FXHaptics.play failed: \(error)")
        }
    }

    func stop() {
        try? player?.stop(atTime: CHHapticTimeImmediate)
        player = nil
    }

    // MARK: Building blocks

    /// A single hit. Sharpness 0 = deep thud, 1 = crisp click.
    static func hit(_ time: TimeInterval, _ intensity: Float, _ sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(eventType: .hapticTransient, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
        ], relativeTime: time)
    }

    /// A sustained vibration.
    static func rumble(_ time: TimeInterval, _ duration: TimeInterval, _ intensity: Float, _ sharpness: Float) -> CHHapticEvent {
        CHHapticEvent(eventType: .hapticContinuous, parameters: [
            CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
            CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
        ], relativeTime: time, duration: duration)
    }

    /// Shapes rumbles over time: intensity control (0…1 multiplier) or
    /// sharpness control (-1…1 offset), as (time, value) points.
    static func curve(_ id: CHHapticDynamicParameter.ID, _ points: [(TimeInterval, Float)]) -> CHHapticParameterCurve {
        CHHapticParameterCurve(
            parameterID: id,
            controlPoints: points.map { CHHapticParameterCurve.ControlPoint(relativeTime: $0.0, value: $0.1) },
            relativeTime: 0
        )
    }
}
