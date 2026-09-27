import SwiftUI
import UIKit

/// The comment box used by the comment sheets. A UIKit text view instead of a
/// SwiftUI `TextField` for one reason: it becomes first responder the moment
/// it's added to the window, so the keyboard animates up *together with* the
/// sheet. `@FocusState` can only be set once the sheet has appeared, which
/// shows the sheet first and the keyboard a beat later.
///
/// Mirrors the old field: Jakarta 14pt, grows to `maxLines` then scrolls,
/// Return sends (`onSubmit`) instead of inserting a newline.
///
/// Present the hosting sheet with `.presentationDetents([.large])` only. With
/// a smaller detent available, focusing the field makes iOS grow (or slide)
/// the sheet while SwiftUI lifts the bar for the keyboard, and the bar
/// overshoots above the keyboard before settling (measured frame by frame in
/// the simulator, 2026-09-26). Large-only leaves just the keyboard motion.
struct CommentInputField: UIViewRepresentable {
    @Binding var text: String
    /// Two-way: set true to focus (e.g. Reply), reflects the real state.
    @Binding var isFocused: Bool
    var placeholder: String = String(localized: "Add a comment…")
    /// Focus as soon as the field is on screen.
    var focusOnAppear = true
    var maxLines = 4
    var onSubmit: () -> Void = {}

    private static let font = UIFont(name: "PlusJakartaSans-Regular", size: 14) ?? .systemFont(ofSize: 14)

    final class FieldView: UITextView {
        var focusWhenInWindow = false
        let placeholderLabel = UILabel()

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard focusWhenInWindow, window != nil else { return }
            focusWhenInWindow = false
            becomeFirstResponder()
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> FieldView {
        let view = FieldView()
        view.delegate = context.coordinator
        view.font = Self.font
        view.textColor = UIColor(named: "sjInk")
        view.backgroundColor = .clear
        view.isScrollEnabled = false
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.returnKeyType = .send
        view.enablesReturnKeyAutomatically = true
        view.setContentHuggingPriority(.defaultLow, for: .horizontal)
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityLabel = placeholder

        view.placeholderLabel.text = placeholder
        view.placeholderLabel.font = Self.font
        view.placeholderLabel.textColor = UIColor(named: "sjMuted")
        view.placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(view.placeholderLabel)
        NSLayoutConstraint.activate([
            view.placeholderLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            view.placeholderLabel.topAnchor.constraint(equalTo: view.topAnchor),
        ])

        view.text = text
        view.placeholderLabel.isHidden = !text.isEmpty
        view.focusWhenInWindow = focusOnAppear
        return view
    }

    func updateUIView(_ view: FieldView, context: Context) {
        context.coordinator.parent = self
        if view.text != text {
            view.text = text
            view.placeholderLabel.isHidden = !text.isEmpty
            view.invalidateIntrinsicContentSize()
        }
        // Only drive focus once the view is live; before that,
        // focusWhenInWindow handles it.
        guard view.window != nil else { return }
        if isFocused, !view.isFirstResponder {
            DispatchQueue.main.async { view.becomeFirstResponder() }
        } else if !isFocused, view.isFirstResponder {
            DispatchQueue.main.async { view.resignFirstResponder() }
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: FieldView, context: Context) -> CGSize? {
        let width = proposal.width ?? 240
        let fitting = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height
        let lineHeight = Self.font.lineHeight
        let maxHeight = ceil(lineHeight * CGFloat(maxLines))
        let scrolls = fitting > maxHeight
        if uiView.isScrollEnabled != scrolls { uiView.isScrollEnabled = scrolls }
        return CGSize(width: width, height: max(ceil(lineHeight), min(fitting, maxHeight)))
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: CommentInputField
        init(_ parent: CommentInputField) { self.parent = parent }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange,
                      replacementText replacement: String) -> Bool {
            if replacement == "\n" {
                parent.onSubmit()
                return false
            }
            return true
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text
            (textView as? FieldView)?.placeholderLabel.isHidden = !textView.text.isEmpty
            textView.invalidateIntrinsicContentSize()
        }

        func textViewDidBeginEditing(_ textView: UITextView) {
            if !parent.isFocused { parent.isFocused = true }
        }

        func textViewDidEndEditing(_ textView: UITextView) {
            if parent.isFocused { parent.isFocused = false }
        }
    }
}

/// Plain UIKit tap target. SwiftUI doesn't route taps to a background that
/// only reaches the home-indicator strip via `.ignoresSafeArea` (verified in
/// the simulator); a UIKit view there is hit-tested by its real frame.
struct TapCatcher: UIViewRepresentable {
    let onTap: () -> Void

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.backgroundColor = .clear
        view.addGestureRecognizer(UITapGestureRecognizer(target: context.coordinator,
                                                         action: #selector(Coordinator.tapped)))
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) { context.coordinator.onTap = onTap }

    func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

    final class Coordinator: NSObject {
        var onTap: () -> Void
        init(onTap: @escaping () -> Void) { self.onTap = onTap }
        @objc func tapped() { onTap() }
    }
}
