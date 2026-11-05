# Crossbow B1 配色研究 v01

2026-11-05 · Issue #297 · 状态：提案，待用户选色；未改动任何生产品牌资源。

## 设计判断

当前 Logo 的 #3F52CF 饱和度高，而界面主按钮为 #293345、文字为 #242B37，整体是灰蓝/中性色体系。新提案把标志色向灰蓝收拢，保留一点蓝色识别，不直接使用深主按钮色（在深色标题栏会过暗）。

本轮只改变根 SVG 的 color 属性。B1 弧路与箭头的 path、11px 线宽、比例、圆角、Dock 9px/82% 安全区均逐字符保留。明暗模式同色；不增加渐变、光效或颜色自动切换。

| 方案 | 色值 | 取向 |
| --- | --- | --- |
| A 岩蓝（推荐） | #5C6F8B | 蓝灰平衡，衔接灰蓝主操作色；保留品牌识别 |
| B 静靛 | #5E6BA4 | 留下更多原有靛蓝气质，变化较温和 |
| C 钢蓝 | #5B778B | 偏冷的钢蓝灰，深背景识别更明显 |
| D 石墨 | #6A7280 | 中性灰阶，最安静，品牌色存在感较低 |
| E 雾靛 | #6974A3 | 更柔和明亮的灰靛，深色环境更轻盈 |
| F 青岩 | #5C7C7A | 低饱和蓝绿灰，引入新的识别方向 |

A 对白底的计算对比度为 5.12:1，对应用深色内容底 #1A1C21 为 3.33:1；当前靛蓝分别为 6.33:1、2.69:1。这些数值是色彩比较依据，不作为整套界面无障碍达标结论。完整计算见 contrast.json。

## 文件与预览

- palette.json：六个提案与现用色的名称、理由和色值。
- assets/：每色的可编辑 mark/app/dock SVG，256px 透明标志与128px Dock PNG（sRGB ICC）。这是选色预览资产，不是正式全尺寸发布包。
- comparison.svg / previews/comparison.png：六色、明暗背景、Dock 容器与当前 UI 色板对比。
- recommended.svg / previews/recommended.png：现用配色与 A 的细节对比。
- index.html：离线资源的交互选色页；app.html + app-preview.tsx 直接渲染生产 App。Vite 预览插件只在内存中替换 Logo 导入，不修改 App.tsx 或生产 PNG。
- mock-tauri.ts：只用于原型的模拟 IPC，不启动代理、不读真实配置。
- source.zip：源稿与生成代码快照；manifest.json 记录文件 SHA256。

```sh
apps/desktop/node_modules/.bin/vite --config docs/designs/2026-11-05-logo-palette/v01/vite.config.mts
```

打开 `http://127.0.0.1:5216/#A`。可选 A–F、切回现用色，在浅色/深色生产组件中比较；可原尺寸单独打开应用或下载 SVG。

重新生成矢量与 PNG：`CROSSBOW_SHARP_MODULE=/path/to/sharp node docs/designs/2026-11-05-logo-palette/v01/generate.cjs`。依赖 Sharp；路径可指向已有安装，不需要修改项目依赖。

## 验证与边界

已实际渲染并查看六色对比与推荐方案 PNG。检查确认：七个（含现用）标志和 Dock 的几何与当前源稿完全一致；透明 PNG 存在预期颜色像素，带 sRGB ICC；可携带的原型构建包含 SVG/PNG、palette/contrast JSON。Vite 双入口构建通过。

生产组件的浏览器交互验收尚未执行；此前浏览器工具明确被 Work settings 禁用。这里的 PNG 是真实 SVG 设计稿导出，不是原生 App 或实际 Dock 的运行截图；不以它们冒充原生验证。

用户选定颜色后，再更新正式品牌源、完整平台图标、manifest 与所有应用/官网资源，并走独立实现 PR。当前规范的正式颜色仍为 #3F52CF。
