# Agent 协作状态（稳定层）

> 认领/完成流水已拆分到 `coordination/<会话名>.md`（**append-only：只追加，不修改删除**）。
> 开工先看全局视野：`cat coordination/*.md`。协作规范见 AGENTS.md。
> 本文件只保留不常变的全局信息，低频改动（需用户确认），**不随 PR 分支提交**。

## Worktree 布局

| 路径 | 会话 |
|---|---|
| /Users/ayu/Desktop/Crossbow | zcode |
| /Users/ayu/Crossbow-codex | codex |

各会话当前所在分支以其流水文件的最新 `[认领]` 行为准。

## 冲突规避机制（2026-10-25 起）

- 每个会话只写 `coordination/` 下**自己的**文件，且 append-only —— 不同文件在 git 合并时永不冲突。
- `coordination/` 文件直推 main（先 `git pull --rebase origin main` 再推）；**代码一律走 PR**。
- PR 分支不得携带 `COORDINATION.md` / `coordination/` 改动（误提交须在合并前还原为 main 内容）。
