# B1 主按钮配色：正式实现 v02

用户于 2026-11-05 确认按推荐的自适应方案实施。关联 #301 / PR #302，代码基线为 v0.13.3 main `dd771cbb3ac77d421516c94c03ad0f32b3552ebe`。v01 提案保持原样。

- 应用内浅色 Logo 为 #293345，深色为 #E7EAF2，与相应主题主按钮同色；保留 B1 原始弧路几何。
- 桌面使用 CSS mask 和明暗 `--cb-brand`，官网 Logo 按 `resolvedTheme` 选择明暗 PNG，iOS 明暗 imageset 交由系统选择；手动和系统外观均适用。
- 独立应用图标、Dock、favicon 和 Apple touch 固定 #F7F8FB 浅底、#293345 墨色；深底反白 SVG 仅供展示，不用于原生 AppIcon。
- 原生 Dock 保留安全区，所有 PNG 及 ICNS / ICO 内的 PNG 嵌入 sRGB ICC；托盘黑白模板不变。iOS AppIcon 保持不透明方形，由系统裁切。

## 查看及复现

`previews/production-assets.png` 是从本次正式 PNG 和解码后的原生容器合成的资源预览，不是已安装应用截图。`production-assets.svg` 为可编辑源稿，`source.zip` 保存生成器、校验器、消费代码、规范和正式资源快照。manifest 记录文件 SHA256 与生产资源指纹。

生产组件的可运行预览沿用 ../v01/index.html 的自适应入口；该预览有模拟数据，不连接真实代理，不能代替新安装版本验收。重新生成正式资源：在仓库根目录运行 `node scripts/generate-brand-icons.cjs`。重新渲染本归档：运行 `node docs/designs/2026-11-05-button-logo/v02/render.cjs`；环境提供 sharp（或 CROSSBOW_SHARP_MODULE）。

## 验证边界

结果记录在 checks.json。原生记录来自本次正式 dock-icon.icns，走 AppKit NSImage → NSApplication.applicationIconImage → sRGB 位图路径，验证 64 / 96 / 128px 实色、居中和安全区。不启动代理、不替换用户安装的 Crossbow，不读写订阅或网络设置。

浏览器运行时此前被 Work 设置禁用，本轮没有绕过限制获取新页面截图。尚未构建和安装完整原生应用，Windows / iOS 未进行设备验收；本地前端构建与原生图标读取不代表上述验收完成。不持续轮询 CI。
