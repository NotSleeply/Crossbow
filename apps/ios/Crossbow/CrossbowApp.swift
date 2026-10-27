import SwiftUI
import UniformTypeIdentifiers

@main
struct CrossbowApp: App {
    @StateObject private var tunnel = TunnelManager()
    var body: some Scene {
        WindowGroup {
            RootView(tunnel: tunnel)
                .tint(Studio.accent)
                .overlay(alignment: .top) { NotificationOverlay(notices: tunnel.notices) }
        }
    }
}

struct RootView: View {
    @ObservedObject var tunnel: TunnelManager
    @Environment(\.scenePhase) private var scenePhase
    @State private var importing = false
    @State private var tab = 0
    var body: some View {
        TabView(selection: $tab) {
            NavigationStack {
                ConnectionView(tunnel: tunnel, showConfiguration: { tab = 1 }, showDiagnostics: { tab = 2 })
            }.tabItem { Label("连接", systemImage: "house") }.tag(0)
            NavigationStack {
                ConfigurationView(tunnel: tunnel, importFile: { importing = true })
            }.tabItem { Label("配置", systemImage: "doc") }.tag(1)
            NavigationStack { TunnelDiagnosticsView(tunnel: tunnel) }
                .tabItem { Label("诊断", systemImage: "waveform.path.ecg") }.tag(2)
        }
        .toolbarBackground(Studio.chrome, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
            do {
                guard let url = try result.get().first else { return }
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 1_048_576 else { throw ConfigurationError(message: "配置超过 1 MB。") }
                tunnel.importConfiguration(data: try Data(contentsOf: url), name: url.deletingPathExtension().lastPathComponent)
            } catch {
                tunnel.notices.publish(UUID(), kind: .error, title: "无法读取配置文件", description: "请确认选择了不超过 1 MB 的本地 JSON 文件。")
            }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await tunnel.reload() } } }
    }
}
