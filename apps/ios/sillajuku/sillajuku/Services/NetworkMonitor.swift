import Foundation
import Network
import Observation

/// Live network reachability, backed by `NWPathMonitor`. Push-based —
/// `isConnected` updates the moment the path actually changes (WiFi drops,
/// airplane mode, cellular reconnects); nothing polls it and nothing needs
/// to call a manual re-check for it to stay current.
@Observable
final class NetworkMonitor {
    static let shared = NetworkMonitor()

    /// Optimistic until the first path update arrives (near-instant in
    /// practice) — starting `false` would flash a false "no internet" error
    /// on every launch before `NWPathMonitor` has reported anything.
    private(set) var isConnected = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.sillajuku.networkMonitor")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            DispatchQueue.main.async {
                self?.isConnected = connected
            }
        }
        monitor.start(queue: queue)
    }
}
