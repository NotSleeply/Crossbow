# Agent 协作状态（每会话开工前必读，认领后必更）

> 更新：2026-10-24 20:0x

## Worktree 布局

| 路径 | 会话 | 分支 |
|---|---|---|
| /Users/ayu/Desktop/Crossbow | zcode | main |
| /Users/ayu/Crossbow-codex | codex | codex/harden-release-pipeline |

## 当前认领

- **codex**: 无（#72 已推送 PR #73，待 CI 与审查；#66 通知重构另见 PR #71）
- **zcode**: 无（待命）；PR #42（标识符切换 com.richard.crossbow + 数据迁移）待合并

## 最近完成

- 2026-10-25: codex #72 发布测试门禁、版本与安装包一致性校验、隔离启动检查、公证诊断、sidecar 摘要与发布入口统一（PR #73，`codex/harden-release-pipeline`；18 项本地回归及 actionlint 通过，未触发正式发版）。

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
