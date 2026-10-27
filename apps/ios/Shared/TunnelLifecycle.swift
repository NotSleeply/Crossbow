import Foundation
import Combine

enum TunnelStatus: Equatable {
    case invalid, disconnected, connecting, connected, reasserting, disconnecting
    var connected: Bool { self == .connected || self == .reasserting }
}

@MainActor
protocol TunnelControlling: AnyObject {
    var status: TunnelStatus { get }
    var onStatus: ((TunnelStatus) -> Void)? { get set }
    func reload() async throws
    func prepare() async throws
    func start() throws
    func stop()
}

struct TunnelFeedback {
    enum Kind { case progress, success, error, info }
    let id: UUID
    let kind: Kind
    let title: String
    let message: String
}

/// System status is authoritative. A pending preference authorization cannot be
/// cancelled by starting another save; wait for it to finish, then skip startup.
@MainActor
final class TunnelLifecycle: ObservableObject {
    enum Phase: Equatable { case idle, preparing, cancelling, connecting, disconnecting }
    @Published private(set) var status: TunnelStatus
    @Published private(set) var phase: Phase = .idle
    private(set) var operationID: UUID?
    var onFeedback: ((TunnelFeedback) -> Void)?
    private let controller: any TunnelControlling
    private let validate: () throws -> Void
    private let connectTimeout: Duration
    private let stopTimeout: Duration
    private var timer: Task<Void, Never>?
    private var cancellationRequested = false
    private var expectedDisconnect = false

    init(controller: any TunnelControlling, connectTimeout: Duration = .seconds(25), stopTimeout: Duration = .seconds(12), validate: @escaping () throws -> Void) {
        self.controller = controller
        self.status = controller.status
        self.connectTimeout = connectTimeout
        self.stopTimeout = stopTimeout
        self.validate = validate
        controller.onStatus = { [weak self] in self?.receive($0) }
    }
    var connected: Bool { status.connected }
    var pending: Bool { phase != .idle || status == .connecting || status == .disconnecting }
    var label: String {
        switch phase {
        case .preparing: return "准备连接…"
        case .cancelling: return "正在取消连接…"
        case .disconnecting: return "正在断开…"
        case .connecting: return "连接中…"
        case .idle:
            switch status {
            case .connected: return "已连接"
            case .reasserting: return "正在恢复连接…"
            case .connecting: return "连接中…"
            case .disconnecting: return "正在断开…"
            default: return "未连接"
            }
        }
    }
    func reload() async throws {
        guard operationID == nil else { return }
        try await controller.reload()
        guard operationID == nil else { return }
        receive(controller.status)
    }
    func connect() async {
        guard !pending, !connected, operationID == nil else { return }
        let id = UUID()
        operationID = id; cancellationRequested = false; expectedDisconnect = false; phase = .preparing
        emit(id, .progress, "准备连接", "首次连接需要系统 VPN 授权。")
        do {
            try validate()
            try await controller.prepare()
            guard operationID == id else { return }
            if cancellationRequested {
                stopPreparedConnection(id)
                return
            }
            phase = .connecting
            if !controller.status.connected { try controller.start() }
            // startVPNTunnel returning only means the request was accepted. The
            // immediate property can still be disconnected until the first event.
            let current = controller.status
            if current.connected || current == .connecting { receive(current) }
            else { status = current }
            if operationID == id { arm(id, delay: connectTimeout) }
        } catch {
            guard operationID == id else { return }
            status = controller.status
            let cancelled = cancellationRequested
            finish()
            if cancelled { emit(id, .info, "连接操作已取消") }
            else {
                let message = (error as? ConfigurationError)?.message ?? "请确认系统 VPN 权限，并在诊断页检查状态。"
                emit(id, .error, "连接未完成", message)
            }
        }
    }
    func disconnect() {
        if phase == .preparing || phase == .cancelling {
            cancellationRequested = true; phase = .cancelling
            if let id = operationID {
                emit(id, .progress, "正在取消连接", "如系统正在询问授权，请完成或取消该对话框。")
            }
            return
        }
        let id = operationID ?? UUID()
        operationID = id; cancellationRequested = true; expectedDisconnect = false; phase = .disconnecting
        timer?.cancel()
        emit(id, .progress, "正在断开")
        controller.stop()
        receive(controller.status)
        if operationID == id { arm(id, delay: stopTimeout) }
    }
    private func stopPreparedConnection(_ id: UUID) {
        phase = .disconnecting
        controller.stop()
        receive(controller.status)
        if operationID == id { arm(id, delay: stopTimeout) }
    }
    private func receive(_ value: TunnelStatus) {
        let previous = status; status = value
        if (value == .disconnected || value == .invalid), expectedDisconnect {
            expectedDisconnect = false
            return
        }
        // A save/load can emit disconnected before start. It is not a failure.
        guard phase != .preparing, phase != .cancelling else { return }
        if value.connected {
            if phase == .disconnecting { return }
            let id = operationID
            finish()
            if let id { emit(id, .success, "隧道已连接", "请用浏览器验证实际站点访问。") }
        } else if value == .disconnected || value == .invalid {
            if phase == .disconnecting {
                let id = operationID; let cancelled = cancellationRequested
                finish()
                if let id { emit(id, cancelled ? .info : .success, "已断开连接") }
            } else if phase == .connecting || previous.connected || previous == .connecting {
                let id = operationID ?? UUID()
                finish()
                emit(id, .error, "隧道已停止", "请检查配置和网络，诊断页可查看运行记录。")
            }
        }
    }
    private func arm(_ id: UUID, delay: Duration) {
        timer?.cancel()
        timer = Task { [weak self] in
            do { try await Task.sleep(for: delay) } catch { return }
            self?.expired(id)
        }
    }
    private func expired(_ id: UUID) {
        guard operationID == id else { return }
        status = controller.status
        if status.connected, phase != .disconnecting { receive(status); return }
        let wasStopping = phase == .disconnecting
        finish()
        // Keep actual state; stopping is a request, never proof of disconnection.
        expectedDisconnect = true
        if !wasStopping { controller.stop(); status = controller.status }
        if status == .disconnected || status == .invalid { expectedDisconnect = false }
        emit(id, .error, wasStopping ? "尚未确认断开" : "连接超时", "请检查系统 VPN 状态；可再次断开或前往系统设置处理。")
    }
    private func finish() {
        timer?.cancel(); timer = nil
        operationID = nil; cancellationRequested = false; phase = .idle
    }
    private func emit(_ id: UUID, _ kind: TunnelFeedback.Kind, _ title: String, _ message: String = "") {
        onFeedback?(TunnelFeedback(id: id, kind: kind, title: title, message: message))
    }
}
