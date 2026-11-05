# 主按钮同色 Logo 预览 v01

2026-11-05 · Issue #301 · 状态：提案，未改动正式品牌资源。

## 颜色与判断

截图箭头指向主要操作按钮。生产代码浅色主按钮为 `--cb-primary: #293345`，深色主按钮为 `#E7EAF2`。

- 固定同色：应用内 Logo 在浅/深主题均 #293345，遵循此前“明暗保持同色”的方向；浅色更统一，但深色对比度低。
- 随按钮主题：浅色 #293345、深色 #E7EAF2。建议作为可读性更好的备选，此轮仅展示，并未擅自更改正式颜色策略。
- Dock：继续浅色底板 #F7F8FB，标志 #293345，明暗系统环境使用同一个图标。保留 B1 几何、现有 9px / 82% 安全区。

颜色计算：#293345 对白底 12.70:1，对深色标题栏 #121317 为 1.46:1；#E7EAF2 对该深色底为 15.42:1。此处用于解释视觉差异，不是整套产品无障碍合规结论。

## 原型与源文件

- comparison.svg / previews/comparison.png：现用岩蓝、浅色按钮同色、深色固定/反色、两种 Dock 环境的设计对比。
- assets/：可编辑 SVG、sRGB PNG 和本次独立 Dock 预览的多尺寸 ICNS。
- index.html / app-preview.tsx：直接引用生产 App 的互动对比；只覆盖预览进程中的 `--cb-brand`，正确处理实际 Logo 的 CSS 遮罩着色。未替换正式图片或写配置。
- mock-tauri.ts：脱敏模拟 IPC，应用预览不会启动真实代理。
- dock-preview.swift / build-native.sh：独立 AppKit 程序，不导入 Crossbow，不读写其配置；编译到系统临时目录，不安装到 Applications。
- native-probe.swift：原生 ICNS 解码→NSApplication.applicationIconImage→sRGB 离屏绘制的颜色/尺寸校验。
- generate.cjs：从正式 B1 源稿仅改 color 属性，使用 Sharp、Tauri 和既有容器 ICC 辅助函数导出。

运行网页：

```sh
apps/desktop/node_modules/.bin/vite --config docs/designs/2026-11-05-button-logo/v01/vite.config.mts
```

`http://127.0.0.1:5218/#fixed` 查看固定色，`#adaptive` 切换随主题的策略。网页支持原尺寸打开生产组件视图。底部 Dock 条是设计模拟，不冒充用户实际 Dock 截图。

运行原生 Dock 程序：

```sh
bash docs/designs/2026-11-05-button-logo/v01/build-native.sh
# 脚本输出独立 .app 路径，使用 open 打开。关闭窗口或 Cmd+Q 即退出。
```

原生程序的 Dock 图标从带 sRGB ICC 的 ICNS 通过 NSImage(data:) 载入，与正式 macOS 加载路径一致；不会操作当前 Crossbow 应用。

## 实际验证

- 已渲染并实际查看 comparison.png，主题与 Dock 示意均使用预期颜色。
- B1 源 SVG 与 Dock SVG 仅颜色不同，几何逐字符一致。
- 原生 AppKit 校验 64/96/128px 通过：存在精确的 #293345 实色像素，图标安全区和居中断言通过，输出保留在 previews/native-checks.txt。
- 独立 AppKit 程序已编译、临时 ad-hoc 签名并实际启动；进程存在。用户可直接查看系统 Dock 中的测试图标。本记录不代表用户已经确认视觉效果。
- 生产组件网页双入口构建通过。

没有捕获用户完整桌面或真实 Dock 截图；原生校验为自己的图标/绘制数据，不包含私人内容。浏览器交互和生产 App 原生运行未在此轮验收。用户未选定此轮策略，正式品牌仍为 #5C6F8B。提交提案 PR 后不持续盯 CI。
