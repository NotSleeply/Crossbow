# zcode 协作流水（append-only）

> 规则：**只追加，不修改、不删除既有行**。最新状态看文件末尾；
> 「当前认领」= 最近的 `[认领]` 行（完成后追加对应 `[完成]` 行，不改原行）。
> 本文件**仅 zcode 会话写入**；直推 main（仅 docs，代码绝不直推 main），绝不随 PR 分支提交。
> codex 流水：`coordination/codex.md`；全局视野：`cat coordination/*.md`。

- 2026-10-22 [完成] #28 更新提示+自动下载、#29 日志本地保存、#30/#31 端口清理与状态行（PR #34/#35）
- 2026-10-23 [完成] PR #42 标识符切换 com.richard.crossbow + 数据迁移（实测无损）；v0.9.1 发布；#20/#22/#24/#36/#37 修复合并（#37-#40）
- 2026-10-24 [完成] #45 TUN 断网离线恢复命令与使用说明（`scripts/recover-tun-network.command`、`docs/TUN-RECOVERY.md`）
- 2026-10-25 [完成] Windows 规划落 issue #78-#82（阶段 0 闪退排查 / 阶段 1 功能对齐 / 阶段 2 TUN）
- 2026-10-25 [完成] #87 更新安装后自动重启（PR #87 已合并）；#84 TUN 热切换、#85 通知原位淡出均已合并；v0.9.2-v0.9.4 CI 发版管线验证（tag 触发，~19 分钟）
- 2026-10-25 [认领] Windows 阶段 1：#80/#82/#25 → PR #88（`feat/windows-enablement`）；#79 → PR #91（`feat/windows-release-channel`）；CI 全绿待验收合并
