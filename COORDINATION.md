# Agent 协作状态（每会话开工前必读，认领后必更）

> 更新：2026-10-24 20:0x

## Worktree 布局

| 路径 | 会话 | 分支 |
|---|---|---|
| /Users/ayu/Desktop/Crossbow | zcode | main |
| /Users/ayu/Crossbow-codex | codex | codex/harden-release-pipeline |

## 当前认领

- **codex**: #66 / #72 PR #71、#73 Windows 测试夹具修复（`codex/harden-release-pipeline`；`core_download.rs`、`core_manager.rs`，随后同步本人通知分支）
- **zcode**: 无（待命）；PR #42（标识符切换 com.richard.crossbow + 数据迁移）待合并

## 最近完成

- 2026-10-25: codex #72 PR #73 发布加固已推送；补齐 Windows UTF-8 读取与 macOS 实机测试平台限制，19 项脚本回归通过，双平台 CI 复验中。
- 2026-10-25: codex #66 PR #71 已同步 main 并保留日志连接状态、sing-box 日志聚合与统一通知；前端构建及通知专项回归通过，双平台 CI 复验中。

- 2026-10-25: codex #66 全局通知服务、页面/托盘/后台提示迁移、独立浮层、脱敏与开发约定（PR #71，`codex/unified-notifications`；本地构建及 5 项专项回归通过，原生交互待验收）。

- 2026-10-24: codex #54 托盘 0ms 失败显示、TUN 与系统代理独立开关、子菜单对勾统一（PR #55，`codex/tray-tun-proxy-controls`，待验收）
- 2026-10-24: PR #53 已合并且 Netlify 预览成功；PR #55 已变基到 main，并补充 TUN LAN 网关保留与 macOS 分片默认路由识别（Refs #21 #23）。
- 2026-10-24: codex #50 手动检查更新进度、结果与超时反馈（PR #51，`codex/fix-update-check-feedback`，待审）
- 2026-10-24: codex #52 官网与 README 同步已推送至 PR #53（`codex/docs-site-readme-v092`），待审。
- 2026-10-24: codex #49 TUN 就绪与系统代理恢复已推送至 PR #48（`codex/fix-tun-sysproxy-conflict`），待审。
- 2026-10-24: #45 TUN 断网离线恢复命令与使用说明（`scripts/recover-tun-network.command`、`docs/TUN-RECOVERY.md`，已提交）
- 2026-10-23: PR #42 标识符切换（待合并）；v0.9.1 发布；#20/#22/#24/#36/#37 修复合并（#37-#40）
- 2026-10-22: #28 更新提示+自动下载、#29 日志本地保存、#30/#31 端口清理与状态行（PR #34/#35）

## 暂存提示

（无）
