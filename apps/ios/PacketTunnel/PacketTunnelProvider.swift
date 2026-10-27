import Foundation
import NetworkExtension
import Tunnelcore

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private let queue = DispatchQueue(label: "crossbow.tunnel.lifecycle")
    private var engine: TunnelcoreEngine?
    private lazy var platform = TunnelPlatform(provider: self)

    override func startTunnel(options: [String: NSObject]? = nil, completionHandler: @escaping (Error?) -> Void) {
        queue.async { [self] in
            do {
                let files = try SharedFiles.appGroup()
                let snapshot = try files.load()
                files.record(code: "STARTING")
                var error: NSError?
                guard let engine = TunnelcoreNewEngine(platform, files.root.appendingPathComponent("core").path, &error) else {
                    throw error ?? failure("CORE_SETUP_FAILED")
                }
                self.engine = engine
                do { try engine.start(snapshot.config) }
                catch { engine.close(); self.engine = nil; throw error }
                files.record(code: "CONNECTED")
                completionHandler(nil)
            } catch {
                engine?.close(); engine = nil
                (try? SharedFiles.appGroup())?.record(code: "START_FAILED_CHECK_CONFIG_OR_NETWORK")
                // Raw libbox errors can include a server or credential. Keep the
                // cross-process message bounded and free of user config values.
                completionHandler(failure("START_FAILED_CHECK_CONFIG_OR_NETWORK"))
            }
        }
    }
    override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
        queue.async { [self] in
            engine?.close(); engine = nil
            try? platform.stopMonitor()
            (try? SharedFiles.appGroup())?.record(code: "STOPPED_\(reason.rawValue)")
            completionHandler()
        }
    }
    override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
        guard messageData == Data("status-v1".utf8) else { completionHandler?(nil); return }
        queue.async {
            let status = (try? SharedFiles.appGroup())?.status() ?? "STATUS_UNAVAILABLE"
            completionHandler?(Data(status.prefix(512).utf8))
        }
    }
    override func sleep(completionHandler: @escaping () -> Void) { completionHandler() }
    override func wake() {}
    private func failure(_ code: String) -> NSError { NSError(domain: "Crossbow.Tunnel", code: 1, userInfo: [NSLocalizedDescriptionKey: code]) }
}
