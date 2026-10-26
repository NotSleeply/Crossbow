# 统一通知（Issue #66）

所有用户可见的操作结果、错误和后台提示，使用同一套 Notification 卡片。
主窗口内顶部居中展示；主窗口隐藏、最小化或被轻量模式销毁时，使用独立的无标题浮层。
通知数据由 Rust 保存，页面切换或 WebView 重建不会清空队列。

## 设计与生命周期

- 成功 3 秒、信息 5 秒、普通警告 8 秒自动关闭；错误和进度不自动关闭。
- 需要处理的警告使用 `duration: 0`，保留至关闭。
- 最多显示 3 张，错误优先，其次警告、进度、普通结果。排队中的通知不消耗时长。
- 悬停、键盘焦点、展开详情时暂停倒计时。切换通知承载窗口不重置剩余时间。
- 相同 operationId 或 dedupeKey 更新同一卡片；重复内容合并次数。
- 关闭进度卡只是隐藏展示，不取消任务。后续成功不重新弹出，失败会重新显示。
- 被关闭的相同后台故障不反复弹出；新的用户操作可重新显示其进度。
- 会话内保留最近 50 条记录；未处理错误优先保留。待处理队列最多 30 条。
- “最近通知”位于主窗口左下方。历史只存在进程内，不写入配置或磁盘。
- 浅色/深色使用现有 cb 主题变量；支持键盘、读屏和减少动态效果。
- 前端任务进度统一使用 `components/ProgressRing.tsx`，配合百分比或阶段说明；禁止新增原生 `<progress>` 长条。更新下载、测速、内核下载等进度均由同一个通知组件渲染。

## 前端用法

```tsx
import { notify } from "../notifications/service";

const result = await notify.run(
  "setting-flags",
  t("settings.flags"),
  () => ipc.setFlagEmoji(next),
);
if (result.ok) setFlags(next);
```

`notify.run` 返回 `{ ok: true, value }` 或 `{ ok: false }`，会发出进度和最终结果。
失败已经展示，调用方不得继续提示成功或提交乐观状态。需要时重新读取后端真实状态。
独立操作使用不同的标识，例如 `override-save-${id}` 与 `override-rename-${id}`。

```tsx
notify.start("latency-group-a", t("proxies.testing"));
notify.publish({
  kind: "progress",
  operationId: "latency-group-a",
  source: "latency-group-a",
  title: t("proxies.testing"),
  progress: 60,
});
notify.success(t("proxies.testAll"), "latency-group-a");
// 或 notify.error(error, "latency-group-a");
```

`notify.publish` 可指定 description、details、duration、dedupeKey 和 actions。
动作只有明确实现的白名单：settings、profiles、diagnostics、logs、retryDownload。
下载失败提供安全的“重新下载”，其他失败可前往设置或诊断；不要为不可重入的操作添加重试。

页面不要再自行保存 toast/flash/ErrorBar。表单可以保留字段定位和校验关联；
诊断结果表格、实时流量、版本资料、节点状态仍然是页面内容，不应变成大量通知。
页面卸载时的退订、可选数据的缺省值可以静默处理；用户操作和真正的后台故障不可空 catch。

## Rust 与窗口行为

`src-tauri/src/notifications.rs` 提供会话级队列、脱敏和结构化 `app://notifications` 快照。
`Notice::new` 使用稳定 code，展示时由前端按当前语言解释。技术原因放 details，标题保持简短。

```rust
let mut notice = notifications::Notice::new(
    notifications::Kind::Warning, "tun.disabled", "tun-health",
);
notice.duration = Some(0);
notice.actions = vec![notifications::Action::Diagnostics];
notifications::publish(&app, notice);
```

系统代理/TUN 切换、后台更新下载、内核下载的结果由 Rust 直接报告；调用页面关闭后也能完成通知。
后端拥有通知的操作，前端不要再包一层会重复报结果的通知任务。

主窗口准备好并可见时才向它投递；否则惰性创建 `notifications` WebView，接收方先监听再读取快照。
仅使用同源本地页面。一次只激活一个通知承载位置，关闭主窗口不关闭通知服务。
macOS 使用 `NSWindow.orderFrontRegardless`，Windows 使用 `SW_SHOWNOACTIVATE`；
不能用会激活窗口的普通 show() 来显示后台通知。动作按钮由用户主动点击后才打开主窗口。
窗口关闭/重建时移除 ready 标记，暂停队列倒计时，直到新接收方就绪。

管理员授权、文件选择、破坏性操作确认仍使用系统交互。
UI 尚未初始化的致命启动错误保留原生兜底；操作系统崩溃报告需要另外排查崩溃原因。

## 安全与性能

- 所有标题、正文和详情在进入 Rust 队列时脱敏；历史和复制使用同一份数据。
- URL 只保留 origin，避免订阅 URL 路径或查询参数泄漏密钥；隐藏 Bearer、secret、token、password 等值。
- 文本限长，队列和历史有上限。不要把完整配置或原始凭据作为通知标识。
- 下载通知进度限频；快照使用 revision 发送，空闲轮询不会持续发送整份历史。
- WebView 创建从后台线程发起，避免 WebView2 主线程死锁；AppKit 原生显示调用只在主线程执行。调用窗口 API 前释放队列锁。

## 验收路径

1. 在设置中输入无效端口，确认顶部错误卡片出现、页面不变高；展开详情、复制、关闭。
2. 保存普通设置，确认成功卡片约 3 秒关闭；悬停或把焦点移到通知按钮，确认计时暂停。
3. 测试代理组，确认同一通知从进度变成结果；节点失败时显示警告而不是全部成功。
4. 连续触发多个独立错误，确认不互相覆盖；重复触发同一错误，确认合并计数。
5. 下载更新，确认进度更新；模拟下载失败，确认可重新下载，失败通知不会被成功替换。
6. 展开“最近通知”，确认可查看已关闭通知与脱敏详情；切换页面后历史仍在。
7. 隐藏或最小化主窗口，从托盘触发操作，确认屏幕顶部浮层不抢焦点、不关闭托盘菜单。
8. 开启轻量模式并关闭窗口，触发托盘错误，再点“打开诊断”，确认重建主窗口并跳转。
9. 切换深浅主题及语言，检查通知、历史、按钮；检查窄窗口、长错误、键盘和减少动画设置。

静态/单元检查：前端 `npm run build`；Rust `cargo check`；
`cargo test --lib --manifest-path apps/desktop/src-tauri/Cargo.toml notifications::`。
Windows 编译和构建依照仓库规范使用 GitHub Actions。
