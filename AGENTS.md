# Crossbow 多 Agent 协作规范

本仓库由多个 AI 会话（ZCode / Codex）共享。**每个会话在自己的 git worktree 中工作**，
禁止在他人 worktree 或分支上操作。开工前必读本文件与 `COORDINATION.md`。

## 铁律

1. **开工**：在自己的 worktree 运行 `git rev-parse --abbrev-ref HEAD` 确认分支，
   然后运行 `python3 scripts/coordination.py status` 查看本机所有会话当前认领。
2. **认领**：先建 issue，再在自己的工作分支运行：
   ```sh
   python3 scripts/coordination.py claim --session codex --issue 123 \
     --file apps/desktop/src --summary "说明本次工作范围"
   ```
   `--file` 可重复，路径相对仓库根目录；目录表示整个子树。会话名须唯一，
   同时运行的多个 Codex 会话应使用不同名称。文件/目录、分支或 worktree 已被认领时，
   必须先协调，不能跳过检查。实际范围扩大前，先完成旧认领并重新登记完整范围。
3. **提交**：禁止 `git add -A`；逐文件 `git add <path>`；commit message
   用约定式格式并关联 issue（`Closes #NN` / `Refs #NN`）。
4. **禁止**：
   - 直接推送 `main` / `master`，包括代码、文档、协作规则和历史记录；
   - 切换他人认领中的分支，或修改他人的 worktree；
   - force-push `main` 或他人分支；
   - 未经用户确认自行合并 PR；
   - 改写他人本地协作流水或释放他人认领；
   - 将临时认领/完成记录写入受 Git 跟踪的文件，或把它们提交进 PR。
5. **PR**：所有仓库改动一律走 PR，base 为 `main`；协作脚本和规则文档同样适用。
   堆叠 PR 在父 PR 合并后立即 retarget 到 main。
6. **收工**：推送自己的分支并创建/更新 PR 后，在原认领 worktree/分支运行：
   ```sh
   python3 scripts/coordination.py finish --session codex --pr 456 --summary "已提 PR，验证结果……"
   ```
   这只表示本次实现结束，不代表 PR 已合并。中止任务可省略 `--pr`，在说明里写明原因。

临时流水位于 `git rev-parse --git-common-dir` 指向的共享 Git 元数据目录内，
不提交、不推送。Issue / PR 是长期记录。旧 `coordination/` 流水已归档到
`docs/coordination-history/`，其中的旧规则及未结束认领均不代表当前状态。

## 构建速查

- 桌面构建：`cd apps/desktop && npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'`
- 后端测试：`cargo test --lib --manifest-path apps/desktop/src-tauri/Cargo.toml`
- 发版：`scripts/release-macos.sh`（签名+公证+DMG，见 docs/RELEASE.md）
- 依赖镜像已配置（rsproxy）；Windows 编译验证只走 GitHub Actions

## Issue 流程

问题/新功能先建 issue；实现的 PR 必须在标题或正文关联 issue（`Closes #NN`）。
issue 状态以 GitHub 为准，本文件不重复维护 issue 列表。

## 用户通知约定

- 新增报错、操作结果和提示必须使用统一 Notification，见 `docs/NOTIFICATIONS.md`。
- 前端使用 `src/notifications/service.ts`；后台/托盘使用 `notifications::publish/result`。
- 同一异步操作共用 operationId；独立操作使用不同标识。后端已发结果的操作不要在前端重复发。
- 禁止 catch 后继续更新开关或提示成功。失败后保留后端真实状态，并提供脱敏详情。
- 页面不得新增私有 toast/flash/ErrorBar 或普通提示 MessageDialog；启动前致命错误和系统授权交互保留原生兜底。
