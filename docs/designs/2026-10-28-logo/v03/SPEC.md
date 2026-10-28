# 用户确认 B1 的正式资产

2026-10-28。Issue #178。状态：已确认并实现，待 PR 合并。

采用 v01/assets/b1.svg 的原比例、原笔画，主标志母版位于 design/logo/current/mark.svg。verify-brand-icons.cjs 逐字比较两者，防止误用 V2。浅色使用 #455ab5，深色使用 #b7b4ed；托盘提供纯黑/纯白模板；应用图标浅底为 #f7f8fb。

消费点：桌面 PNG/ICNS/ICO、macOS template tray、Windows 彩色托盘、桌面主题 alpha mask、官网 Logo 与 adaptive SVG favicon、iOS 不透明 AppIcon 和明暗 imageset。iOS 删除同名松散 PNG，避免遮蔽资产目录。PNG/ICO/ICNS、favicon 和资源目录均由 scripts/generate-brand-icons.cjs 生成。

编辑与复现：正式母版、生成脚本和消费点映射见 design/logo/README.md。brand-sheet.svg 与 generate-preview.cjs 为本版可编辑展示源；previews/brand-sheet.png 直接使用实际导出文件展示应用、托盘及 favicon。历史版本保留，不覆盖。

验证：桌面与官网 tsc + Vite 构建通过；68 个资产 SHA256、关键尺寸、透明模板、ICO 多尺寸、ICNS 容器、iOS 无 alpha 和目录引用校验通过；xcrun actool 编译 iPhone/iPad 模拟器资源目录成功。未进行 Windows 原生启动、iPhone 安装或签名发版；本次未修改网络行为。SVG/PNG 已检查，图标保持静态。
