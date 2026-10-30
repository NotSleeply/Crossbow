# B1 主色 B · 正式资产落地 V2

- 日期：2026-10-30；状态：用户已确认 B，已实现，待 PR #204 评审；Issue #202。
- 实现提交：213e9a5a0dcdf9fcf01cd5989650fc85ed5df1b5。
- 采用主色 #3F52CF，保留原 B1 几何与笔画，不改变图标底色。
- V1 对比稿与历史提案保留，不覆盖；V1 生成器需在其记录的原基线运行。

## 实现范围

1. design/logo/current/mark.svg 为唯一品牌色母版；生成器从母版读取颜色，明暗 Logo 都用同一个 B 色。
2. 重新生成桌面 PNG、macOS ICNS、Windows ICO、官网 Logo / AppIcon / SVG 与位图 favicon、iOS 不透明 AppIcon 与 1x/2x/3x 明暗 imageset。
3. 桌面导航使用 CSS alpha mask，新增独立 --cb-brand，避免深色 Logo 被主题强调色改成淡紫；页面其他配色不变。
4. macOS 纯黑/纯白 template 托盘与几何轮廓保持逐字节一致；Windows 彩色托盘使用重新导出的 32px 应用图标。
5. 验证脚本将原来的母版逐字比较改为“几何逐字相等 + 已确认 B 色 + 实际 PNG 像素”，继续检查 ICO 多尺寸、ICNS、透明模板、iOS 不透明性及 manifest 全文件哈希。

## 验证

- 品牌校验通过：68 项资产；原版 B1 几何、真实颜色、主题一致、ICO/ICNS 及 iOS catalog 有效。
- PNG / SVG / ICO 重复生成一致；Tauri 生成的 ICNS 可能改变容器条目顺序，已确认各尺寸图像块哈希相同。21 项黑白与 template 资产和改动前逐字节一致。
- 桌面与官网 npm run build 均通过。
- 预览直接读取正式 PNG 和桌面 CSS；浅/深色实际计算颜色均为 rgb(63, 82, 207)，图像载入成功，无横向溢出。记录见 previews/checks.json。
- 本轮验证生成资产与浏览器呈现，没有安装新包、做 iOS 真机启动或更改已发布版本。

## 留存与运行

index.html / main.js / style.css / vite.config.mts 为正式资产展示入口；直接引用项目文件。source.zip 冻结此次相关源文件与资产；manifest 记录清单、哈希和验证结果。

运行：
    node apps/desktop/node_modules/vite/bin/vite.js --config docs/designs/2026-10-29-logo-color/v02/vite.config.mts

本地预览 http://127.0.0.1:5203/ 。正式资产重新生成与检查：
    node scripts/generate-brand-icons.cjs
    node scripts/verify-brand-icons.cjs

依赖 sharp 与桌面 Tauri CLI；可通过 CROSSBOW_SHARP_MODULE 指定已安装的 sharp 路径，不需要修改项目依赖。
