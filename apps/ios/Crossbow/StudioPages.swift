import SwiftUI
import UIKit

struct ConnectionView: View {
    @ObservedObject var tunnel: TunnelManager
    let showConfiguration: () -> Void
    let showDiagnostics: () -> Void
    private var headline: String { tunnel.pending ? (tunnel.cancelling ? "正在断开…" : "正在连接…") : tunnel.connected ? "连接已建立" : tunnel.profileName == nil ? "准备第一次连接" : "让连接就绪" }
    var body: some View {
        StudioPage {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 8) {
                    Circle().fill(tunnel.connected ? Studio.success : Studio.secondary).frame(width: 6, height: 6)
                    Text(tunnel.label).font(.subheadline).foregroundStyle(tunnel.connected ? Studio.success : Studio.secondary)
                }
                HStack(spacing: 16) {
                    Text(headline).font(.system(.largeTitle, design: .default).weight(.semibold)).tracking(-0.6).frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        if tunnel.connected || tunnel.pending { tunnel.disconnect() }
                        else { Task { await tunnel.connect() } }
                    } label: {
                        Group {
                            if tunnel.pending { ProgressView().tint(Studio.ink) }
                            else { Image(systemName: "power").font(.system(size: 28, weight: .medium)) }
                        }.frame(width: 60, height: 60)
                            .foregroundStyle(tunnel.connected ? Studio.onPrimary : Studio.ink)
                            .background(tunnel.connected ? Studio.primary : Studio.surface, in: Circle())
                            .overlay(Circle().stroke(tunnel.connected ? Studio.primary : Studio.line))
                    }.buttonStyle(.plain).disabled(tunnel.cancelling)
                        .accessibilityLabel(tunnel.pending ? "取消连接" : tunnel.connected ? "断开 VPN" : "连接 VPN")
                }
                Text(tunnel.connected ? "隧道由系统接管，离开 App 后仍会运行。" : "选择本地配置，连接后由系统 VPN 接管流量。")
                    .font(.subheadline).foregroundStyle(Studio.secondary).lineSpacing(4)
            }.padding(.vertical, 12)
            Divider().overlay(Studio.line)
            HStack(spacing: 16) {
                Image(systemName: "iphone").font(.title3)
                Text("这台设备").font(.caption).foregroundStyle(Studio.secondary)
                Rectangle().fill(Studio.line).frame(height: 1)
                Image(systemName: "globe").font(.title3)
                Text("系统隧道").font(.caption).foregroundStyle(Studio.secondary)
            }.padding(.vertical, 4).accessibilityElement(children: .combine)
            Divider().overlay(Studio.line)
            VStack(alignment: .leading, spacing: 12) {
                StudioSectionTitle(text: "当前配置")
                StudioCard {
                    Button(action: showConfiguration) {
                        StudioRow(title: tunnel.profileName ?? "选择配置", symbol: "doc", subtitle: tunnel.profileName == nil ? "从本地文件导入" : "sing-box JSON", chevron: true)
                    }.buttonStyle(.plain)
                    Divider().overlay(Studio.line)
                    StudioRow(title: "内核", value: "sing-box 1.14.4")
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("想确认连接情况？").font(.body.weight(.medium))
                Text("用浏览器访问你常用的站点，诊断页可以查看系统状态。")
                    .font(.subheadline).foregroundStyle(Studio.secondary).lineSpacing(4)
                Button(action: showDiagnostics) { Label("查看诊断", systemImage: "chevron.right").foregroundStyle(Studio.accent).font(.subheadline).frame(minHeight: 44) }
            }
        }.navigationTitle("Crossbow")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Image("logo-glyph").resizable().scaledToFit().frame(width: 28, height: 28).accessibilityHidden(true) } }
    }
}

struct ConfigurationView: View {
    @ObservedObject var tunnel: TunnelManager
    let importFile: () -> Void
    var body: some View {
        StudioPage {
            VStack(alignment: .leading, spacing: 12) {
                StudioSectionTitle(text: "当前使用")
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Text("本地配置").font(.caption).foregroundStyle(Studio.secondary)
                        Spacer()
                        if tunnel.profileName != nil { Label("已就绪", systemImage: "checkmark").font(.caption).foregroundStyle(Studio.success) }
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text(tunnel.profileName ?? "尚未导入配置").font(.title2.weight(.semibold))
                        Text("sing-box JSON").font(.subheadline).foregroundStyle(Studio.secondary)
                    }
                    Divider().overlay(Studio.line)
                    Label(tunnel.connected ? "用于当前连接" : "在本机保存", systemImage: "circle.fill")
                        .font(.caption).foregroundStyle(Studio.secondary)
                }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Studio.surface, in: RoundedRectangle(cornerRadius: 14))
            }
            VStack(alignment: .leading, spacing: 12) {
                StudioSectionTitle(text: "替换配置")
                StudioCard {
                    Button(action: importFile) { StudioRow(title: "从文件导入", symbol: "doc.badge.plus", chevron: true) }
                        .buttonStyle(.plain).disabled(tunnel.connected || tunnel.pending)
                }
                Text("sing-box JSON · 最大 1 MB\n" + (tunnel.connected || tunnel.pending ? "请先断开连接，再替换当前配置。" : "请提供完整的 DNS 与 outbounds 配置。"))
                    .font(.caption).foregroundStyle(Studio.secondary).lineSpacing(4)
            }
            Divider().overlay(Studio.line)
            DisclosureGroup("隧道基础验证") {
                VStack(alignment: .leading, spacing: 12) {
                    Text("仅验证 VPN 授权、路由和 DNS，不提供代理访问能力。")
                        .font(.caption).foregroundStyle(Studio.secondary)
                    Button("使用直连验证配置") {
                        tunnel.importConfiguration(data: ConfigurationSnapshot.directExample, name: "直连验证（不提供代理）")
                    }.font(.subheadline).frame(minHeight: 44).disabled(tunnel.connected || tunnel.pending)
                }.padding(.top, 12)
            }.font(.subheadline)
            HStack {
                Text("本地保存")
                Spacer()
                Text("不会上传配置文件")
            }.font(.caption).foregroundStyle(Studio.secondary).padding(.top, 12)
        }.navigationTitle("配置")
    }
}

struct TunnelDiagnosticsView: View {
    @ObservedObject var tunnel: TunnelManager
    @State private var licenses = false
    private var version: String {
        let number = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        return "\(number) (\(build))"
    }
    var body: some View {
        StudioPage {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: tunnel.connected ? "checkmark.circle.fill" : "info.circle")
                    .font(.title).foregroundStyle(tunnel.connected ? Studio.success : Studio.secondary)
                VStack(alignment: .leading, spacing: 8) {
                    Text(tunnel.connected ? "系统连接正常" : tunnel.label).font(.title2.weight(.semibold))
                    Text("VPN 状态由 iOS 系统报告。\n站点访问情况请以实际使用为准。")
                        .font(.subheadline).foregroundStyle(Studio.secondary).lineSpacing(4)
                }
            }.padding(.vertical, 12)
            Divider().overlay(Studio.line)
            VStack(alignment: .leading, spacing: 12) {
                StudioSectionTitle(text: "最近运行记录")
                StudioCard {
                    HStack(alignment: .top, spacing: 12) {
                        Text(tunnel.lastRecord).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Button { Task { await tunnel.reload() } } label: { Image(systemName: "arrow.clockwise").frame(width: 44, height: 44) }
                            .buttonStyle(.plain).accessibilityLabel("刷新状态")
                    }.padding(.vertical, 16)
                }
                Text("状态码不包含节点地址、密码或配置内容。")
                    .font(.caption).foregroundStyle(Studio.secondary)
            }
            VStack(alignment: .leading, spacing: 12) {
                StudioSectionTitle(text: "应用与内核")
                StudioCard {
                    StudioRow(title: "Crossbow", value: version)
                    Divider().overlay(Studio.line)
                    StudioRow(title: "sing-box", value: "1.14.4")
                    Divider().overlay(Studio.line)
                    Button { licenses = true } label: { StudioRow(title: "开源许可", chevron: true) }.buttonStyle(.plain)
                }
            }
        }.navigationTitle("诊断")
            .sheet(isPresented: $licenses) {
                NavigationStack {
                    ScrollView {
                        Text(licenseText).font(.caption).textSelection(.enabled).padding(24)
                    }.background(Studio.background).navigationTitle("开源许可")
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { licenses = false } } }
                }
            }
    }
    private var licenseText: String {
        let notices = Bundle.main.url(forResource: "THIRD-PARTY-NOTICES", withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "内嵌 sing-box/libbox 来自 SagerNet；不代表上游官方关联。"
        let coreLicense = Bundle.main.url(forResource: "sing-box-LICENSE", withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
        return "Crossbow · GPL-3.0\n\n" + notices + "\n\n" + coreLicense
    }
}
