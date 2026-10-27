# Crossbow iOS · M0/M1

当前已实现 SwiftUI 最小验证 App、PacketTunnel/libbox 桥接、配置快照、系统 VPN 状态和顶部统一通知。主 App 与扩展已完成签名和 iPhone 真机安装。2026-10-27，用户确认直连配置的连接、断开、重连与锁屏访问正常；使用 Mac 已有 Hy2 节点生成的私有测试配置后，Safari 可访问 GitHub、YouTube 和 X，锁屏及 Wi-Fi/蜂窝切换后也正常。资源基线和异常恢复仍在 #132 验收，编译或出现 VPN 图标不代替实际联网验证。

完整设计见 [iOS MVP](../../docs/IOS-MVP.md)，分阶段门槛见 [开发路线](../../docs/IOS-ROADMAP.md)。当前包支持导入本地 sing-box JSON；Clash 订阅转换、完整四 Tab、节点选择和测速按后续 M2/M3 实现。

## 固定依赖与工程

- iOS 17 起，SwiftUI + `NETunnelProviderManager` / `NEPacketTunnelProvider`。
- sing-box/libbox **v1.14.4**，SagerNet gomobile/gobind **v0.1.12**；依赖版本和摘要记录在 `TunnelCore/go.mod` / `go.sum`。
- `TunnelCore` 提供小型 Go 适配层，直接绑定已锁定的 libbox API；扩展不链接桌面 Tauri 或完整 Rust/JS 运行时，不创建内核子进程。
- `scripts/ios/build-core.sh` 从固定依赖构建 XCFramework，包含设备与模拟器切片；Framework、派生工程、签名资料不提交。构建需要完整 Xcode、XcodeGen、满足 go.mod 的 Go 工具链。
- App Group 的 `Library/Application Support/Crossbow/Tunnel` 中仅保存受保护、排除备份的配置快照和有限脱敏状态；旧根目录快照校验后迁移，不覆盖新配置；主 App 写配置、扩展管理隧道。连接只以系统状态确认；取消授权等待时不会并发创建第二个 VPN 配置。

## 开发者后台配置

在与 Xcode 一致的付费团队内登记：

| 类型 | 标识 |
|---|---|
| 主 App ID | `com.richard.crossbow.ios` |
| 扩展 App ID | `com.richard.crossbow.ios.PacketTunnel` |
| App Group | `group.com.richard.crossbow.ios` |

1. [Identifiers](https://developer.apple.com/account/resources/identifiers/list) → `+` → **App Groups** → 填写上面的组标识并 Register。
2. 分别编辑两个 App ID，为 **App Groups** 勾选同一个组并保存。两个 target 也需要 Network Extensions 的 Packet Tunnel 权限。
3. 在 Xcode 登录账号；手机信任 Mac 并开启开发者模式。用 `-allowProvisioningUpdates` 生成描述文件，实际检查两个签名与 profile 都包含该 App Group。

只启用 App Groups 复选框、但没有绑定具体组时，自动生成的 profile 可能仍为空列表，真机构建会报 entitlement mismatch。账号密码、私钥和 p12 不进入仓库或聊天。

## 可重复构建

在仓库根目录：

```bash
# 首次/更新固定核心后生成 Framework；耗时与本机缓存有关
scripts/ios/build-core.sh

# Swift 配置与连接生命周期回归
swift test --package-path apps/ios

# 无签名设备 / 模拟器构建
scripts/ios/build-app.sh --unsigned
scripts/ios/build-app.sh --simulator

# 真机签名；通过 xcrun devicectl list devices 查设备标识
CROSSBOW_TEAM_ID=YOUR_TEAM_ID CROSSBOW_DEVICE_ID=YOUR_DEVICE_UDID \
  scripts/ios/build-app.sh --device
```

`check-bundle.py --signed` 验证主 App / 扩展 ID、嵌入关系、App Group、Packet Tunnel 权限、签名及 profile 有效期；不输出配置凭据。构建脚本不自动安装、不启动 VPN。

## 首轮真机验收

1. 安装并打开开发包；在「配置」选择 **直连验证配置**，首页点连接，按系统提示授权 VPN。
2. 确认首页由连接中变为已连接，Safari 正常访问原本可达的站点。**直连验证不提供代理访问能力**。
3. 断开后确认状态和普通联网恢复；再测试快速连接/取消、系统设置中手动断开、退出前台再打开的真实状态。
4. 导入自己已确认可用的 **sing-box v1.14.4 JSON**，验证实际代理站点。JSON 需有 DNS/outbounds；本包拒绝进程规则、额外监听和未支持字段。原始配置不发送到日志/通知。
5. 测试锁屏、Wi-Fi/蜂窝切换、IPv6/NAT64 和资源占用；失败时反馈诊断页固定状态码，不提交服务器密码或订阅 token。

真机开发签名不等于 TestFlight 或 VPN 公开分发已获批准；分发资格和资料在 M5 单独处理。
