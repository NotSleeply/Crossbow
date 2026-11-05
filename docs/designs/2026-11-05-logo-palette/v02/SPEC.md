# B1 / A 岩蓝正式实现 v02

2026-11-05 · Issue #297 / PR #298 · 用户已确认 A：#5C6F8B。

正式实现：`88cdf04`。此版承接 v01 提案，保留旧稿。B1 的弧路、箭头、线宽与 Dock 安全区均不变；明暗主题保持同色。

## 替换范围

- `design/logo/current/`：唯一 SVG 母版、明暗标志、应用容器、Dock 源稿、各尺寸 PNG、favicon 与完整资源 manifest。
- 桌面：应用内 `logo-glyph.png`、独立 `--cb-brand`、Tauri 多尺寸图标与 Windows ICO、macOS bundle ICNS / Dock ICNS。Linux 桌面构建使用同一组桌面品牌资源。
- 官网：品牌 PNG、应用图标、favicon SVG/ICO/16/32/192px、Apple Touch Icon。
- iOS：1024px 不透明 AppIcon、浅/深色 1×/2×/3× Logo，目录引用保持一致。
- 托盘黑/白模板文件不变；它们由系统着色，不染成品牌色。历史设计稿、旧概念资产和历史截图不覆盖，继续用于追溯。

桌面 Logo 通过 CSS 遮罩显示，所以同时修改 `--cb-brand`，仅更换 PNG 不能保证应用内颜色生效。正式主题 accent/primary 等界面色不改动。

## 生成与验证

沿用正式 `scripts/generate-brand-icons.cjs` 和 Tauri 官方 icon 生成器，输出中保留 sRGB ICC。生成脚本 manifest 关联更新到 #297，校验器以已确认 A 色为预期，并继续校验原始 B1 几何和 Dock 的 9px / 82% 安全区。

已完成：

- 70 项资源校验通过，包含原始几何、品牌色、ICC、manifest SHA256、引用、透明模板和 iOS 无 alpha。
- 位图、ICNS/ICO 的 >=64px 表征包含预期品牌墨色；更小表征可完全由抗锯齿覆盖，不强制存在全覆盖的实色像素，但仍检查容器尺寸、ICC 和哈希。
- 浅/深 iOS Logo 字节一致，黑白模板没有文件差异；当前主 SVG 与 v01 已确认 A 一致。生产 SVG 中没有残留旧品牌色。
- 桌面与官网 TypeScript/Vite 构建通过。
- `previews/production-assets.png` 已实际渲染并查看；原生 ICNS / ICO 卡片解码自生成后的正式容器，非仅展示母版 SVG。

资源预览不是已安装 App 或运行中 Dock 的截图。本轮未安装或启动新构建，未执行 Windows/iOS 原生运行或浏览器视觉验收；已有浏览器限制记录不变。保留这些验收边界，不宣称跨平台原生实际验收通过。CI 推送后不持续轮询。

## 文件

- production-assets.svg / previews/production-assets.png：正式资源集合的实际导出预览。
- render.cjs：从正式 PNG、ICNS、ICO 重新渲染预览，依赖 Sharp。
- source.zip：正式母版、完整 70 项资源、生成/校验脚本、品牌 CSS 与当前规范的快照。
- manifest.json / checks.json：代码版本、文件哈希与验证边界。

```sh
CROSSBOW_SHARP_MODULE=/path/to/sharp node scripts/generate-brand-icons.cjs
CROSSBOW_SHARP_MODULE=/path/to/sharp node scripts/verify-brand-icons.cjs
CROSSBOW_SHARP_MODULE=/path/to/sharp node docs/designs/2026-11-05-logo-palette/v02/render.cjs
```
