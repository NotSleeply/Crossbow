import XCTest
@testable import CrossbowMobileShared

@MainActor
private final class ControlledVPN: TunnelControlling {
    var status: TunnelStatus = .disconnected
    var onStatus: ((TunnelStatus) -> Void)?
    var pausePreparation = false
    var preparation: CheckedContinuation<Void, Error>?
    var prepareCalls = 0
    var starts = 0
    var stops = 0
    var confirmStop = true
    func reload() async throws {}
    func prepare() async throws {
        prepareCalls += 1
        if pausePreparation { try await withCheckedThrowingContinuation { preparation = $0 } }
    }
    func start() throws { starts += 1 }
    func stop() { stops += 1; if confirmStop { send(.disconnected) } }
    func send(_ value: TunnelStatus) { status = value; onStatus?(value) }
    func finishPreparation() { preparation?.resume(); preparation = nil }
}

@MainActor
final class TunnelLifecycleTests: XCTestCase {
    func testCancellingAuthorizationWaitsAndNeverStartsOrOverlapsSave() async {
        let backend = ControlledVPN(); backend.pausePreparation = true
        let lifecycle = TunnelLifecycle(controller: backend) {}
        var feedback: [TunnelFeedback] = []; lifecycle.onFeedback = { feedback.append($0) }
        let task = Task { await lifecycle.connect() }
        for _ in 0..<100 { if backend.preparation != nil { break }; await Task.yield() }
        XCTAssertNotNil(backend.preparation)
        lifecycle.disconnect()
        XCTAssertEqual(lifecycle.phase, .cancelling)
        await lifecycle.connect()
        XCTAssertEqual(backend.prepareCalls, 1)
        backend.finishPreparation(); await task.value
        XCTAssertEqual(backend.starts, 0)
        XCTAssertFalse(lifecycle.pending)
        XCTAssertFalse(feedback.contains { $0.kind == .success })
    }
    func testAcceptedStartWaitsForSystemConfirmation() async {
        let backend = ControlledVPN()
        let lifecycle = TunnelLifecycle(controller: backend) {}
        var feedback: [TunnelFeedback] = []; lifecycle.onFeedback = { feedback.append($0) }
        await lifecycle.connect()
        let id = lifecycle.operationID
        XCTAssertNotNil(id)
        XCTAssertEqual(lifecycle.phase, .connecting)
        XCTAssertFalse(lifecycle.connected)
        XCTAssertFalse(feedback.contains { $0.kind == .success || $0.kind == .error })
        backend.send(.connecting); backend.send(.connected)
        XCTAssertTrue(lifecycle.connected)
        XCTAssertNil(lifecycle.operationID)
        XCTAssertEqual(feedback.last?.id, id)
        XCTAssertEqual(feedback.last?.kind, .success)
    }
    func testRejectedAuthorizationAfterCancellationIsNotShownAsFailure() async {
        let backend = ControlledVPN(); backend.pausePreparation = true
        let lifecycle = TunnelLifecycle(controller: backend) {}
        var feedback: [TunnelFeedback] = []; lifecycle.onFeedback = { feedback.append($0) }
        let task = Task { await lifecycle.connect() }
        for _ in 0..<100 { if backend.preparation != nil { break }; await Task.yield() }
        lifecycle.disconnect()
        backend.preparation?.resume(throwing: NSError(domain: "private-value-not-for-ui", code: 1))
        backend.preparation = nil
        await task.value
        XCTAssertEqual(backend.starts, 0)
        XCTAssertEqual(feedback.last?.kind, .info)
        XCTAssertFalse(feedback.contains { $0.message.contains("private-value") })
    }
    func testStopTimeoutKeepsActualConnectedStatus() async throws {
        let backend = ControlledVPN(); backend.confirmStop = false
        let lifecycle = TunnelLifecycle(controller: backend, stopTimeout: .milliseconds(20)) {}
        var feedback: [TunnelFeedback] = []; lifecycle.onFeedback = { feedback.append($0) }
        await lifecycle.connect(); backend.send(.connected)
        lifecycle.disconnect()
        XCTAssertEqual(lifecycle.phase, .disconnecting)
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertTrue(lifecycle.connected)
        XCTAssertEqual(feedback.last?.title, "尚未确认断开")
        XCTAssertEqual(feedback.last?.kind, .error)
        let count = feedback.count
        backend.send(.disconnected)
        XCTAssertFalse(lifecycle.connected)
        XCTAssertEqual(feedback.count, count, "A delayed requested stop is not a second failure")
    }
    func testConnectTimeoutProducesOneOperationResult() async throws {
        let backend = ControlledVPN()
        let lifecycle = TunnelLifecycle(controller: backend, connectTimeout: .milliseconds(20)) {}
        var feedback: [TunnelFeedback] = []; lifecycle.onFeedback = { feedback.append($0) }
        await lifecycle.connect(); backend.send(.connecting)
        let id = lifecycle.operationID
        try await Task.sleep(for: .milliseconds(80))
        XCTAssertEqual(backend.stops, 1)
        XCTAssertFalse(lifecycle.connected)
        XCTAssertEqual(feedback.filter { $0.kind == .error }.count, 1)
        XCTAssertEqual(feedback.last?.id, id)
        XCTAssertEqual(feedback.last?.title, "连接超时")
    }
    func testValidationFailureDoesNotRequestVPNPermission() async {
        let backend = ControlledVPN()
        let lifecycle = TunnelLifecycle(controller: backend) { throw ConfigurationError(message: "请先导入配置") }
        var feedback: [TunnelFeedback] = []; lifecycle.onFeedback = { feedback.append($0) }
        await lifecycle.connect()
        XCTAssertEqual(backend.prepareCalls, 0)
        XCTAssertEqual(feedback.last?.message, "请先导入配置")
        XCTAssertFalse(lifecycle.pending)
    }
}
