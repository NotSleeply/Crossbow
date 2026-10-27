import Foundation
import NetworkExtension
import Combine

@MainActor
private final class SystemTunnelController: TunnelControlling {
    var onStatus: ((TunnelStatus) -> Void)?
    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?
    private var generation = UUID()
    private var providerID: String { Bundle.main.object(forInfoDictionaryKey: "CrossbowTunnelID") as? String ?? "" }
    var status: TunnelStatus { map(manager?.connection.status ?? .invalid) }
    init() {
        observer = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: nil, queue: .main) { [weak self] event in
            guard let connection = event.object as? NEVPNConnection else { return }
            Task { @MainActor [weak self] in
                guard let self, connection === self.manager?.connection else { return }
                self.onStatus?(self.map(connection.status))
            }
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    func reload() async throws {
        let token = UUID(); generation = token
        let all = try await NETunnelProviderManager.loadAllFromPreferences()
        guard generation == token else { return }
        manager = all.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == providerID }
    }
    func prepare() async throws {
        guard !providerID.isEmpty else { throw ConfigurationError(message: "隧道标识缺失，请重新安装开发构建。") }
        let token = UUID(); generation = token
        let all = try await NETunnelProviderManager.loadAllFromPreferences()
        guard generation == token else { throw CancellationError() }
        let target = all.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == providerID } ?? NETunnelProviderManager()
        manager = target
        if status.connected { return }
        let configuration = NETunnelProviderProtocol()
        configuration.providerBundleIdentifier = providerID
        configuration.serverAddress = "Crossbow"
        configuration.disconnectOnSleep = false
        target.protocolConfiguration = configuration
        target.localizedDescription = "Crossbow"
        target.isOnDemandEnabled = false
        target.isEnabled = true
        try await target.saveToPreferences()
        try await target.loadFromPreferences()
    }
    func start() throws {
        guard let manager else { throw ConfigurationError(message: "系统 VPN 配置尚未就绪，请重试连接。") }
        try manager.connection.startVPNTunnel()
    }
    func stop() { manager?.connection.stopVPNTunnel() }
    private func map(_ value: NEVPNStatus) -> TunnelStatus {
        switch value {
        case .connected: return .connected
        case .connecting: return .connecting
        case .disconnecting: return .disconnecting
        case .reasserting: return .reasserting
        case .disconnected: return .disconnected
        default: return .invalid
        }
    }
}

@MainActor
final class TunnelManager: ObservableObject {
    @Published private(set) var profileName: String?
    @Published private(set) var lastRecord = "暂无隧道运行记录"
    let notices = Notifications()
    private let lifecycle: TunnelLifecycle
    private var changes: AnyCancellable?
    var connected: Bool { lifecycle.connected }
    var pending: Bool { lifecycle.pending }
    var label: String { lifecycle.label }
    var cancelling: Bool { lifecycle.phase == .cancelling }
    init() {
        lifecycle = TunnelLifecycle(controller: SystemTunnelController()) { _ = try SharedFiles.appGroup().load() }
        changes = lifecycle.objectWillChange.sink { [weak self] in self?.objectWillChange.send() }
        lifecycle.onFeedback = { [weak self] event in
            guard let self else { return }
            let kind: Notifications.Kind
            switch event.kind { case .progress: kind = .progress; case .success: kind = .success; case .error: kind = .error; case .info: kind = .info }
            self.notices.publish(event.id, kind: kind, title: event.title, description: event.message)
            self.refreshRecord()
        }
        Task { await reload() }
    }
    func reload() async {
        do { try await lifecycle.reload(); refreshRecord() }
        catch { notices.publish(UUID(), kind: .error, title: "无法读取 VPN 配置", description: "请检查系统权限和签名设置后重试。") }
    }
    func importConfiguration(data: Data, name: String) {
        let id = UUID()
        guard !connected && !pending else { notices.publish(id, kind: .info, title: "请先断开连接再导入配置"); return }
        do {
            let snapshot = try ConfigurationSnapshot(name: name, data: data)
            try SharedFiles.appGroup().save(snapshot); profileName = snapshot.name
            notices.publish(id, kind: .success, title: "配置已导入", description: "系统将接管 TUN 参数；连接时由固定版本内核完成最终校验。")
        } catch let error as ConfigurationError { notices.publish(id, kind: .error, title: "配置导入失败", description: error.message) }
        catch { notices.publish(id, kind: .error, title: "配置导入失败", description: "请检查 JSON 格式及文件权限。") }
    }
    func connect() async { await lifecycle.connect() }
    func disconnect() { lifecycle.disconnect() }
    private func refreshRecord() {
        guard let files = try? SharedFiles.appGroup() else { return }
        profileName = try? files.load().name; lastRecord = files.status()
    }
}
