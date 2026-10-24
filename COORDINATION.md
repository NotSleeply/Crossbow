# Agent 协作状态（每会话开工前必读，认领后必更）

> 更新：2026-10-23 13:0x

## Worktree 布局

| 路径 | 会话 | 分支 |
|---|---|---|
| /Users/ayu/Desktop/Crossbow | zcode | main |
| /Users/ayu/Crossbow-codex | codex | codex/fix-tun-sysproxy-conflict |

## 当前认领

- **codex**: #33 sysproxy 状态同步 + #41 PR（sysproxy 启动死锁修复，待合并）；
  #46 TUN 系统代理与端口交接修复（`codex/fix-tun-sysproxy-conflict`）；
  另有 `chore/release-signing` 分支（发版签名脚本，未并入 main）
- **zcode**: 无（待命）；PR #42（标识符切换 com.richard.crossbow + 数据迁移）待合并

## 最近完成

- 2026-10-24: codex #49 TUN 就绪与系统代理恢复已推送至 PR #48（`codex/fix-tun-sysproxy-conflict`），待审。
- 2026-10-24: #45 TUN 断网离线恢复命令与使用说明（`scripts/recover-tun-network.command`、`docs/TUN-RECOVERY.md`，已提交）
- 2026-10-23: PR #42 标识符切换（待合并）；v0.9.1 发布；#20/#22/#24/#36/#37 修复合并（#37-#40）
- 2026-10-22: #28 更新提示+自动下载、#29 日志本地保存、#30/#31 端口清理与状态行（PR #34/#35）

## 暂存提示

（无）
