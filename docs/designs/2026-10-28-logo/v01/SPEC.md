# Logo 初轮提案

2026-10-28。Issue #178。状态：B1「弧路」原版已确认；其余提案保留供追溯。

本轮使用 logo-generator 的多方案 SVG 流程，以及 apple-design / emil-design-eng 的克制、反馈与小尺寸原则。按当前应用配色提出三组六款：A1 弩线、A2 横弩、B1 弧路、B2 折径、C1 字印、C2 双扣。用户先倾向 B1，要求在此方向探索六个变体，最终选择原 B1。

index.html 是可交互评审稿，generate.py / variants.json / assets/*.svg 是可编辑源稿；SVG 使用 currentColor，另存黑白反色和应用图标。PNG 为原 SVG 的直接光栅化导出，不是生成式位图。previews/contact-sheet.png 供离线比较。

本地查看：本目录运行 python3 -m http.server 5194 --bind 127.0.0.1。实际背景切换和选中状态已在浏览器检查。没有将 Gemini 或其他外部图像 API 接入项目，也未索取 API key。

参考 workflow：https://github.com/op7418/logo-generator-skill/blob/main/SKILL.md 。模板的比较结构改为无 CDN、无背景光晕的本地评审稿；标志几何为本次独立绘制。当前稿不构成商标唯一性审查结论。
