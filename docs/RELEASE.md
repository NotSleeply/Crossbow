# 发版流程

## macOS（脚本自动化）

```bash
VERSION=v0.9.2 ./scripts/release-macos.sh
```

一次性前置：
1. 钥匙串含 **Developer ID Application** 证书（Xcode → Accounts → Manage Certificates 创建）
2. 公证凭据入钥匙串：
   ```bash
   xcrun notarytool store-credentials CROSSBOW_NOTARY \
     --apple-id <AppleID> --password <App专用密码> --team-id M8H9MSJT3S
   ```
   （App 专用密码在 appleid.apple.com → 登录与安全 → App 专用密码 生成）
3. 更新器私钥 `~/.tauri/crossbow.key`；`gh` 已登录

脚本依次：构建（含更新器签名）→ Developer ID 签名（hardened runtime）→ 公证 + staple → DMG → latest.json（手工确认 notes）→ 提交/tag → GitHub Release。

> 注意：tag 推送会触发 CI 的 unsigned 构建（供参考），正式产物以本脚本本地签名的为准。

## Windows

待 M1.5（当前仅 CI 产物，未签名）。

## iOS

M2：App Store / TestFlight 分发，NE entitlement 申请通过后配置。
