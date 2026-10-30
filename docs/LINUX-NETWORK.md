# Linux 网络接管（第二阶段，#216）

面向 CachyOS x86_64 + niri/Wayland。显式代理仍可独立使用；TUN 需要单独安装网络服务，当前只支持随安装提供的 mihomo。系统代理设置、正式 Linux 安装包及自动更新不在这一阶段开放。

## 开启前会发生什么

桌面先检查现有隧道、代理进程、IPv4/IPv6 策略路由和保留路由表。发现 FlClash、WireGuard、Tailscale 等冲突时直接返回原因，保留正在运行的显式代理；不会关闭其他程序、修改它们的配置或抢占端口。服务在真正启动前再检查一次，运行中发现新的冲突或自身路由丢失时停止本次接管。

检查通过后才请求系统授权。桌面保持普通用户权限，`pkexec` 只调用固定安装路径的 `crossbow-service --authorize`。它从 `PKEXEC_UID` 取得调用用户，启动固定名称的 systemd 临时服务 `crossbow-tun.service`：

- 服务和 mihomo 以该用户身份运行，仅有 `CAP_NET_ADMIN`；不授予 root 文件访问权限，不给桌面或下载内核设置 setuid/file capability。
- Unix socket 位于 `/run/crossbow-tun/control.sock`，目录 `0700`、socket `0600`；两端验证所属用户，桌面还验证服务程序身份。请求仅支持启动、状态和停止，不接受可执行程序路径或任意命令。
- 服务读取用户配置并生成受控副本，限制文件大小和 provider 相对路径，固定回环控制器及随机密钥，覆盖网络接管字段。订阅和覆写不能自行启用额外 TUN。
- 桌面到服务的连接在整个 TUN 会话中保持打开。配置变化复用已有的服务重启流程，重新经过检查，不直接向特权内核热重载未经处理的配置。

服务安装与一次系统授权是两件事。取消授权或服务启动失败会报告错误，原来的显式代理继续运行。服务正常停止后保留最多 30 秒空闲时间，供配置重启复用；桌面重新启动不会根据旧开关自动接管网络。

## 安装

需要 systemd、polkit、iproute2 和可用的 `/dev/net/tun`；niri 会话需要运行 polkit 认证代理。先从仓库根目录构建并检查产物，再明确执行安装：

```sh
cargo build --locked --release -p crossbow-service
sudo scripts/linux/install-service.sh \
  "$PWD/target/release/crossbow-service" \
  "$PWD/apps/desktop/src-tauri/binaries/mihomo-x86_64-unknown-linux-gnu"
```

脚本只安装 root 保护的 `/usr/lib/crossbow/{crossbow-service,mihomo}` 和 polkit action，不启动服务、不修改网络。运行中的 TUN 服务会阻止覆盖安装。缺少 sidecar 时先按 [Linux 测试说明](LINUX-TESTING.md) 下载仓库钉定版本。

安装后在设置页确认服务状态，再从首页或设置开启 TUN。Linux 的“服务已安装”不表示永久授权；系统仍会在新服务会话需要权限时确认。

卸载前先在桌面关闭 TUN，确认服务已停止且没有未恢复记录，再移除上述两个程序和 `/usr/share/polkit-1/actions/org.crossbow.tun.policy`。不要在接管过程中删除程序或恢复记录。

## 退出与恢复

服务只管理设备 `Crossbow`、路由表 `20220`、优先级 `12020` 和标记 `49451`，自己添加的路由/规则使用 protocol `242`。创建前检查占用，成功创建后记录精确资源与接口 ifindex，恢复时逐项核对、删除；不执行路由表全量 flush，不覆盖宿主快照。

普通关闭、桌面断连、内核退出、启动失败、冲突和路由漂移共用停止流程：先终止并回收自己的内核，再清理已确认资源。systemd 的 `KillMode=control-group` 和 `ExecStopPost` 提供进程异常退出后的兜底。清理失败会保留 `/run/crossbow-tun/network.json`，界面保留待确认状态，允许再次关闭重试。

若进程恰在内核接受创建命令、但成功记录尚未落盘的窗口中被杀，记录里的 `pending` 不能证明资源归属。此时服务保留记录并要求管理员核查，不自动删除这条未确认资源，也不允许下一次启动覆盖记录。接口 ifindex 已变化或出现重复匹配时同样停止自动恢复。`/run/crossbow-tun` 残留目录属于另一用户时不会自动改属主接管。

本实现不调用 resolvectl，不改 `/etc/resolv.conf` 或防火墙。公共目标经 TUN，私网、链路本地和组播等保留原路由；私网 DNS 也仍按原路由访问。这一阶段没有承诺 DNS 防泄漏或与其他 VPN 同时接管。

## 钉定内核的兼容处理

mihomo v1.19.32 使用 sing-tun v0.4.27。该版本即使 `auto-route: false`，非空 `inet6-address` 仍会生成额外的 IPv6 路由和 `oif` 规则。因此服务显式传入空数组，自行管理 IPv6 路由；gVisor 仍可转发 IPv6，已用真实 TCP 流量验证。内核的 `PATH` 限于 root 保护的安装目录，阻止旧版调用系统解析器工具。未改动其他平台的运行时注入。

依据：[sing-tun IPv6 规则](https://github.com/MetaCubeX/sing-tun/blob/v0.4.27/tun_linux.go#L496)、[gVisor 双栈处理](https://github.com/MetaCubeX/sing-tun/blob/v0.4.27/stack_gvisor.go#L91)、[pkexec 调用用户与授权](https://www.freedesktop.org/software/polkit/docs/master/pkexec.1.html)。

## 验证与未完成的实机验收

```sh
cargo test --locked -p crossbow-service
cargo test --locked --lib -p crossbow-desktop
cargo build --locked -p crossbow-service
python3 scripts/linux/smoke_network.py
```

网络脚本需要已安装的 bubblewrap 和允许创建的用户命名空间。它使用独立 user/PID/mount/network namespace、临时安装映射和真实 mihomo，不需要 sudo；宿主网络在前后只读对比。覆盖双栈 TCP、UDP DNS、正常停止、授权服务复用、端口冲突、桌面断连、内核 SIGKILL、外来策略路由保留、所属规则丢失以及独立的 `ExecStopPost` 清理入口。设置页和开关另有前端故障注入检查，不能代替真实权限故障。

2026-10-30：上述隔离场景通过；niri 实机的显式代理、已有代理/VPN 冲突拦截、失败保留原内核通过。两组验证的宿主路由/DNS 摘要均未变。当前机器没有安装此服务，也没有开启真实 TUN。

**第二阶段的宿主实网验收仍未完成。** 隔离环境没有启动真正的系统级 systemd/polkit，因此认证代理弹窗、取消授权、systemd 的服务属性生效及 `ExecStopPost` 自动执行仍需在专用测试环境验证；脚本只验证了同一个清理入口。不能把这些本机/隔离通过项当作完整日用或公开发布验收。详细结果见 [Linux 测试记录](LINUX-TESTING.md)。
