import Foundation
import NetworkExtension

@MainActor
final class TunnelManager: ObservableObject {
    @Published private(set) var status: NEVPNStatus = .invalid
    @Published private(set) var busy = false
    @Published private(set) var profileName: String?
    @Published private(set) var lastRecord = "暂无隧道运行记录"
    let notices = Notifications()
    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?
    private var operation: UUID?
    private var disconnectRequested = false
    private var timeout: Task<Void, Never>?
    private var providerID: String { Bundle.main.object(forInfoDictionaryKey: "CrossbowTunnelID") as? String ?? "" }
    var connected: Bool { status == .connected || status == .reasserting }
    var pending: Bool { busy || status == .connecting || status == .disconnecting }
    var label: String {
        if busy && status != .disconnecting { return "准备连接…" }
        switch status { case .connected: return "已连接"; case .connecting: return "连接中…"; case .disconnecting: return "正在断开…"; case .reasserting: return "正在恢复连接…"; default: return "未连接" }
    }
    init() {
        observer = NotificationCenter.default.addObserver(forName: .NEVPNStatusDidChange, object: nil, queue: .main) { [weak self] event in
            guard let connection = event.object as? NEVPNConnection else { return }
            Task { @MainActor [weak self] in
                guard let self, connection === self.manager?.connection else { return }
                self.receive(connection.status)
            }
        }
        Task { await reload() }
    }
    func reload() async {
        do {
            let managers = try await NETunnelProviderManager.loadAllFromPreferences()
            guard operation == nil else { return }
            manager = managers.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == providerID }
            status = manager?.connection.status ?? .invalid
            if let files = try? SharedFiles.appGroup() { profileName = try? files.load().name; lastRecord = files.status() }
        } catch { notices.publish(UUID(), kind: .error, title: "无法读取 VPN 配置", description: "请检查系统权限和签名设置后重试。") }
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
    func connect() async {
        guard operation == nil, !connected else { return }
        let id = UUID(); operation = id; busy = true; disconnectRequested = false
        notices.publish(id, kind: .progress, title: "准备连接", description: "首次连接需要系统 VPN 授权。")
        do {
            _ = try SharedFiles.appGroup().load()
            let all = try await NETunnelProviderManager.loadAllFromPreferences()
            guard operation == id else { return }
            let target = all.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == providerID } ?? NETunnelProviderManager()
            let configuration = NETunnelProviderProtocol()
            configuration.providerBundleIdentifier = providerID
            configuration.serverAddress = "Crossbow"
            configuration.disconnectOnSleep = false
            target.protocolConfiguration = configuration; target.localizedDescription = "Crossbow"; target.isEnabled = true; manager = target
            try await target.saveToPreferences()
            guard operation == id else { return }
            try await target.loadFromPreferences()
            guard operation == id else { return }
            try target.connection.startVPNTunnel()
            busy = false; receive(target.connection.status)
            timeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(25))
                guard !Task.isCancelled, let self, self.operation == id, !self.connected else { return }
                self.manager?.connection.stopVPNTunnel(); self.operation = nil; self.busy = false
                self.notices.publish(id, kind: .error, title: "连接超时", description: "隧道未确认连接，请在诊断页查看状态并重试。")
            }
        } catch {
            guard operation == id else { return }
            operation = nil; busy = false; status = manager?.connection.status ?? .invalid
            notices.publish(id, kind: .error, title: "连接未完成", description: "请确认已导入配置，并允许系统 VPN 授权；也可查看诊断页。")
        }
    }
    func disconnect() {
        if let old = operation { notices.publish(old, kind: .info, title: "连接操作已取消") }
        operation = nil; busy = false; timeout?.cancel()
        let id = UUID(); operation = id; disconnectRequested = true
        manager?.connection.stopVPNTunnel()
        status = manager?.connection.status ?? .invalid
        notices.publish(id, kind: .progress, title: "正在断开")
        if status == .disconnected || status == .invalid { receive(status) }
    }
    private func receive(_ value: NEVPNStatus) {
        let previous = status; status = value
        if let files = try? SharedFiles.appGroup() { lastRecord = files.status() }
        if value == .connected {
            timeout?.cancel(); busy = false
            if let id = operation { notices.publish(id, kind: .success, title: "隧道已连接", description: "请用浏览器验证实际站点访问。") }
            operation = nil
        } else if value == .disconnected || value == .invalid {
            if let id = operation, disconnectRequested {
                notices.publish(id, kind: .success, title: "已断开连接"); operation = nil; busy = false
            } else if value == .disconnected && (previous == .connecting || previous == .connected || previous == .reasserting) {
                timeout?.cancel(); busy = false
                notices.publish(operation ?? UUID(), kind: .error, title: "隧道已停止", description: "请检查配置和网络，诊断页可查看固定状态码。")
                operation = nil
            }
        }
    }
}
