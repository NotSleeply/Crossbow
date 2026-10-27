import Foundation
import Network
import NetworkExtension
import Tunnelcore
import Darwin

final class TunnelPlatform: NSObject, TunnelcorePlatformProtocol {
    private weak var provider: NEPacketTunnelProvider?
    private let lock = NSLock()
    private var monitor: NWPathMonitor?
    init(provider: NEPacketTunnelProvider) { self.provider = provider }

    private struct Prefix: Decodable { let address: String; let mask: String; let prefix: Int }
    private struct Settings: Decodable {
        let mtu: Int
        let dns: [String]?
        let ipv4: [Prefix]?
        let ipv6: [Prefix]?
        let routes4: [Prefix]?
        let routes6: [Prefix]?
        let exclude4: [Prefix]?
        let exclude6: [Prefix]?
    }
    func applyNetworkSettings(_ value: String?) throws {
        guard let value, value.utf8.count < 262_144, let provider else { throw failure("invalid network settings") }
        let input = try JSONDecoder().decode(Settings.self, from: Data(value.utf8))
        guard input.mtu >= 1280, input.mtu <= 9000, let servers = input.dns, !servers.isEmpty else { throw failure("missing DNS or invalid MTU") }
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")
        settings.mtu = NSNumber(value: input.mtu)
        let dns = NEDNSSettings(servers: servers)
        dns.matchDomains = [""]; dns.matchDomainsNoSearch = true
        settings.dnsSettings = dns
        let addresses4 = input.ipv4 ?? []
        if !addresses4.isEmpty {
            let ipv4 = NEIPv4Settings(addresses: addresses4.map(\.address), subnetMasks: addresses4.map(\.mask))
            let routes = input.routes4 ?? []
            ipv4.includedRoutes = routes.isEmpty ? [NEIPv4Route.default()] : routes.map { NEIPv4Route(destinationAddress: $0.address, subnetMask: $0.mask) }
            ipv4.excludedRoutes = (input.exclude4 ?? []).map { NEIPv4Route(destinationAddress: $0.address, subnetMask: $0.mask) }
            settings.ipv4Settings = ipv4
        }
        let addresses6 = input.ipv6 ?? []
        if !addresses6.isEmpty {
            let ipv6 = NEIPv6Settings(addresses: addresses6.map(\.address), networkPrefixLengths: addresses6.map { NSNumber(value: $0.prefix) })
            let routes = input.routes6 ?? []
            ipv6.includedRoutes = routes.isEmpty ? [NEIPv6Route.default()] : routes.map { NEIPv6Route(destinationAddress: $0.address, networkPrefixLength: NSNumber(value: $0.prefix)) }
            ipv6.excludedRoutes = (input.exclude6 ?? []).map { NEIPv6Route(destinationAddress: $0.address, networkPrefixLength: NSNumber(value: $0.prefix)) }
            settings.ipv6Settings = ipv6
        }
        let semaphore = DispatchSemaphore(value: 0)
        var result: Error?
        provider.setTunnelNetworkSettings(settings) { error in result = error; semaphore.signal() }
        guard semaphore.wait(timeout: .now() + 15) == .success else { throw failure("network settings timed out") }
        if let result { throw result }
    }
    func startMonitor(_ listener: TunnelcoreInterfaceListenerProtocol?) throws {
        guard let listener else { throw failure("missing interface listener") }
        try stopMonitor()
        let monitor = NWPathMonitor()
        lock.lock(); self.monitor = monitor; lock.unlock()
        let first = DispatchSemaphore(value: 0)
        let firstLock = NSLock(); var delivered = false
        monitor.pathUpdateHandler = { path in
            if path.status == .satisfied, let interface = path.availableInterfaces.first(where: { !$0.name.hasPrefix("utun") }) {
                listener.update(interface.name, index: Int32(interface.index), expensive: path.isExpensive, constrained: path.isConstrained)
            } else { listener.update("", index: -1, expensive: false, constrained: false) }
            firstLock.lock(); if !delivered { delivered = true; first.signal() }; firstLock.unlock()
        }
        monitor.start(queue: DispatchQueue(label: "crossbow.tunnel.network"))
        guard first.wait(timeout: .now() + 10) == .success else { try stopMonitor(); throw failure("interface monitor timed out") }
    }
    func stopMonitor() throws {
        lock.lock(); let old = monitor; monitor = nil; lock.unlock()
        old?.cancel()
    }
    func interfaces(_ error: NSErrorPointer) -> String {
        do { return try interfaceData() }
        catch let failure { error?.pointee = failure as NSError; return "[]" }
    }
    private func interfaceData() throws -> String {
        lock.lock(); let path = monitor?.currentPath; lock.unlock()
        guard let path else { throw failure("interface monitor not started") }
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0 else { throw failure("cannot read interfaces") }
        defer { freeifaddrs(head) }
        var addresses: [String: [String]] = [:]
        var flags: [String: UInt32] = [:]
        var cursor = head
        while let current = cursor {
            let item = current.pointee; cursor = item.ifa_next
            let name = String(cString: item.ifa_name); flags[name] = item.ifa_flags
            guard let address = item.ifa_addr, let mask = item.ifa_netmask,
                  address.pointee.sa_family == UInt8(AF_INET) || address.pointee.sa_family == UInt8(AF_INET6) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let bits: Int
            if address.pointee.sa_family == UInt8(AF_INET) {
                var value = UnsafeRawPointer(mask).assumingMemoryBound(to: sockaddr_in.self).pointee.sin_addr
                bits = withUnsafeBytes(of: &value) { $0.reduce(0) { $0 + $1.nonzeroBitCount } }
            } else {
                var value = UnsafeRawPointer(mask).assumingMemoryBound(to: sockaddr_in6.self).pointee.sin6_addr
                bits = withUnsafeBytes(of: &value) { $0.reduce(0) { $0 + $1.nonzeroBitCount } }
            }
            let ip = String(cString: host).split(separator: "%")[0]
            addresses[name, default: []].append("\(ip)/\(bits)")
        }
        let items: [[String: Any]] = path.status == .satisfied ? path.availableInterfaces.filter { !$0.name.hasPrefix("utun") }.map { interface in
            let type: Int
            switch interface.type { case .wifi: type = 0; case .cellular: type = 1; case .wiredEthernet: type = 2; default: type = 3 }
            return ["name": interface.name, "index": interface.index, "mtu": 1500, "flags": flags[interface.name] ?? 0, "type": type, "addresses": addresses[interface.name] ?? []]
        } : []
        return String(decoding: try JSONSerialization.data(withJSONObject: items), as: UTF8.self)
    }
    private func failure(_ code: String) -> Error { NSError(domain: "Crossbow.Network", code: 1, userInfo: [NSLocalizedDescriptionKey: code]) }
}
