import SwiftUI
import UniformTypeIdentifiers

@main
struct CrossbowApp: App {
    @StateObject private var tunnel = TunnelManager()
    var body: some Scene {
        WindowGroup {
            RootView(tunnel: tunnel).tint(.indigo).overlay(alignment: .top) { NotificationOverlay(notices: tunnel.notices) }
        }
    }
}
struct RootView: View {
    @ObservedObject var tunnel: TunnelManager
    @Environment(\.scenePhase) private var scenePhase
    @State private var importing = false
    var body: some View {
        TabView {
            NavigationStack {
                ScrollView {
                    VStack(spacing: 24) {
                        VStack(spacing: 16) {
                            Text(tunnel.label).font(.subheadline).foregroundStyle(.secondary)
                            Button {
                                if tunnel.connected || tunnel.pending { tunnel.disconnect() }
                                else { Task { await tunnel.connect() } }
                            } label: {
                                VStack(spacing: 8) {
                                    Image(systemName: "power").font(.system(size: 38, weight: .medium))
                                    Text(tunnel.pending ? "取消" : tunnel.connected ? "断开" : "连接").font(.subheadline)
                                }.frame(width: 138, height: 138).background(.indigo.opacity(0.10), in: Circle())
                            }.buttonStyle(.plain).accessibilityLabel(tunnel.pending ? "取消连接" : tunnel.connected ? "断开 VPN" : "连接 VPN")
                        }.padding(.top, 20)
                        GroupBox {
                            LabeledContent("当前配置", value: tunnel.profileName ?? "请先导入")
                            Divider().padding(.vertical, 8)
                            LabeledContent("内核", value: "sing-box 1.14.4")
                        }
                        Text("首个真机验证包 · 先验证隧道启停和实际联网。当前不包含 Clash 订阅转换与节点测速。")
                            .font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
                    }.padding().frame(maxWidth: 640)
                }.frame(maxWidth: .infinity).navigationTitle("Crossbow")
            }.tabItem { Label("首页", systemImage: "house") }
            NavigationStack {
                List {
                    Section("配置") {
                        LabeledContent("当前", value: tunnel.profileName ?? "未导入")
                        Button("从文件导入 sing-box JSON") { importing = true }.disabled(tunnel.connected || tunnel.pending)
                        Text("请提供完整 DNS 和 outbounds。首版使用系统 TUN，不开放 HTTP/SOCKS 监听；不兼容的字段会明确提示。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Section("隧道基础验证") {
                        Button("使用直连验证配置") { tunnel.importConfiguration(data: ConfigurationSnapshot.directExample, name: "直连验证（不提供代理）") }
                            .disabled(tunnel.connected || tunnel.pending)
                        Text("仅用于验证 VPN 授权、路由和 DNS，不会让原本不可访问的网站变得可访问。")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }.navigationTitle("配置")
            }.tabItem { Label("配置", systemImage: "doc") }
            NavigationStack {
                List {
                    Section("真实状态") {
                        LabeledContent("系统 VPN", value: tunnel.label)
                        Text(tunnel.lastRecord).font(.caption.monospaced()).textSelection(.enabled)
                        Button("刷新状态") { Task { await tunnel.reload() } }
                    }
                    Section("版本") {
                        LabeledContent("Crossbow", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                        LabeledContent("sing-box", value: "1.14.4")
                    }
                    Section("开源") { Text("Crossbow · GPL-3.0。内嵌 sing-box/libbox 来自 SagerNet；许可证与固定版本记录见随包声明。对上游不作官方关联声明。") .font(.footnote) }
                }.navigationTitle("诊断")
            }.tabItem { Label("诊断", systemImage: "waveform.path.ecg") }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
            do {
                guard let url = try result.get().first else { return }
                let accessed = url.startAccessingSecurityScopedResource(); defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size <= 1_048_576 else { throw ConfigurationError(message: "配置超过 1 MB。") }
                tunnel.importConfiguration(data: try Data(contentsOf: url), name: url.deletingPathExtension().lastPathComponent)
            } catch { tunnel.notices.publish(UUID(), kind: .error, title: "无法读取配置文件", description: "请确认选择了不超过 1 MB 的本地 JSON 文件。") }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await tunnel.reload() } } }
    }
}
