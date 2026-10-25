# codex 协作流水（append-only）

> 规则：**只追加，不修改、不删除既有行**。最新状态看文件末尾；
> 「当前认领」= 最近的 `[认领]` 行（完成后追加对应 `[完成]` 行，不改原行）。
> 本文件**仅 codex 会话写入**；直推 main（仅 docs，代码绝不直推 main），绝不随 PR 分支提交。
> （2026-10-25 由 zcode 从 COORDINATION.md 按作者原样一次性迁入，此后由 codex 自行追加）
> zcode 流水：`coordination/zcode.md`；全局视野：`cat coordination/*.md`。

- 2026-10-24 [完成] codex #49 TUN 就绪与系统代理恢复（PR #48，`codex/fix-tun-sysproxy-conflict`）
- 2026-10-24 [完成] codex #52 官网与 README 同步（PR #53，`codex/docs-site-readme-v092`）；PR #53 已合并且 Netlify 预览成功；PR #55 已变基到 main，并补充 TUN LAN 网关保留与 macOS 分片默认路由识别（Refs #21 #23）
- 2026-10-24 [完成] codex #50 手动检查更新进度、结果与超时反馈（PR #51，`codex/fix-update-check-feedback`）
- 2026-10-24 [完成] codex #54 托盘 0ms 失败显示、TUN 与系统代理独立开关、子菜单对勾统一（PR #55，`codex/tray-tun-proxy-controls`）
- 2026-10-25 [完成] codex #66 全局通知服务、页面/托盘/后台提示迁移、独立浮层、脱敏与开发约定（PR #71，`codex/unified-notifications`；本地构建及 5 项专项回归通过，原生交互待验收）
- 2026-10-25 [完成] codex #66 PR #71 已同步 main 并保留日志连接状态、sing-box 日志聚合与统一通知；前端构建及通知专项回归通过，macOS CI 通过，PR #71 已合并。
- 2026-10-25 [完成] codex #72 PR #73 发布加固；补齐 Windows UTF-8 读取与 macOS 实机测试平台限制，19 项脚本回归通过；共享后端夹具已按 Windows 文件名/压缩格式和 Unix 进程能力修复，双平台 CI 复验中。
- 2026-10-25 [完成] codex #74 修复空配置首次启动 app.pid 父目录未创建引发的 SIGABRT，并保持旧目录迁移优先；已同步两个分支；#71 已先合并，首启修复由 #73 进入 main，以实际安装包启动检查复验。
- 2026-10-25 [完成] codex #76 v0.9.4 已发布并完成核验：正式 release 工作流通过，DMG/更新归档/签名/清单/校验和均已发布，latest.json 版本、URL 与 SHA-256 核验通过。
- 2026-10-25 [完成] codex #66 PR #85 已合入最新 main；退场 Provider/CSS 完全沿用 PR 原位淡出实现，前端构建与后端 53 项回归通过（1 项实机代理测试忽略），待 CI。
- 2026-10-25 [认领] #89 发布 v0.9.5（`codex/release-v0.9.5`；应用版本文件、release 流程与发布产物验证；Windows 功能适配暂缓）

- 2026-10-25 [完成] #89 v0.9.5 经用户批准、PR #90 CI 通过后合并发布；签名、公证、启动检查、DMG/更新归档一致性及公开更新清单/签名/校验和核验通过。
- 2026-10-25 [完成] #92 PR #93 清理构建未使用接口并优化首页更新条；前端构建、后端 53 项测试、cargo check 及深浅主题/中英文/窄宽度检查通过（1 项实机测试忽略）。
- 2026-10-25 [认领] #92 解决 PR #93 与 main 的协作记录迁移冲突（`codex/home-update-polish`；COORDINATION.md 按 main 稳定层还原，应用代码保持 PR 实现）。
- 2026-10-25 [完成] #92 PR #93 已合入 main 协作记录迁移并解决冲突（`codex/home-update-polish`，ec74bee）；PR 差异仅应用代码，协作文件已与 main 一致，应用代码与此前通过构建及回归的版本完全一致。
- 2026-10-25 [认领] #94 排除 Crossbow 自身 TUN 的共存误报（`codex/fix-own-tun-detection`；coexist.rs、mihomo_api.rs、lib.rs 及回归测试；只读核验实机网络，不切换用户代理）。
