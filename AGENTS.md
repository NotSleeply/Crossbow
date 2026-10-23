# Crossbow 多 Agent 协作规范

本仓库由多个 AI 会话（ZCode / Codex）共享。**每个会话在自己的 git worktree 中工作**，
禁止在他人 worktree 或分支上操作。开工前必读本文件与 `COORDINATION.md`。

## 铁律

1. **开工**：`git rev-parse --abbrev-ref HEAD` 确认自己 worktree 的分支；
   读 `COORDINATION.md` 了解当前认领与最近完成。
2. **认领**：开始一项工作前，在 `COORDINATION.md`「当前认领」区写明
   （会话名 / issue / 分支 / 主要涉及文件）。改完立即提交该文件。
3. **提交**：禁止 `git add -A`；逐文件 `git add <path>`；commit message
   用约定式格式并关联 issue（`Closes #NN` / `Refs #NN`）。
4. **禁止**：
   - 切换他人「当前认领」中的分支；
   - force-push `main` 或他人分支；
   - 未经用户确认自行合并 PR；
   - 改写共享记忆/协作文件中他人写的条目（只追加或修正自己的）。
5. **PR**：base 一律 `main`；堆叠 PR 在父 PR 合并后立即 retarget 到 main。
6. **收工**：推送分支 → 更新 `COORDINATION.md`（认领区移到「最近完成」）。

## 构建速查

- 桌面构建：`cd apps/desktop && npm run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'`
- 后端测试：`cargo test --lib --manifest-path apps/desktop/src-tauri/Cargo.toml`
- 发版：`scripts/release-macos.sh`（签名+公证+DMG，见 docs/RELEASE.md）
- 依赖镜像已配置（rsproxy）；Windows 编译验证只走 GitHub Actions

## Issue 流程

问题/新功能先建 issue；实现的 PR 必须在标题或正文关联 issue（`Closes #NN`）。
issue 状态以 GitHub 为准，本文件不重复维护 issue 列表。
