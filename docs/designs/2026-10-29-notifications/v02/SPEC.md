# 通知中心 V2：正式实现验证

- 日期：2026-10-29；状态：已实现，待 PR 评审；Issue #196。
- 用户已确认 V1 设计并授权接入、完成后提交 PR。
- 基线 main：`a1cd0e8`；正式实现提交：`eddfc15`。
- 采用 emil-design-eng 和 design-taste-frontend 的应用界面方向，保留现有品牌与 cb 主题变量。

## 与原实现的比较

| Before | After | Why |
| --- | --- | --- |
| 大卡片套卡片，固定位置 | 铃铛下方 408px 紧凑列表，最大 590px/剩余视口 | 便于扫读，适配小窗口 |
| 主题、语言等操作统一弹成功 | 成功静默，失败保留；本地忙碌反馈 | 减少重复确认 |
| 关闭和恢复混淆 | readAt、dismissed、resolvedAt 分开 | 已读不等于解决 |
| 历史只能查看 | 待处理筛选、全部已读、清除已完成、10 秒撤销 | 让通知可管理，保护未恢复问题和进行中任务 |
| 旧详情变化造成重复弹出 | 稳定来源合并次数/最后时间，明确重试可再提醒 | 保留上下文，减少后台噪声 |

## 正式实现位置

- `apps/desktop/src/notifications/NotificationProvider.tsx`：中心、行、浮层与动画退场。
- `apps/desktop/src/notifications/service.ts`：统一发布、800ms 延迟进度、error-only 反馈、翻译键。
- `apps/desktop/src/notifications/notifications.css`：紧凑样式、主题、固定头尾/列表滚动。
- `apps/desktop/src-tauri/src/notifications.rs`：会话队列、已读、恢复、清理撤销、合并、限长/脱敏与测试。
- Settings / Home / Profiles / Diagnostics / OverridePanel：直接可感知的成功降噪，失败按原后端真实状态处理。
- scheduler / lib：订阅刷新、TUN 实际健康检查恢复后更新原问题。
- 完整规则/API 见 `docs/NOTIFICATIONS.md`。

## 实际验证

前端生产构建通过。Rust 通知队列 10 项测试通过：脱敏、时长暂停、错误优先、关闭进度不吞失败、严格容量、已读/解决分离、清除/撤销、新结果保护、重复合并和静默恢复。

浏览器验证使用正式 React 组件与样式；只把 Tauri IPC 替换成脱敏内存示例，不修改真实设置或网络。`previews/checks.json` 保存已读、清除、撤销、静默主题/语言、任务关闭、失败、恢复、筛选和 Esc 返回焦点的 DOM 检查。880×560 下列表内部滚动，390×720 长详情无横向溢出。

原生后台浮层的置前但不激活、主窗口销毁/重建、真实系统代理与 TUN 仍需安装包验收；本轮保留原生路由实现，未用浏览器模拟冒充真机验证。已有 core_manager.rs 的测试 unused import 警告未在本任务修改。

## 留存与运行

- V1 原型不覆盖；本目录记录正式组件预览。
- `source.zip` 冻结 `eddfc15` 的相关生产源文件及文档；不含依赖、真实配置或凭据。
- `main.tsx`、`mock-tauri.ts`、`vite.config.mts` 是可编辑演示入口；预览引用当前检出的生产组件。
- `previews/` 是实际浏览器截图；`manifest.json` 记录基线、源文件哈希和文件清单。

```sh
# 仓库已安装桌面依赖后
node apps/desktop/node_modules/vite/bin/vite.js --config docs/designs/2026-10-29-notifications/v02/vite.config.mts
```

默认地址 `http://127.0.0.1:5201/`；`?dark=1&en=1` 查看深色英文，`?empty=1` 查看空态。演示背景说明与示例配置名称保留中文，通知控件使用正式中英文文案。
