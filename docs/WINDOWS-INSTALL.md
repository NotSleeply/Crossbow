# Windows 安装与签名说明

Crossbow Windows 版使用**自签名证书**（B 方案，#82）做 Authenticode 代码签名。
自签名不能消除 SmartScreen 提示（那需要付费证书或长期信誉积累），但安装器会
显示发布者名称而非「未知发布者」。

## 安装步骤

1. 从 [Releases](https://github.com/Richard-Zhang1019/Crossbow/releases/latest)
   下载 `Crossbow_x.y.z_x64-setup.exe`。
2. 浏览器可能提示「此文件可能危害计算机」——点 `...` → **保留** → **仍然保留**
   （Crossbow 全程开源，安装包哈希见 Release 资产 SHA256SUMS，可自行核对）。
3. 双击安装器，SmartScreen 弹出「Windows 已保护你的电脑」时：
   点 **更多信息** → **仍要运行**。
4. 按安装器引导完成安装。安装器会顺带注册 `CrossbowService` 特权服务
   （开机自启）——TUN 模式依赖它以管理员权限运行内核，安装一次即授权一次，
   日后开关 TUN 不再弹任何窗口。

## 可选：信任签名证书（消除「未知发布者」安装警告）

信任我们的公开证书后，安装器的 UAC 弹窗会显示 `Crossbow` 而非「未知发布者」。
仓库内 `docs/crossbow-win-cert.cer` 即签名用公开证书（私钥不在仓库）。

以管理员 PowerShell 执行：

```powershell
certutil -addstore -f Root crossbow-win-cert.cer
```

不需要时移除：

```powershell
certutil -delstore Root Crossbow
```

> 注意：信任根证书即信任该证书签发的一切内容。Crossbow 的签名私钥仅用于
> 本项目发布物；若你对此有顾虑，跳过此步完全不影响使用（仅 UAC 显示差异）。

## 常见问题

- **TUN 开关报「service not running」**：服务未注册（多见于绿色版/便携运行）。
  重装一次安装器即可注册；或在应用内开关 TUN 时按提示完成一次性 UAC 兜底安装。
- **安装/升级后服务未启动**：以管理员执行 `sc start CrossbowService`。
- **校验安装包**：Release 页 SHA256SUMS 含全部资产哈希，
  `Get-FileHash Crossbow_*_x64-setup.exe` 比对即可。
