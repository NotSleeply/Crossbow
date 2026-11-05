# Crossbow 品牌资产

当前主标志：**B1「弧路」原版**，用户于 2026-10-28 确认。不是 V2 的 B1-01 细化版。Issue #178；最新配色按 2026-11-05 用户确认的主按钮配色方案执行，Issue #301 / PR #302。

## 当前资产

`current/mark.svg` 是唯一矢量母版，纯色、透明背景。`current/` 保存明暗、黑白、应用图标、托盘和 favicon；manifest 记录生成结果与 SHA256。

| 场景 | 正式消费点 |
| --- | --- |
| 桌面安装包 / Dock / Windows 应用 | `apps/desktop/src-tauri/icons/`：PNG、ICNS、ICO |
| macOS 托盘 | `icons/tray-icon.png`：44px 黑色透明模板，系统决定明暗 |
| Windows 托盘 | `icons/32x32.png`：深石墨标记配浅色底，在深浅任务栏都可辨认 |
| 桌面导航 | `apps/desktop/src/assets/logo-glyph.png`，CSS alpha mask 使用主题品牌色：浅 #293345、深 #E7EAF2 |
| 官网导航 / 页脚 | `apps/site/src/assets/logo-glyph.png` / `logo-glyph-dark.png`，跟随已解析的明暗主题 |
| 官网 favicon / Apple touch | `apps/site/public/`，SVG / PNG / ICO 均使用固定浅底深色图标 |
| iOS AppIcon / 页面标志 | `apps/ios/Crossbow/Resources/Assets.xcassets/`：不透明 1024 AppIcon 与明暗 logo imageset |

配色：应用内浅色 `#293345`、深色 `#E7EAF2`；独立应用图标 / Dock / favicon 固定 `#293345` 标志与 `#F7F8FB` 浅底。`app-icon-dark.svg` 是深底反白展示导出，不被原生图标消费。图形不依赖渐变。iOS 图标为完整不透明方形，由系统裁切；macOS/Windows 图标保留圆角外形。

## 重新生成

在仓库根目录运行 `node scripts/generate-brand-icons.cjs`，然后 `node scripts/verify-brand-icons.cjs`。需要工作环境提供 `sharp`，并安装桌面 Tauri CLI；可用 `CROSSBOW_SHARP_MODULE` 指定已有 sharp 模块的绝对路径。浅色 / 独立图标墨色从 `current/mark.svg` 读取，生成器使用 #E7EAF2 导出应用内深色标志；桌面主题变量与此规范一致。脚本通过 Tauri 官方工具生成 ICO/ICNS，不手写容器。生成过程只更新明确列出的品牌资源，不改动签名、凭据或网络设置。

历史渐变 v3 文件仍保留在本目录根部及旧子目录，供追溯；正式代码已改用 B1，不再从这些历史资源生成图标。V1/V2 提案和确认稿位于 `docs/designs/2026-10-28-logo/`。
