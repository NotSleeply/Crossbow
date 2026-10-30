# 公共选择器与节点筛选行 v04

2026-10-31 · 已实现 · #227。基线24a060d。完成前两项独立提交后实现本项。

## 设计与实现

保留组件调用方式，统一为 apps/desktop/src/components/Select.tsx + Select.css，采用 @base-ui/react/select 1.9.0 处理焦点、键盘、Portal、边缘碰撞和长列表。官方原语文档：https://base-ui.com/react/components/select 。不增加动效框架。

全桌面7处：节点地区与排序、设置内核/主题/语言/日志保留天数、订阅自动更新间隔。现有各业务的保存、错误处理和通知保持原调用。每处均提供独立可访问名称；数字选项在组件边界转为字符串，与旧API兼容。

| Before | After | Why |
| --- | --- | --- |
| 节点页使用平台原生下拉，其他页面自绘 | 全部使用一个 Select | 字体、箭头、焦点、选中标识一致 |
| 下拉盖住触发器，系统平台表现不一 | 触发器下方6px展开，空间不足自动向上 | 保持上下文，避免被卡片裁切 |
| 手工维护坐标/焦点 | Base UI交互与定位原语 | 支持方向键、Home/End、首字母、Tab、Esc及焦点返回 |
| 无过渡或重复边框 | 150ms淡入/3px位移，单一焦点环 | 轻量且连续；键盘与减少动态效果时即时切换 |

默认触发器34px，工具栏32px；浮层圆角9px，选项高30px；一色选中态与尾部对勾。搜索最大320px不是固定宽度，空间不足自动收缩。工具栏不换行，选择值过长省略，浮层保留完整文本。

## 验证

- pnpm9 frozen-lockfile安装、桌面tsc+Vite生产构建、独立预览生产构建通过。锁文件仅增加Base UI依赖树，不更新其他包。
- 实际浏览器：1440×900、820×734英文、760×720、1120×800深色，所有工具栏同一行、无横向溢出、input无内层shadow，最大320px、窄窗分别收缩至约243px/261px。
- 地区香港2条；可用4条；延迟升序正确。点击选择与Esc返回触发器；Tab从地区移到排序；首字母s定位sing-box；Home/End支持；数字30天回显正确。
- 空列表/禁用触发器不可操作，禁用选项不能选；40项列表可滚动，尾项可选；靠底边时浮层自动向上且留在视口内；外部点击关闭。
- 生产预览使用编译后的/assets入口，未产生新控制台警告或错误。减少动态效果与强制色彩模式有CSS兜底，未修改系统设置；未做Windows原生窗口或代理联网测试。
- 新依赖带来约42KB gzip增量；仅UI选择器，不改内核和网络逻辑。

## 留存与复现

preview.tsx/preview.css/mock-tauri.ts/vite.config.mts使用正式Proxies与Select，脱敏内存IPC，不访问系统网络。运行：

`apps/desktop/node_modules/.bin/vite --config docs/designs/2026-10-30-node-toolbar/v04/vite.config.mts`

访问 http://127.0.0.1:5204/ 。?dark=1深色，?en=1英文，?view=selects展示设置/订阅类型和长列表。生产构建命令把输出写入/tmp，可用Vite preview查看。

previews保存真实截图与checks.json；source.zip冻结生产组件、样式、依赖声明及锁文件。v03保留第一项独立提交时的实现与截图。
