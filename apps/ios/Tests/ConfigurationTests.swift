import XCTest
@testable import CrossbowMobileShared

final class ConfigurationTests: XCTestCase {
    func testNativeRuntimeAndAtomicSnapshotRoundtrip() throws {
        let snapshot = try ConfigurationSnapshot(name: "direct", data: ConfigurationSnapshot.directExample)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(snapshot.config.utf8)) as? [String: Any])
        let inbounds = try XCTUnwrap(value["inbounds"] as? [[String: Any]])
        XCTAssertEqual(inbounds.count, 1)
        XCTAssertEqual(inbounds[0]["type"] as? String, "tun")
        XCTAssertEqual(inbounds[0]["auto_route"] as? Bool, true)
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let files = try SharedFiles(root: root)
        try files.save(snapshot)
        XCTAssertEqual(try files.load().revision, snapshot.revision)
        var corrupt = try JSONSerialization.jsonObject(with: JSONEncoder().encode(snapshot)) as! [String: Any]
        corrupt["config"] = "{}"
        try JSONSerialization.data(withJSONObject: corrupt).write(to: root.appendingPathComponent("active.json"))
        XCTAssertThrowsError(try files.load())
    }
    func testLegacySnapshotMigratesWithoutReplacingCurrentConfiguration() throws {
        let container = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: container) }
        let legacy = try SharedFiles(root: container.appendingPathComponent("Tunnel"))
        let direct = try ConfigurationSnapshot(name: "old", data: ConfigurationSnapshot.directExample)
        try legacy.save(direct)
        let files = try SharedFiles.inAppGroupContainer(container)
        XCTAssertTrue(files.root.path.hasSuffix("Library/Application Support/Crossbow/Tunnel"))
        XCTAssertEqual(try files.load().revision, direct.revision)
        XCTAssertFalse(FileManager.default.fileExists(atPath: legacy.root.appendingPathComponent("active.json").path))
        let current = try ConfigurationSnapshot(name: "current", data: ConfigurationSnapshot.directExample)
        try files.save(current)
        try legacy.save(direct)
        XCTAssertEqual(try SharedFiles.inAppGroupContainer(container).load().revision, current.revision)
    }
    func testInvalidLegacySnapshotDoesNotCreateAnActiveConfiguration() throws {
        let container = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: container) }
        let legacy = try SharedFiles(root: container.appendingPathComponent("Tunnel"))
        try Data("{}".utf8).write(to: legacy.root.appendingPathComponent("active.json"))
        XCTAssertThrowsError(try SharedFiles.inAppGroupContainer(container))
        XCTAssertTrue(FileManager.default.fileExists(atPath: legacy.root.appendingPathComponent("active.json").path))
    }
    func testUnsupportedProcessRulesAndInboundAreNotSilentlyDropped() throws {
        var value = try JSONSerialization.jsonObject(with: ConfigurationSnapshot.directExample) as! [String: Any]
        value["route"] = ["rules": [["process_name": ["browser"], "outbound": "direct"]]]
        XCTAssertThrowsError(try ConfigurationSnapshot(name: "process", data: JSONSerialization.data(withJSONObject: value)))
        value["route"] = [:]
        value["inbounds"] = [["type": "mixed", "listen_port": 7898]]
        XCTAssertThrowsError(try ConfigurationSnapshot(name: "listener", data: JSONSerialization.data(withJSONObject: value)))
    }
    func testUnknownFieldsAndOversizeFailBeforeWriting() throws {
        var value = try JSONSerialization.jsonObject(with: ConfigurationSnapshot.directExample) as! [String: Any]
        value["experimental"] = ["clash_api": ["external_controller": "0.0.0.0:9090"]]
        XCTAssertThrowsError(try ConfigurationSnapshot(name: "external", data: JSONSerialization.data(withJSONObject: value)))
        XCTAssertThrowsError(try ConfigurationSnapshot(name: "huge", data: Data(repeating: 32, count: 1_048_577)))
    }
}
