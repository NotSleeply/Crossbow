// swift-tools-version: 5.10
import PackageDescription
let package = Package(name: "CrossbowMobileShared", platforms: [.macOS(.v13), .iOS(.v17)], products: [.library(name: "CrossbowMobileShared", targets: ["CrossbowMobileShared"])], targets: [.target(name: "CrossbowMobileShared", path: "Shared"), .testTarget(name: "CrossbowMobileSharedTests", dependencies: ["CrossbowMobileShared"], path: "Tests")])
