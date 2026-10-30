# Linux 第一阶段：CachyOS + niri/Wayland

关联 #213。Linux 目前提供显式 HTTP/SOCKS 代理；不修改系统代理、TUN、路由或 DNS。
Linux 能力由 Rust 返回，首页、设置与托盘据此禁用未支持入口；直接调用系统代理/TUN 命令也会失败。
订阅或覆写中的 TUN 入站在启动/热重载前被拒绝。应用自动更新在提供 Linux 发布产物前禁用。

## 本机开发与构建

依赖 Node.js 20+、pnpm、Rust stable、GTK 3、WebKitGTK 4.1、AppIndicator 和常规 C 构建工具。
本次使用 CachyOS x86_64、niri/Wayland，GTK 3.24.52、WebKitGTK 2.54.2。

```sh
pnpm install --frozen-lockfile
python3 scripts/ci/download_sidecar.py x86_64-unknown-linux-gnu
cd apps/desktop
CARGO_BUILD_JOBS=2 CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 \
  pnpm tauri build --debug --no-bundle \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

产物位于仓库根目录 `target/debug/crossbow-desktop`，旁边的 `mihomo` 是已核对上游 SHA-256 的 v1.19.32 内核。
Linux 内核下载映射同时支持 sing-box；第一阶段主验收内核为 mihomo，不能据此声明 sing-box 或其他架构完成日用验证。

本机运行可用 `GDK_BACKEND=wayland target/debug/crossbow-desktop`。
已有代理占用 7890 时，先在设置中选择未占用的混合端口，再导入配置并开启首页的“显式代理”。
应用需要主动将 HTTP 或 SOCKS 代理设到显示的回环地址；启动内核不等于浏览器已自动经过 Crossbow。

## 自动化原生验证

测试使用真实 WebKitGTK 窗口、Tauri IPC 和 mihomo，不替换前后端。
需要 `tauri-driver`、`WebKitWebDriver`、`curl` 与图形会话；可将驱动安装在单独目录：

```sh
cargo install tauri-driver --locked --root /tmp/crossbow-linux-tools
GDK_BACKEND=wayland python3 scripts/linux/smoke_desktop.py \
  --application target/debug/crossbow-desktop \
  --driver /tmp/crossbow-linux-tools/bin/tauri-driver \
  --output /tmp/crossbow-linux-loopback
```

脚本创建临时 XDG 配置/数据/缓存目录、空闲端口和本地订阅/HTTP 上游。
它从真实界面导入订阅、启停内核、选择节点，并通过 curl 的 HTTP 与 SOCKS5h 两条入口访问本地上游。
同时验证失败更新保留旧配置、真实日志展示、诊断跳过不支持项和停止后释放端口。
运行前后比较 IPv4/IPv6 路由、规则及 `/etc/resolv.conf` 的摘要，最后关闭验证实例并删除临时数据。
输出包含 `report.json`、原生 WebView 截图与驱动日志；均使用脱敏测试数据。

若已存在可用的本机 HTTP 代理，可额外验证外网链路：

```sh
GDK_BACKEND=wayland python3 scripts/linux/smoke_desktop.py \
  --application target/debug/crossbow-desktop \
  --driver /tmp/crossbow-linux-tools/bin/tauri-driver \
  --upstream-port 7890 \
  --output /tmp/crossbow-linux-external
```

此时链路为 **测试请求 → Crossbow 混合端口 → Crossbow mihomo → 现有本机代理 → 外网**。
测试不读取现有代理的订阅、凭据或控制器，也不修改它的设置；验证 HTTP 204 与 HTTPS CONNECT。
它证明 Crossbow 的真实代理链路工作，不能替代直接连接远端节点或独立 TUN 的验收。

## 回归与 CI

```sh
cargo test --locked -p crossbow-core
cargo test --locked --lib --manifest-path apps/desktop/src-tauri/Cargo.toml
node --experimental-strip-types --test apps/desktop/src/components/nodeFlags.test.mjs apps/desktop/src/components/fitGrid.test.mjs
python3 -m unittest discover -s scripts/ci/tests -v
```

`build.yml` 增加 Ubuntu 24.04 Linux 编译/测试任务，保留 macOS/Windows 原有验证。
CI 编译通过不是 niri/Wayland 实机通过；本机原生验证结果单独记录。

## 2026-10-30 本机验证结果

基于 `8f292be` 加本 PR 变更，在 CachyOS/niri 的原生 Wayland 会话中执行，未使用 Xvfb 或浏览器模拟页面。

| 项目 | 结果 |
|---|---|
| TypeScript/Vite、Tauri debug 原生程序 | 构建通过 |
| 桌面 Rust 单测 | 97 通过 |
| 共享核心单测 | 50 通过；另 2 项真实 store/sing-box 测试因未提供 `CROSSBOW_STORE` 提前返回，不计入真实验证 |
| 节点旗帜/网格组件测试 | 6 通过 |
| CI/发布脚本测试、源版本检查 | 20 通过，版本检查通过 |
| 本地 HTTP 上游闭环 | UI 导入/启停/选节点、HTTP/SOCKS5h、日志、更新失败恢复与 TUN 配置拒绝通过 |
| 现有 FlClash 7890 作为上游 | HTTP 与 SOCKS5h 请求均返回 204；HTTPS CONNECT 到 GitHub 返回 200 |
| 真实网络诊断 | 6/6 适用项通过，系统代理单独标为不适用 |
| 网络保全与退出 | 两次原生验证路由/DNS 摘要均未变化；停止后混合端口释放 |

最终外网验证程序 SHA-256：`3436e5b2fda56fbc6904e2a28f304308be12e03ef368e5f426e4a34866b8104c`。
本机报告与截图保存在工作树 `target/linux-validation/`，构建产物不提交到 Git。
首轮截图发现新增显式代理行超出接管卡片高度，已仅针对 Linux 调整布局，并在最终原生验证中检查控件边界。

## 尚未覆盖

- Linux 系统代理、TUN、特权服务、VPN 共存检测与网络恢复。
- 后台浮层不抢焦点、托盘速率、休眠恢复、开机自启及深链接的完整日用验收。
- sing-box 真实联网、多种远端协议、其他发行版/桌面/CPU 架构。
- AppImage/DEB/RPM、安装卸载、公开发布与应用自动更新。

现有托盘可用于重新打开窗口和退出；窗口关闭驻留行为保留。对无托盘宿主的桌面尚未作支持承诺。
诊断的系统代理项显示“不适用”，不计入通过数；其余网络检查按真实结果显示，不以编译或端口监听代替联网成功。

## 第二阶段先行修复（2026-10-30，#216）

这些修复放在 `codex/linux-network`，第一阶段 PR #214 的提交保持 `f6dccc1`，保留已启动的 CI。
网络接管和特权服务仍未开启。

- Linux 配置检查仅接受未设置、空值或明确为 `false` 的 `tun.enable`，拒绝 `yes/on`、字符串及其他含糊类型。检查前复用 YAML 库处理合并键，不能确认安全的剩余合并也会拒绝。
- 首页和诊断页停止失败时由已有后端回调报告错误；诊断不继续重启，首页重新读取真实状态。启动预检错误仍会显示。
- Linux 显式代理复用原有代理控制行，删除多余控制行和专用高度样式；未增加依赖或通知、进程管理框架。

验证结果：桌面 Rust 单测 99 项通过，新增的布尔兼容与 YAML 合并用例在修复前失败、修复后通过；前端及 Tauri 原生程序构建通过，完整分支差异的 `git diff --check` 通过。
原生脚本再次验证了订阅更新中的 `true`、`yes` 和合并键 TUN 配置拒绝、旧配置保留、HTTP/SOCKS5h 204、HTTPS 200、诊断和正常停止，路由/DNS 摘要未变。

界面检查使用隔离浏览器和临时 IPC 数据：停止失败只收到后端一条错误，诊断不继续启动；启动预检失败保留错误及关闭状态，成功启停不额外通知。五种尺寸（1120×720、880×560、1440×960、1120×1400、1920×600）与中英文、深浅主题的 20 个组合均无页面横向溢出，接管控件未超出面板。
这组故障注入验证的是前端分支，不代表真实操作系统拒绝终止进程的场景已实测。

本机证据位于 `target/linux-validation/fixes-native/` 和 `target/linux-validation/fixes-ui/`；原生程序 SHA-256 为 `c26549920c48aab4bbf7b9cb83ffa93ae4d47ff36923a09851fdee3576f7e3ee`。
