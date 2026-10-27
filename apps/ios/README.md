# Crossbow iOS

当前仍是 SwiftUI 主 App + PacketTunnel 扩展的占位骨架，**尚不能提供真实 VPN**。

首版方案和实现顺序见 [iOS MVP 设计](../../docs/IOS-MVP.md)，[可点击界面草图](../../docs/ios-preview.html) 使用模拟数据。用户路线已确定为：已有付费个人 Apple Developer 账号，先自用真机，再评估 TestFlight。

开发里程碑、PR 拆分与每阶段验收见 [iOS 开发路线](../../docs/IOS-ROADMAP.md)。

## 计划架构

- 主 App：SwiftUI 四 Tab（首页 / 代理 / 配置 / 设置），通过独立 UniFFI 包装复用 Rust 的配置业务逻辑。
- 隧道：`NETunnelProviderManager` 管理 `NEPacketTunnelProvider`，进程内运行固定版本 libbox；首版不把完整 Rust/JS 引擎放进扩展。
- App Group：已校验配置的原子快照、有限运行状态；Keychain 处理密钥与凭据。
- iOS 使用一个「连接」入口，不照搬桌面系统代理/内核进程开关。内核随签名 App 更新。

## 开工准备

1. 完整 Xcode；当前开发 Mac 已有 Xcode 27.0，旧说明中的「只有 CLT」已过时。
2. 已付费开发者账号在 Xcode 登录；真机信任电脑并开启开发者模式。签名与 capability 需实际验证，个人开发测试不等同于获准公开分发 VPN App。
3. 确认 App / 扩展 Bundle ID、App Group、Team ID 与所需 provisioning profile；不要沿用骨架中的未注册占位 ID。
4. 安装 XcodeGen、配置 Rust iOS targets 和 UniFFI；从固定版本来源构建/获取并校验 libbox XCFramework。不能假设任意上游 release 都有可直接使用的二进制。

`project.yml` 尚需补齐主 App 嵌入扩展、扩展入口/权限与依赖、libbox 和 Rust 链接。`xcodegen generate` 目前只能生成占位工程，不代表已经完成集成或真机验证。

真实隧道、后台锁屏和网络切换先通过真机验证；布局可先用模拟器。最低支持系统、依赖版本和签名标识在集成验证阶段锁定。
