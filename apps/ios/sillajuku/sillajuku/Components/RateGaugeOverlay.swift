import SwiftUI
import UIKit

/// A single floating window, above every other window (including sheets),
/// used to render the drag-to-rate gauge so it can escape whatever
/// List/ScrollView/HStack the rate button itself sits inside. SwiftUI has no
/// direct equivalent of web's `createPortal(..., document.body)` (which is
/// what `FlowerRateControl.tsx`'s `DragGauge` uses) -- this is the iOS
/// substitute. Non-interactive: the window ignores touches, so the real
/// button beneath keeps owning the actual `DragGesture`.
@MainActor
final class RateGaugeOverlay {
    static let shared = RateGaugeOverlay()

    private var window: UIWindow?
    private var hostingController: UIHostingController<RateGaugeView>?

    private init() {}

    func show(origin: CGPoint, angle: Double, score: Double?, size: CGFloat, canDelete: Bool = false, isOverDeleteZone: Bool = false) {
        let view = RateGaugeView(origin: origin, angle: angle, score: score, size: size, canDelete: canDelete, isOverDeleteZone: isOverDeleteZone)
        if let hostingController {
            hostingController.rootView = view
            return
        }
        guard let scene = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene })
            .first(where: { $0.activationState == .foregroundActive })
        else { return }

        let controller = UIHostingController(rootView: view)
        controller.view.backgroundColor = .clear
        let win = UIWindow(windowScene: scene)
        win.windowLevel = .alert + 1
        win.backgroundColor = .clear
        win.isUserInteractionEnabled = false
        win.rootViewController = controller
        win.isHidden = false
        window = win
        hostingController = controller
    }

    func hide() {
        window?.isHidden = true
        window = nil
        hostingController = nil
    }
}
