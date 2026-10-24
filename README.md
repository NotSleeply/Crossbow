# Crossbow

Crossbow 是面向 macOS 的开源代理客户端，使用 Tauri 2、React 和 Rust 构建，支持
mihomo 与 sing-box 双内核。它把订阅、节点选择、系统代理、TUN、连接与日志放在同一个界面，
并在菜单栏显示实时速率。

**当前公开版本：** [v0.9.2](https://github.com/Richard-Zhang1019/Crossbow/releases/tag/v0.9.2)，
提供 Apple Silicon 的 macOS DMG。下载及更新内容以
[GitHub Releases](https://github.com/Richard-Zhang1019/Crossbow/releases/latest) 为准；
`main` 可能包含尚未进入公开安装包的改动。Windows 正在开发与排查中，iOS 目前是工程骨架，
均未提供正式安装包。

## 安装与使用

1. 从 [最新 Release](https://github.com/Richard-Zhang1019/Crossbow/releases/latest)
   下载 Apple Silicon DMG，将 Crossbow 拖入「应用程序」并启动。
2. 导入订阅链接或配置文件，在「代理」页选择节点；可在托盘菜单直接切换节点并查看延迟。
3. 日常使用可在首页开启系统代理。若应用不读取系统代理设置，可在「设置」中开启 TUN。
   TUN 首次开启需要 macOS 管理员授权；开启时会暂停系统代理。

使用 TUN 前，请先关闭其他代理或 VPN 的 TUN 模式，避免虚拟网卡路由冲突。
测试网络配置时可先阅读 [TUN 离线恢复说明](docs/TUN-RECOVERY.md)；恢复命令需要一款仍在运行的备用代理。
近期的 TUN 就绪与代理恢复修复在 v0.9.2 发布后才合入 `main`，尚未包含在该公开 DMG 中。

配置和日志位于 `~/Library/Application Support/com.richard.crossbow/`。旧版
`com.crossbow.app` 数据会自动迁移，升级前仍建议备份数据目录。

## 开发

依赖 Node.js 20+、pnpm 和 Rust stable；macOS 本地构建还需 Xcode Command Line Tools。

```bash
pnpm install
pnpm tauri dev
pnpm --filter @crossbow/site build
```

本地打包桌面应用（不生成需要发版签名的更新器产物）：

```bash
cd apps/desktop
npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

仓库结构：

```text
crates/crossbow-core  共享的配置、覆写与存储逻辑
apps/desktop          macOS 桌面应用；Windows 桌面端仍在开发
apps/site             官网（Netlify）
apps/ios              iOS 工程骨架
docs                  设计、路线图与恢复说明
```

桌面开发时可用 `CROSSBOW_MIHOMO_BIN=/path/to/mihomo pnpm tauri dev` 指定本地内核。
详细设计、范围与计划见 [设计文档](docs/DESIGN.md)、[MVP](docs/MVP.md) 和
[路线图](docs/ROADMAP.md)；macOS 正式发版步骤见 [发版文档](docs/RELEASE.md)。

## 许可

项目声明采用 [GPL-3.0](https://www.gnu.org/licenses/gpl-3.0.html)。mihomo 与 sing-box
作为独立内核进程运行，分别遵循其自身许可。
