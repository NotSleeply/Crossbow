import Foundation
import CryptoKit

struct ConfigurationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
struct ConfigurationSnapshot: Codable {
    let schemaVersion: Int
    let coreVersion: String
    let revision: UUID
    let name: String
    let config: String
    let digest: String

    init(name: String, data: Data) throws {
        guard data.count <= 1_048_576 else { throw ConfigurationError(message: "配置超过 1 MB，请精简后导入。") }
        guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let outbounds = object["outbounds"] as? [[String: Any]], !outbounds.isEmpty else {
            throw ConfigurationError(message: "首个验证包需要包含 outbounds 的 sing-box JSON；Clash 订阅将在后续接入。")
        }
        let allowed: Set<String> = ["log", "dns", "inbounds", "outbounds", "route"]
        guard Set(object.keys).isSubset(of: allowed) else { throw ConfigurationError(message: "配置包含本验证包尚未支持的顶级字段。") }
        guard object["dns"] is [String: Any] else { throw ConfigurationError(message: "请提供完整的 DNS 配置。") }
        try Self.rejectProcessRules(object)
        if let inbounds = object["inbounds"] as? [[String: Any]], inbounds.contains(where: { ($0["type"] as? String) != "tun" }) {
            throw ConfigurationError(message: "iOS 验证包不开放 HTTP/SOCKS 入站，请移除非 TUN inbounds。")
        }
        object["inbounds"] = [["type": "tun", "tag": "crossbow-tun", "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"], "mtu": 1500, "auto_route": true, "strict_route": true, "stack": "gvisor"]]
        object["log"] = ["level": "info", "timestamp": true]
        var route = object["route"] as? [String: Any] ?? [:]
        var rules = route["rules"] as? [[String: Any]] ?? []
        rules.insert(["protocol": "dns", "action": "hijack-dns"], at: 0)
        route["rules"] = rules
        route["auto_detect_interface"] = true
        object["route"] = route
        let rendered = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        self.schemaVersion = 1
        self.coreVersion = "1.14.4"
        self.revision = UUID()
        self.name = String(name.prefix(80))
        self.config = String(decoding: rendered, as: UTF8.self)
        self.digest = Self.hash(rendered)
    }
    func validate() throws {
        guard schemaVersion == 1, coreVersion == "1.14.4", config.utf8.count <= 1_048_576,
              digest == Self.hash(Data(config.utf8)) else { throw ConfigurationError(message: "配置快照校验失败，请重新导入。") }
    }
    private static func hash(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
    private static func rejectProcessRules(_ value: Any) throws {
        let blocked: Set<String> = ["process_name", "process_path", "process_path_regex", "package_name", "user", "user_id"]
        if let dict = value as? [String: Any] {
            if !Set(dict.keys).isDisjoint(with: blocked) { throw ConfigurationError(message: "普通 iOS 环境不支持此配置中的进程或应用匹配规则。") }
            for value in dict.values { try rejectProcessRules(value) }
        } else if let list = value as? [Any] { for value in list { try rejectProcessRules(value) } }
    }
    static let directExample = Data(#"{"dns":{"servers":[{"type":"udp","tag":"local","server":"223.5.5.5"}],"final":"local"},"outbounds":[{"type":"direct","tag":"direct"}],"route":{"final":"direct"}}"#.utf8)
}

struct SharedFiles {
    let root: URL
    init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var resource = URLResourceValues(); resource.isExcludedFromBackup = true
        var url = root; try url.setResourceValues(resource)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: root.path)
        #endif
    }
    static func appGroup() throws -> SharedFiles {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "CrossbowAppGroup") as? String,
              let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw ConfigurationError(message: "App Group 不可用，请检查签名权限。")
        }
        return try inAppGroupContainer(url)
    }
    static func inAppGroupContainer(_ container: URL) throws -> SharedFiles {
        // Keep persistent data in the standard shared Library directory. Device
        // development tools only expose Library/Documents/tmp, never the root.
        let files = try SharedFiles(root: container.appendingPathComponent("Library/Application Support/Crossbow/Tunnel", isDirectory: true))
        let legacyRoot = container.appendingPathComponent("Tunnel", isDirectory: true)
        let legacySnapshot = legacyRoot.appendingPathComponent("active.json")
        if !FileManager.default.fileExists(atPath: files.root.appendingPathComponent("active.json").path),
           FileManager.default.fileExists(atPath: legacySnapshot.path) {
            let legacy = try SharedFiles(root: legacyRoot)
            // Validate before migrating; a failed write leaves the old copy intact.
            try files.save(legacy.load())
        }
        if FileManager.default.fileExists(atPath: legacySnapshot.path) {
            _ = try files.load()
            do { try FileManager.default.removeItem(at: legacySnapshot) }
            catch CocoaError.fileNoSuchFile { /* Another process completed the same migration. */ }
        }
        return files
    }
    func save(_ snapshot: ConfigurationSnapshot) throws {
        try snapshot.validate()
        try write(try JSONEncoder().encode(snapshot), file: "active.json")
    }
    func load() throws -> ConfigurationSnapshot {
        let url = root.appendingPathComponent("active.json")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw ConfigurationError(message: "请先在配置页导入 sing-box JSON，或使用直连验证配置。")
        }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 2_097_152 else { throw ConfigurationError(message: "配置文件过大。") }
        let value = try JSONDecoder().decode(ConfigurationSnapshot.self, from: Data(contentsOf: url))
        try value.validate(); return value
    }
    func record(code: String) {
        // Only fixed diagnostic codes cross processes; no raw core errors/config.
        let text = "\(ISO8601DateFormatter().string(from: Date())) \(code)"
        try? write(Data(text.utf8), file: "last-status.txt")
    }
    func status() -> String { (try? String(contentsOf: root.appendingPathComponent("last-status.txt"), encoding: .utf8)) ?? "暂无隧道运行记录" }
    private func write(_ data: Data, file: String) throws {
        var options: Data.WritingOptions = [.atomic]
        #if os(iOS)
        options.insert(.completeFileProtectionUntilFirstUserAuthentication)
        #endif
        try data.write(to: root.appendingPathComponent(file), options: options)
    }
}
