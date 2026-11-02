# 官网对齐、导航与平台介绍优化

- 状态：已实现，待 PR 评审；Issue #259。
- 基线：main `d234ffb`（2026-11-02 读取）；正式实现：`apps/site/`。
- 输入：用户首屏截图，要求修正中心轴、GitHub 改图标、优化下载入口，并核对 main 中遗漏的能力。
- 使用设计技能：design-taste-frontend、landing-page-design。保留已确认的 V3 白色/靛蓝主题、功能和三步上手卡片，不增加应用截图。

## 设计与交互

三个信息节点使用同宽网格、居中图标与文字，左右连接段等宽；规则分流、主标题与下载 CTA 共用中心轴。1440px 下三者中心为 x=720px；320/390/768px 下同样精确居中。

导航保留首页/功能详解/进阶指南。GitHub 为 44px 图标触点，提供可访问名称和新窗口说明；下载为独立浅底描边动作，当前页有状态反馈。保留手机菜单、Escape 关闭和键盘焦点。

连接示意仍为单包从左到右，0.84 秒传输后等待 2.56 秒；保留暂停和系统减少动态效果设置，不暗示真实流量。

三平台下载卡片同宽，按钮基线一致。1000px 及以下纵向排列，避免标题与下载按钮被挤窄。安装包从 GitHub 最新发布动态匹配；API 离线/限流或对应资产缺失时回落官方发布页。Linux 指南使用可直达的 `#/guide#linux` 锚点。

## 内容核对与能力边界

核对 README、`docs/LINUX-NETWORK.md`、`docs/LINUX-TESTING.md`、`docs/NOTIFICATIONS.md`，以及 Linux 相关 PR #257/#258。

- 最新读取发布为 v0.12.2，含 `Crossbow_0.12.2_linux_x86_64.tar.gz`。官网不写死版本和包地址。
- Linux 为社区实验版，感谢 YangYuS8。主要验证 CachyOS + niri / Wayland；普通用户运行，应用代理手动设置，TUN 需 systemd/polkit 服务与 mihomo。
- 明确尚无 Linux 自动系统代理、AppImage/DEB 和应用内更新；完整宿主机 TUN、休眠恢复和其他桌面仍需验证。
- main 的 Linux 后台任务/深链接/原生通知进展与已发布版本分开说明，不宣称全部在当前安装包内。
- 补充通知中心的待处理/未读区别、降噪、去重、会话历史和进度反馈。保留原有站点连通性、节点筛选测速、覆写和双内核说明。
- 菜单栏双行实时速率标明 macOS；系统代理与 TUN 并行开关标明 macOS/Windows。iOS 仍未公开分发。

## 验证

- `VITE_BASE=/ npm --prefix apps/site run build` 通过（Netlify 根路径）；默认 /Crossbow/ 构建亦通过。
- 真实浏览器验证 1440×960、768×1024、390×844、320×740；未发现横向溢出。
- 首页节点/CTA 中心和下载按钮基线测量见 `previews/checks.json`。
- 实测手机菜单展开、Escape 关闭、动画暂停、Linux 指南跳转、通知功能段入口。
- GitHub API 可用时显示实际发布资产；等待/失败时仍显示可用的官方发布页入口。
- 设计 lint 见 `previews/design-lint.json`：保留用户已确认的描边卡片和导航按钮（outlined-box 警告），旧指南中文案破折号警告未扩张修改范围。安装步骤编号是有序操作，不是装饰编号。

## 留存与复现

实际渲染图保存在 `previews/`，不是营销素材。`source.zip` 包含完整可编辑的官网源码、字体/品牌资产和构建配置；不含 node_modules/dist。动效的可播放原型即该完整网站源码。

解压 source.zip 后，在 apps/site 运行 `npm ci`、`npm run dev -- --host 127.0.0.1 --port 5207`，打开 `http://127.0.0.1:5207/Crossbow/`。需要 Node 20.19+ 或 22.12+。
